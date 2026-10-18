import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import fs, { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openCoreDb } from '../src/store/db.ts';
import { call, enqueue } from '../src/pipe/client.ts';
import { browserPipe, corePipe, dbFile, schemaFile } from '../src/paths.ts';
import { NOTIFY_PLUGIN, notifyTick, setSink } from '../src/notify.ts';
import { setSecret } from '../src/secrets.ts';
import { readClaudeTranscript, sessionTokens } from '../src/meter.ts';
import { BUILT_IN, syncEngines } from '../src/engines/registry.ts';
import { createDecoder, encode } from '../src/pipe/framing.ts';
import { logOnce } from '../src/log.ts';
import { startPipeServer } from '../src/pipe/server.ts';
import { CommandRunner } from '../src/pipe/commands.ts';
import { Approvals } from '../src/approvals.ts';
import { trustFolder } from '../src/trust.ts';
import { markGone } from '../src/sessions/resume-all.ts';
import * as term from '../src/terminal/index.ts';
import { liveText, wireTermEvents } from '../src/terminal/events.ts';
import { buildMethods } from '../src/methods.ts';
import { isolation, until, withEnv } from './helpers.ts';

function home(t): { home: string; env: Record<string, string> } {
  const isolated = isolation();
  t.after(() => rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return { home: isolated.home, env: { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix } };
}

test('h-a-d1 CLI enqueue never creates or migrates troop.db and refuses one migrated by a newer core', (t) => {
  const { env } = home(t);
  assert.throws(() => withEnv(env, () => enqueue('c0', 'project.open', {})), /does not exist/);
  assert.equal(withEnv(env, () => existsSync(dbFile())), false);
  withEnv(env, openCoreDb).close();
  withEnv(env, () => enqueue('c1', 'project.open', { path: 'x' }));
  const db = new DatabaseSync(withEnv(env, dbFile));
  try {
    db.prepare("INSERT INTO schema_migration (id, applied_at) VALUES (999, 'x')").run();
    assert.throws(() => withEnv(env, () => enqueue('c2', 'project.open', {})), /migration 999/);
    assert.deepEqual(db.prepare('SELECT id FROM command ORDER BY id').all().map((r) => r.id), ['c1']);
  } finally { db.close(); }
});

test('h-rv-waitms a slow ui.hello does not eat into the wait for the reply', async (t) => {
  const { home: dir, env } = home(t);
  writeFileSync(join(dir, 'ui.key'), 'k');
  const server = net.createServer((s) => {
    s.on('data', createDecoder((m) => {
      const id = (m as { id: string }).id;
      setTimeout(() => { if (!s.destroyed) s.write(encode({ jsonrpc: '2.0', id, result: { ok: true } })); }, 400);
    }));
  });
  const pipe = withEnv(env, corePipe);
  await new Promise<void>((r) => server.listen(pipe, r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const out = await call('pane.url', { pane_id: 'p', url: 'x' }, { ui: true, waitMs: 600 });
    assert.equal(out.kind, 'reply');
  } finally {
    for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

test('h-a-d2 logOnce writes each distinct timer error once', (t) => {
  const lines: string[] = [];
  t.mock.method(console, 'error', (s: string) => { lines.push(s); });
  logOnce('core timer failed: fixture a');
  logOnce('core timer failed: fixture a');
  logOnce('core timer failed: fixture b');
  assert.deepEqual(lines, ['core timer failed: fixture a', 'core timer failed: fixture b']);
});

test('h-a-d3 lines after a too-long line on the same socket never run', async (t) => {
  // a TCP port, since a Windows named pipe has no half-close and hides the bug
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const pipe = String((probe.address() as net.AddressInfo).port);
  await new Promise<void>((r) => probe.close(() => r()));
  const ran: string[] = [];
  const runner = { call: async (req: { method: string }) => { ran.push(req.method); return {}; } };
  const server = await startPipeServer(pipe, Promise.resolve({ runner: runner as never, uiKey: 'k' }));
  t.after(() => server.close());
  const socket = net.connect({ port: Number(pipe), host: '127.0.0.1', allowHalfOpen: true });
  t.after(() => socket.destroy());
  const replies: unknown[] = [];
  socket.on('data', createDecoder((m) => replies.push(m)));
  socket.on('error', () => {});
  await new Promise((r) => socket.once('connect', r));
  socket.write(JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'before.ok' }) + '\n');
  socket.write(' '.repeat(1024 * 1024 + 10) + '\n');
  await new Promise((r) => setTimeout(r, 100));
  socket.write(JSON.stringify({ jsonrpc: '2.0', id: 'b', method: 'after.never' }) + '\n');
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(ran, ['before.ok']);
  assert.ok(replies.some((m) => (m as { error?: { code: number } }).error?.code === -32600));
});

test('h-a-notify a sink with unreadable kinds or a bad command dest is skipped and the good sink still sends every row', async (t) => {
  const { home: dir } = home(t);
  const saved = { home: process.env.METATROOPER_HOME, fake: process.env.METATROOPER_FAKE_DPAPI };
  process.env.METATROOPER_HOME = dir;
  process.env.METATROOPER_FAKE_DPAPI = '1';
  t.after(() => {
    if (saved.home === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = saved.home;
    if (saved.fake === undefined) delete process.env.METATROOPER_FAKE_DPAPI; else process.env.METATROOPER_FAKE_DPAPI = saved.fake;
  });
  t.mock.method(console, 'error', () => {});
  const bodies: string[] = [];
  const web = createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { bodies.push(b); res.writeHead(204); res.end(); }); });
  await new Promise<void>((r) => web.listen(0, '127.0.0.1', r));
  t.after(() => new Promise<void>((r) => web.close(() => r())));
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(readFileSync(schemaFile, 'utf8'));
  const insertSink = db.prepare("INSERT INTO notify_sink (id, kind, name, dest_hash, kinds, enabled, approved_at) VALUES (?, ?, ?, 'h', ?, 1, 'x')");
  insertSink.run('a-bad-kinds', 'webhook', 'a', 'not json');
  insertSink.run('b-bad-cmd', 'command', 'b', '["gate"]');
  setSecret(db, NOTIFY_PLUGIN, 'SINK_b-bad-cmd', 'not json');
  setSink(db, { id: 'c-good', kind: 'webhook', dest: `http://127.0.0.1:${(web.address() as net.AddressInfo).port}/hook`, kinds: ['gate'] });
  const at = new Date().toISOString();
  for (const id of ['g1', 'g2']) db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'gate', ?, 'fixture')").run(id, at, id);
  await notifyTick(db);
  assert.deepEqual(bodies.map((b) => JSON.parse(b).id).sort(), ['g1', 'g2']);
});

