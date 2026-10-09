import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { schemaFile } from '../src/paths.ts';
import { notifyTick, setSink } from '../src/notify.ts';
import { buildGenerated, client, isolation, sleep, startCore, stopCore, teardownCore, uiHello, until } from './helpers.ts';

function withFakeWebhook(onRequest: (body: string) => void, status = 204, headers: Record<string, string> = {}) {
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => { body += chunk; });
    req.on('end', () => {
      bodies.push(body);
      onRequest(body);
      res.writeHead(status, headers);
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

function withNotifyDb<T>(run: (db: DatabaseSync, home: string) => Promise<T> | T): Promise<T> {
  const isolated = isolation();
  const env = { ...isolated.env, METATROOPER_FAKE_DPAPI: '1' };
  const oldHome = process.env.METATROOPER_HOME;
  const oldFake = process.env.METATROOPER_FAKE_DPAPI;
  process.env.METATROOPER_HOME = isolated.home;
  process.env.METATROOPER_FAKE_DPAPI = '1';
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(schemaFile, 'utf8'));
  return Promise.resolve().then(() => run(db, isolated.home)).finally(() => {
    db.close();
    rmSync(isolated.home, { recursive: true, force: true });
    if (oldHome === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = oldHome;
    if (oldFake === undefined) delete process.env.METATROOPER_FAKE_DPAPI; else process.env.METATROOPER_FAKE_DPAPI = oldFake;
  });
}

function notifySink(db: DatabaseSync, id: string, dest: string, name = id): void {
  setSink(db, { id, kind: 'webhook', name, dest, kinds: ['gate'] });
}

function insertNotifyGate(db: DatabaseSync, id: string, at: string): void {
  db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'gate', ?, ?)").run(id, at, `gate-${id}`, `fixture ${id}`);
}

function insertGate(dbFile: string, id: string, text: string, at = new Date().toISOString()): void {
  const db = new DatabaseSync(dbFile);
  try {
    db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'gate', ?, ?)").run(id, at, `gate-${id}`, text);
  } finally { db.close(); }
}

async function waitFor<T>(read: () => T, predicate: (value: T) => boolean, ms = 4000): Promise<T> {
  return until(() => {
    const value = read();
    return predicate(value) ? value : false;
  }, ms);
}

async function withCore(fn: (home: string, prefix: string) => Promise<void>): Promise<void> {
  const isolated = isolation();
  const env = { ...isolated.env, METATROOPER_FAKE_DPAPI: '1', METATROOPER_ENGINES: join(isolated.home, 'engines.json') };
  writeFileSync(env.METATROOPER_ENGINES, '[]');
  let core = await startCore({ ...isolated, env });
  try { await fn(isolated.home, isolated.prefix); }
  finally { await teardownCore(core, isolated); rmSync(isolated.home, { recursive: true, force: true }); }
}

async function startAgain(home: string, prefix: string): Promise<ReturnType<typeof startCore> extends Promise<infer T> ? T : never> {
  const env = { ...process.env, METATROOPER_HOME: home, METATROOPER_PIPE_PREFIX: prefix, METATROOPER_FAKE_DPAPI: '1', METATROOPER_ENGINES: join(home, 'engines.json') };
  const child = await startCore({ home, prefix, env, started: Date.now() });
  return child as never;
}

test('M5-15a/b new gate sends one redacted POST with the stable needs-you link', async () => {
  await withCore(async (home, prefix) => {
    const received = await withFakeWebhook(() => {});
    try {
      const c = await client(prefix);
      await uiHello(c, home);
      const sink = await c.request('notify.sink.set', { id: 'fake-hook', kind: 'webhook', name: 'fixture webhook', dest: received.url, kinds: ['gate'] });
      assert.deepEqual(sink.result, { id: 'fake-hook' });
      const id = '01J9FAKEGATE000000000000001';
      const actionArgs = 'FAKE_ACTION_ARGS_DO_NOT_SEND';
      const runDir = join(home, 'runs', 'must-not-leak');
      insertGate(join(home, 'troop.db'), id, `Approval required; ${actionArgs}; ${runDir}`);
      await waitFor(() => received.bodies.length, (n) => n === 1, 4000);
      await sleep(2300);
      assert.equal(received.bodies.length, 1);
      const body = received.bodies[0];
      assert.match(body, /gate/);
      assert.match(body, /Approval required/);
      assert.ok(body.includes(`metatrooper://needs-you/${id}`));
      assert.ok(!body.includes(actionArgs));
      assert.ok(!body.includes(runDir));
      assert.ok(!body.includes(received.url));
      c.close();
    } finally { await received.close(); }
  });
});

