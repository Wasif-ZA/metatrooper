import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, isolation, root, sleep, until } from './helpers.ts';
import { migrate } from '../src/store/db.ts';
import { ownership, parseNetstat, parseUrls } from '../src/devservers.ts';

const windows = process.platform === 'win32';
const home = isolation();
const prior = { ...process.env };
let db: DatabaseSync;
let term: typeof import('../src/terminal/index.ts');
let dev: typeof import('../src/devservers.ts');
let ticker: NodeJS.Timeout;

before(async () => {
  if (!windows) return;
  await buildGenerated();
  Object.assign(process.env, home.env);
  mkdirSync(home.home, { recursive: true });
  const { openCoreDb } = await import('../src/store/db.ts');
  const { wireTermEvents } = await import('../src/terminal/events.ts');
  term = await import('../src/terminal/index.ts');
  dev = await import('../src/devservers.ts');
  db = openCoreDb();
  const at = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p-ports', home.home, 'ports', at, at);
  db.prepare("INSERT OR IGNORE INTO engine (id, spec_json, cost_rank) VALUES ('fake', '{}', 1)").run();
  wireTermEvents(db);
  ticker = setInterval(() => { void dev.pollDevServers(db); }, 1000);
});

after(async () => {
  clearInterval(ticker);
  term?.killAll();
  await sleep(300);
  try { db?.close(); } catch {}
  rmSync(home.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
  Object.assign(process.env, prior);
});

function session(): string {
  const id = `s-${randomUUID()}`;
  const at = new Date().toISOString();
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p-ports', 'fake', 'pty', 'working', ?, ?)").run(id, at, at);
  return id;
}

function rows(sessionId: string) {
  return db.prepare('SELECT port, url, pid, matched_by, status FROM session_dev_server WHERE session_id = ?').all(sessionId) as Array<{ port: number; url: string; pid: number; matched_by: string; status: string }>;
}

/** Waits until the session's terminal shows text matching `re`, and returns when it was seen. */
async function printed(id: string, re: RegExp): Promise<{ at: number; match: RegExpMatchArray }> {
  const match = await until(async () => (await term.snapshot(id))?.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').match(re), 20_000);
  return { at: Date.now(), match };
}

function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

test('M6-03 parseUrls takes the port from each loopback URL, through colour escapes, and skips a cut-off port', () => {
  const vite = '  \x1b[32m➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\r\n';
  assert.deepEqual(parseUrls(vite), [{ url: 'http://localhost:5173/', port: 5173 }]);
  assert.deepEqual(parseUrls('ready on http://127.0.0.1:3000/app?x=1, and http://[::1]:8080.\n'), [
    { url: 'http://127.0.0.1:3000/app?x=1', port: 3000 },
    { url: 'http://[::1]:8080/', port: 8080 },
  ]);
  assert.deepEqual(parseUrls('http://localhost:51'), []);
  assert.deepEqual(parseUrls('https://localhost:5173/ http://example.com:80/ http://localhost:99999/ http://0.0.0.0:3000/\n'), []);
});

test('M6-03 parseNetstat keeps loopback and any-address listeners with their pids', () => {
  const out = [
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1200',
    '  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       42',
    '  TCP    192.168.1.5:7000       0.0.0.0:0              LISTENING       9',
    '  TCP    127.0.0.1:5173         127.0.0.1:50000        ESTABLISHED     42',
    '  TCP    [::1]:5173             [::]:0                 ABHÖREN         42',
    '  TCP    [::]:3000              [::]:0                 LISTENING       7',
    '  TCP    [::]:3000              [::]:0                 LISTENING       8',
    '  UDP    127.0.0.1:5353         *:*                                    3',
  ].join('\r\n');
  const map = parseNetstat(out);
  assert.deepEqual([...map.keys()].sort((a, b) => a - b), [135, 3000, 5173]);
  assert.deepEqual([...map.get(5173)!], [42]);
  assert.deepEqual([...map.get(3000)!].sort(), [7, 8]);
});

test('M6-03 ownership: ancestry beats the snapshot, printed needs a port absent at the print', () => {
  const parents = new Map([[50, 40], [40, 30], [30, 1], [70, 999]]);
  assert.equal(ownership(50, 30, parents, true), 'ancestry');
  assert.equal(ownership(70, 30, parents, false), 'printed');
  assert.equal(ownership(70, 30, parents, true), null);
  assert.equal(ownership(70, null, parents, false), 'printed');
});

test('M6-03a a dev server in the session terminal gets an ancestry row within 2 s of its URL, and stops with the session', { skip: !windows, timeout: 30_000 }, async () => {
  const id = session();
  const code = "require('http').createServer((q,r)=>r.end('ok')).listen(0,'127.0.0.1',function(){console.log('  Local:   http://localhost:'+this.address().port+'/');setInterval(()=>{},1000)})";
  writeFileSync(join(home.home, 'ancestry-server.js'), code);
  term.open(id, ['cmd.exe', '/d', '/k', 'node ancestry-server.js'], home.home, process.env, 120, 30);
  const seen = await printed(id, /http:\/\/localhost:(\d+)\//);
  const port = Number(seen.match[1]);
  const [row] = await until(() => rows(id).length && rows(id), 2000);
  assert.ok(Date.now() - seen.at <= 2000);
  assert.equal(row.matched_by, 'ancestry');
  assert.equal(row.status, 'ready');
  assert.equal(row.port, port);
  assert.equal(row.url, `http://localhost:${port}/`);
  term.kill(id);
  await until(() => rows(id)[0].status === 'stopped', 5000);
});

test('M6-03b npm run dev that starts a detached child gets a printed row; the row stops when the port does', { skip: !windows, timeout: 60_000 }, async () => {
  const dir = join(home.home, `npm-${randomUUID()}`);
  mkdirSync(dir);
  const port = await freePort();
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', private: true, scripts: { dev: 'node spawner.js' } }));
  writeFileSync(join(dir, 'spawner.js'), [
    "const { spawn } = require('child_process');",
    `console.log('dev server: http://localhost:${port}/');`,
    "spawn(process.execPath, [__dirname + '/server.js'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();",
  ].join('\n'));
  writeFileSync(join(dir, 'server.js'), `setTimeout(() => require('http').createServer((q, r) => r.end('ok')).listen(${port}, '127.0.0.1'), 1500);`);
  const id = session();
  term.open(id, ['cmd.exe', '/d', '/k', 'npm run dev'], dir, process.env, 120, 30);
  await printed(id, new RegExp(`http://localhost:${port}/`));
  const [row] = await until(() => rows(id).length && rows(id), 15_000);
  assert.equal(row.matched_by, 'printed');
  assert.equal(row.status, 'ready');
  assert.equal(row.port, port);
  process.kill(row.pid);
  await until(async () => { await dev.sweepDevServers(db); return rows(id)[0].status === 'stopped'; }, 10_000);
  term.kill(id);
});

test('M6-03b a port served from outside MetaTrooper before the URL was printed gets no row', { skip: !windows, timeout: 30_000 }, async () => {
  const outside: Server = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => outside.once('listening', r));
  const port = (outside.address() as { port: number }).port;
  try {
    await dev.pollDevServers(db);
    const id = session();
    term.open(id, [process.execPath, '-e', `console.log('open http://localhost:${port}/');setInterval(()=>{},1000)`], home.home, process.env, 120, 30);
    await printed(id, new RegExp(`localhost:${port}`));
    await sleep(3000);
    assert.deepEqual(rows(id), []);
    term.kill(id);
  } finally {
    outside.close();
  }
});

test('M6-03 a process table that fails to load leaves the URL watched, so the server still gets its ancestry row', { skip: !windows, timeout: 30_000 }, async () => {
  const id = session();
  const table = dev.probe.parentTableAsync;
  let failed = 0;
  dev.probe.parentTableAsync = async () => { failed++; return new Map(); };
  try {
    const code = "require('http').createServer((q,r)=>r.end('ok')).listen(0,'127.0.0.1',function(){console.log('  Local:   http://localhost:'+this.address().port+'/');setInterval(()=>{},1000)})";
    writeFileSync(join(home.home, 'probe-fail-server.js'), code);
    term.open(id, ['cmd.exe', '/d', '/k', 'node probe-fail-server.js'], home.home, process.env, 120, 30);
    await printed(id, /http:\/\/localhost:(\d+)\//);
    await until(() => failed > 0, 10_000);
    await dev.pollDevServers(db);
  } finally {
    dev.probe.parentTableAsync = table;
  }
  const [row] = await until(() => rows(id).length && rows(id), 10_000);
  assert.equal(row.matched_by, 'ancestry');
  term.kill(id);
});

test('M6-03 migration 002 is recorded and both tables exist', { skip: !windows }, () => {
  assert.ok(db.prepare('SELECT 1 FROM schema_migration WHERE id = 2').get());
  for (const t of ['session_port', 'session_dev_server']) assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t), t);
});

test('M6-03 leasePort leases from session_port, skipping leased and listening ports', { skip: !windows }, async () => {
  const { leasePort, releasePorts } = await import('../src/ports.ts');
  const id = session();
  const busy = createServer().listen(3001, '127.0.0.1');
  await new Promise((r) => { busy.once('listening', r); busy.once('error', r); });
  try {
    const a = await leasePort(db, id);
    const b = await leasePort(db, id);
    assert.ok(a > 3001 && b > a);
    assert.deepEqual((db.prepare('SELECT port FROM session_port WHERE session_id = ? ORDER BY port').all(id) as Array<{ port: number }>).map((r) => r.port), [a, b]);
    releasePorts(db, id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_port WHERE session_id = ?').get(id)!.n, 0);
  } finally {
    busy.close();
  }
});

test('M6-03 migration 002 upgrades an M6-4 database to the tables schema.sql defines', () => {
  const before = execFileSync('git', ['show', 'ce27246~1:contracts/schema.sql'], { cwd: root, encoding: 'utf8' });
  assert.doesNotMatch(before, /session_dev_server/);
  const old = new DatabaseSync(':memory:');
  const fresh = new DatabaseSync(':memory:');
  try {
    old.exec(before);
    assert.deepEqual(migrate(old), [1, 2, 3]);
    assert.deepEqual(old.prepare('PRAGMA foreign_key_check').all(), []);
    fresh.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
    const sql = (d: DatabaseSync) => d.prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('session_port', 'session_dev_server') ORDER BY name").all();
    assert.equal(sql(old).length, 2);
    assert.deepEqual(sql(old), sql(fresh));
  } finally {
    old.close();
    fresh.close();
  }
});
