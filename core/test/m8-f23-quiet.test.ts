import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { schemaFile } from '../src/paths.ts';
import { notifyTick, quietNow, setSink } from '../src/notify.ts';
import { DEFAULTS } from '../src/settings.ts';

let settingsTime = 1_800_000_000;

async function withNotifyDb<T>(quietAtNight: boolean | undefined, run: (db: DatabaseSync) => Promise<T> | T): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), 'metatrooper-f23-'));
  const file = join(home, 'settings.json');
  if (quietAtNight !== undefined) {
    writeFileSync(file, JSON.stringify({ notify: { quiet_at_night: quietAtNight } }));
    // Each fixture gets a distinct mtime for the settings cache.
    utimesSync(file, ++settingsTime, settingsTime);
  }
  const oldHome = process.env.METATROOPER_HOME;
  const oldFake = process.env.METATROOPER_FAKE_DPAPI;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
  process.env.METATROOPER_HOME = home;
  process.env.METATROOPER_FAKE_DPAPI = '1';
  // Fake DPAPI is only available off Windows; keep these fixtures independent of PowerShell.
  if (process.platform === 'win32') Object.defineProperty(process, 'platform', { value: 'linux' });
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(schemaFile, 'utf8'));
    return await run(db);
  } finally {
    db.close();
    Object.defineProperty(process, 'platform', platform);
    if (oldHome === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = oldHome;
    if (oldFake === undefined) delete process.env.METATROOPER_FAKE_DPAPI; else process.env.METATROOPER_FAKE_DPAPI = oldFake;
    rmSync(home, { recursive: true, force: true });
  }
}

function withFakeWebhook() {
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => {
      bodies.push(body);
      res.writeHead(204);
      res.end();
    });
  });
  return new Promise<{ url: string; bodies: string[]; close: () => Promise<void> }>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('fake webhook did not bind TCP'));
      resolve({ url: `http://127.0.0.1:${address.port}/fake-webhook`, bodies, close: () => new Promise<void>((done) => server.close(() => done())) });
    });
  });
}

function insertGate(db: DatabaseSync, id: string): void {
  db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'gate', ?, ?)")
    .run(id, new Date().toISOString(), `gate-${id}`, `Waiting gate ${id}`);
}

test('notifications default to sending at 23:30 without settings.json', () => withNotifyDb(undefined, async (db) => {
  // protects=586b7a54 night suppression is opt-in in DEFAULTS and in a fresh home
  assert.equal(DEFAULTS.notify.quiet_at_night, false);
  const hook = await withFakeWebhook();
  try {
    setSink(db, { id: 'default-hook', kind: 'webhook', dest: hook.url, kinds: ['gate'], enabled: true });
    insertGate(db, 'default-night');
    await notifyTick(db, new Date(2026, 0, 15, 23, 30));
    assert.equal(hook.bodies.length, 1);
    assert.match(hook.bodies[0], /default-night/);
    assert.equal(typeof db.prepare('SELECT notified_at FROM needs_you WHERE id = ?').get('default-night')!.notified_at, 'string');
  } finally { await hook.close(); }
}));

test('a batch admitted at 21:59:59.9 rechecks the clock before sending after 22:00', (t) => withNotifyDb(true, async (db) => {
  // protects=586b7a54 each send checks elapsed time even when the tick began outside quiet hours
  const hook = await withFakeWebhook();
  try {
    setSink(db, { id: 'boundary-hook', kind: 'ntfy', dest: hook.url, kinds: ['gate'], enabled: true });
    insertGate(db, 'boundary-first');
    insertGate(db, 'boundary-second');
    const base = Date.now();
    let calls = 0;
    const clock = t.mock.method(Date, 'now', () => base + (calls++ === 0 ? 0 : 200));
    try {
      await notifyTick(db, new Date(2026, 0, 15, 21, 59, 59, 900));
    } finally { clock.mock.restore(); }
    assert.ok(calls > 1, 'clock advances after tick admission');
    assert.equal(hook.bodies.length, 0);
    assert.deepEqual(db.prepare('SELECT notified_at FROM needs_you ORDER BY rowid').all().map(r => r.notified_at), [null, null]);
    await notifyTick(db, new Date(2026, 0, 16, 7));
    assert.equal(hook.bodies.length, 2, 'deferred batch remains deliverable');
  } finally { await hook.close(); }
}));

