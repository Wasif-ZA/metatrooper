import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { sleep, until } from './helpers.ts';
import { nowIso } from '../src/time.ts';

const home = mkdtempSync(join(tmpdir(), 'troop-m6-22-'));
process.env.METATROOPER_HOME = home;
const { Watcher, beginAction, endAction, raise, FOLLOW_MS } = await import('../src/watch/watcher.ts');

const schema = readFileSync(join(import.meta.dirname, '..', '..', 'contracts', 'schema.sql'), 'utf8');
const windows = process.platform === 'win32';
const e2e = windows && process.env.METATROOPER_DESKTOP_E2E === '1';

function setup(): DatabaseSync {
  const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), 'troop-m6-22-db-')), 'troop.db'));
  db.exec(schema);
  const at = nowIso();
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', '/p', 'p', ?, ?)").run(at, at);
  db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1)").run();
  for (const id of ['s1', 's2']) db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p', 'claude', 'pty', 'working', ?, ?)").run(id, at, at);
  return db;
}

function grant(db: DatabaseSync, session: string, hwnd = 100): void {
  db.prepare("INSERT INTO grant (id, session_id, hwnd, pid, process_start, exe, title, created_at) VALUES (?, ?, ?, 1, 't', 'notepad.exe', 'Notepad', ?)").run(`gr_${session}_${hwnd}`, session, hwnd, nowIso());
}

const items = (db: DatabaseSync, kind: 'input' | 'away', hwnd?: number) =>
  db.prepare("SELECT text FROM needs_you WHERE kind = 'other' AND resolved_at IS NULL AND ref LIKE ?").all(`watch:${kind}:${hwnd ?? '%'}`) as Array<{ text: string }>;