test('M5-15c notify.sink.set requires ui.hello', async () => {
  await withCore(async (_home, prefix) => {
    const c = await client(prefix);
    const response = await c.request('notify.sink.set', { kind: 'webhook', name: 'fixture', dest: 'http://127.0.0.1:43210/fake', kinds: ['gate'] });
    assert.equal(response.error?.code, -32012);
    assert.match(response.error?.message ?? '', /needs a trusted UI connection \(ui\.hello\)/);
    c.close();
  });
});

test('M5-15d webhook secret is absent from database, logs and home files except its DPAPI file', async () => {
  await withCore(async (home, prefix) => {
    const received = await withFakeWebhook(() => {});
    try {
      const c = await client(prefix);
      await uiHello(c, home);
      await c.request('notify.sink.set', { id: 'storage-hook', kind: 'webhook', name: 'fixture', dest: received.url, kinds: ['gate'] });
      const dbContents = readFileSync(join(home, 'troop.db'));
      assert.equal(dbContents.includes(Buffer.from(received.url)), false);
      const hits: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const { name } = entry;
          const file = join(dir, name);
          if (entry.isDirectory()) walk(file);
          else if (readFileSync(file).includes(Buffer.from(received.url)) && !file.endsWith('.dpapi')) hits.push(file);
        }
      };
      walk(home);
      assert.deepEqual(hits, []);
      const logs = join(home, 'logs');
      if (existsSync(logs)) assert.equal(readdirSync(logs, { recursive: true }).some((name) => String(name).includes('log.jsonl')), false);
      c.close();
    } finally { await received.close(); }
  });
});

test('M5-15e queued rows survive a core restart and are delivered exactly once', async () => {
  const isolated = isolation();
  const env = { ...isolated.env, METATROOPER_FAKE_DPAPI: '1', METATROOPER_ENGINES: join(isolated.home, 'engines.json') };
  writeFileSync(env.METATROOPER_ENGINES, '[]');
  let core = await startCore({ ...isolated, env });
  const received = await withFakeWebhook(() => {});
  try {
    const c = await client(isolated.prefix);
    await uiHello(c, isolated.home);
    await c.request('notify.sink.set', { id: 'restart-hook', kind: 'webhook', name: 'restart fixture', dest: received.url, kinds: ['gate'] });
    c.close();
    const id = '01J9FAKERESTART000000000001';
    insertGate(join(isolated.home, 'troop.db'), id, 'queued before restart');
    await stopCore(core, isolated);
    core = await startAgain(isolated.home, isolated.prefix);
    await waitFor(() => received.bodies.length, (n) => n === 1, 4000);
    await sleep(2300);
    assert.equal(received.bodies.length, 1);
    assert.ok(received.bodies[0].includes(id));
    const db = new DatabaseSync(join(isolated.home, 'troop.db'));
    try {
      const row = db.prepare('SELECT notified_at FROM needs_you WHERE id=?').get(id) as { notified_at: string };
      assert.match(row.notified_at, /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/);
    } finally { db.close(); }
  } finally {
    await teardownCore(core, isolated);
    await received.close();
    rmSync(isolated.home, { recursive: true, force: true });
  }
});