test('M8-F23b quietNow uses the local 22:00 inclusive and 07:00 exclusive boundaries', () => withNotifyDb(true, () => {
  // protects=M8-F23b: quiet hours span local midnight with exact start and end boundaries.
  for (const [hour, minute, expected] of [[21, 59, false], [22, 0, true], [6, 59, true], [7, 0, false]] as const) {
    assert.equal(quietNow(new Date(2026, 0, 15, hour, minute)), expected, `${hour}:${minute}`);
  }
}));

test('M8-F23b quietNow is false at every boundary when quiet hours are disabled', () => withNotifyDb(false, () => {
  // protects=M8-F23b: the persisted quiet_at_night opt-out applies on both sides of midnight.
  for (const [hour, minute] of [[21, 59], [22, 0], [6, 59], [7, 0]]) {
    assert.equal(quietNow(new Date(2026, 0, 15, hour, minute)), false, `${hour}:${minute}`);
  }
}));

test('M8-F23b a quiet tick keeps a gate pending and a morning tick delivers it once', () => withNotifyDb(true, async (db) => {
  // protects=M8-F23b: quiet hours preserve the waiting PC row for one morning delivery.
  const hook = await withFakeWebhook();
  try {
    setSink(db, { id: 'quiet-hook', kind: 'ntfy', dest: hook.url, kinds: ['gate'], enabled: true });
    const id = 'f23-quiet-gate';
    insertGate(db, id);
    const row = () => db.prepare('SELECT notified_at, resolved_at, kind, text FROM needs_you WHERE id = ?').get(id);
    const waiting = row();
    assert.ok(waiting);
    assert.equal(waiting.notified_at, null);
    assert.equal(waiting.resolved_at, null);

    await notifyTick(db, new Date(2026, 0, 15, 23, 30));
    assert.equal(hook.bodies.length, 0);
    assert.deepEqual(row(), waiting);

    await notifyTick(db, new Date(2026, 0, 16, 8, 0));
    assert.equal(hook.bodies.length, 1);
    assert.equal(hook.bodies[0], `cc (approval needed): Waiting gate ${id}`);
    const delivered = row();
    assert.ok(delivered);
    assert.equal(delivered.resolved_at, null);
    assert.equal(typeof delivered.notified_at, 'string');
    assert.ok(Number.isFinite(Date.parse(delivered.notified_at as string)));

    await notifyTick(db, new Date(2026, 0, 16, 8, 0));
    assert.equal(hook.bodies.length, 1);
    assert.deepEqual(row(), delivered);
  } finally { await hook.close(); }
}));

test('Q9b a webhook sink still sends at 23:30 with Never at night on', () => withNotifyDb(true, async (db) => {
  const hook = await withFakeWebhook();
  try {
    setSink(db, { id: 'q9b-hook', kind: 'webhook', dest: hook.url, kinds: ['gate'], enabled: true });
    const id = 'q9b-night-gate';
    insertGate(db, id);

    await notifyTick(db, new Date(2026, 0, 15, 23, 30));
    assert.equal(hook.bodies.length, 1);
    const body = JSON.parse(hook.bodies[0]);
    assert.equal(body.id, id);
    assert.equal(body.text, `cc (approval needed): Waiting gate ${id}`);
    assert.equal(body.link, `metatrooper://needs-you/${id}`);
    const row = db.prepare('SELECT notified_at FROM needs_you WHERE id = ?').get(id);
    assert.ok(row);
    assert.equal(typeof row.notified_at, 'string');
    assert.ok(Number.isFinite(Date.parse(row.notified_at as string)));
  } finally { await hook.close(); }
}));

test('Q9b a slack-webhook sink still sends at 23:30 with Never at night on', () => withNotifyDb(true, async (db) => {
  const hook = await withFakeWebhook();
  try {
    setSink(db, { id: 'q9b-slack', kind: 'slack-webhook', dest: hook.url, kinds: ['gate'], enabled: true });
    const id = 'q9b-slack-night-gate';
    insertGate(db, id);

    await notifyTick(db, new Date(2026, 0, 15, 23, 30));
    assert.equal(hook.bodies.length, 1);
    const body = JSON.parse(hook.bodies[0]);
    assert.equal(body.text, `cc (approval needed): Waiting gate ${id}\nmetatrooper://needs-you/${id}`);
    const row = db.prepare('SELECT notified_at FROM needs_you WHERE id = ?').get(id);
    assert.ok(row);
    assert.equal(typeof row.notified_at, 'string');
    assert.ok(Number.isFinite(Date.parse(row.notified_at as string)));
  } finally { await hook.close(); }
}));