const meta = (db: DatabaseSync, key: string) => (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
const key = (t: number, hwnd = 7) => ({ kind: 'key' as const, t, idle_ms: -1, hwnd, title: 'Untitled - Notepad' });
const uia = (t: number, idle_ms: number, hwnd = 8) => ({ kind: 'invoked' as const, t, idle_ms, hwnd, title: 'Calculator' });

test('M6-22a: unmatched injected input raises one "input from another program" item naming the window and sets the take-over flag', () => {
  const db = setup();
  const t = Date.now() + 100_000;
  assert.equal(raise(db, key(t)), true);
  assert.equal(raise(db, key(t + 5)), true);
  const open = items(db, 'input');
  assert.equal(open.length, 1);
  assert.match(open[0].text, /^input from another program in "Untitled - Notepad" \(the watcher cannot name the program behind it\)$/);
  assert.ok(meta(db, 'takeover_paused_at'));
});

test('M6-22a: injected input inside a metatrooper-desktop action, 200 ms slack either side, raises none; past the slack it raises', () => {
  const db = setup();
  const t = Date.now() + 200_000;
  const id = beginAction(t);
  endAction(id, t + 1000);
  for (const at of [t - 200, t, t + 500, t + 1200]) assert.equal(raise(db, key(at)), false, `at +${at - t} ms`);
  assert.equal(items(db, 'input').length, 0);
  assert.equal(meta(db, 'takeover_paused_at'), null);
  assert.equal(raise(db, key(t - 201)), true);
  assert.equal(raise(db, key(t + 1201, 9)), true);
  assert.equal(items(db, 'input').length, 2);
});

test('M6-22a: an action with no end yet covers everything after its start', () => {
  const db = setup();
  const t = Date.now() + 300_000;
  const id = beginAction(t);
  assert.equal(raise(db, key(t + 60_000)), false);
  endAction(id, t + 60_001);
});

test('M6-22c: a UI Automation event after 2 s with no input raises "the desktop changed while you were away from it"; one while the user is typing raises none', () => {
  const db = setup();
  const t = Date.now() + 400_000;
  assert.equal(raise(db, uia(t, 1999)), false);
  assert.equal(items(db, 'away').length, 0);
  assert.equal(raise(db, uia(t, 5000)), true);
  assert.equal(raise(db, uia(t + 1, 5001)), true);
  const open = items(db, 'away');
  assert.equal(open.length, 1);
  assert.match(open[0].text, /^the desktop changed while you were away from it, in "Calculator" \(the watcher cannot name the program behind it\)$/);
  assert.ok(meta(db, 'takeover_paused_at'));
});

test('M6-22: a window event in the acted-on process up to 1500 ms after the action is the action\'s own; another process, a later event or injected input still raises', () => {
  const db = setup();
  const t = Date.now() + 450_000;
  const id = beginAction(t, 4100);
  endAction(id, t + 100);
  const opened = (at: number, pid: number, hwnd = 300) => ({ kind: 'opened' as const, t: at, idle_ms: 10_000, hwnd, title: 'Save as', pid });
  assert.equal(raise(db, opened(t + 100 + FOLLOW_MS, 4100)), false, 'dialog of the acted-on process inside the window');
  assert.equal(raise(db, { ...opened(t + 900, 4100), kind: 'focus' }), false);
  assert.equal(raise(db, opened(t + 900, 4200, 301)), true, 'another process');
  assert.equal(raise(db, opened(t + 101 + FOLLOW_MS, 4100, 302)), true, 'past the window');
  assert.equal(raise(db, opened(t + 900, 0, 303)), true, 'unknown process');
  assert.equal(raise(db, { ...key(t + 900, 304), pid: 4100 }), true, 'injected input is never the action\'s own');
  assert.equal(items(db, 'away').length, 3);
  assert.equal(items(db, 'input').length, 1);
});

test('M6-22: desktop.watch_pause off raises the item but leaves the take-over flag alone', () => {
  writeFileSync(join(home, 'settings.json'), JSON.stringify({ desktop: { watch_pause: false } }));
  try {
    const db = setup();
    assert.equal(raise(db, key(Date.now() + 500_000)), true);
    assert.equal(items(db, 'input').length, 1);
    assert.equal(meta(db, 'takeover_paused_at'), null);
  } finally {
    writeFileSync(join(home, 'settings.json'), '{}');
  }
});

test('M6-22b: with the helper blocked by policy the watcher reports off while a grant is live, and idle once none is', { skip: !windows && 'Windows only', timeout: 60_000 }, async () => {
  const db = setup();
  const w = new Watcher(db, { policy: 'Restricted' });
  try {
    assert.equal(meta(db, 'input_watcher'), 'idle');
    w.tick();
    assert.equal(meta(db, 'input_watcher'), 'idle', 'no grant, no helper');
    grant(db, 's1');
    w.tick();
    await until(() => meta(db, 'input_watcher') === 'off', 30_000);
    w.tick();
    assert.equal(meta(db, 'input_watcher'), 'off', 'a blocked helper is not retried while the grant lives');
    db.prepare('UPDATE grant SET ended_at = ?').run(nowIso());
    w.tick();
    assert.equal(meta(db, 'input_watcher'), 'idle');
  } finally {
    w.stop();
  }
});

test('M6-22: the real helper compiles its hook class and reports on while a grant is live', { skip: !windows && 'Windows only', timeout: 60_000 }, async () => {
  const db = setup();
  const w = new Watcher(db);
  try {
    grant(db, 's1');
    w.tick();
    await until(() => meta(db, 'input_watcher') === 'on', 30_000);
  } finally {
    w.stop();
  }
});

/** Runs a PowerShell fixture that reads commands on stdin and prints one JSON line per reply. */
function fixture(script: string) {
  const file = join(mkdtempSync(join(tmpdir(), 'troop-m6-22-fx-')), 'fx.ps1');
  writeFileSync(file, script);
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { stdio: ['pipe', 'pipe', 'inherit'] });
  const lines: any[] = [];
  readline.createInterface({ input: child.stdout! }).on('line', (l) => { try { lines.push(JSON.parse(l)); } catch {} });
  const next = async (timeout = 60_000) => { const at = lines.length; await until(() => lines.length > at, timeout); return lines[lines.length - 1]; };
  return { child, lines, next, send: (cmd: string) => child.stdin!.write(`${cmd}\n`), close: () => { child.stdin!.end(); child.kill(); } };
}

