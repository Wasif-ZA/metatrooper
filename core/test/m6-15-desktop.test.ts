import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { buildGenerated, client, isolation, pipePath, root, sleep, startCore, stopCore, teardownCore, uiHello, until } from './helpers.ts';
import { createDecoder, encode } from '../src/pipe/framing.ts';
import { mcpAttachArgs } from '../src/plugins/mcp.ts';
import { covers, sameWindow, type GrantRow, type WindowInfo } from '../src/grants.ts';
import { isQueueable } from '../src/pipe/commands.ts';
import { migrate } from '../src/store/db.ts';

const UI_PID = process.pid;
const NOTEPAD = { hwnd: 100, pid: 4100, process_start: '2026-10-12T01:00:00.000Z', exe: 'Notepad.exe', title: 'Untitled - Notepad', controls: [{ role: 'document', name: 'Text editor', automation_id: 'RichEditD2DPT' }, { role: 'menuitem', name: 'File', automation_id: 'File' }] };
const SAVE_AS = { hwnd: 101, owner: 100, pid: 4100, process_start: NOTEPAD.process_start, exe: 'Notepad.exe', title: 'Save as', class: '#32770', file_dialog: true, controls: [{ role: 'edit', name: 'File name:', automation_id: '1001' }, { role: 'button', name: 'Save', automation_id: '1' }] };
const CALC = { hwnd: 200, pid: 4200, process_start: '2026-10-12T01:00:01.000Z', exe: 'CalculatorApp.exe', title: 'Calculator', controls: [{ role: 'button', name: 'Seven', automation_id: 'num7Button' }] };
const WORKBENCH = { hwnd: 300, pid: UI_PID, process_start: '2026-10-12T00:59:00.000Z', exe: 'electron.exe', title: 'MetaTrooper', controls: [] };

function setup(windows: object[], delayMs = 0) {
  const iso = isolation();
  const statePath = join(iso.home, 'fake-uia.json');
  const logPath = join(iso.home, 'fake-uia.log');
  writeFileSync(statePath, JSON.stringify({ windows }));
  iso.env = { ...iso.env, METATROOPER_UIA_HELPER: join(root, 'core', 'test', 'fake-uia-helper.js'), FAKE_UIA_STATE: statePath, FAKE_UIA_LOG: logPath, FAKE_UIA_DELAY_MS: String(delayMs) };
  const setWindows = (w: object[]) => writeFileSync(statePath, JSON.stringify({ windows: w }));
  const inputs = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { iso, setWindows, inputs };
}

/** Two live sessions whose launcher pid is this test process, so the core's ancestry check passes. */
function seed(home: string) {
  const db = new DatabaseSync(join(home, 'troop.db'));
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF');
  const now = new Date().toISOString();
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
  for (const id of ['s1', 's2']) db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, hidden, started_at, pid) VALUES (?, 'p1', 'fake', 'pty', 'working', ?, 0, ?, ?)").run(id, now, now, process.pid);
  return db;
}

/** Clears the seeded pids, since teardownCore kills session pids and these name the test process itself. */
function release(db: DatabaseSync) {
  db.prepare('UPDATE session SET pid = NULL').run();
  db.close();
}

const call = (pipe: any, method: string, params: object, timeout = 15_000) => pipe.request(method, params, { timeout });
const me = (session_id: string) => ({ session_id, pid: process.pid });

async function connect(iso: any) {
  const agent = await client(iso.prefix);
  const ui = await client(iso.prefix);
  await uiHello(ui, iso.home);
  assert.deepEqual((await call(ui, 'desktop.ui-window', { pid: UI_PID, takeover_key: 'Control+Alt+Q', takeover_error: null })).result, {});
  return { agent, ui };
}

/** Describes, checks, then acts, as metatrooper-desktop does; returns the act reply. */
async function act(agent: any, session_id: string, params: Record<string, unknown>) {
  const d = await call(agent, 'desktop.describe', { ...me(session_id), window: params.window, ref: params.ref });
  if (d.error) return d;
  const expect = { ...(d.result.control ?? {}), password: d.result.password, file_dialog: d.result.file_dialog, grant_id: d.result.grant_id };
  return call(agent, 'desktop.act', { ...me(session_id), ...params, expect }, 60_000);
}

