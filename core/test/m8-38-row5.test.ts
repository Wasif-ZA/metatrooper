import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// M8-38 row 5 (M8-38d) against the real uia-helper.ps1, live WinForms forms and Edge; contracts/desktop-tools.md is the oracle.
const HELPER = fileURLToPath(new URL('../src/desktop/uia-helper.ps1', import.meta.url));
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const T = { timeout: 180000 };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Form with a title, a position, a size and a body; prints `HWND <n>` once shown and `say` lines for events.
const form = (title: string, x: number, y: number, w: number, h: number, body: string) => `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$f = New-Object System.Windows.Forms.Form
$f.Text = '${title}'; $f.StartPosition = 'Manual'; $f.Location = New-Object System.Drawing.Point(${x}, ${y}); $f.Width = ${w}; $f.Height = ${h}
function say($s) { [Console]::Out.WriteLine($s); [Console]::Out.Flush() }
${body}
$f.Add_Shown({ say ('HWND ' + $f.Handle.ToInt64()) })
[System.Windows.Forms.Application]::Run($f)
`;

// Fixture: a named Button and a named Label, each printing its own event line on Click.
const FIXTURE = form('row5 fixture', 1500, 700, 500, 300, `
$b = New-Object System.Windows.Forms.Button; $b.Text = 'Btn'; $b.AccessibleName = 'Btn'; $b.Location = New-Object System.Drawing.Point(10, 10); $b.Add_Click({ say 'EV button' }); $f.Controls.Add($b)
$l = New-Object System.Windows.Forms.Label; $l.Text = 'Lbl'; $l.AccessibleName = 'Lbl'; $l.Location = New-Object System.Drawing.Point(10, 90); $l.Add_Click({ say 'EV label' }); $f.Controls.Add($l)
`);
// Cover: a plain form placed over the fixture (the fixture spans 1500..2000 x 700..1000 on screen).
const COVER = form('row5 cover', 1480, 680, 560, 360, '');
// Edge page: an autofocused input whose oninput sets the document title.
const PAGE = `<!doctype html><meta charset="utf-8"><title>row5 page</title><body style="margin:0">
<input aria-label="PageInput" autofocus style="position:fixed;top:0;left:0;width:300px" oninput="document.title='input '+this.value">
</body>`;

type Child = { p: ChildProcess; events: string[]; hwnd: Promise<number> };
let workDir = '';
let helper: ChildProcess | null = null;
let ask: (req: Record<string, unknown>) => Promise<any> = async () => { throw new Error('helper not started'); };
let ui = { ui_pid: 0, ui_start: '' };
let fx: Child | null = null;
let fxHwnd = 0;
const kids: ChildProcess[] = [];
const profiles: string[] = [];