const WIN32 = `
Add-Type -AssemblyName System.Windows.Forms, UIAutomationClient, UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Fx {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] public struct LII { public uint cb; public uint t; }
  [DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LII i);
  public static long Idle() { var i = new LII { cb = 8 }; GetLastInputInfo(ref i); return (long)unchecked((uint)Environment.TickCount - i.t); }
}
'@
function Out($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
function Now { [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
$reader = New-Object IO.StreamReader([Console]::OpenStandardInput())
$pending = $reader.ReadLineAsync()
function Pump($f) { while (-not $pending.IsCompleted) { [Windows.Forms.Application]::DoEvents(); Start-Sleep -Milliseconds 15 }; $l = $pending.Result; if ($l -ne $null) { $script:pending = $reader.ReadLineAsync() }; return $l }
`;

// Opt-in: injects keys into a window it opens itself, checking first that it holds the foreground.
test('M6-22a on this desktop: SendKeys from another program raises one item within 1 s and sets the flag; inside a desktop action it raises none', { skip: !e2e && 'needs METATROOPER_DESKTOP_E2E=1 on Windows', timeout: 180_000 }, async () => {
  const fx = fixture(`${WIN32}
$f = New-Object Windows.Forms.Form; $f.Text = 'm6-22 SendKeys fixture'; $f.TopMost = $true
$t = New-Object Windows.Forms.TextBox; $f.Controls.Add($t)
$f.Show(); [Windows.Forms.Application]::DoEvents()
$f.Activate(); [void]$t.Focus(); [Windows.Forms.Application]::DoEvents()
Out @{ hwnd = $f.Handle.ToInt64() }
while (($l = Pump $f) -ne $null) {
  if ([Fx]::GetForegroundWindow() -ne $f.Handle) { Out @{ front = $false }; continue }
  $at = Now; [Windows.Forms.SendKeys]::SendWait('abc'); [Windows.Forms.Application]::DoEvents()
  Out @{ front = $true; at = $at; text = $t.Text }
}
`);
  const db = setup();
  const w = new Watcher(db);
  try {
    const { hwnd } = await fx.next();
    grant(db, 's1');
    w.tick();
    await until(() => meta(db, 'input_watcher') === 'on', 30_000);
    await sleep(500);
    db.prepare("UPDATE needs_you SET resolved_at = ? WHERE resolved_at IS NULL").run(nowIso());
    db.prepare("DELETE FROM meta WHERE key = 'takeover_paused_at'").run();

    fx.send('send');
    const sent = await fx.next();
    assert.equal(sent.front, true, 'the fixture window must hold the foreground; nothing was typed');
    assert.equal(sent.text, 'abc');
    await until(() => items(db, 'input', hwnd).length === 1, 1000);
    assert.ok(Date.now() - sent.at <= 1500);
    assert.ok(meta(db, 'takeover_paused_at'));
    await sleep(500);
    assert.equal(items(db, 'input', hwnd).length, 1, 'six key events, one item');

    db.prepare("UPDATE needs_you SET resolved_at = ? WHERE resolved_at IS NULL").run(nowIso());
    db.prepare("DELETE FROM meta WHERE key = 'takeover_paused_at'").run();
    const id = beginAction();
    fx.send('send');
    const inside = await fx.next();
    endAction(id);
    assert.equal(inside.front, true);
    await sleep(1000);
    assert.equal(items(db, 'input').length, 0);
    assert.equal(meta(db, 'takeover_paused_at'), null);
  } finally {
    w.stop();
    fx.close();
  }
});


/** Runs a PowerShell script to its end and returns its last JSON line. */
async function runPs(script: string): Promise<any> {
  const fx = fixture(script);
  fx.child.stdin!.end();
  await new Promise((r) => fx.child.on('exit', r));
  return fx.lines[fx.lines.length - 1];
}