test('M6-15 unit: a grant covers its window and owned windows with the same pid and process start, nothing else', () => {
  const g: GrantRow = { id: 'gr_1', session_id: 's1', hwnd: 100, pid: 1, process_start: 't0', exe: 'a.exe', title: 'A', created_at: 't', ended_at: null };
  const w = (o: Partial<WindowInfo>): WindowInfo => ({ alive: true, hwnd: 100, root: 100, pid: 1, process_start: 't0', exe: 'a.exe', title: 'A', class: '', owner_chain: [], file_dialog: false, elevated: false, rect: [0, 0, 1, 1], minimized: false, ...o });
  assert.equal(covers(g, w({})), true);
  assert.equal(covers(g, w({ hwnd: 101, root: 101, owner_chain: [100] })), true, 'owned dialog');
  assert.equal(covers(g, w({ hwnd: 102, root: 102, owner_chain: [101, 100] })), true, 'owned by an owned window');
  assert.equal(covers(g, w({ hwnd: 101, root: 101, owner_chain: [100], pid: 2 })), false, 'owner chain from another process');
  assert.equal(covers(g, w({ process_start: 't1' })), false, 'same handle and pid, new process');
  assert.equal(covers(g, w({ pid: 2 })), false, 'same handle, other process');
  assert.equal(covers(g, w({ alive: false })), false);
  assert.equal(covers(g, w({ elevated: true })), false);
  assert.equal(covers(g, w({ hwnd: 200, root: 200 })), false);
  assert.equal(sameWindow(g, w({ hwnd: 101, root: 101, owner_chain: [100] })), false);
  assert.equal(isQueueable('desktop.act'), false, 'typed text never reaches the command queue');
  assert.equal(isQueueable('grant.window'), false);
  assert.equal(isQueueable('takeover.pause'), false);
});

