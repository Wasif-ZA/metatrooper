import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { client, isolation, root, startCore, teardownCore, uiHello } from './helpers.ts';
import { Desktop, workbenchExes } from '../src/desktop/driver.ts';

const [WB_EXE] = [...workbenchExes()];
const NOTEPAD = { hwnd: 100, pid: 4100, process_start: '2026-10-12T01:00:00.000Z', exe: 'Notepad.exe', exe_path: 'C:\\Windows\\System32\\notepad.exe', title: 'Untitled - Notepad', controls: [{ role: 'document', name: 'Text editor' }] };
/** The workbench that reported itself to the core under test (its pid is this test process). */
const OWN = { hwnd: 300, pid: process.pid, process_start: `start-of-${process.pid}`, exe: 'electron.exe', exe_path: WB_EXE, title: 'MetaTrooper (demo)', controls: [{ role: 'button', name: 'Approve once' }] };
/** A window under the reporting workbench's pid but another process start: the pid was reused. */
const REUSED = { hwnd: 310, pid: process.pid, process_start: '2026-10-12T00:00:00.000Z', exe: 'electron.exe', exe_path: WB_EXE, title: 'Reused pid', controls: [] };
/** Another workbench of this install, under another pid; the path differs only in case. */
const OTHER = { hwnd: 400, pid: 4400, process_start: '2026-10-12T00:58:00.000Z', exe: 'electron.exe', exe_path: WB_EXE?.toUpperCase(), title: 'MetaTrooper', controls: [{ role: 'button', name: 'Stop everything' }] };
/** A window whose executable path the helper could not read. */
const NOPATH = { hwnd: 500, pid: 4500, process_start: '2026-10-12T00:57:00.000Z', exe: '', exe_path: '', title: 'Unknown', controls: [] };

async function core(args: string[]) {
  const iso: any = isolation();
  // another workbench started through a junction to the install's electron folder
  const link = join(iso.home, 'electron-link');
  symlinkSync(dirname(realpathSync.native(WB_EXE)), link, 'junction');
  const LINKED = { hwnd: 600, pid: 4600, process_start: '2026-10-12T00:56:00.000Z', exe: 'electron.exe', exe_path: join(link, basename(WB_EXE)), title: 'MetaTrooper linked', controls: [] };
  const state = join(iso.home, 'fake-uia.json');
  writeFileSync(state, JSON.stringify({ windows: [NOTEPAD, OWN, REUSED, OTHER, NOPATH, LINKED] }));
  iso.env = { ...iso.env, METATROOPER_UIA_HELPER: join(root, 'core', 'test', 'fake-uia-helper.js'), FAKE_UIA_STATE: state, FAKE_UIA_LOG: join(iso.home, 'fake-uia.log') };
  iso.args = args;
  const child = await startCore(iso);
  const db = new DatabaseSync(join(iso.home, 'troop.db'));
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF');
  const now = new Date().toISOString();
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, hidden, started_at, pid) VALUES ('s1', 'p1', 'fake', 'pty', 'working', ?, 0, ?, ?)").run(now, now, process.pid);
  const ui = await client(iso.prefix);
  const agent = await client(iso.prefix);
  await uiHello(ui, iso.home);
  assert.deepEqual((await ui.request('desktop.ui-window', { pid: process.pid, takeover_key: 'Control+Alt+Q', takeover_error: null }, { timeout: 15_000 })).result, {});
  const call = (c: any, method: string, params: object) => c.request(method, params, { timeout: 15_000 });
  const grant = (w: typeof NOTEPAD) => call(ui, 'grant.window', { session_id: 's1', hwnd: w.hwnd, pid: w.pid, process_start: w.process_start });
  /** A live grant row for `w`, as if one had been made before the refusal rule applied. */
  const plant = (w: typeof NOTEPAD) => db.prepare("INSERT INTO grant (id, session_id, hwnd, pid, process_start, exe, title, created_at) VALUES (?, 's1', ?, ?, ?, ?, ?, ?)").run(`gr_planted${w.hwnd}`, w.hwnd, w.pid, w.process_start, w.exe, w.title, now);
  return {
    ui, agent, call, grant, plant, LINKED,
    async close() {
      ui.close(); agent.close();
      db.prepare('UPDATE session SET pid = NULL').run();
      db.close();
      await teardownCore(child, iso);
    },
  };
}

const skip = !WB_EXE && 'needs workbench/node_modules/electron installed';

test('M6-16c a core without --demo never lists or grants a window of any workbench of this install, its own or another, nor a window whose exe is unreadable', { skip, timeout: 60_000 }, async () => {
  // protects=rule 8 on the real core fails_when=a workbench window (own pid, a matching exe path, or one reached through a junction) or an unreadable-exe window is listed or granted no_claim=packaged MetaTrooper.exe builds, which M5-1 must re-run against
  const c = await core([]);
  try {
    const listed = (await c.call(c.ui, 'grant.candidates', {})).result.windows.map((w: any) => w.hwnd);
    assert.deepEqual(listed, [NOTEPAD.hwnd]);
    for (const w of [OWN, REUSED, OTHER, c.LINKED]) {
      const r = await c.grant(w as any);
      assert.equal(r.error?.code, -32003, `window ${w.hwnd}`);
      assert.match(r.error.message, /workbench cannot be granted/);
    }
    const unknown = await c.grant(NOPATH as any);
    assert.equal(unknown.error?.code, -32003);
    assert.match(unknown.error.message, /executable could not be read/);
    assert.match((await c.grant(NOTEPAD)).result.grant_id, /^gr_/);
  } finally {
    await c.close();
  }
});

