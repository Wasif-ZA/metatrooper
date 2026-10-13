import test from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate, openCoreDb } from '../src/store/db.ts';
import { CommandRunner, type MethodSpec } from '../src/pipe/commands.ts';
import { isolation, withEnv } from './helpers.ts';

function coreDb(t): DatabaseSync {
  const isolated = isolation();
  const db = withEnv({ METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix }, openCoreDb);
  t.after(() => {
    db.close();
    rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return db;
}

function tempDir(t): string {
  const dir = mkdtempSync(join(tmpdir(), 'mt-harden-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

test('migrate refuses two files with the same id and applies neither', t => {
  const dir = tempDir(t);
  writeFileSync(join(dir, '903-a.sql'), 'CREATE TABLE from_a (id INTEGER);');
  writeFileSync(join(dir, '903-b.sql'), 'CREATE TABLE from_b (id INTEGER);');
  const db = new DatabaseSync(':memory:');
  try {
    assert.throws(() => migrate(db, dir), /903-a\.sql.*903-b\.sql/);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('from_a', 'from_b')").get(), undefined);
  } finally { db.close(); }
});

test('a queued command whose params do not parse fails alone and the rows behind it still run', async t => {
  const db = coreDb(t);
  const ran: unknown[] = [];
  const methods = new Map<string, MethodSpec>([['fixture.do', { handler: (p) => { ran.push(p); return {}; } }]]);
  const insert = db.prepare("INSERT INTO command (id, at, origin, method, params, status) VALUES (?, '2026-10-14T00:00:00+11:00', 'cli', 'fixture.do', ?, 'queued')");
  insert.run('bad', '{');
  insert.run('good', '{"n":1}');
  await new CommandRunner(db, methods).drainQueued();
  assert.deepEqual(ran, [{ n: 1 }]);
  const status = (id: string) => (db.prepare('SELECT status FROM command WHERE id = ?').get(id) as { status: string }).status;
  assert.equal(status('bad'), 'error');
  assert.equal(status('good'), 'ok');
});

function clientScript(t, body: string[], home?: string) {
  const dir = tempDir(t);
  const script = [
    "const net = await import('node:net');",
    "const { call } = await import('./src/pipe/client.ts');",
    "const { corePipe } = await import('./src/paths.ts');",
    "const server = net.createServer((s) => s.resume());",
    'await new Promise((r) => server.listen(corePipe(), r));',
    ...body,
    'server.close();',
  ].join('\n');
  const env = { ...process.env, METATROOPER_HOME: home ?? dir, METATROOPER_PIPE_PREFIX: `mt-harden-${randomUUID()}` };
  return { dir, run: () => spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: join(import.meta.dirname, '..'), env, encoding: 'utf8', timeout: 20_000 }) };
}

test('a call whose queue write fails reports offline instead of crashing the CLI', t => {
  const file = join(tempDir(t), 'home-is-a-file');
  writeFileSync(file, '');
  const { run } = clientScript(t, ["const out = await call('project.open', { path: 'x' }, { waitMs: 1000 });", 'console.log(out.kind);'], file);
  const r = run();
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), 'offline');
});

test('a UI call to a core that never answers ui.hello gives up after waitMs', t => {
  const { dir, run } = clientScript(t, ["const out = await call('core.ping', {}, { ui: true, waitMs: 500 });", 'console.log(out.kind);']);
  writeFileSync(join(dir, 'ui.key'), 'fixture-key');
  const started = Date.now();
  const r = run();
  assert.ok(Date.now() - started < 10_000, `call hung ${Date.now() - started} ms`);
  assert.equal(r.stdout.trim(), 'offline', r.stderr);
});

test('the CLI reports a database that does not open as one line and exits 1', t => {
  const home = tempDir(t);
  writeFileSync(join(home, 'troop.db'), 'not a database');
  const r = spawnSync(process.execPath, ['cli.ts', 'sessions'], { cwd: join(import.meta.dirname, '..'), env: { ...process.env, METATROOPER_HOME: home }, encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.status, 1);
  assert.equal(r.stderr.trim(), 'troop: file is not a database');
});

test('reinstalling a git plugin keeps the installed copy when moving the new one in fails', async t => {
  const isolated = isolation();
  const env = { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix };
  const db = withEnv(env, openCoreDb);
  t.after(() => { db.close(); rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const { installPlugin, pluginsDir } = await import('../src/plugins/store.ts');
  const repo = join(isolated.home, 'fixture.git');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' });
  const manifest = (version: string) => writeFileSync(join(repo, 'troop-plugin.json'), JSON.stringify({ schema: 1, id: 'reinstall-fixture', version, name: 'reinstall-fixture' }));
  mkdirSync(repo);
  git('init', '-q');
  manifest('1.0.0');
  git('add', '.');
  git('commit', '-qm', 'v1');
  withEnv(env, () => installPlugin(db, { source: repo, approved_permissions: [] }));
  manifest('2.0.0');
  git('commit', '-qam', 'v2');
  const target = withEnv(env, () => join(pluginsDir(), 'reinstall-fixture'));
  const rename = fs.renameSync;
  t.mock.method(fs, 'renameSync', (from, to) => {
    if (String(to) === target && String(from).includes('.staging-')) throw Object.assign(new Error('EPERM: fixture'), { code: 'EPERM' });
    return rename(from, to);
  });
  assert.throws(() => withEnv(env, () => installPlugin(db, { source: repo, approved_permissions: [] })), /EPERM/);
  assert.equal(JSON.parse(readFileSync(join(target, 'troop-plugin.json'), 'utf8')).version, '1.0.0');
});

test('an error reply over 1 MiB goes out as a short error and the server keeps serving', async t => {
  const { startPipeServer } = await import('../src/pipe/server.ts');
  const { PipeClient } = await import('../src/pipe/client.ts');
  const { corePipe } = await import('../src/paths.ts');
  const pipe = withEnv({ METATROOPER_PIPE_PREFIX: `mt-harden-${randomUUID()}` }, corePipe);
  const runner = { call: async (req: { method: string }) => { if (req.method === 'big.fail') throw new Error('x'.repeat(2 * 1024 * 1024)); return { ok: true }; } };
  const server = await startPipeServer(pipe, Promise.resolve({ runner: runner as never, uiKey: 'k' }));
  t.after(() => server.close());
  const client = await PipeClient.connect(pipe);
  t.after(() => client.close());
  const big = await client.send('big.fail').reply;
  assert.equal(big.error?.code, -32099);
  assert.ok(big.error!.message.length < 1000, `${big.error!.message.length} chars`);
  assert.deepEqual((await client.send('small.ok').reply).result, { ok: true });
});

test('openCoreDb waits out another process holding the write lock for 600 ms', async t => {
  const isolated = isolation();
  const env = { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix };
  withEnv(env, openCoreDb).close();
  t.after(() => rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const script = `const { DatabaseSync } = await import('node:sqlite'); const db = new DatabaseSync(${JSON.stringify(join(isolated.home, 'troop.db'))}); db.exec('BEGIN IMMEDIATE'); console.log('held'); const end = Date.now() + 600; while (Date.now() < end) {} db.exec('COMMIT'); db.close();`;
  const holder = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  const exited = new Promise((r) => holder.once('exit', r));
  await new Promise<void>((r) => holder.stdout.once('data', () => r()));
  try {
    const db = withEnv(env, openCoreDb);
    assert.equal((db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout, 200);
    db.close();
  } finally { await exited; }
});

test('an oversized reply to a request with a near-1 MiB id still gets a short error and the server keeps serving', async t => {
  const net = await import('node:net');
  const { startPipeServer } = await import('../src/pipe/server.ts');
  const { createDecoder } = await import('../src/pipe/framing.ts');
  const { corePipe } = await import('../src/paths.ts');
  const pipe = withEnv({ METATROOPER_PIPE_PREFIX: `mt-harden-${randomUUID()}` }, corePipe);
  const runner = { call: async (req: { method: string }) => { if (req.method === 'big.fail') throw new Error('y'.repeat(200)); return { ok: true }; } };
  const server = await startPipeServer(pipe, Promise.resolve({ runner: runner as never, uiKey: 'k' }));
  t.after(() => server.close());
  const socket = net.connect(pipe);
  t.after(() => socket.destroy());
  const replies: Array<{ id: unknown; error?: { code: number } }> = [];
  socket.on('data', createDecoder((m) => replies.push(m as never)));
  await new Promise((r) => socket.once('connect', r));
  socket.write(JSON.stringify({ jsonrpc: '2.0', id: 'i'.repeat(1024 * 1024 - 50), method: 'big.fail' }) + '\n');
  socket.write(JSON.stringify({ jsonrpc: '2.0', id: 'small', method: 'small.ok' }) + '\n');
  const deadline = Date.now() + 5000;
  while (replies.length < 2 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(replies.map((r) => [r.id, r.error?.code ?? null]).sort(), [[null, -32099], ['small', null]]);
});

test('queued and finished rows whose params are not an object fail alone in drain and recover', async t => {
  const db = coreDb(t);
  const ran: unknown[] = [];
  const methods = new Map<string, MethodSpec>([['fixture.do', { handler: (p) => { ran.push(p); return {}; } }]]);
  const insert = db.prepare("INSERT INTO command (id, at, origin, method, params, status) VALUES (?, '2026-10-14T00:00:00+11:00', 'cli', 'fixture.do', ?, ?)");
  insert.run('done-null', 'null', 'ok');
  insert.run('null', 'null', 'queued');
  insert.run('number', '123', 'queued');
  insert.run('array', '[1]', 'queued');
  insert.run('good', '{"n":1}', 'queued');
  await new CommandRunner(db, methods).recover();
  assert.deepEqual(ran, [{ n: 1 }]);
  const status = (id: string) => (db.prepare('SELECT status FROM command WHERE id = ?').get(id) as { status: string }).status;
  assert.deepEqual(['null', 'number', 'array', 'good'].map(status), ['error', 'error', 'error', 'ok']);
});