/** A stand-in for the workbench's `\\.\pipe\<prefix>-browser`: binds sessions and answers cursor.glide, recording when. */
async function fakeWorkbench(prefix: string, log: string) {
  const glides: Array<{ at: number; params: any }> = [];
  const server = net.createServer((socket) => {
    let bound: string | null = null;
    socket.on('data', createDecoder((raw: any) => {
      const reply = (result: unknown) => socket.write(encode({ jsonrpc: '2.0', id: raw.id, result }));
      if (raw.method === 'browser.hello') { bound = raw.params.session_id; return reply({ ok: true, bound: 'session' }); }
      if (raw.method === 'cursor.glide' && raw.params.session === bound) { glides.push({ at: Date.now(), params: raw.params }); appendFileSync(log, JSON.stringify({ op: 'glide' }) + '\n'); return reply({ arrived: true }); }
      socket.write(encode({ jsonrpc: '2.0', id: raw.id, error: { code: -32601, message: 'no' } }));
    }));
    socket.on('error', () => {});
  });
  await new Promise<void>((r) => server.listen(pipePath(`${prefix}-browser`), r));
  return { glides, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** metatrooper-desktop as a child of this process, which is the seeded session's launcher. */
function desktopMcp(env: Record<string, string | undefined>) {
  const child = spawn(process.execPath, [join(root, 'core', 'metatrooper-desktop.js')], { env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  const waiting = new Map<number, (m: any) => void>();
  let n = 0;
  readline.createInterface({ input: child.stdout! }).on('line', (l) => { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); });
  const rpc = (method: string, params: object = {}) => new Promise<any>((resolve) => { const id = ++n; waiting.set(id, resolve); child.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const tool = async (name: string, args: object = {}) => (await rpc('tools/call', { name, arguments: args })).result;
  return { rpc, tool, pid: child.pid!, close: () => child.kill() };
}

test('M6-15 metatrooper-desktop: workbench closed, then describe, approval, glide and act in that order', async () => {
  await buildGenerated();
  const { iso, inputs } = setup([NOTEPAD, SAVE_AS, CALC, WORKBENCH]);
  const parents = join(iso.home, 'synthetic-parents.txt');
  const preload = join(iso.home, 'synthetic-ancestry.mjs');
  writeFileSync(parents, '');
  writeFileSync(preload, `
    import cp from 'node:child_process';
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    const spawnSync = cp.spawnSync;
    const execFile = cp.execFile;
    const isParents = (file, args) => file === 'powershell' && args?.[3] === 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }';
    cp.spawnSync = (file, args, options) => isParents(file, args)
      ? { status: 0, stdout: fs.readFileSync(process.env.FAKE_PARENT_TABLE, 'utf8'), stderr: '' }
      : spawnSync(file, args, options);
    cp.execFile = (file, args, options, callback) => {
      if (!isParents(file, args)) return execFile(file, args, options, callback);
      queueMicrotask(() => callback(null, fs.readFileSync(process.env.FAKE_PARENT_TABLE, 'utf8'), ''));
    };
    syncBuiltinESMExports();
  `);
  iso.env.FAKE_PARENT_TABLE = parents;
  iso.env.NODE_OPTIONS += ' --import=' + pathToFileURL(preload).href;
  const core = await startCore(iso);
  const db = seed(iso.home);
  db.prepare("UPDATE session SET pid = NULL WHERE id = 's2'").run();
  const { agent, ui } = await connect(iso);
  const mcp = desktopMcp(iso.env);
  writeFileSync(parents, String(mcp.pid) + ' ' + String(process.pid));
  let wb: Awaited<ReturnType<typeof fakeWorkbench>> | null = null;
  try {
    const listed = (await mcp.rpc('tools/list')).result.tools.map((t: any) => t.name);
    assert.deepEqual(listed, ['windows', 'snapshot', 'screenshot', 'click', 'type', 'key', 'scroll', 'wait_for']);
    // Workbench closed: every tool fails the same way, reads included
    for (const [name, args] of [['windows', {}], ['snapshot', { window: 100 }], ['type', { window: 100, ref: 'e1', text: 'x' }]] as const) {
      const r = await mcp.tool(name, args);
      assert.equal(r.isError, true);
      assert.equal(r.content[0].text, 'desktop not available: the MetaTrooper workbench is closed');
    }

    wb = await fakeWorkbench(iso.prefix, iso.env.FAKE_UIA_LOG!);
    assert.match((await mcp.tool('snapshot', { window: 100 })).content[0].text, /window not granted; ask the user to give it to you/);
    const grant = (await call(ui, 'grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start })).result.grant_id;
    assert.deepEqual(JSON.parse((await mcp.tool('windows')).content[0].text).windows.map((w: any) => w.window), [100, 101]);
    assert.match((await mcp.tool('snapshot', { window: 100 })).content[0].text, /document "Text editor" \[ref=e1\]/);
    assert.equal((await mcp.tool('screenshot', { window: 100 })).content[0].type, 'image');
    assert.equal(JSON.parse((await mcp.tool('wait_for', { window: 100, text: 'File', timeout_ms: 1000 })).content[0].text).found, true);

    const typed = await mcp.tool('type', { window: 100, ref: 'e1', text: 'hello' });
    assert.equal(JSON.parse(typed.content[0].text).status, 'confirmed');
    assert.equal(wb.glides.length, 1);
    assert.deepEqual(wb.glides[0].params, { session: 's1', target_rect_px: [10, 10, 50, 20], caption: 'type 5 characters' });
    assert.deepEqual(inputs().map((i) => i.op), ['glide', 'set_text'], 'the cursor arrives before the input lands');

    assert.equal((await mcp.tool('click', { window: 200, ref: 'e1' })).content[0].text, 'window not granted; ask the user to give it to you');

    // Save As: the click waits for a person; rejecting it sends nothing
    const pending = mcp.tool('click', { window: 101, ref: 'e2' });
    const waiting = await until(() => db.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any, 5000);
    assert.equal(waiting.reason, 'file dialog');
    assert.equal(waiting.target, grant);
    await call(ui, 'approval.resolve', { approval_id: waiting.id, decision: 'reject' });
    assert.equal((await pending).content[0].text, 'not approved: the user rejected this action');
    assert.equal(inputs().filter((i) => i.hwnd === 101).length, 0);

    await call(ui, 'takeover.pause', {});
    assert.equal((await mcp.tool('key', { window: 100, keys: 'Tab' })).content[0].text, 'paused by the user');
  } finally {
    mcp.close(); await wb?.close();
    agent.close(); ui.close(); release(db);
    await teardownCore(core, iso);
  }
});

test('M6-15 rollback: with the desktop plugin disabled, desktop calls refuse and live grants end', async () => {
  const { iso } = setup([NOTEPAD, CALC, WORKBENCH]);
  const core = await startCore(iso);
  const db = seed(iso.home);
  const { agent, ui } = await connect(iso);
  try {
    const grant = (await call(ui, 'grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start })).result.grant_id;
    db.prepare("UPDATE plugin SET enabled = 0 WHERE id = 'desktop'").run();
    await until(() => (db.prepare('SELECT ended_at FROM grant WHERE id = ?').get(grant) as any).ended_at, 3000);
    assert.match((await call(ui, 'grant.candidates', {})).error.message, /computer use is off: the desktop plugin is disabled/);
    assert.match((await call(ui, 'grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start })).error.message, /computer use is off/);
    assert.match((await call(agent, 'desktop.windows', me('s1'))).error.message, /computer use is off/);
    db.prepare("UPDATE plugin SET enabled = 1 WHERE id = 'desktop'").run();
    assert.match((await call(ui, 'grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start })).result.grant_id, /^gr_/);
  } finally {
    agent.close(); ui.close(); release(db);
    await teardownCore(core, iso);
  }
});

test('M6-15 attach: metatrooper-desktop joins Windows sessions while the desktop plugin is enabled, never contained or isolated ones', { skip: process.platform !== 'win32' }, () => {
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE plugin (id TEXT, enabled INTEGER, manifest TEXT, path TEXT, source TEXT, permissions TEXT, version TEXT, installed_at TEXT); INSERT INTO plugin (id, enabled, manifest, path, source, permissions, version, installed_at) VALUES ('desktop', 1, '{}', '', 'builtin', '[]', '1', '')");
  const engine = { id: 'codex', mcp_attach: { kind: 'codex-config' } } as any;
  const names = (approval: string) => mcpAttachArgs(db, engine, 's1', false, { approval }).filter((a) => a.includes('metatrooper-desktop.command'));
  assert.equal(names('ask').length, 1);
  assert.match(mcpAttachArgs(db, engine, 's1', false, { approval: 'ask' }).join(' '), /metatrooper-desktop\.args=.*metatrooper-desktop\.js/);
  assert.equal(names('contained').length, 0);
  assert.equal(names('isolated').length, 0);
  assert.equal(mcpAttachArgs(db, engine, 's1', false, { approval: 'ask', pipeline: true }).filter((a) => a.includes('metatrooper-desktop')).length, 0);
  db.exec("UPDATE plugin SET enabled = 0 WHERE id = 'desktop'");
  assert.equal(names('ask').length, 0, 'disabling the desktop plugin detaches it');
  db.close();
});

test('M6-15 the real UI Automation helper compiles and answers read-only requests', { skip: process.platform !== 'win32' }, async () => {
  const { Helper } = await import('../src/desktop/driver.ts');
  const saved = process.env.METATROOPER_UIA_HELPER;
  delete process.env.METATROOPER_UIA_HELPER;
  const helper = new Helper();
  try {
    const gone = await helper.request('info', { hwnd: 1 }, 90_000);
    assert.equal(gone.alive, false);
    const { windows } = await helper.request('list', {}, 30_000);
    assert.ok(Array.isArray(windows));
    for (const w of windows) {
      assert.equal(typeof w.hwnd, 'number');
      assert.equal(typeof w.pid, 'number');
      assert.ok(Array.isArray(w.owner_chain) && w.rect.length === 4);
    }
    await assert.rejects(helper.request('describe', { hwnd: 1, ref: 'e1' }), /unknown ref e1; take a new snapshot/);
    await assert.rejects(helper.request('nope'), /unknown op nope/);
  } finally {
    helper.stop();
    if (saved !== undefined) process.env.METATROOPER_UIA_HELPER = saved;
  }
});

test('M6-15 migration 003 gives an older database the grant table schema.sql defines', () => {
  const old = new DatabaseSync(':memory:');
  const fresh = new DatabaseSync(':memory:');
  try {
    old.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8').replace(/CREATE TABLE grant \([\s\S]*?\n\);\nCREATE INDEX grant_live_idx[^\n]*\n/, ''));
    assert.equal(old.prepare("SELECT 1 FROM sqlite_master WHERE name = 'grant'").get(), undefined);
    assert.ok(migrate(old).includes(3));
    fresh.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
    const sql = (d: DatabaseSync) => d.prepare("SELECT name, sql FROM sqlite_master WHERE name IN ('grant', 'grant_live_idx') ORDER BY name").all();
    assert.equal(sql(old).length, 2);
    assert.deepEqual(sql(old), sql(fresh));
  } finally {
    old.close();
    fresh.close();
  }
});

test('M6-15a: a session granted Notepad types into it; Calculator is not granted; every input in Save As asks', async () => {
  const { iso, inputs } = setup([NOTEPAD, SAVE_AS, CALC, WORKBENCH]);
  let core = await startCore(iso);
  const db = seed(iso.home);
  const { agent, ui } = await connect(iso);
  try {
    // Nothing granted yet: every call fails the same way
    assert.match((await call(agent, 'desktop.describe', { ...me('s1'), window: 100, ref: 'e1' })).error.message, /window not granted; ask the user to give it to you/);
    assert.deepEqual((await call(agent, 'desktop.windows', me('s1'))).result, { windows: [] });

    // grant.window needs ui.hello
    assert.equal((await call(agent, 'grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start })).error.code, -32012);
    const grant = (await call(ui, 'grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start })).result.grant_id;
    assert.match(grant, /^gr_/);
    const row = db.prepare('SELECT * FROM grant WHERE id = ?').get(grant) as any;
    assert.equal(row.pid, 4100);
    assert.equal(row.process_start, NOTEPAD.process_start);
    assert.equal(row.ended_at, null);

    // windows lists the grant and the Save As dialog it owns
    const listed = (await call(agent, 'desktop.windows', me('s1'))).result.windows;
    assert.deepEqual(listed.map((w: any) => [w.window, w.owner, w.grant_id]), [[100, 0, grant], [101, 100, grant]]);

    // Typing into Notepad lands; plain typing needs no approval
    const check = { session_id: 's1', surface: 'desktop', target: grant, action: 'type', args: { window: 100, ref: 'e1', text: 'hello world' }, control: { automation_id: 'RichEditD2DPT', name: 'Text editor', role: 'document' } };
    assert.deepEqual((await call(agent, 'approval.check', check)).result, { decision: 'allow' });
    const typed = await act(agent, 's1', { window: 100, ref: 'e1', action: 'type', text: 'hello world' });
    assert.equal(typed.result.status, 'confirmed');
    assert.deepEqual(inputs().filter((i) => i.op === 'set_text').map((i) => i.value), ['hello wo', 'hello world']);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM command WHERE params LIKE '%hello%'").get() as any).n, 0, 'typed text never reaches the command table');

    // Calculator, not granted: describe, act and approval.check all refuse
    assert.match((await call(agent, 'desktop.describe', { ...me('s1'), window: 200, ref: 'e1' })).error.message, /window not granted/);
    assert.match((await call(agent, 'desktop.act', { ...me('s1'), window: 200, ref: 'e1', action: 'click', expect: { name: 'Seven', automation_id: 'num7Button', role: 'button' } })).error.message, /window not granted/);
    assert.match((await call(agent, 'desktop.snapshot', { ...me('s1'), window: 200 })).error.message, /window not granted/);
    assert.deepEqual((await call(agent, 'approval.check', { ...check, target: 'gr_not_mine' })).result, { decision: 'deny', reason: 'window not granted; ask the user to give it to you' });
    assert.equal(inputs().filter((i) => i.hwnd === 200).length, 0);

    // Another session cannot use s1's grant
    assert.match((await call(agent, 'desktop.describe', { ...me('s2'), window: 100, ref: 'e1' })).error.message, /window not granted/);
    assert.deepEqual((await call(agent, 'approval.check', { ...check, session_id: 's2' })).result.decision, 'deny');

    // Save As is reachable, and every input in it raises an approval
    const d = (await call(agent, 'desktop.describe', { ...me('s1'), window: 101, ref: 'e1' })).result;
    assert.equal(d.grant_id, grant);
    assert.equal(d.file_dialog, true);
    for (const [action, args, control] of [
      ['type', { window: 101, ref: 'e1', text: 'notes.txt' }, SAVE_AS.controls[0]],
      ['click', { window: 101, ref: 'e2' }, SAVE_AS.controls[1]],
      ['key', { window: 101, keys: 'Tab' }, null],
    ] as const) {
      const pending = call(agent, 'approval.check', { session_id: 's1', surface: 'desktop', target: grant, action, args, control, file_dialog: true });
      const waiting = await until(() => db.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any, 5000);
      assert.equal(waiting.reason, 'file dialog');
      assert.equal(waiting.target, grant);
      assert.match(waiting.summary, / in Untitled - Notepad$/, 'the card names the window, not the grant id');
      // session scope is refused for file dialogs, so the next input asks again
      assert.equal((await call(ui, 'approval.resolve', { approval_id: waiting.id, decision: 'approve', scope: 'session' })).result.scope, 'once');
      assert.equal((await pending).result.decision, 'approved');
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM approval WHERE reason = 'file dialog'").get().n, 3);

    // A call that skipped the check (expect without file_dialog) is not sent
    const skipped = await call(agent, 'desktop.act', { ...me('s1'), window: 101, ref: 'e2', action: 'click', expect: { name: 'Save', automation_id: '1', role: 'button' } });
    assert.equal(skipped.error.code, -32035);
    assert.equal(inputs().filter((i) => i.hwnd === 101).length, 0);

    // The caller must descend from the session's launcher
    assert.match((await call(agent, 'desktop.windows', { session_id: 's1', pid: 4 })).error.message, /not an ancestor/);
  } finally {
    agent.close(); ui.close(); release(db);
    await teardownCore(core, iso);
  }
});

test('M6-15b: after the core acknowledges Ctrl+Alt+Q, no further character of a 2,000-character type lands', async () => {
  const { iso, inputs } = setup([NOTEPAD, CALC, WORKBENCH], 5);
  const core = await startCore(iso);
  const db = seed(iso.home);
  const { agent, ui } = await connect(iso);
  try {
    const grant = (await call(ui, 'grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start })).result.grant_id;
    const text = 'abcdefghij'.repeat(200);
    const typing = act(agent, 's1', { window: 100, ref: 'e1', action: 'type', text });
    await until(() => inputs().length >= 20, 10_000);
    const ack = await call(ui, 'takeover.pause', {});
    assert.ok(ack.result.paused_at);
    const atAck = inputs().filter((i) => i.op === 'set_text');
    const lengthAtAck = atAck.at(-1).value.length;
    await sleep(2000);
    const later = inputs().filter((i) => i.op === 'set_text');
    assert.equal(later.length, atAck.length, 'no chunk after the acknowledgement');
    assert.equal(later.at(-1).value.length, lengthAtAck);
    assert.ok(lengthAtAck < text.length);
    assert.ok(later.every((i) => i.value.length <= 2000) && later.every((i, n) => n === 0 || i.value.length - later[n - 1].value.length <= 8), 'chunks of at most 8 characters');
    const r = await typing;
    assert.match(r.error.message, new RegExp(`paused by the user; ${lengthAtAck} of 2000 characters were typed`));

    // Paused everywhere: desktop calls, and approval.check on both surfaces
    assert.match((await act(agent, 's1', { window: 100, ref: 'e2', action: 'click' })).error.message, /paused by the user/);
    assert.deepEqual((await call(agent, 'approval.check', { session_id: 's1', surface: 'browser', target: 'https://example.com', action: 'click', args: {}, control: null })).result, { decision: 'deny', reason: 'paused by the user' });
    assert.deepEqual((await call(agent, 'approval.check', { session_id: 's2', surface: 'desktop', target: grant, action: 'click', args: {}, control: null })).result.reason, 'paused by the user');
    assert.ok(db.prepare("SELECT value FROM meta WHERE key = 'takeover_paused_at'").get());

    // Resume is per session
    assert.equal((await call(agent, 'takeover.resume', { session_id: 's1' })).error.code, -32012);
    assert.deepEqual((await call(ui, 'takeover.resume', { session_id: 's1' })).result, {});
    assert.equal((await act(agent, 's1', { window: 100, ref: 'e1', action: 'type', text: 'ok' })).result.status, 'confirmed');
    assert.equal((await call(agent, 'approval.check', { session_id: 's2', surface: 'browser', target: 'https://example.com', action: 'click', args: {}, control: null })).result.reason, 'paused by the user');

    // A second pause stops the resumed session again
    await call(ui, 'takeover.pause', {});
    assert.match((await act(agent, 's1', { window: 100, ref: 'e1', action: 'type', text: 'no' })).error.message, /paused by the user/);
  } finally {
    agent.close(); ui.close(); release(db);
    await teardownCore(core, iso);
  }
});

test('M6-15c: the workbench is never granted, a closed window ends its grant, a reused handle is not granted, and a restart ends every grant', async () => {
  const { iso, setWindows } = setup([NOTEPAD, CALC, WORKBENCH]);
  let core = await startCore(iso);
  const db = seed(iso.home);
  let { agent, ui } = await connect(iso);
  try {
    // The workbench never appears and cannot be granted or named
    const candidates = (await call(ui, 'grant.candidates', {})).result.windows;
    assert.deepEqual(candidates.map((w: any) => w.hwnd).sort(), [100, 200]);
    assert.equal((await call(ui, 'grant.window', { session_id: 's1', hwnd: 300, pid: WORKBENCH.pid, process_start: WORKBENCH.process_start })).error.code, -32003);
    const grant = (await call(ui, 'grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start })).result.grant_id;
    assert.ok(!(await call(agent, 'desktop.windows', me('s1'))).result.windows.some((w: any) => w.window === 300));
    assert.match((await call(agent, 'desktop.describe', { ...me('s1'), window: 300 })).error.message, /window not granted/);
    assert.match((await call(agent, 'desktop.screenshot', { ...me('s1'), window: 300 })).error.message, /window not granted/);
    assert.equal((await call(ui, 'grant.live', {})).result.grants[0].id, grant);

    // Close Notepad: the grant ends within the 500 ms check
    setWindows([CALC, WORKBENCH]);
    await until(() => (db.prepare('SELECT ended_at FROM grant WHERE id = ?').get(grant) as any).ended_at, 3000);
    // A new window that gets the same handle, in another process, is not granted
    setWindows([{ ...NOTEPAD, pid: 5100, process_start: '2026-10-12T02:00:00.000Z', title: 'New window' }, CALC, WORKBENCH]);
    assert.match((await call(agent, 'desktop.describe', { ...me('s1'), window: 100, ref: 'e1' })).error.message, /window not granted/);
    assert.deepEqual((await call(agent, 'desktop.windows', me('s1'))).result, { windows: [] });

    // Same handle reused before the check ran: the call itself ends the grant
    setWindows([NOTEPAD, CALC, WORKBENCH]);
    const second = (await call(ui, 'grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start })).result.grant_id;
    setWindows([{ ...NOTEPAD, process_start: '2026-10-12T03:00:00.000Z' }, CALC, WORKBENCH]);
    assert.match((await call(agent, 'desktop.describe', { ...me('s1'), window: 100, ref: 'e1' })).error.message, /window not granted/);
    assert.ok((db.prepare('SELECT ended_at FROM grant WHERE id = ?').get(second) as any).ended_at);

    // Revoke ends a grant
    setWindows([NOTEPAD, CALC, WORKBENCH]);
    const third = (await call(ui, 'grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start })).result.grant_id;
    assert.deepEqual((await call(ui, 'grant.revoke', { grant_id: third })).result, {});
    assert.match((await call(agent, 'desktop.describe', { ...me('s1'), window: 100, ref: 'e1' })).error.message, /window not granted/);

    // After a core restart no grant is live
    const fourth = (await call(ui, 'grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start })).result.grant_id;
    assert.equal((await call(agent, 'desktop.describe', { ...me('s1'), window: 100, ref: 'e1' })).result.grant_id, fourth);
    agent.close(); ui.close();
    await stopCore(core, iso);
    core = await startCore(iso);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM grant WHERE ended_at IS NULL').get() as any).n, 0);
    // The restarted core marks the seeded sessions gone; bring s1 back so only the grant rule is under test
    db.prepare("UPDATE session SET ended_at = NULL, state = 'working', pid = ? WHERE id = 's1'").run(process.pid);
    ({ agent, ui } = await connect(iso));
    assert.match((await call(agent, 'desktop.describe', { ...me('s1'), window: 100, ref: 'e1' })).error.message, /window not granted/);
    assert.deepEqual((await call(ui, 'grant.live', {})).result, { grants: [] });
  } finally {
    agent.close(); ui.close(); release(db);
    await teardownCore(core, iso);
  }
});

async function desktopFixture() {
  const { Desktop } = await import('../src/desktop/driver.ts');
  const { iso, inputs } = setup([NOTEPAD, WORKBENCH]);
  const saved = new Map(Object.keys(iso.env).filter((k) => k === 'METATROOPER_UIA_HELPER' || k.startsWith('FAKE_UIA_')).map((k) => [k, process.env[k]]));
  for (const k of saved.keys()) process.env[k] = iso.env[k];
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
  db.exec("PRAGMA foreign_keys = OFF; INSERT INTO plugin (id, version, path, manifest, source, permissions, installed_at) VALUES ('desktop', '1', '', '{}', 'builtin', '[]', 't'); INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, pid) VALUES ('s1', 'p1', 'fake', 'pty', 'working', 't', 't', " + process.pid + ")");
  const desktop = new Desktop(db);
  const methods = new Map<string, any>();
  desktop.methods(methods);
  const request = (method: string, params: any = {}) => methods.get(method).handler(params);
  await request('desktop.ui-window', { pid: UI_PID, takeover_key: 'Control+Alt+Q', takeover_error: null });
  const { grant_id } = await request('grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start });
  return { desktop, db, request, grant_id, inputs,
    state: (extra: object = {}) => writeFileSync(iso.env.FAKE_UIA_STATE!, JSON.stringify({ windows: [NOTEPAD, WORKBENCH], ...extra })),
    close: () => {
      desktop.helper.stop(); db.close();
      for (const [k, v] of saved) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
      rmSync(iso.home, { recursive: true, force: true });
    },
  };
}

for (const end of ['revoke', 'disable'] as const) {
  test('M6-15 type stops further chunks and reports characters when ' + (end === 'revoke' ? 'grant.revoke ends its grant' : 'the desktop plugin is disabled'), async () => {
    const f = await desktopFixture();
    try {
      const original = f.desktop.helper.request.bind(f.desktop.helper);
      f.desktop.helper.request = async (op, params, timeout) => {
        const out = await original(op, params, timeout);
        if (op === 'set_text') {
          if (end === 'revoke') await f.request('grant.revoke', { grant_id: f.grant_id });
          else f.db.prepare("UPDATE plugin SET enabled = 0 WHERE id = 'desktop'").run();
        }
        return out;
      };
      await assert.rejects(f.desktop.act({ window: 100, ref: 'e1', action: 'type', text: 'x'.repeat(2000), expect: NOTEPAD.controls[0] }, 's1'), /^Error: window not granted; ask the user to give it to you; 8 of 2000 characters were typed$/);
      assert.deepEqual(f.inputs().map((i) => [i.op, i.value]), [['set_text', 'xxxxxxxx']]);
    } finally { f.close(); }
  });
}

test('M6-15 resolved helper ops carry pid and refuse a window reused between info and the action', async () => {
  const f = await desktopFixture();
  try {
    const original = f.desktop.helper.request.bind(f.desktop.helper);
    const seen: Array<[string, unknown]> = [];
    f.desktop.helper.request = (op, params = {}, timeout) => {
      if (op !== 'info') seen.push([op, params.pid]);
      return original(op, params, timeout);
    };
    const actions = ['type', 'click', 'key', 'scroll'];
    const operations = [
      ['describe', () => f.desktop.describe('s1', 100, 'e1'), 'after_info_pid'],
      ...actions.map((action) => [action === 'type' ? 'set_text' : action, () => f.desktop.act({ window: 100, ref: 'e1', action, text: 'ok', keys: 'Tab', dy: 10, expect: NOTEPAD.controls[0] }, 's1'), 'after_describe_pid']),
      ...[['snapshot', 'desktop.snapshot'], ['screenshot', 'desktop.screenshot'], ['find_text', 'desktop.find']].map(([op, method]) => [op, () => f.request(method, { ...me('s1'), window: 100, text: 'File' }), 'after_info_pid']),
    ] as Array<[string, () => Promise<unknown>, string]>;
    for (const [op, action, change] of operations) {
      f.state(); seen.length = 0;
      await action();
      assert.deepEqual(seen.find(([name]) => name === op), [op, NOTEPAD.pid]);
      f.state({ [change]: NOTEPAD.pid + 1 }); seen.length = 0;
      const before = f.inputs().length;
      await assert.rejects(action(), /window not granted/, op);
      assert.deepEqual(seen.find(([name]) => name === op), [op, NOTEPAD.pid]);
      assert.equal(f.inputs().length, before, op + ' sends no input to the reused window');
    }
  } finally { f.close(); }
});

test('M6-15 a helper timeout stops the process and the next request starts a fresh helper', async () => {
  const f = await desktopFixture();
  try {
    const first = await f.desktop.helper.request('process_id');
    const exited = new Promise<void>((resolve) => (f.desktop.helper as any).child.once('exit', resolve));
    await assert.rejects(f.desktop.helper.request('never_answer', {}, 50), /desktop helper never_answer timed out/);
    assert.equal(f.desktop.helper.running(), false);
    await until(() => { try { process.kill(first.pid, 0); return false; } catch (e: any) { if (e.code === 'ESRCH') return true; throw e; } });
    await exited;
    const next = await f.desktop.helper.request('process_id', {}, 3000);
    assert.notEqual(next.pid, first.pid);
    assert.equal(f.desktop.helper.running(), true);
  } finally { f.close(); }
});

test('M6-15 grant.candidates refuses until the workbench reports its own windows', async () => {
  const { iso } = setup([NOTEPAD, WORKBENCH]);
  const core = await startCore(iso);
  const ui = await client(iso.prefix);
  try {
    await uiHello(ui, iso.home);
    assert.equal((await call(ui, 'grant.candidates', {})).error?.message, 'the workbench has not reported its own windows yet');
    await call(ui, 'desktop.ui-window', { pid: UI_PID, takeover_key: 'Control+Alt+Q', takeover_error: null });
    assert.deepEqual((await call(ui, 'grant.candidates', {})).result.windows.map((w: any) => w.hwnd), [100]);
  } finally { ui.close(); await teardownCore(core, iso); }
});
