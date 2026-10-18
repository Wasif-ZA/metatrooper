import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sleep, until } from './helpers.ts';
import { Helper } from '../src/desktop/driver.ts';

// Opt-in: sends key requests straight to the real uia-helper.ps1, past the core's own checks, so only the helper's
// refusals stand between the request and a real Notepad. Run with METATROOPER_DESKTOP_E2E=1 and no Notepad window open.
const runnable = process.env.METATROOPER_DESKTOP_E2E === '1' && process.platform === 'win32';

test('M6-15 helper on this laptop: a Control or Shift chord and a key to a background window are refused by uia-helper.ps1 itself, and Notepad does not change', { skip: !runnable && 'needs METATROOPER_DESKTOP_E2E=1 on Windows', timeout: 180_000 }, async () => {
  const helper = new Helper();
  const notepads = async () => (await helper.request('list', {}, 90_000)).windows.filter((w: any) => /^notepad\.exe$/i.test(w.exe));
  assert.deepEqual(await notepads(), [], 'close every Notepad window first: the test must not touch your own tabs');
  const dir = mkdtempSync(join(tmpdir(), 'm6-15-helper-e2e-'));
  const scratch = join(dir, 'm6-15-helper-e2e-scratch.txt');
  writeFileSync(scratch, '');
  const calcPids = () => [...execFileSync('tasklist', ['/FI', 'IMAGENAME eq CalculatorApp.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8' }).matchAll(/^"[^"]+","(\d+)"/gm)].map((m) => m[1]);
  const calcsBefore = calcPids();
  let notepadPid = 0;
  try {
    spawn('notepad.exe', [scratch], { detached: true, stdio: 'ignore' }).unref();
    const ours = (w: any) => w.title.startsWith('m6-15-helper-e2e-scratch.txt');
    const notepad = (await until(async () => (await notepads()).find(ours), 15_000)) as any;
    notepadPid = notepad.pid;
    const hwnd = notepad.hwnd;
    const foreground = async () => (await helper.request('probe')).foreground;
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `(New-Object -ComObject WScript.Shell).AppActivate(${notepad.pid}) | Out-Null`]);
    await until(async () => (await foreground()) === hwnd, 10_000);
    await sleep(1000);
    const docRef = /^\s*document\b.*\[ref=(e\d+)\]/m.exec((await helper.request('snapshot', { hwnd, max_nodes: 400 })).text)![1];
    const text = async () => (await helper.request('value', { hwnd, ref: docRef })).value;
    assert.equal(await text(), '');

    // in front, the document holds focus, so a posted Shift+X that slipped past the refusal would type an x
    const front = await helper.request('describe', { hwnd });
    assert.equal(front.control?.role, 'document');
    assert.equal(front.hidden, false);
    // this test stands in for the workbench the helper requires to be running
    const ui = { ui_pid: process.pid, ui_start: (await helper.request('process', { process: process.pid })).process_start };
    assert.ok(ui.ui_start);
    const seen = { check: 1, name: front.control.name, automation_id: front.control.automation_id, role: front.control.role, password: 0, hidden: 0, file_dialog: 0, rid: front.rid, pid: notepad.pid, ...ui };
    // a pid reused by a later process, or none, gets no key even with focus in the document
    await assert.rejects(helper.request('key', { hwnd, keys: 'X', ...seen, ui_start: '2000-01-01T00:00:00.0000000Z' }), /the workbench is not running/);
    await assert.rejects(helper.request('key', { hwnd, keys: 'X', ...seen, ui_pid: 0 }), /the workbench is not running/);
    for (const keys of ['Shift+X', 'Control+V', 'Alt+Shift', 'Shift']) {
      await assert.rejects(helper.request('key', { hwnd, keys, ...seen }), /Control and Shift cannot be sent/, keys);
    }
    assert.equal(await foreground(), hwnd, 'Notepad stayed in front for the chord refusals');

    spawn('calc.exe', [], { detached: true, stdio: 'ignore' }).unref();
    await until(async () => { const f = await foreground(); return f !== 0 && f !== hwnd; }, 15_000);
    await sleep(1000);
    // in the background Notepad's thread reports no focus HWND, so a key approved in front has nowhere checked to go
    await assert.rejects(helper.request('key', { hwnd, keys: 'X', ...seen }), /this window has no keyboard focus/);
    await assert.rejects(helper.request('key', { hwnd, keys: 'Enter', ...seen }), /this window has no keyboard focus/);
    await assert.rejects(helper.request('key', { hwnd, keys: 'Alt+Control', ...seen }), /Control and Shift cannot be sent/);

    await sleep(500);
    await helper.request('snapshot', { hwnd, max_nodes: 400 });
    assert.equal(await text(), '', 'nothing reached the document');
    assert.equal(readFileSync(scratch, 'utf8'), '');
    assert.ok(ours((await notepads()).find((w: any) => w.hwnd === hwnd)), 'the scratch tab is still the active, unmodified tab');
  } finally {
    helper.stop();
    if (notepadPid) try { process.kill(notepadPid); } catch {}
    for (const pid of calcPids()) if (!calcsBefore.includes(pid)) try { process.kill(Number(pid)); } catch {}
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
