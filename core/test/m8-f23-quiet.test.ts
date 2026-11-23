import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { schemaFile } from '../src/paths.ts';
import { notifyTick, quietNow, setSink } from '../src/notify.ts';

let settingsTime = 1_800_000_000;

async function withNotifyDb<T>(quietAtNight: boolean, run: (db: DatabaseSync) => Promise<T> | T): Promise<T> {
  const home = mkdtempSync(join(tmpdir(), 'metatrooper-f23-'));
  const file = join(home, 'settings.json');
  writeFileSync(file, JSON.stringify({ notify: { quiet_at_night: quietAtNight } }));
  // Each fixture gets a distinct mtime for the settings cache.
  utimesSync(file, ++settingsTime, settingsTime);
  const oldHome = process.env.METATROOPER_HOME;
  const oldFake = process.env.METATROOPER_FAKE_DPAPI;
  process.env.METATROOPER_HOME = home;
  process.env.METATROOPER_FAKE_DPAPI = '1';
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(schemaFile, 'utf8'));
    return await run(db);
  } finally {
    db.close();
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
    setSink(db, { id: 'quiet-hook', kind: 'webhook', dest: hook.url, kinds: ['gate'], enabled: true });
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
    assert.ok(hook.bodies[0].includes(`metatrooper://needs-you/${id}`));
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