test('h-a-meter a transcript is read in bounded chunks and a line longer than a chunk is skipped', (t) => {
  const { home: dir, env } = home(t);
  const db = withEnv(env, openCoreDb);
  try {
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(dir);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s1', 'p', 'claude', 'pty', 'working', 'x', 'x')").run();
    const rec = (id: string) => JSON.stringify({ type: 'assistant', message: { id, model: 'x', usage: { input_tokens: 10, output_tokens: 1 } } }) + '\n';
    const file = join(dir, 't.jsonl');
    writeFileSync(file, rec('m1') + JSON.stringify({ pad: 'p'.repeat(8 * 1024 * 1024 + 1024) }) + '\n' + rec('m2'));
    assert.equal(readClaudeTranscript(db, 's1', file), 1);
    let n = 0;
    for (let i = 0; i < 4; i++) n += readClaudeTranscript(db, 's1', file);
    assert.equal(n, 1);
    assert.deepEqual(sessionTokens(db, 's1'), { in: 20, out: 2, cache_read: 0, cache_write: 0 });
  } finally { db.close(); }
});

test('h-a-recover recover scrubs the rows it interrupts and never scans finished rows', async (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(readFileSync(schemaFile, 'utf8'));
  const insert = db.prepare("INSERT INTO command (id, at, origin, method, params, status) VALUES (?, 'x', 'cli', 'fixture.do', ?, ?)");
  insert.run('cut', JSON.stringify({ prompt: 'PRIVATE' }), 'running');
  for (let i = 0; i < 3; i++) insert.run(`old${i}`, '{"n":1}', 'ok');
  const sql: string[] = [];
  const prepare = db.prepare.bind(db);
  t.mock.method(db, 'prepare', (s: string) => { sql.push(s); return prepare(s); });
  await new CommandRunner(db, new Map()).recover();
  assert.deepEqual(JSON.parse((prepare("SELECT params FROM command WHERE id = 'cut'").get() as { params: string }).params), { prompt_length: 7 });
  assert.ok(!sql.some((s) => /status IN \('ok'/.test(s)), sql.join('\n'));
});

test('h-b-sandbox markGone marks open sandbox sessions process-gone like pty ones', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(schemaFile, 'utf8'));
    db.exec('PRAGMA foreign_keys = OFF');
    const add = db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p', 'claude', ?, ?, 'x', 'x')");
    add.run('pty1', 'pty', 'working');
    add.run('box1', 'sandbox', 'working');
    add.run('box2', 'sandbox', 'exited');
    markGone(db, []);
    assert.deepEqual(db.prepare("SELECT session_id FROM event WHERE kind = 'core.process-gone' ORDER BY session_id").all().map((r) => r.session_id), ['box1', 'pty1']);
  } finally { db.close(); }
});

