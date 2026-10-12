import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
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
  try {
    await uiHello(ui, iso.home);
    await call(ui, 'desktop.ui-window', { pid: 1 });
    const me = { session_id: 's1', pid: process.pid };

    spawn('notepad.exe', [], { detached: true, stdio: 'ignore' }).unref();
    const notepad = (await until(async () => (await notepads())[0], 15_000)) as any;
    notepadPid = notepad.pid;
    spawn('calc.exe', [], { detached: true, stdio: 'ignore' }).unref();
    const calc = (await until(async () => (await probe.request('list')).windows.find((w: any) => /^Calculator$/.test(w.title)), 15_000)) as any;
    await sleep(1500);

    const grant = (await call(ui, 'grant.window', { session_id: 's1', hwnd: notepad.hwnd })).result.grant_id;
    assert.match(grant, /^gr_/);
    const tree = (await call(agent, 'desktop.snapshot', { ...me, window: notepad.hwnd, max_nodes: 400 })).result.text as string;
    const docRef = /^\s*document\b.*\[ref=(e\d+)\]/m.exec(tree)![1];

    const act = async (window: number, params: Record<string, unknown>) => {
      const d = await call(agent, 'desktop.describe', { ...me, window, ref: params.ref });
      if (d.error) return d;
      const check = { session_id: 's1', surface: 'desktop', target: d.result.grant_id, action: params.action, args: { window, ...params }, control: d.result.control, password: d.result.password, file_dialog: d.result.file_dialog };
      const v = await call(agent, 'approval.check', check, 130_000);
      if (v.result.decision !== 'allow' && v.result.decision !== 'approved') return { error: { message: `not allowed: ${JSON.stringify(v.result)}` } };
      return call(agent, 'desktop.act', { ...me, window, ...params, expect: { ...(d.result.control ?? {}), password: d.result.password, file_dialog: d.result.file_dialog, grant_id: d.result.grant_id } }, 300_000);
    };

    // M6-15a: another app has focus, the pointer does not move
    const before = await probe.request('probe');
    assert.notEqual(before.foreground, notepad.hwnd, 'another app holds the foreground');
    const typed = await act(notepad.hwnd, { action: 'type', ref: docRef, text: 'typed by M6-15' });
    assert.ok(typed.result, JSON.stringify(typed.error));
    const after = await probe.request('probe');
    assert.deepEqual(after.cursor, before.cursor, 'the pointer did not move');
    await probe.request('snapshot', { hwnd: notepad.hwnd, max_nodes: 400 });
    assert.equal((await probe.request('value', { hwnd: notepad.hwnd, ref: docRef })).value, 'typed by M6-15');
    console.log(`focus_returned: ${typed.result.focus_returned}; foreground before ${before.foreground}, after ${after.foreground}`);

    // Calculator was not granted
    assert.match((await call(agent, 'desktop.describe', { ...me, window: calc.hwnd, ref: 'e1' })).error.message, /window not granted/);

    // Save As is reachable as an owned window, and every input in it raises an approval
    const npTree = (await call(agent, 'desktop.snapshot', { ...me, window: notepad.hwnd, max_nodes: 400 })).result.text as string;
    const fileRef = /menuitem "File".*\[ref=(e\d+)\]/m.exec(npTree)![1];
    assert.ok((await act(notepad.hwnd, { action: 'click', ref: fileRef })).result);
    await sleep(800);
    const menu = await until(async () => {
      const ws = (await call(agent, 'desktop.windows', me)).result.windows;
      for (const w of ws) {
        const t = (await call(agent, 'desktop.snapshot', { ...me, window: w.window, max_nodes: 400 })).result?.text ?? '';
        const m = /menuitem "Save as".*\[ref=(e\d+)\]/m.exec(t);
        if (m) return { window: w.window, ref: m[1] };
      }
      return null;
    }, 10_000) as { window: number; ref: string };
    assert.ok((await act(menu.window, { action: 'click', ref: menu.ref })).result);
    const dialog = (await until(async () => (await call(agent, 'desktop.windows', me)).result.windows.find((w: any) => w.owner === notepad.hwnd || (w.window !== notepad.hwnd && /save/i.test(w.title))), 10_000)) as any;
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

    // M6-15b: Ctrl+Alt+Q while typing 2,000 characters; nothing lands after the acknowledgement
    const text = 'abcdefghij'.repeat(200);
    const typing = act(notepad.hwnd, { action: 'type', ref: docRef, text });
    await sleep(1500);
    const ack = await call(ui, 'takeover.pause', {});
    assert.ok(ack.result.paused_at);
    await probe.request('snapshot', { hwnd: notepad.hwnd, max_nodes: 400 });
    const atAck = (await probe.request('value', { hwnd: notepad.hwnd, ref: docRef })).value as string;
    await sleep(2000);
    const later = (await probe.request('value', { hwnd: notepad.hwnd, ref: docRef })).value as string;
    assert.equal(later, atAck, 'no character reached Notepad after the acknowledgement');
    assert.ok(atAck.length < text.length, `paused before the end (${atAck.length} of ${text.length})`);
    assert.match((await typing).error.message, /paused by the user/);
    console.log(`paused after ${atAck.length} of ${text.length} characters`);
  } finally {
    agent.close(); ui.close();
    db.prepare('UPDATE session SET pid = NULL').run();
    db.close();
    probe.stop();
    if (notepadPid) try { process.kill(notepadPid); } catch {}
    await teardownCore(core, iso);
  }
});
