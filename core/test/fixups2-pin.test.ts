import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Desktop, PAUSED_DRIFT } from '../src/desktop/driver.ts';
import { takeoverPaused } from '../src/grants.ts';

const NOTEPAD = { hwnd: 100, pid: 4100, process_start: '2026-10-12T01:00:00.000Z', exe: 'Notepad.exe', title: 'Untitled - Notepad', controls: [{ role: 'document', name: 'Text editor', automation_id: 'RichEditD2DPT' }] };
const DIALOG = { hwnd: 101, owner: 100, pid: 4100, process_start: NOTEPAD.process_start, exe: 'Notepad.exe', title: 'Save as', class: '#32770', file_dialog: true, controls: [{ role: 'button', name: 'Save', automation_id: '1' }] };
const WORKBENCH = { hwnd: 300, pid: process.pid, process_start: '2026-10-12T00:59:00.000Z', exe: 'electron.exe', title: 'MetaTrooper', controls: [] };
const pausedDrift = (e: any) => { assert.equal(e.message, PAUSED_DRIFT); return true; };

// Same fake-helper fixture as m8-40e-grant-pin.test.ts, trimmed to what the pin checks need.
async function fixture(t: any) {
  const home = mkdtempSync(join(tmpdir(), 'fixups2-pin-'));
  const statePath = join(home, 'fake-uia.json');
  const logPath = join(home, 'fake-uia.log');
  const setWindows = (windows: object[]) => writeFileSync(statePath, JSON.stringify({ windows }));
  setWindows([NOTEPAD, DIALOG, WORKBENCH]);
  const env: Record<string, string> = { METATROOPER_UIA_HELPER: join(import.meta.dirname, 'fake-uia-helper.js'), FAKE_UIA_STATE: statePath, FAKE_UIA_LOG: logPath, FAKE_UIA_DELAY_MS: '0' };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../contracts/schema.sql', import.meta.url), 'utf8'));
  db.exec(`PRAGMA foreign_keys = OFF; INSERT INTO plugin (id, version, path, manifest, source, permissions, installed_at) VALUES ('desktop', '1', '', '{}', 'builtin', '[]', 't'); INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, pid) VALUES ('s1', 'p1', 'fake', 'pty', 'working', 't', 't', ${process.pid})`);
  const desktop = new Desktop(db);
  const methods = new Map<string, any>();
  desktop.methods(methods);
  const call = (method: string, params: any = {}) => Promise.resolve().then(() => methods.get(method).handler(params));
  await call('desktop.ui-window', { pid: process.pid, takeover_key: 'Control+Alt+Q', takeover_error: null });
  const grant: string = ((await call('grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start })) as any).grant_id;
  t.after(() => {
    desktop.helper.stop();
    db.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { db, desktop, call, grant, setWindows };
}

test('fixups2 pin: a dialog owned by the granted window is checked against the granted window title', async (t) => {
  const f = await fixture(t);
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' });
  // The granted main window has drifted; its owned dialog still has a title that matches the pin.
  f.setWindows([{ ...NOTEPAD, title: 'Inbox - Mail (3)' }, { ...DIALOG, title: 'Untitled - Save as' }, WORKBENCH]);
  // Models the dialog info the spec describes: the helper reports root as the granted window (fake helper reports the dialog itself).
  const info = f.desktop.info.bind(f.desktop);
  f.desktop.info = async (hwnd: number) => { const w = await info(hwnd); return hwnd === DIALOG.hwnd ? { ...w, root: NOTEPAD.hwnd } : w; };
  await assert.rejects(f.desktop.resolve('s1', DIALOG.hwnd), pausedDrift);
  assert.equal(takeoverPaused(f.db, 's1'), true, 'the drift pauses the session');
});

test('fixups2 pin: a dialog whose helper root is itself still checks the granted window title', async (t) => {
  const f = await fixture(t);
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' });
  f.setWindows([{ ...NOTEPAD, title: 'Inbox - Mail (3)' }, { ...DIALOG, title: 'Untitled - Save as' }, WORKBENCH]);
  // Control: the fake helper's own dialog info (root is the dialog) already routes the check to the granted window.
  await assert.rejects(f.desktop.resolve('s1', DIALOG.hwnd), pausedDrift);
  assert.equal(takeoverPaused(f.db, 's1'), true);
});