test('h-b-maps an exited terminal drops its typed time and exit code map entry, and hiding the session drops its live text', async (t) => {
  const { home: dir, env } = home(t);
  const saved = { ...process.env };
  Object.assign(process.env, env);
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(schemaFile, 'utf8'));
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s-maps', 'p', 'fake', 'pty', 'idle', 'x', 'x')").run();
    wireTermEvents(db);
    term.open('s-maps', [process.execPath, '-e', "const c = String.fromCharCode; process.stdout.write(c(27) + ']0;MAPS TITLE' + c(7) + 'hello'); setTimeout(() => process.exit(4), 400)"], dir, process.env, 80, 24);
    term.noteTyped('s-maps', 'abc');
    assert.ok(term.typedAt('s-maps') > 0);
    await until(() => liveText()['s-maps']?.title === 'MAPS TITLE', 8000);
    await until(() => term.savedScreen('s-maps') !== null, 8000);
    assert.equal(term.typedAt('s-maps'), 0);
    assert.equal(term.exitCodeOf('s-maps'), 4);
    buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k' }).get('session.hide')!.handler({ session_id: 's-maps' }, { ui: true, origin: 'test' });
    assert.equal(liveText()['s-maps'], undefined);
    await new Promise((r) => setTimeout(r, 200));
  } finally {
    db.close();
    for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

test('m6-27-clear-unknown project.clear keeps unknown-state sessions visible', async (t) => {
  const db = withEnv(home(t).env, openCoreDb);
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    const add = db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p', 'fake', 'pty', ?, 'x', 'x')");
    for (const state of ['unknown', 'idle', 'working']) add.run(state, state);
    await buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k' }).get('project.clear')!.handler({ project_id: 'p' }, { ui: true, origin: 'test' });
    assert.deepEqual(db.prepare('SELECT id FROM session WHERE hidden = 0 ORDER BY id').all().map((r) => r.id), ['unknown', 'working']);
  } finally { db.close(); }
});

test('h-c-control a long control name still asks but is stored capped like the summary', async (t) => {
  const db = withEnv(home(t).env, openCoreDb);
  try {
    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s1', 'p', 'fake', 'pty', 'working', 'x', 'x')").run();
    const out = await new Approvals(db, 50).check({ session_id: 's1', surface: 'desktop', target: 'app', action: 'click', args: {}, control: { name: `${'x '.repeat(3000)}Delete`, automation_id: 'a'.repeat(5000), role: 'button' } });
    assert.equal(out.decision, 'expired');
    const row = db.prepare('SELECT control FROM approval').get() as { control: string };
    assert.ok(row.control.length < 1000, `${row.control.length} chars`);
  } finally { db.close(); }
});

test('h-c-trust a write the engine makes between trust.ts reading and writing its config is kept', (t) => {
  const { home: dir } = home(t);
  const file = join(dir, 'claude.json');
  writeFileSync(file, JSON.stringify({ projects: {} }));
  const read = fs.readFileSync;
  let first = true;
  t.mock.method(fs, 'readFileSync', (p: fs.PathOrFileDescriptor, o?: unknown) => {
    const text = read(p, o as never);
    if (first && p === file) {
      first = false;
      writeFileSync(file, JSON.stringify({ projects: {}, engineOwn: 1 }));
    }
    return text;
  });
  const engine = { id: 'fake', trust: { kind: 'json-map', file, at: ['projects'], set: { ok: true }, path_style: 'posix' } } as never;
  assert.deepEqual(trustFolder(dir, [engine]), ['fake']);
  const doc = JSON.parse(read(file, 'utf8'));
  assert.equal(doc.engineOwn, 1);
  assert.equal(Object.values(doc.projects).length, 1);
});

test('h-c-browsermcp a message that makes handle() throw gets a JSON-RPC error, and two first calls share one browser connection', async (t) => {
  const { env } = home(t);
  let connections = 0;
  const browser = net.createServer((s) => {
    connections++;
    s.on('data', createDecoder((m) => s.write(encode({ jsonrpc: '2.0', id: (m as { id: string }).id, result: { panes: [] } }))));
  });
  await new Promise<void>((r) => browser.listen(withEnv(env, browserPipe), r));
  const child = spawn(process.execPath, ['src/hook/browser-mcp.ts'], { cwd: join(import.meta.dirname, '..'), env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await new Promise((r) => child.once('exit', r)); }
    await new Promise<void>((r) => browser.close(() => r()));
  });
  let stderr = '';
  child.stderr.on('data', (c) => { stderr += c; });
  const replies: Array<{ id: unknown; result?: unknown; error?: { code: number } }> = [];
  child.stdout.on('data', createDecoder((m) => replies.push(m as never)));
  const call = (id: number) => JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'panes', arguments: {} } });
  child.stdin.write(`null\n${call(1)}\n${call(2)}\n`);
  await until(() => replies.length >= 3 || child.exitCode !== null, 5000).catch(() => {});
  assert.equal(child.exitCode, null, stderr);
  assert.deepEqual(replies.map((r) => [r.id, r.error?.code ?? null]).sort(), [[null, -32603], [1, null], [2, null]]);
  assert.equal(connections, 1);
});