/** Clicks the fixture's button through InvokePattern from this separate process; `busy` moves the mouse a pixel and back every 100 ms around it. */
const clicker = (hwnd: number, busy: boolean) => `${WIN32}
function Jiggle { for ($i = 0; $i -lt 10; $i++) { [Fx]::mouse_event(1, 1, 0, 0, [UIntPtr]::Zero); [Fx]::mouse_event(1, -1, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 100 } }
$win = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]${hwnd})
$btn = $win.FindFirst([Windows.Automation.TreeScope]::Descendants, (New-Object Windows.Automation.AndCondition((New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, 'Press me')), (New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::ControlTypeProperty, [Windows.Automation.ControlType]::Button)))))
$pattern = $btn.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
if (${busy ? '$true' : '$false'}) { Jiggle } else { $until = (Now) + 120000; while ([Fx]::Idle() -lt 5000 -and (Now) -lt $until) { Start-Sleep -Milliseconds 50 } }
$idle = [Fx]::Idle(); $at = Now
$pattern.Invoke()
if (${busy ? '$true' : '$false'}) { Jiggle }
Out @{ at = $at; idle = $idle }
`;

// Opt-in: another app (a form this test opens) has its button clicked through InvokePattern by a separate script, first
// while that script moves the mouse a pixel and back every 100 ms (input GetLastInputInfo counts, as typing is), then
// after 5 s with no input at all.
test('M6-22c on this desktop: an InvokePattern click after 5 s idle raises one "away" item within 1 s; the same click during input raises none', { skip: !e2e && 'needs METATROOPER_DESKTOP_E2E=1 on Windows', timeout: 240_000 }, async () => {
  const app = fixture(`${WIN32}
Add-Type -AssemblyName PresentationFramework
$w = New-Object Windows.Window; $w.Title = 'm6-22 Invoke fixture'; $w.Width = 300; $w.Height = 120; $w.ShowActivated = $false
$b = New-Object Windows.Controls.Button; $b.Content = 'Press me'; $w.Content = $b
$script:pressed = 0; $b.Add_Click({ $script:pressed++ })
$w.Add_ContentRendered({ Out @{ hwnd = (New-Object Windows.Interop.WindowInteropHelper($w)).Handle.ToInt64() } })
$timer = New-Object Windows.Threading.DispatcherTimer; $timer.Interval = [TimeSpan]::FromMilliseconds(50)
$timer.Add_Tick({ if ($pending.IsCompleted) { if ($pending.Result -eq $null) { $w.Close() } else { $script:pending = $reader.ReadLineAsync(); Out @{ pressed = $script:pressed } } } })
$timer.Start()
[void]$w.ShowDialog()
`);
  const db = setup();
  const w = new Watcher(db);
  try {
    const { hwnd } = await app.next();
    grant(db, 's1');
    w.tick();
    await until(() => meta(db, 'input_watcher') === 'on', 30_000);

    const busy = await runPs(clicker(hwnd, true));
    assert.ok(busy.idle < 2000, `idle ${busy.idle} ms`);
    await sleep(1000);
    assert.equal(items(db, 'away', hwnd).length, 0, 'input in the last 2 s: no away item');

    const click = await runPs(clicker(hwnd, false));
    assert.ok(click.idle >= 5000, `idle ${click.idle} ms: someone used the mouse or keyboard during the test`);
    await until(() => items(db, 'away', hwnd).length === 1, Math.max(1, click.at + 1000 - Date.now()));
    await sleep(500);
    assert.equal(items(db, 'away', hwnd).length, 1);
    app.send('count');
    assert.equal((await app.next()).pressed, 2, 'both clicks landed');
  } finally {
    w.stop();
    app.close();
  }
});