test('Q9b one gate with an ntfy and a webhook sink at night: webhook gets it now, ntfy only at 07:00, row notified once both are done', () => withNotifyDb(true, async (db) => {
  const phone = await withFakeWebhook();
  try {
    const hook = await withFakeWebhook();
    try {
      setSink(db, { id: 'q9b-phone', kind: 'ntfy', dest: phone.url, kinds: ['gate'], enabled: true });
      setSink(db, { id: 'q9b-hook', kind: 'webhook', dest: hook.url, kinds: ['gate'], enabled: true });
      const id = 'q9b-mixed-gate';
      insertGate(db, id);
      const row = () => db.prepare('SELECT notified_at FROM needs_you WHERE id = ?').get(id)!;
      const deliveries = () => db.prepare(`SELECT s.id, COALESCE(d.state, 'pending') AS state, COALESCE(d.tries, 0) AS tries
        FROM notify_sink s LEFT JOIN notify_delivery d ON d.sink_id = s.id AND d.needs_you_id = ?
        ORDER BY s.id`).all(id).map(r => [r.id, r.state, r.tries]);

      await notifyTick(db, new Date(2026, 0, 15, 23, 30));
      assert.equal(hook.bodies.length, 1);
      assert.equal(JSON.parse(hook.bodies[0]).id, id);
      assert.equal(phone.bodies.length, 0);
      assert.deepEqual(deliveries(), [['q9b-hook', 'done', 1], ['q9b-phone', 'pending', 0]]);
      assert.equal(row().notified_at, null);

      await notifyTick(db, new Date(2026, 0, 16, 6, 59));
      assert.equal(hook.bodies.length, 1);
      assert.equal(phone.bodies.length, 0);
      assert.deepEqual(deliveries(), [['q9b-hook', 'done', 1], ['q9b-phone', 'pending', 0]]);
      assert.equal(row().notified_at, null);

      await notifyTick(db, new Date(2026, 0, 16, 7, 0));
      assert.equal(hook.bodies.length, 1);
      assert.deepEqual(phone.bodies, [`cc (approval needed): Waiting gate ${id}`]);
      assert.deepEqual(deliveries(), [['q9b-hook', 'done', 1], ['q9b-phone', 'done', 1]]);
      const delivered = row();
      assert.equal(typeof delivered.notified_at, 'string');
      assert.ok(Number.isFinite(Date.parse(delivered.notified_at as string)));

      await notifyTick(db, new Date(2026, 0, 16, 7, 0));
      assert.equal(hook.bodies.length, 1);
      assert.equal(phone.bodies.length, 1);
      assert.deepEqual(deliveries(), [['q9b-hook', 'done', 1], ['q9b-phone', 'done', 1]]);
      assert.deepEqual(row(), delivered);
    } finally { await hook.close(); }
  } finally { await phone.close(); }
}));

test('M8-F23b disabling quiet hours permits a 23:30 gate delivery', () => withNotifyDb(false, async (db) => {
  // protects=M8-F23b: settings.json can opt into alerts during the night.
  const hook = await withFakeWebhook();
  try {
    setSink(db, { id: 'night-hook', kind: 'webhook', dest: hook.url, kinds: ['gate'], enabled: true });
    const id = 'f23-night-gate';
    insertGate(db, id);
    await notifyTick(db, new Date(2026, 0, 15, 23, 30));
    assert.equal(hook.bodies.length, 1);
    assert.ok(hook.bodies[0].includes(`metatrooper://needs-you/${id}`));
    const row = db.prepare('SELECT notified_at FROM needs_you WHERE id = ?').get(id);
    assert.ok(row);
    assert.equal(typeof row.notified_at, 'string');
    assert.ok(Number.isFinite(Date.parse(row.notified_at as string)));
  } finally { await hook.close(); }
}));
