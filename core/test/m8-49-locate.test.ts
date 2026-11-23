import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// M8-49g: locate's centre and screenshot's origin_px/scale against a fixture that reports each button's own physical rect.
const HELPER = fileURLToPath(new URL('../src/desktop/uia-helper.ps1', import.meta.url));
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const win = process.platform === 'win32';
const T = { timeout: 180000, skip: !win && 'needs Windows' };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Per-monitor aware form of 10 buttons B0..B9; -Monitor N moves it onto screen N; state JSON holds each button's screen rect.
const FIXTURE = `
param([int]$Monitor = -1, [string]$State)
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type @'
using System; using System.Runtime.InteropServices;
public static class W { [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr c); [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int w, int hh, uint f); }
'@
[void][W]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
$f = New-Object System.Windows.Forms.Form
$f.Text = 'm8-49 locate fixture'; $f.StartPosition = 'Manual'; $f.TopMost = $true
$bs = @()
for ($i = 0; $i -lt 10; $i++) {
  $b = New-Object System.Windows.Forms.Button; $b.Text = "B$i"; $b.AccessibleName = "B$i"
  $b.Size = New-Object System.Drawing.Size(80, 30); $b.Location = New-Object System.Drawing.Point((10 + 95 * ($i % 5)), (10 + 45 * [math]::Floor($i / 5)))
  $f.Controls.Add($b); $bs += $b
}
$f.Add_Shown({
  $s = if ($Monitor -ge 0) { [System.Windows.Forms.Screen]::AllScreens[$Monitor] } else { [System.Windows.Forms.Screen]::PrimaryScreen }
  [void][W]::SetWindowPos($f.Handle, [IntPtr]::new(-1), $s.Bounds.X + 100, $s.Bounds.Y + 100, 560, 200, 0x40)
  $t = New-Object System.Windows.Forms.Timer; $t.Interval = 600
  $t.Add_Tick({
    $t.Stop()
    $rects = @($bs | ForEach-Object { $r = $_.RectangleToScreen($_.ClientRectangle); @{ name = $_.AccessibleName; x = $r.X; y = $r.Y; w = $r.Width; h = $r.Height } })
    [IO.File]::WriteAllText($State, (@{ buttons = $rects } | ConvertTo-Json -Depth 4 -Compress))
    [Console]::Out.WriteLine('HWND ' + $f.Handle.ToInt64()); [Console]::Out.Flush()
  })
  $t.Start()
})
[System.Windows.Forms.Application]::Run($f)
`;

type Btn = { name: string; x: number; y: number; w: number; h: number };
const kids: ChildProcess[] = [];
const dirs: string[] = [];
let helper: ChildProcess | null = null;
let ask: (req: Record<string, unknown>) => Promise<any> = async () => { throw new Error('helper not started'); };

async function startHelper() {
  if (helper) return;
  const h = spawn('powershell.exe', [...PS, '-File', HELPER], { stdio: ['pipe', 'pipe', 'ignore'] });
  helper = h;
  const waiting = new Map<number, (r: any) => void>();
  readline.createInterface({ input: h.stdout! }).on('line', (l) => { const r = JSON.parse(l); waiting.get(r.id)?.(r); });
  let n = 0;
  ask = (req) => new Promise((resolve) => { const id = ++n; waiting.set(id, resolve); h.stdin!.write(JSON.stringify({ id, ...req }) + '\n'); });
}

async function launch(monitor: number): Promise<{ hwnd: number; buttons: Btn[]; kill: () => void }> {
  await startHelper();
  const dir = mkdtempSync(join(tmpdir(), 'm8-49-locate-'));
  dirs.push(dir);
  const file = join(dir, 'fixture.ps1'); const state = join(dir, 'state.json');
  writeFileSync(file, FIXTURE);
  const p = spawn('powershell.exe', [...PS, '-STA', '-File', file, '-Monitor', String(monitor), '-State', state], { stdio: ['ignore', 'pipe', 'ignore'] });
  kids.push(p);
  const hwnd = await new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('fixture window did not appear')), 60000);
    readline.createInterface({ input: p.stdout! }).on('line', (l) => { const m = /^HWND (\d+)/.exec(l); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    p.on('exit', () => reject(new Error('fixture exited')));
  });
  await sleep(300);
  const buttons: Btn[] = JSON.parse(readFileSync(state, 'utf8').replace(/^﻿/, '')).buttons;
  assert.equal(buttons.length, 10);
  return { hwnd, buttons, kill: () => p.kill() };
}