test('M6-16c a --demo core grants its own workbench window to its own session and still refuses any other workbench', { skip, timeout: 60_000 }, async () => {
  // protects=the demo exception stays scoped to the demo core's own ui-window pid and process start fails_when=the demo core refuses its own window, reads of a granted demo window fail, a reused pid or another workbench becomes grantable, or a live grant on another workbench is listed or read no_claim=a live Electron window (the opt-in E2E covers that)
  const c = await core(['--demo']);
  try {
    const listed = (await c.call(c.ui, 'grant.candidates', {})).result.windows.map((w: any) => w.hwnd);
    assert.deepEqual(listed.sort(), [NOTEPAD.hwnd, OWN.hwnd]);
    const g = await c.grant(OWN as any);
    assert.match(g.result?.grant_id ?? '', /^gr_/, JSON.stringify(g));
    for (const w of [REUSED, OTHER, c.LINKED]) {
      const other = await c.grant(w as any);
      assert.equal(other.error?.code, -32003, `window ${w.hwnd}`);
      assert.match(other.error.message, /workbench cannot be granted/);
    }
    // the other workbench gets an otherwise valid live grant, so only the workbench rule can refuse it
    c.plant(OTHER as any);
    const me = { session_id: 's1', pid: process.pid };
    const windows = (await c.call(c.agent, 'desktop.windows', me)).result.windows;
    assert.deepEqual(windows.map((w: any) => w.window), [OWN.hwnd], 'windows lists only the demo window, not the planted grant');
    const snap = await c.call(c.agent, 'desktop.snapshot', { ...me, window: OWN.hwnd });
    assert.match(snap.result?.text ?? '', /button "Approve once"/, JSON.stringify(snap));
    const refused = await c.call(c.agent, 'desktop.snapshot', { ...me, window: OTHER.hwnd });
    assert.ok(refused.error, `another workbench stays unreadable despite its grant: ${JSON.stringify(refused)}`);
    assert.doesNotMatch(JSON.stringify(refused), /Stop everything/);
  } finally {
    await c.close();
  }
});

test('M6-16c when the workbench executable cannot be identified, no window is listed, granted or read', { timeout: 30_000 }, async (t) => {
  // protects=fail-closed exe identification fails_when=an unreadable electron path.txt leaves grants open no_claim=the real helper's buffer growth (uia-helper.ps1, not run here)
  const home = mkdtempSync(join(tmpdir(), 'm6-16-noexe-'));
  const state = join(home, 'state.json');
  writeFileSync(state, JSON.stringify({ windows: [NOTEPAD] }));
  const env = { METATROOPER_UIA_HELPER: join(root, 'core', 'test', 'fake-uia-helper.js'), FAKE_UIA_STATE: state, FAKE_UIA_LOG: join(home, 'log.jsonl') };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const db = new DatabaseSync(join(home, 'synthetic.sqlite'));
  db.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
  db.exec(`PRAGMA foreign_keys=OFF; INSERT INTO project (id,path,name,opened_at,last_opened) VALUES ('p1','/p','p','t','t'); INSERT INTO session (id,project_id,engine_id,host,state,state_at,started_at,pid) VALUES ('s1','p1','fake','pty','working','t','t',${process.pid}); INSERT INTO plugin (id,enabled,manifest,path,source,permissions,version,installed_at) VALUES ('desktop',1,'{}','','builtin','[]','1','t'); INSERT INTO grant (id,session_id,hwnd,pid,process_start,exe,title,created_at) VALUES ('gr_n','s1',100,4100,'${NOTEPAD.process_start}','Notepad.exe','${NOTEPAD.title}','t')`);
  const desktop = new Desktop(db);
  Object.assign(desktop as any, { uiPid: process.pid, uiStart: `start-of-${process.pid}`, noTakeover: null, workbench: new Set() });
  (desktop as any).bound.add(`s1 ${process.pid}`);
  const methods = new Map<string, any>();
  desktop.methods(methods);
  const call = (m: string, p: object) => Promise.resolve().then(() => methods.get(m).handler(p));
  t.after(async () => {
    const child = (desktop.helper as any).child;
    desktop.helper.stop();
    if (child && child.exitCode === null) await new Promise((r) => child.once('exit', r));
    db.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const unidentified = /workbench executable could not be identified/;
  await assert.rejects(call('grant.candidates', {}), unidentified);
  await assert.rejects(call('grant.window', { session_id: 's1', hwnd: NOTEPAD.hwnd, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start }), unidentified);
  await assert.rejects(call('desktop.snapshot', { session_id: 's1', pid: process.pid, window: NOTEPAD.hwnd }));
  assert.deepEqual((await call('desktop.windows', { session_id: 's1', pid: process.pid })).windows, []);
});
