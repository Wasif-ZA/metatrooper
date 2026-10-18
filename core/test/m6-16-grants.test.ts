import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { client, isolation, root, startCore, teardownCore, uiHello } from './helpers.ts';
import { workbenchExes } from '../src/desktop/driver.ts';

const [WB_EXE] = [...workbenchExes()];
const NOTEPAD = { hwnd: 100, pid: 4100, process_start: '2026-10-12T01:00:00.000Z', exe: 'Notepad.exe', exe_path: 'C:\\Windows\\System32\\notepad.exe', title: 'Untitled - Notepad', controls: [{ role: 'document', name: 'Text editor' }] };
/** The workbench that reported itself to the core under test (its pid is this test process). */
const OWN = { hwnd: 300, pid: process.pid, process_start: `start-of-${process.pid}`, exe: 'electron.exe', exe_path: WB_EXE, title: 'MetaTrooper (demo)', controls: [{ role: 'button', name: 'Approve once' }] };
/** Another workbench of this install, under another pid; the path differs only in case. */
const OTHER = { hwnd: 400, pid: 4400, process_start: '2026-10-12T00:58:00.000Z', exe: 'electron.exe', exe_path: WB_EXE?.toUpperCase(), title: 'MetaTrooper', controls: [] };

async function core(args: string[]) {
  const iso: any = isolation();
  const state = join(iso.home, 'fake-uia.json');
  writeFileSync(state, JSON.stringify({ windows: [NOTEPAD, OWN, OTHER] }));
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
  return {
    ui, agent, call, grant,
    async close() {
      ui.close(); agent.close();
      db.prepare('UPDATE session SET pid = NULL').run();
      db.close();
      await teardownCore(child, iso);
    },
  };
}

const skip = !WB_EXE && 'needs workbench/node_modules/electron installed';

test('M6-16c a core without --demo never lists or grants a window of any workbench of this install, its own or another', { skip, timeout: 60_000 }, async () => {
  // protects=rule 8 on the real core fails_when=a workbench window (own pid or only a matching exe path) is listed or granted no_claim=packaged MetaTrooper.exe builds, which M5-1 must re-run against
  const c = await core([]);
  try {
    const listed = (await c.call(c.ui, 'grant.candidates', {})).result.windows.map((w: any) => w.hwnd);
    assert.deepEqual(listed, [NOTEPAD.hwnd]);
    for (const w of [OWN, OTHER]) {
      const r = await c.grant(w as any);
      assert.equal(r.error?.code, -32003, `window ${w.hwnd}`);
      assert.match(r.error.message, /workbench cannot be granted/);
    }
    assert.match((await c.grant(NOTEPAD)).result.grant_id, /^gr_/);
  } finally {
    await c.close();
  }
});

test('M6-16c a --demo core grants its own workbench window to its own session and still refuses any other workbench', { skip, timeout: 60_000 }, async () => {
  // protects=the demo exception stays scoped to the demo core's own ui-window pid fails_when=the demo core refuses its own window, reads of a granted demo window fail, or another workbench becomes grantable no_claim=a live Electron window (the opt-in E2E covers that)
  const c = await core(['--demo']);
  try {
    const listed = (await c.call(c.ui, 'grant.candidates', {})).result.windows.map((w: any) => w.hwnd);
    assert.deepEqual(listed.sort(), [NOTEPAD.hwnd, OWN.hwnd]);
    const g = await c.grant(OWN as any);
    assert.match(g.result?.grant_id ?? '', /^gr_/, JSON.stringify(g));
    const other = await c.grant(OTHER as any);
    assert.equal(other.error?.code, -32003);
    const me = { session_id: 's1', pid: process.pid };
    const windows = (await c.call(c.agent, 'desktop.windows', me)).result.windows;
    assert.deepEqual(windows.map((w: any) => w.window), [OWN.hwnd], 'windows lists only the grant');
    const snap = await c.call(c.agent, 'desktop.snapshot', { ...me, window: OWN.hwnd });
    assert.match(snap.result?.text ?? '', /button "Approve once"/, JSON.stringify(snap));
    assert.ok((await c.call(c.agent, 'desktop.snapshot', { ...me, window: OTHER.hwnd })).error, 'another workbench stays unreadable');
  } finally {
    await c.close();
  }
});