// Starts a WinForms script under STA and collects its stdout: the HWND line and event lines.
function launchForm(name: string, script: string): Child {
  const file = join(workDir, name);
  writeFileSync(file, script);
  const p = spawn('powershell.exe', [...PS, '-STA', '-File', file], { stdio: ['ignore', 'pipe', 'ignore'] });
  kids.push(p);
  const events: string[] = [];
  const hwnd = new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${name} window did not appear`)), 60000);
    readline.createInterface({ input: p.stdout! }).on('line', (l) => {
      const m = /^HWND (\d+)/.exec(l);
      if (m) { clearTimeout(t); resolve(Number(m[1])); } else events.push(l);
    });
    p.on('exit', () => reject(new Error(`${name} exited`)));
  });
  return { p, events, hwnd };
}

before(async () => {
  if (process.platform !== 'win32') return;
  workDir = mkdtempSync(join(tmpdir(), 'm8-38-row5-'));
  fx = launchForm('fixture.ps1', FIXTURE);
  fxHwnd = await fx.hwnd;
  await sleep(500);
  const h = spawn('powershell.exe', [...PS, '-File', HELPER], { stdio: ['pipe', 'pipe', 'ignore'] });
  helper = h;
  const waiting = new Map<number, (r: any) => void>();
  readline.createInterface({ input: h.stdout! }).on('line', (l) => { const r = JSON.parse(l); waiting.get(r.id)?.(r); });
  let n = 0;
  ask = (req) => new Promise((resolve) => { const id = ++n; waiting.set(id, resolve); h.stdin!.write(JSON.stringify({ id, ...req }) + '\n'); });
  // The helper's own pid and start time stand in for the workbench's, so input ops pass the ui_pid/ui_start check.
  const start = await ask({ op: 'process', process: h.pid });
  ui = { ui_pid: h.pid!, ui_start: start.result.process_start };
});

after(async () => {
  if (process.platform !== 'win32') return;
  helper?.kill();
  for (const k of kids) k.kill();
  for (const profile of profiles) {
    // Stops only the browser started with this temp profile, matched on its command line.
    try {
      execFileSync('powershell.exe', [...PS, '-Command', 'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($env:M8_PROFILE) } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }'], { env: { ...process.env, M8_PROFILE: profile }, stdio: 'ignore' });
    } catch { /* best effort */ }
  }
  await sleep(1000);
  for (const d of [workDir, ...profiles]) {
    // Best-effort removal of temp dirs; a locked file is left behind.
    try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
  }
});

const errText = (r: any): string => (typeof r.error === 'string' ? r.error : String(r.error?.message ?? JSON.stringify(r.error)));
// Fails the test with the helper's error text when a reply carries one.
function noError(r: any) { if (r.error) assert.fail(errText(r)); }

// Snapshots the window until a node named `name` shows up, and returns its ref.
async function refFor(hwnd: number, name: string, tries = 10): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const r = await ask({ op: 'snapshot', hwnd, max_nodes: 400 });
    noError(r);
    const line = String(r.result.text).split(/\r?\n/).find((l) => l.includes(`"${name}"`));
    if (line) return /\[ref=(e\d+)\]/.exec(line)![1];
    await sleep(300);
  }
  assert.fail(`no node named ${name}`);
}

// Waits up to ms for an event line from a form; true when it arrived.
async function seen(c: Child, line: string, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (c.events.includes(line)) return true; await sleep(50); }
  return c.events.includes(line);
}

async function listWindows(): Promise<Array<{ hwnd: number; title: string }>> {
  const r = await ask({ op: 'list' });
  noError(r);
  return (Array.isArray(r.result) ? r.result : r.result.windows) as Array<{ hwnd: number; title: string }>;
}

// Polls for a window whose title starts with prefix and was not already open before the launch.
async function findNewWindow(prefix: string, known: Set<number>) {
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const w = (await listWindows()).find((x) => !known.has(x.hwnd) && String(x.title).startsWith(prefix));
    if (w) return w;
  }
  return null;
}

// Polls the window list until hwnd is listed, then waits for its first paint.
async function waitListed(hwnd: number) {
  for (let i = 0; i < 50; i++) {
    if ((await listWindows()).some((x) => x.hwnd === hwnd)) { await sleep(800); return; }
    await sleep(200);
  }
  assert.fail(`cover window ${hwnd} never appeared in list`);
}

// Polls the window list until hwnd is gone, so a killed cover cannot still shadow the next test.
async function waitGone(hwnd: number) {
  for (let i = 0; i < 50; i++) {
    if (!(await listWindows()).some((x) => x.hwnd === hwnd)) return;
    await sleep(200);
  }
  assert.fail(`cover window ${hwnd} is still listed after 10 s`);
}

async function titleOf(hwnd: number): Promise<string> {
  const r = await ask({ op: 'info', hwnd });
  noError(r);
  return r.result.title;
}

describe('M8-38 row 5: refuse posted input that is lost', { skip: process.platform !== 'win32' ? 'needs Windows UI Automation' : false }, () => {
  test('row 1: a Label covered by another window is refused and nothing is sent', T, async () => {
    const cover = launchForm('cover1.ps1', COVER);
    try {
      await waitListed(await cover.hwnd);
      const ref = await refFor(fxHwnd, 'Lbl');
      fx!.events.length = 0;
      const r = await ask({ op: 'click', hwnd: fxHwnd, ref, ...ui });
      if (!r.error) assert.fail('click on a covered Label succeeded');
      const text = errText(r);
      assert.ok(text.startsWith('background_unavailable'), text);
      assert.ok(text.endsWith('nothing was sent'), text);
      await sleep(800);
      assert.ok(!fx!.events.includes('EV label'), 'EV label arrived after a refused click');
    } finally {
      cover.p.kill();
      await waitGone(await cover.hwnd);
    }
  });

  test('row 2: an uncovered Label still takes the click and EV label arrives', T, async () => {
    const ref = await refFor(fxHwnd, 'Lbl');
    fx!.events.length = 0;
    const r = await ask({ op: 'click', hwnd: fxHwnd, ref, ...ui });
    noError(r);
    assert.ok(await seen(fx!, 'EV label', 2000), 'EV label did not arrive');
  });

  test('row 3: a Button covered by another window still gets its click (BM_CLICK is not refused)', T, async () => {
    const cover = launchForm('cover3.ps1', COVER);
    try {
      await waitListed(await cover.hwnd);
      const ref = await refFor(fxHwnd, 'Btn');
      fx!.events.length = 0;
      const r = await ask({ op: 'click', hwnd: fxHwnd, ref, ...ui });
      noError(r);
      assert.ok(await seen(fx!, 'EV button', 2000), 'EV button did not arrive');
    } finally {
      cover.p.kill();
      await waitGone(await cover.hwnd);
    }
  });

  test('row 4: Alt+g on Chromium is refused and the title stays; plain x still succeeds', T, async (t) => {
    if (!existsSync(EDGE)) return t.skip('Edge is not installed');
    const known = new Set((await listWindows()).map((x) => x.hwnd));
    const page = join(workDir, 'page.html');
    writeFileSync(page, PAGE);
    const profile = mkdtempSync(join(tmpdir(), 'm8-38-row5-profile-'));
    profiles.push(profile);
    const edge = spawn(EDGE, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-position=1800,100', '--window-size=700,500', `--app=file:///${page.replace(/\\/g, '/')}`], { stdio: 'ignore' });
    kids.push(edge);
    const w = await findNewWindow('row5 page', known);
    assert.ok(w, 'Edge window did not appear');
    await sleep(1500);
    const input = await refFor(w.hwnd, 'PageInput', 40);
    noError(await ask({ op: 'set_text', hwnd: w.hwnd, ref: input, value: 'ab', ...ui }));
    await sleep(500);
    const titleBefore = await titleOf(w.hwnd);
    const r = await ask({ op: 'key', hwnd: w.hwnd, keys: 'Alt+g', ...ui });
    if (r.error && errText(r).includes('has no keyboard focus')) return t.skip('Edge window has no keyboard focus');
    if (!r.error) assert.fail('Alt+g was sent to the page');
    assert.ok(errText(r).startsWith('background_unavailable'), errText(r));
    await sleep(800);
    assert.equal(await titleOf(w.hwnd), titleBefore, 'title changed after a refused Alt+g');
    const x = await ask({ op: 'key', hwnd: w.hwnd, keys: 'x', ...ui });
    if (x.error && errText(x).includes('has no keyboard focus')) return t.skip('Edge window lost keyboard focus before the plain key');
    noError(x);
  });
});
