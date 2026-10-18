import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { client, isolation, sleep, startCore, teardownCore, uiHello, until } from './helpers.ts';
import { Helper } from '../src/desktop/driver.ts';

// Opt-in: drives real Notepad and Calculator on this desktop through the real UI Automation helper.
// Run with METATROOPER_DESKTOP_E2E=1 and no Notepad window open (Windows 11 Notepad opens new files as tabs of an
// open window, and the test must never type into the user's own tabs). It types only into the Notepad it starts.
const runnable = process.env.METATROOPER_DESKTOP_E2E === '1' && process.platform === 'win32';

const call = (pipe: any, method: string, params: object, timeout = 60_000) => pipe.request(method, params, { timeout });

test('M6-15a / M6-15b on this laptop: Notepad typing with another app in front, Calculator refused, Save As asks, take-over stops typing', { skip: !runnable && 'needs METATROOPER_DESKTOP_E2E=1 on Windows', timeout: 300_000 }, async () => {
  const probe = new Helper();
  const notepads = async () => (await probe.request('list', {}, 90_000)).windows.filter((w: any) => /^notepad\.exe$/i.test(w.exe));
  assert.deepEqual(await notepads(), [], 'close every Notepad window first: the test must not touch your own tabs');

  const iso = isolation();
  const core = await startCore(iso);
  const db = new DatabaseSync(join(iso.home, 'troop.db'));
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF');
  const now = new Date().toISOString();
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, hidden, started_at, pid) VALUES ('s1', 'p1', 'fake', 'pty', 'working', ?, 0, ?, ?)").run(now, now, process.pid);
  const agent = await client(iso.prefix);
  const ui = await client(iso.prefix);
  let notepadPid = 0;
  let calcsBefore: string[] | null = null;
  const calcPids = () => [...execFileSync('tasklist', ['/FI', 'IMAGENAME eq CalculatorApp.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).matchAll(/^"[^"]+","(\d+)"/gm)].map((m) => m[1]);
  try {
    await uiHello(ui, iso.home);
    await call(ui, 'desktop.ui-window', { pid: 1, takeover_key: 'Control+Alt+Q', takeover_error: null });
    const me = { session_id: 's1', pid: process.pid };

    // Windows 11 Notepad restores the last session's tabs, so open a file of our own and type only while it is the active tab
    const scratch = join(iso.home, 'm6-15-e2e-scratch.txt');
    writeFileSync(scratch, '');
    spawn('notepad.exe', [scratch], { detached: true, stdio: 'ignore' }).unref();
    const ours = (w: any) => w.title.startsWith('m6-15-e2e-scratch.txt');
    const notepad = (await until(async () => (await notepads()).find(ours), 15_000)) as any;
    const assertOurs = async () => assert.ok(ours((await notepads()).find((w: any) => w.hwnd === notepad.hwnd) ?? { title: '' }), 'the scratch file is not the active Notepad tab');
    notepadPid = notepad.pid;
    calcsBefore = calcPids();
    spawn('calc.exe', [], { detached: true, stdio: 'ignore' }).unref();
    const calc = (await until(async () => (await probe.request('list')).windows.find((w: any) => /^Calculator$/.test(w.title)), 15_000)) as any;
    await sleep(1500);

    const grant = (await call(ui, 'grant.window', { session_id: 's1', hwnd: notepad.hwnd })).result.grant_id;
    assert.match(grant, /^gr_/);
    const tree = (await call(agent, 'desktop.snapshot', { ...me, window: notepad.hwnd, max_nodes: 400 })).result.text as string;
    const docRef = /^\s*document\b.*\[ref=(e\d+)\]/m.exec(tree)![1];

    const act = async (window: number, params: Record<string, unknown>) => {
      if (window === notepad.hwnd) await assertOurs();
      const d = await call(agent, 'desktop.describe', { ...me, window, ref: params.ref });
      if (d.error) return d;
      const { control, password, hidden, file_dialog, grant_id, token } = d.result;
      const check = { session_id: 's1', surface: 'desktop', target: grant_id, action: params.action, args: { window, ...params }, control, password, hidden, file_dialog };
      const v = await call(agent, 'approval.check', check, 130_000);
      if (v.error) return v;
      if (v.result.decision !== 'allow' && v.result.decision !== 'approved') return { error: { message: `not allowed: ${JSON.stringify(v.result)}` } };
      return call(agent, 'desktop.act', { ...me, window, ...params, expect: { ...(control ?? { name: '', automation_id: '', role: '' }), password, hidden, file_dialog, grant_id, token } }, 300_000);
    };

    // M6-15a: another app has focus, the pointer does not move
    const before = await probe.request('probe');
    assert.notEqual(before.foreground, notepad.hwnd, 'another app holds the foreground');
    // a posted Control or Shift never reaches the app, so Control+Shift+S is refused before any approval is asked
    const refused = (await act(notepad.hwnd, { action: 'key', keys: 'Control+Shift+S' })).error?.message;
    assert.match(refused, /Control and Shift cannot be sent/);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM approval').get() as any).n, 0);
    console.log(`Control+Shift+S refused: ${refused}`);
    await sleep(300);
    await probe.request('snapshot', { hwnd: notepad.hwnd, max_nodes: 400 });
    assert.equal((await probe.request('value', { hwnd: notepad.hwnd, ref: docRef })).value, '');
    const typed = await act(notepad.hwnd, { action: 'type', ref: docRef, text: 'typed by M6-15' });
    assert.ok(typed.result, JSON.stringify(typed.error));
    const after = await probe.request('probe');
    assert.deepEqual(after.cursor, before.cursor, 'the pointer did not move');
    await probe.request('snapshot', { hwnd: notepad.hwnd, max_nodes: 400 });
    assert.equal((await probe.request('value', { hwnd: notepad.hwnd, ref: docRef })).value, 'typed by M6-15');
    console.log(`focus_returned: ${typed.result.focus_returned}; foreground before ${before.foreground}, after ${after.foreground}`);

    // Calculator was not granted
    assert.match((await call(agent, 'desktop.describe', { ...me, window: calc.hwnd, ref: 'e1' })).error.message, /window not granted/);

    // M6-15b: Ctrl+Alt+Q while typing 2,000 characters; nothing lands after the acknowledgement
    const text = 'abcdefghij'.repeat(200);
    const tree2 = (await call(agent, 'desktop.snapshot', { ...me, window: notepad.hwnd, max_nodes: 400 })).result.text as string;
    const docRef2 = /^\s*document\b.*\[ref=(e\d+)\]/m.exec(tree2)![1];
    const typing = act(notepad.hwnd, { action: 'type', ref: docRef2, text });
    await probe.request('snapshot', { hwnd: notepad.hwnd, max_nodes: 400 });
    for (let i = 0; i < 400 && !/abcdefghij/.test((await probe.request('value', { hwnd: notepad.hwnd, ref: docRef2 })).value as string); i++) await sleep(25);
    const ack = await call(ui, 'takeover.pause', {});
    assert.ok(ack.result.paused_at);
    await probe.request('snapshot', { hwnd: notepad.hwnd, max_nodes: 400 });
    const atAck = (await probe.request('value', { hwnd: notepad.hwnd, ref: docRef2 })).value as string;
    await sleep(2000);
    const later = (await probe.request('value', { hwnd: notepad.hwnd, ref: docRef2 })).value as string;
    assert.match(atAck, /abcdefghij/, 'typing had started before the pause');
    assert.equal(later, atAck, 'no character reached Notepad after the acknowledgement');
    assert.ok(atAck.length < text.length, `paused before the end (${atAck.length} of ${text.length})`);
    assert.match((await typing).error.message, /paused by the user/);
    console.log(`paused after ${atAck.length} of ${text.length} characters`);
    await call(ui, 'takeover.resume', { session_id: 's1' });

    // Save As is reachable as an owned window, and every input in it raises an approval
    // Posted Control+Shift+S lands as a bare S, and Notepad's flyout closes when a click hands focus back,
    // so bring Notepad to the front and open Save As from the menu
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `(New-Object -ComObject WScript.Shell).AppActivate(${notepad.pid}) | Out-Null`]);
    await until(async () => (await probe.request('probe')).foreground === notepad.hwnd, 10_000);
    // the input watcher (M6-22) pauses on that focus change, as it would for any program; resume as the user would
    await sleep(1500);
    await call(ui, 'takeover.resume', { session_id: 's1' });
    for (const item of ['File', 'Save as']) {
      const pattern = new RegExp(`^\\s*menuitem "${item}".*\\[ref=(e\\d+)\\]`, 'm');
      const ref = (await until(async () => pattern.exec((await call(agent, 'desktop.snapshot', { ...me, window: notepad.hwnd, max_nodes: 600 })).result.text)?.[1], 10_000)) as string;
      const clicked = await act(notepad.hwnd, { action: 'click', ref });
      assert.ok(clicked.result, JSON.stringify(clicked.error));
    }
    const dialog = (await until(async () => (await call(agent, 'desktop.windows', me)).result.windows.find((w: any) => w.owner === notepad.hwnd || (w.window !== notepad.hwnd && /save/i.test(w.title))), 10_000)) as any;
    // the dialog can open more than 200 ms after the click returns, which the watcher reads as a change while away
    await sleep(1000);
    await call(ui, 'takeover.resume', { session_id: 's1' });
    const dTree = (await call(agent, 'desktop.snapshot', { ...me, window: dialog.window, max_nodes: 600 })).result.text as string;
    const nameRef = /edit "File name:".*\[ref=(e\d+)\]/m.exec(dTree)?.[1] ?? /edit .*\[ref=(e\d+)\]/m.exec(dTree)![1];
    const d = (await call(agent, 'desktop.describe', { ...me, window: dialog.window, ref: nameRef })).result;
    assert.equal(d.file_dialog, true);
    // typing a file name asks (rejected, nothing typed); Escape asks too (approved, closes the dialog unsaved)
    for (const [params, decision] of [[{ action: 'type', ref: nameRef, text: 'never-saved.txt' }, 'reject'], [{ action: 'key', keys: 'Escape' }, 'approve']] as const) {
      const pending = act(dialog.window, params);
      const row = await until(() => db.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any, 10_000);
      assert.equal(row.reason, 'file dialog');
      await call(ui, 'approval.resolve', { approval_id: row.id, decision });
      const r = await pending;
      if (decision === 'reject') assert.match(r.error.message, /not allowed/);
      else assert.ok(r.result, JSON.stringify(r.error));
    }

  } finally {
    agent.close(); ui.close();
    db.prepare('UPDATE session SET pid = NULL').run();
    db.close();
    probe.stop();
    if (notepadPid) try { process.kill(notepadPid); } catch {}
    if (calcsBefore) for (const pid of calcPids()) if (!calcsBefore.includes(pid)) try { process.kill(Number(pid)); } catch {}
    await teardownCore(core, iso);
  }
});