async function refFor(hwnd: number, name: string): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const r = await ask({ op: 'snapshot', hwnd, max_nodes: 400 });
    assert.ok(!r.error, JSON.stringify(r.error));
    const line = String(r.result.text).split(/\r?\n/).find((l) => l.includes(`"${name}"`));
    if (line) return /\[ref=(e\d+)\]/.exec(line)![1];
    await sleep(300);
  }
  assert.fail(`no node named ${name}`);
}

const inside = (r: number[], x: number, y: number) => x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3];

// Locates all 10 buttons and compares each centre with the fixture's own rect.
async function checkLocate(fx: { hwnd: number; buttons: Btn[] }) {
  for (const b of fx.buttons) {
    const ref = await refFor(fx.hwnd, b.name);
    const r = await ask({ op: 'locate', hwnd: fx.hwnd, ref });
    assert.ok(!r.error, JSON.stringify(r.error));
    const { screen_rect_px: s, window_rect_px: w, dpi, monitor } = r.result;
    const cx = s[0] + s[2] / 2, cy = s[1] + s[3] / 2;
    assert.ok(Math.abs(cx - (b.x + b.w / 2)) <= 2, `${b.name} centre x ${cx} vs ${b.x + b.w / 2}`);
    assert.ok(Math.abs(cy - (b.y + b.h / 2)) <= 2, `${b.name} centre y ${cy} vs ${b.y + b.h / 2}`);
    assert.ok(inside(w, s[0], s[1]) && inside(w, s[0] + s[2], s[1] + s[3]), `${b.name} rect inside window_rect_px`);
    assert.ok(typeof dpi === 'number' && dpi > 0, `dpi ${dpi}`);
    assert.ok(inside(monitor.rect_px, cx, cy), `${b.name} centre inside monitor.rect_px`);
  }
}

after(() => {
  helper?.kill();
  for (const k of kids) k.kill();
  for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ } }
});

test("locate's centre is within 2 px of each control's own rect", T, async () => {
  const fx = await launch(-1);
  await checkLocate(fx);
  fx.kill();
});

test('a screenshot pixel maps to the screen with origin_px and scale', T, async () => {
  const fx = await launch(-1);
  const loc = await ask({ op: 'locate', hwnd: fx.hwnd, ref: await refFor(fx.hwnd, 'B0') });
  const wr: number[] = loc.result.window_rect_px;
  const r = await ask({ op: 'screenshot', hwnd: fx.hwnd });
  assert.ok(!r.error, JSON.stringify(r.error));
  const { origin_px, scale, width, height } = r.result;
  assert.ok(Math.abs(origin_px[0] - wr[0]) <= 1 && Math.abs(origin_px[1] - wr[1]) <= 1, `origin ${origin_px} vs ${wr}`);
  assert.ok(scale > 0 && scale <= 1);
  for (const b of fx.buttons) {
    const px = (b.x + b.w / 2 - origin_px[0]) * scale, py = (b.y + b.h / 2 - origin_px[1]) * scale;
    assert.ok(px >= 0 && px <= width && py >= 0 && py <= height, `${b.name} at ${px},${py} outside ${width}x${height}`);
  }
  fx.kill();
});

test('a second monitor at a negative origin', T, async (t) => {
  const ps = (s: string) => execFileSync('powershell.exe', [...PS, '-Command', `Add-Type -AssemblyName System.Windows.Forms; ${s}`], { encoding: 'utf8' }).trim();
  if (Number(ps('[System.Windows.Forms.Screen]::AllScreens.Count')) < 2) return t.skip('needs two monitors');
  const idx = Number(ps('$a = [System.Windows.Forms.Screen]::AllScreens; for ($i = 0; $i -lt $a.Count; $i++) { if (-not $a[$i].Primary) { $i; break } }'));
  const fx = await launch(idx);
  await checkLocate(fx);
  // left open: this window stays on the second screen until the after hook ends it
});