test('Delivery rules mark old rows skipped and failed deliveries with the prescribed suffix', async () => {
  await withCore(async (home, prefix) => {
    const c = await client(prefix);
    await uiHello(c, home);
    await c.request('notify.sink.set', { id: 'old-hook', kind: 'webhook', name: 'old fixture', dest: 'http://127.0.0.1:1/fake-webhook', kinds: ['gate'] });
    c.close();
    const staleId = '01J9FAKESTALE0000000000001';
    insertGate(join(home, 'troop.db'), staleId, 'old queued item', '2026-10-07T00:00:00.000Z');
    const failedId = '01J9FAKEFAILED00000000001';
    insertGate(join(home, 'troop.db'), failedId, 'delivery to unavailable loopback', new Date().toISOString());
    const { notifyTick } = await import('../src/notify.ts');
    const db = new DatabaseSync(join(home, 'troop.db'));
    try {
      await notifyTick(db);
      const skipped = db.prepare('SELECT notified_at FROM needs_you WHERE id=?').get(staleId) as { notified_at: string };
      assert.match(skipped.notified_at, /^\d{4}-\d\d-\d\dT.* skipped$/);
      const failed = db.prepare('SELECT notified_at FROM needs_you WHERE id=?').get(failedId) as { notified_at: string | null };
      assert.equal(failed.notified_at, null, 'first delivery attempt schedules retries without marking the row failed');
    } finally { db.close(); }
  });
});

test('M5-15 restart safety persists each sink delivery independently', async () => {
  await withNotifyDb(async (db) => {
    const success = await withFakeWebhook(() => {});
    const failure = await withFakeWebhook(() => {}, 500);
    try {
      notifySink(db, 'restart-success', success.url);
      notifySink(db, 'restart-failure', failure.url);
      const id = '01J9RESTARTSINK000000000001';
      insertNotifyGate(db, id, new Date().toISOString());
      await notifyTick(db);
      assert.equal(success.bodies.length, 1);
      assert.equal(failure.bodies.length, 1);
      // A fresh tick simulates a process restart: delivery state is recovered solely from SQLite.
      await notifyTick(db);
      assert.equal(success.bodies.length, 1, 'successful sink must not receive a duplicate POST');
    } finally { await success.close(); await failure.close(); }
  });
});

test('M5-15 backoff does not starve a newer needs-you row', async () => {
  await withNotifyDb(async (db) => {
    const failing = await withFakeWebhook(() => {}, 500);
    const succeeding = await withFakeWebhook(() => {});
    try {
      notifySink(db, 'backoff-fail', failing.url);
      notifySink(db, 'backoff-pass', succeeding.url);
      const start = Date.now() - 60_000;
      for (let i = 0; i < 50; i++) insertNotifyGate(db, `01J9BACKOFF${String(i).padStart(14, '0')}`, new Date(start + i).toISOString());
      await notifyTick(db);
      assert.equal(failing.bodies.length, 50);
      const newerId = '01J9BACKOFFNEWER000000000001';
      insertNotifyGate(db, newerId, new Date(Date.now() + 1000).toISOString());
      await notifyTick(db);
      await notifyTick(db);
      assert.ok(succeeding.bodies.some((body) => body.includes(newerId)), 'new row should be delivered within two ticks');
    } finally { await failing.close(); await succeeding.close(); }
  });
});

test('M5-15 redirect responses fail without posting to the redirect target', async () => {
  await withNotifyDb(async (db) => {
    const target = await withFakeWebhook(() => {});
    const redirect = await withFakeWebhook(() => {}, 302, { location: target.url });
    try {
      notifySink(db, 'redirect-source', redirect.url);
      insertNotifyGate(db, '01J9REDIRECT00000000000001', new Date().toISOString());
      await notifyTick(db);
      assert.equal(redirect.bodies.length, 1);
      assert.equal(target.bodies.length, 0);
      const delivery = db.prepare('SELECT state FROM notify_delivery WHERE sink_id=?').get('redirect-source') as { state: string };
      assert.equal(delivery.state, 'pending', 'redirect is a failed first attempt and enters retry backoff');
    } finally { await redirect.close(); await target.close(); }
  });
});
