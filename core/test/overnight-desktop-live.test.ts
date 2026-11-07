import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Desktop } from '../src/desktop/driver.ts';
import { grantPin, titleMatches, takeoverPaused } from '../src/grants.ts';
import { once } from 'node:events';
import { until } from './helpers.ts';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// M8-38 rows 4 and 6 against the real uia-helper.ps1 and a live WinForms fixture; contracts/desktop-tools.md is the oracle.
const HELPER = fileURLToPath(new URL('../src/desktop/uia-helper.ps1', import.meta.url));
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const T = { skip: process.platform !== 'win32', timeout: 60000 };
// Bare pane line: no name and no AutomationId, so no `#<id>` token before `actions`.
const BARE_PANE = /^\s*pane actions=\[\] \[ref=e\d+\]/;

// Fixture form: a bare pane (no Name, no AccessibleName, AutomationId zeroed) holding a named button and a named textbox.
const FIXTURE = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Windows.Forms;
public class BarePanel : Panel {
  [DllImport("user32.dll")] static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  // Zeroes GWL_ID so UIA reports no AutomationId for this pane.
  protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); SetWindowLongPtr(Handle, -12, IntPtr.Zero); }
}
'@
$f = New-Object System.Windows.Forms.Form
$f.Text = 'Overnight desktop fixture'; $f.ShowInTaskbar = $false; $f.StartPosition = 'Manual'; $f.Location = New-Object System.Drawing.Point(40, 40); $f.Width = 700; $f.Height = 500
$panel = New-Object BarePanel; $panel.Dock = 'Fill'
$b = New-Object System.Windows.Forms.Button; $b.Text = 'Fixture button'; $b.AccessibleName = 'Fixture button'; $panel.Controls.Add($b)
$e = New-Object System.Windows.Forms.TextBox; $e.Text = 'editable'; $e.AccessibleName = 'Fixture editable'; $e.Location = New-Object System.Drawing.Point(10, 60); $panel.Controls.Add($e)
$f.Controls.Add($panel)
$timer=New-Object System.Windows.Forms.Timer; $timer.Interval=50
$timer.Add_Tick({ if(Test-Path -LiteralPath $env:OVERNIGHT_TITLE) { $f.Text=[IO.File]::ReadAllText($env:OVERNIGHT_TITLE) } })
$timer.Start()
$f.Add_Shown({ [Console]::Out.WriteLine('HWND ' + $f.Handle.ToInt64()); [Console]::Out.Flush() })
[System.Windows.Forms.Application]::Run($f)
`;

type Ctx = { helper: ChildProcess; fixture: ChildProcess; hwnd: number; dir: string; ui: { ui_pid: number; ui_start: string }; ask: (req: Record<string, unknown>) => Promise<any> };
let ctx: Ctx | null = null;
const started: ChildProcess[] = [];
let workDir = '';

before(async () => {
  if (process.platform !== 'win32') return;
  const dir = workDir = mkdtempSync(join(tmpdir(), 'overnight-live-'));
  const script = join(dir, 'fixture.ps1');
  writeFileSync(script, FIXTURE);
  const fixture = spawn('powershell.exe', [...PS, '-STA', '-File', script], { env: { ...process.env, OVERNIGHT_TITLE: join(dir, 'title.txt') }, stdio: ['ignore', 'pipe', 'pipe'] });
  started.push(fixture);
  let fixtureErrors = '';
  fixture.stderr!.on('data', b => { fixtureErrors += b; });
  const fixtureLines: string[] = [];
  readline.createInterface({ input: fixture.stdout! }).on('line', l => fixtureLines.push(l));
  const hwndLine = await until(() => fixtureLines.find(l => /^HWND /.test(l)) || (fixture.exitCode !== null && assert.fail(fixtureErrors)), 20000);
  const hwnd = Number(hwndLine.slice(5));
  const helper = spawn('powershell.exe', [...PS, '-File', HELPER], { stdio: ['pipe', 'pipe', 'ignore'] });
  started.push(helper);
  const replies = new Map<number, any>();
  readline.createInterface({ input: helper.stdout! }).on('line', l => { const r = JSON.parse(l); replies.set(r.id, r); });
  let n = 0;
  const ask = async (req: Record<string, unknown>) => {
    const id = ++n;
    helper.stdin!.write(JSON.stringify({ id, ...req }) + '\n');
    return until(() => replies.get(id), 15000);
  };
  // The helper's own pid and start time stand in for the workbench's, so input ops pass the ui_pid/ui_start check.
  const start = await ask({ op: 'process', process: helper.pid });
  ctx = { helper, fixture, hwnd, dir, ui: { ui_pid: helper.pid, ui_start: start.result.process_start }, ask };
  await initDesktop();
});

after(async () => {
  for (const child of started) if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; }
  if (workDir) rmSync(workDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

const lines = (text: string) => text.split(/\r?\n/).filter((l) => l.trim().length > 0);
const indent = (l: string) => /^ */.exec(l)![0].length;
const refOf = (l: string) => /\[ref=(e\d+)\]/.exec(l)![1];

async function snapWin(hwnd: number, max: number) {
  const r = await ctx!.ask({ op: 'snapshot', hwnd, max_nodes: max });
  assert.equal(r.error, undefined, JSON.stringify(r.error));
  return r.result as { text: string; nodes: number; truncated: boolean };
}

async function probe() {
  const r = await ctx!.ask({ op: 'probe' });
  assert.equal(r.error, undefined, JSON.stringify(r.error));
  return r.result as { cursor: number[]; foreground: unknown };
}

// Runs one input op between two probes, returning both probes and the reply.
async function inputOp(req: Record<string, unknown>) {
  const pre = await probe();
  const r = await ctx!.ask({ ...req, hwnd: ctx!.hwnd, ...ctx!.ui });
  const post = await probe();
  return { pre, post, r };
}

async function refFor(name: string) {
  const { text } = await snapWin(ctx!.hwnd, 400);
  const line = lines(text).find((l) => l.includes(`"${name}"`));
  assert.ok(line, `no node named ${name}`);
  return refOf(line);
}

let db: DatabaseSync, desktop: Desktop, grant: string;
const methods = new Map<string, any>();
const me = { session_id: 's1', pid: process.pid };
const call = (method: string, p: object = {}) => Promise.resolve().then(() => methods.get(method).handler(p));

async function initDesktop() {
  db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../contracts/schema.sql', import.meta.url), 'utf8'));
  db.exec("PRAGMA foreign_keys=OFF; INSERT INTO plugin (id,enabled,manifest,path,source,permissions,version,installed_at) VALUES ('desktop',1,'{}','','builtin','[]','1','t'); INSERT INTO session (id,project_id,engine_id,host,state,state_at,started_at,pid) VALUES ('s1','p1','fake','pty','working','t','t',"+process.pid+"),('s2','p1','fake','pty','working','t','t',NULL)");
  desktop = new Desktop(db);
  desktop.methods(methods);
  await call('desktop.ui-window', { pid: process.pid, takeover_key: 'Control+Alt+Q', takeover_error: null });
  const info = await desktop.info(ctx.hwnd);
  grant = (await call('grant.window', { session_id: 's1', hwnd: ctx.hwnd, pid: info.pid, process_start: info.process_start })).grant_id;
}
after(async () => {
  if (desktop) { const child = (desktop.helper as any).child; desktop.helper.stop(); if (child?.exitCode === null) await once(child, 'exit'); }
  db?.close();
});
async function retitle(title: string) {
  for (let attempt = 0; ; attempt++) {
    try { writeFileSync(join(ctx!.dir, 'title.txt'), title); break; }
    catch (error: any) {
      if (!['EBUSY', 'EPERM'].includes(error.code) || attempt === 50) throw error;
      await new Promise(r => setTimeout(r, 20));
    }
  }
  for (let i = 0; i < 100; i++) { if ((await desktop.info(ctx!.hwnd)).title === title) return; await new Promise(r => setTimeout(r, 100)); }
  assert.fail('fixture title did not update');
}

test('overnight M8-38: non-Chromium snapshot retains its empty pane and child depth', T, async () => {
  const all = lines((await snapWin(ctx!.hwnd, 400)).text);
  const b = all.findIndex(l => l.includes('"Fixture button"'));
  assert.ok(b > 0);
  let parent = b - 1;
  while (parent >= 0 && indent(all[parent]) >= indent(all[b])) parent--;
  assert.match(all[parent], BARE_PANE);
  assert.ok(indent(all[b]) > indent(all[parent]));
});

test('overnight M8-38: stationary button input reports false drift and empty foreground title', T, async () => {
  const ref = await refFor('Fixture button');
  const { pre, post, r } = await inputOp({ op: 'click', ref });
  assert.equal(r.error, undefined);
  assert.deepEqual(post, pre, 'the posted button must preserve foreground and cursor');
  assert.equal(r.result.pointer_drift, false);
  assert.equal(r.result.foreground_taken_by, '');
});

test('overnight M8-40e: live pins match literal punctuation and case; resume with drift pauses again', T, async () => {
  for (const [pattern, bad] of [
    ['Record.a([x])*', 'RecordZa([x]) tail'],
    ['Record.a([x])*', 'Record.a(x) tail'],
    ['Record.a([x])*', 'record.a([x]) tail'],
    ['Record.a([x])*', 'Record.a[x] tail'],
  ]) {
    await retitle('Record.a([x]) tail');
    await call('grant.pin', { grant_id: grant, title_pattern: pattern });
    assert.equal(grantPin(db, grant), pattern);
    await desktop.tick();
    assert.equal(takeoverPaused(db, 's1'), false);
    await retitle(bad);
    await desktop.tick();
    assert.equal(takeoverPaused(db, 's1'), true);
    await new Promise(r => setTimeout(r, 10));
    await call('takeover.resume', { session_id: 's1' });
    assert.equal(takeoverPaused(db, 's1'), false);
    await desktop.tick();
    assert.equal(takeoverPaused(db, 's1'), true, 'unchanged drifting title must pause again');
    await retitle('Record.a([x]) tail');
    await new Promise(r => setTimeout(r, 10));
    await call('takeover.resume', { session_id: 's1' });
  }
  await call('grant.pin', { grant_id: grant, title_pattern: '*' });
  await retitle('');
  await desktop.tick();
  assert.equal(takeoverPaused(db, 's1'), false, '* matches an empty live title');
  await assert.rejects(call('grant.pin', { grant_id: grant, title_pattern: '' }), (e: any) => e.code === -32602);
  assert.equal(grantPin(db, grant), '*', 'invalid empty pin leaves previous pin intact');
  await call('grant.pin', { grant_id: grant, title_pattern: null });
});

test('overnight M8-40: asking alone never pauses and the reason cap counts code points', T, async () => {
  assert.deepEqual(await call('takeover.request', { ...me, reason: '😀'.repeat(199) + 'Z🦊' }), { requested: true, paused: false });
  const requests = JSON.parse((db.prepare("SELECT value FROM meta WHERE key='takeover_requests'").get() as any).value);
  assert.equal(requests.s1.reason, '😀'.repeat(199) + 'Z');
  assert.equal(Array.from(requests.s1.reason).length, 200);
  assert.equal(takeoverPaused(db, 's1'), false);
  assert.equal(takeoverPaused(db, 's2'), false);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key='takeover_paused_at'").get(), undefined);
  const result = await call('desktop.snapshot', { ...me, window: ctx!.hwnd });
  assert.match(result.text, /Fixture button/);
  assert.deepEqual(await call('takeover.status', me), { requested: true, paused: false });
});

test('overnight M8-40e: wildcard and empty matcher boundaries', () => {
  for (const title of ['', 'a', 'a\nb', '😀']) assert.equal(titleMatches('*', title), true);
  assert.equal(titleMatches('', ''), true);
  assert.equal(titleMatches('', 'x'), false);
  assert.equal(titleMatches('(', '('), true);
  assert.equal(titleMatches('[', '['), true);
  assert.equal(titleMatches('.', 'x'), false);
  assert.equal(titleMatches('Case*', 'case'), false);
});

test('overnight M8-40e: a final line terminator is part of the whole title', () => {
  for (const title of ['Record\n', 'Record\r', 'Record\r\n', 'Record\u2028', 'Record\u2029']) {
    assert.equal(titleMatches('Record', title), false, JSON.stringify(title));
  }
});