test('M6-22: output a stopped helper still has in its pipe changes nothing', { skip: !windows && 'Windows only', timeout: 60_000 }, () => {
  const db = setup();
  const w = new Watcher(db);
  grant(db, 's1');
  w.tick();
  const child = (w as any).child;
  db.prepare('UPDATE grant SET ended_at = ?').run(nowIso());
  w.tick();
  assert.equal(meta(db, 'input_watcher'), 'idle');
  child.stdout.emit('data', Buffer.from(`{"ready":true}\n${JSON.stringify(key(Date.now() + 600_000))}\n`));
  assert.equal(meta(db, 'input_watcher'), 'idle');
  assert.equal(items(db, 'input').length, 0);
  assert.equal(meta(db, 'takeover_paused_at'), null);
});

test('M6-22: a line the current helper sends after the last grant ends, before the next tick, changes nothing and stops it', { skip: !windows && 'Windows only', timeout: 60_000 }, () => {
  const db = setup();
  const w = new Watcher(db);
  try {
    grant(db, 's1');
    w.tick();
    const child = (w as any).child;
    db.prepare('UPDATE grant SET ended_at = ?').run(nowIso());
    child.stdout.emit('data', Buffer.from(`{"ready":true}\n${JSON.stringify(key(Date.now() + 600_000))}\n${JSON.stringify(uia(Date.now() + 600_000, 10_000))}\n`));
    assert.equal(meta(db, 'input_watcher'), 'idle');
    assert.equal(items(db, 'input').length, 0);
    assert.equal(items(db, 'away').length, 0);
    assert.equal(meta(db, 'takeover_paused_at'), null);
    assert.equal((w as any).child, null);
  } finally {
    w.stop();
  }
});

test('M6-22: a helper that dies after the last grant ends, before the next tick, leaves the watcher idle, not off', { skip: !windows && 'Windows only', timeout: 60_000 }, () => {
  const db = setup();
  const w = new Watcher(db);
  try {
    grant(db, 's1');
    w.tick();
    const child = (w as any).child;
    db.prepare('UPDATE grant SET ended_at = ?').run(nowIso());
    child.emit('exit', 1, null);
    assert.equal(meta(db, 'input_watcher'), 'idle');
    assert.equal((w as any).child, null);
    assert.equal((w as any).failed, false);
  } finally {
    w.stop();
  }
});

test('M6-22: the helper writes window titles as ASCII JSON, so non-ASCII survives any console code page', { skip: !windows && 'Windows only', timeout: 60_000 }, async () => {
  const helper = readFileSync(join(import.meta.dirname, '..', 'src', 'watch', 'input-hook.ps1'), 'utf8').replace(/^exit .*$/m, '');
  const title = 'café – 日本 \u{1f600} "q" \\';
  const out = await runPs(`${helper}
$s = -join ([char[]]@(${Array.from({ length: title.length }, (_, i) => title.charCodeAt(i)).join(',')}))
[Console]::Out.WriteLine('{"title":' + [MtInputWatch].GetMethod('Json', [Reflection.BindingFlags]'NonPublic,Static').Invoke($null, @($s)) + '}')
`);
  assert.equal(out?.title, title);
});

test('M6-22: a UI Automation event whose sender has no window reports hwnd 0 and pid 0, not the foreground window\'s', { skip: !windows && 'Windows only', timeout: 60_000 }, async () => {
  const helper = readFileSync(join(import.meta.dirname, '..', 'src', 'watch', 'input-hook.ps1'), 'utf8').replace(/^exit .*$/m, '');
  const out = await runPs(`${helper}
$flags = [Reflection.BindingFlags]'NonPublic,Static'
[void][MtInputWatch].GetMethod('OnUia', $flags).Invoke($null, @(2, $null))
$e = [MtInputWatch].GetField('queue', $flags).GetValue($null).Take()
[Console]::Out.WriteLine('{"hwnd":' + $e[3] + ',"pid":' + $e[4] + ',"foreground":' + [MtInputWatch].GetMethod('GetForegroundWindow', $flags).Invoke($null, @()).ToInt64() + '}')
`);
  assert.notEqual(out?.foreground, 0, 'a window holds the foreground, so the old fallback would have named it');
  assert.equal(out?.hwnd, 0);
  assert.equal(out?.pid, 0);
});
