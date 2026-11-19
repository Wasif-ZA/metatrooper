import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { client, isolation, root, startCore, stopCore, teardownCore, uiHello, until, sleep } from './helpers.ts';

const exe = join(root, 'core', 'bin', 'metatrooper-launch.exe');
const win = process.platform === 'win32';

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

const ENGINE = `const { spawn } = require('node:child_process'); const fs = require('node:fs'); const path = require('node:path');
const out = process.env.M710_OUT; const id = process.env.TROOP_SESSION_ID;
const b = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e6)'], { detached: true, stdio: 'ignore', windowsHide: true });
fs.writeFileSync(path.join(out, 'broker-' + id), String(b.pid)); b.unref();
const cfg = process.argv.find((a) => a.startsWith('--mcp-config='));
if (cfg && process.env.M710_RELAY === '1') {
  const { mcpServers } = JSON.parse(fs.readFileSync(cfg.slice(13), 'utf8'));
  const s = mcpServers['ouros-steps'];
  const env = { ...process.env }; delete env.TROOP_SESSION_ID;
  const c = spawn(s.command, s.args, { stdio: ['pipe', 'pipe', 'ignore'], env, windowsHide: true });
  let buf = ''; c.stdout.setEncoding('utf8'); c.stdout.on('data', (d) => { buf += d; fs.writeFileSync(path.join(out, 'relay-' + id), buf); });
  c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\\n');
  c.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'steps_set', arguments: { items: [{ text: 'by ancestry', done: true }] } } }) + '\\n');
}
process.stdout.write('ready\\r\\n'); setInterval(() => {}, 1e6);`;

async function setup() {
  const iso: any = isolation();
  const dir = join(iso.home, 'm710'); mkdirSync(dir, { recursive: true });
  const script = join(dir, 'engine.js'); writeFileSync(script, ENGINE);
  const engines = join(dir, 'engines.json');
  writeFileSync(engines, JSON.stringify([{ id: 'm710', command: 'node', args: [script.split('\\').join('/')], version_cmd: ['node', '--version'], prompt_arg: 'positional', mcp_attach: { kind: 'claude-mcp-config-flag' }, roles: ['worker'], cost_rank: 9 }]));
  const project = join(dir, 'project'); mkdirSync(project, { recursive: true });
  Object.assign(iso.env, { METATROOPER_ENGINES: engines, M710_OUT: dir });
  iso.dir = dir;
  let core: ChildProcess = await startCore(iso);
  let ui = await client(iso.prefix);
  await uiHello(ui, iso.home);
  const req = async (method: string, params: object = {}) => { const r: any = await ui.request(method, params); if (r.error) throw new Error(`${method}: ${r.error.message}`); return r.result; };
  const { project_id } = await req('project.open', { path: project });
  const db = () => new DatabaseSync(join(iso.home, 'troop.db'), { readOnly: true });
  return {
    iso, req, db, project_id, dir,
    get core() { return core; },
    async restart() { try { ui.close(); } catch {} await stopCore(core, iso); core = await startCore(iso); ui = await client(iso.prefix); await uiHello(ui, iso.home); },
    async done() { try { ui.close(); } catch {} await teardownCore(core, iso); },
  };
}

function relay(env: NodeJS.ProcessEnv, server = 'steps') {
  const c = spawn(exe, ['mcp', server], { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
  const replies: any[] = [];
  let buf = '';
  c.stdout.setEncoding('utf8');
  c.stdout.on('data', (d: string) => { buf += d; for (let i; (i = buf.indexOf('\n')) >= 0;) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) replies.push(JSON.parse(l)); } });
  const send = (m: object) => c.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  const reply = (id: unknown, ms = 8000) => until(() => replies.find((r) => r.id === id), ms);
  return { c, replies, send, reply };
}

const INIT = { method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } };

test('M7-10 sessions start through the native launcher, the core writes one launch event with the pty pid, and ouros MCP servers point at the exe', { skip: !win, timeout: 90_000 }, async () => {
  const s = await setup();
  try {
    const { session_id } = await s.req('session.launch', { project_id: s.project_id, engine_id: 'm710' });
    const db = s.db();
    try {
      const row = await until(() => db.prepare('SELECT pid FROM session WHERE id = ? AND pid IS NOT NULL').get(session_id) as { pid: number } | undefined, 15_000);
      const image = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${row.pid}).Path`], { encoding: 'utf8', windowsHide: true }).stdout.trim();
      assert.match(image, /metatrooper-launch\.exe$/i);
      const events = db.prepare("SELECT payload FROM event WHERE session_id = ? AND kind = 'launch'").all(session_id) as Array<{ payload: string }>;
      assert.equal(events.length, 1);
      assert.equal(JSON.parse(events[0].payload).pid, row.pid);
    } finally { db.close(); }
    const cfg = JSON.parse(readFileSync(join(s.iso.home, 'mcp', `${session_id}.json`), 'utf8')).mcpServers;
    assert.match(cfg['ouros-steps'].command, /metatrooper-launch\.exe$/i);
    assert.deepEqual(cfg['ouros-steps'].args, ['mcp', 'steps']);
    assert.deepEqual(cfg['ouros-ui'].args, ['mcp', 'ui']);
  } finally { await s.done(); }
});

test('M7-10a closing 10 sessions leaves 0 of 10 detached grandchildren within 2 s', { skip: !win, timeout: 120_000 }, async () => {
  const s = await setup();
  const brokers: number[] = [];
  try {
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push((await s.req('session.launch', { project_id: s.project_id, engine_id: 'm710' })).session_id);
    for (const id of ids) brokers.push(await until(() => existsSync(join(s.dir, 'broker-' + id)) && Number(readFileSync(join(s.dir, 'broker-' + id), 'utf8')), 20_000));
    assert.equal(brokers.filter(alive).length, 10, 'all 10 brokers running before close');
    await Promise.all(ids.map((id) => s.req('session.stop', { session_id: id })));
    const t0 = Date.now();
    await until(() => brokers.filter(alive).length === 0, 2000).catch(() => {});
    const left = brokers.filter(alive);
    assert.equal(left.length, 0, `${left.length} of 10 grandchildren still alive ${Date.now() - t0} ms after close`);
  } finally {
    for (const b of brokers) if (alive(b)) try { process.kill(b); } catch {}
    await s.done();
  }
});

test('M7-10 the native ouros-steps relay saves steps, ignores notifications, and finds its session by process ancestry', { skip: !win, timeout: 90_000 }, async () => {
  const s = await setup();
  try {
    const { session_id } = await s.req('session.launch', { project_id: s.project_id, engine_id: 'm710' });
    const r = relay({ ...s.iso.env, TROOP_SESSION_ID: session_id });
    try {
      r.send({ id: 1, ...INIT });
      assert.equal((await r.reply(1)).result.serverInfo.name, 'ouros-steps');
      r.send({ method: 'notifications/initialized' });
      r.send({ id: 'two', method: 'tools/list' });
      assert.deepEqual((await r.reply('two')).result.tools.map((t: any) => t.name), ['steps_set']);
      r.send({ id: 3, method: 'tools/call', params: { name: 'steps_set', arguments: { items: [{ text: 'one', done: false }, { text: 'two', done: true }] } } });
      assert.equal((await r.reply(3)).result.content[0].text, 'saved 2 steps');
      assert.equal(r.replies.length, 3, 'a notification gets no reply');
      const db = s.db();
      try { await until(() => db.prepare("SELECT 1 FROM event WHERE session_id = ? AND kind = 'core.steps'").get(session_id), 5000); } finally { db.close(); }
      const u = relay({ ...s.iso.env, TROOP_SESSION_ID: session_id }, 'ui');
      try {
        u.send({ id: 1, ...INIT });
        assert.equal((await u.reply(1)).result.serverInfo.name, 'ouros-ui');
        u.send({ id: 2, method: 'tools/list' });
        assert.deepEqual((await u.reply(2)).result.tools.map((t: any) => t.name), ['ouros_ui']);
      } finally { u.c.kill(); }
    } finally { r.c.kill(); }
  } finally { await s.done(); }
  const s2 = await setup();
  try {
    s2.iso.env.M710_RELAY = '1';
    await s2.restart();
    const { session_id } = await s2.req('session.launch', { project_id: s2.project_id, engine_id: 'm710' });
    const file = join(s2.dir, 'relay-' + session_id);
    const text = await until(() => existsSync(file) && readFileSync(file, 'utf8').includes('"id":2') && readFileSync(file, 'utf8'), 20_000);
    assert.match(text, /saved 1 steps/);
  } finally { await s2.done(); }
});

test('M7-10 the relay answers a tool call with an MCP error while the core is down and works again after it restarts', { skip: !win, timeout: 120_000 }, async () => {
  const s = await setup();
  try {
    const { session_id } = await s.req('session.launch', { project_id: s.project_id, engine_id: 'm710' });
    const r = relay({ ...s.iso.env, TROOP_SESSION_ID: session_id });
    try {
      r.send({ id: 1, ...INIT });
      await r.reply(1);
      await stopCore(s.core, s.iso);
      await sleep(300);
      r.send({ id: 2, method: 'tools/call', params: { name: 'steps_set', arguments: { items: [{ text: 'x', done: false }] } } });
      const down = await r.reply(2, 5000);
      const msg = JSON.stringify(down.error ?? down.result);
      assert.ok(down.error || down.result?.isError, 'an error comes back');
      assert.match(msg, /core/i);
      assert.equal(r.c.exitCode, null, 'relay still running');
      await s.restart();
      r.send({ id: 3, method: 'tools/call', params: { name: 'steps_set', arguments: { items: [{ text: 'y', done: true }] } } });
      assert.equal((await r.reply(3, 10_000)).result.content[0].text, 'saved 1 steps');
    } finally { r.c.kill(); }
  } finally { await s.done(); }
});

test('M7-10 with no core running, the relay answers initialize with an MCP error', { skip: !win, timeout: 30_000 }, async () => {
  const iso: any = isolation();
  const r = relay({ ...iso.env, TROOP_SESSION_ID: 'none' });
  try {
    r.send({ id: 7, ...INIT });
    const got = await r.reply(7, 5000);
    assert.equal(got.error.code, -32603);
    assert.match(got.error.message, /core/i);
  } finally { r.c.kill(); }
});

test('M7-10d without the exe, sessions use node launch.js', async () => {
  const { launcherArgv } = await import('../src/sessions/launch.ts');
  const argv = launcherArgv('S1', 'claude', 'AAAA', join(root, 'core', 'bin', 'missing.exe'));
  assert.equal(argv[0], process.execPath);
  assert.match(argv[2], /launch\.js$/);
  assert.deepEqual(argv.slice(3), ['--session', 'S1', '--engine', 'claude', '--args-b64', 'AAAA']);
  if (win && existsSync(exe)) assert.deepEqual(launcherArgv('S1', 'claude', 'AAAA', exe), [exe, '--session', 'S1', '--engine', 'claude', '--args-b64', 'AAAA']);
});
