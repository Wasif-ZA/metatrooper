import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// M8-38 rows 4 and 6 against the real uia-helper.ps1 and a live WinForms fixture; contracts/desktop-tools.md is the oracle.
const HELPER = fileURLToPath(new URL('../src/desktop/uia-helper.ps1', import.meta.url));
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];
const T = { timeout: 180000 };
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
$f.Text = 'M8-38 rows46 fixture'; $f.ShowInTaskbar = $false; $f.StartPosition = 'Manual'; $f.Location = New-Object System.Drawing.Point(40, 40); $f.Width = 700; $f.Height = 500
$panel = New-Object BarePanel; $panel.Dock = 'Fill'
$b = New-Object System.Windows.Forms.Button; $b.Text = 'Fixture button'; $b.AccessibleName = 'Fixture button'; $panel.Controls.Add($b)
$e = New-Object System.Windows.Forms.TextBox; $e.Text = 'editable'; $e.AccessibleName = 'Fixture editable'; $e.Location = New-Object System.Drawing.Point(10, 60); $panel.Controls.Add($e)
$f.Controls.Add($panel)
$f.Add_Shown({ [Console]::Out.WriteLine('HWND ' + $f.Handle.ToInt64()); [Console]::Out.Flush() })
[System.Windows.Forms.Application]::Run($f)
`;

type Ctx = { helper: ChildProcess; fixture: ChildProcess; hwnd: number; dir: string; ui: { ui_pid: number; ui_start: string }; ask: (req: Record<string, unknown>) => Promise<any> };
let ctx: Ctx | null = null;

before(async () => {
  if (process.platform !== 'win32') return;
  const dir = mkdtempSync(join(tmpdir(), 'm8-38-rows46-'));
  const script = join(dir, 'fixture.ps1');
  writeFileSync(script, FIXTURE);
  const fixture = spawn('powershell.exe', [...PS, '-STA', '-File', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  const hwnd = await new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('fixture window did not appear')), 60000);
    readline.createInterface({ input: fixture.stdout! }).on('line', (l) => { const m = /^HWND (\d+)/.exec(l); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    fixture.on('exit', () => reject(new Error('fixture exited')));
  }).catch(() => 0);
  const helper = spawn('powershell.exe', [...PS, '-File', HELPER], { stdio: ['pipe', 'pipe', 'ignore'] });
  const waiting = new Map<number, (r: any) => void>();
  readline.createInterface({ input: helper.stdout! }).on('line', (l) => { const r = JSON.parse(l); waiting.get(r.id)?.(r); });
  let n = 0;
  const ask = (req: Record<string, unknown>) => new Promise<any>((resolve) => { const id = ++n; waiting.set(id, resolve); helper.stdin!.write(JSON.stringify({ id, ...req }) + '\n'); });
  // The helper's own pid and start time stand in for the workbench's, so input ops pass the ui_pid/ui_start check.
  const start = await ask({ op: 'process', process: helper.pid });
  ctx = { helper, fixture, hwnd, dir, ui: { ui_pid: helper.pid, ui_start: start.result.process_start }, ask };
});

after(() => {
  if (!ctx) return;
  ctx.helper.kill();
  ctx.fixture.kill();
  rmSync(ctx.dir, { recursive: true, force: true });
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

// Checks the row 6 fields on one input op result against the probes around it.
function assertInputFields(pre: { cursor: number[]; foreground: unknown }, post: { cursor: number[]; foreground: unknown }, result: any) {
  assert.equal(typeof result.pointer_drift, 'boolean');
  assert.equal(typeof result.foreground_taken_by, 'string');
  if (JSON.stringify(pre.cursor) === JSON.stringify(post.cursor)) assert.equal(result.pointer_drift, false, 'cursor unchanged but pointer_drift true');
  if (JSON.stringify(pre.foreground) === JSON.stringify(post.foreground)) assert.equal(result.foreground_taken_by, '', 'foreground unchanged but foreground_taken_by set');
}

describe('M8-38 rows 4 and 6', { skip: process.platform !== 'win32' ? 'needs Windows UI Automation' : false }, () => {
  test('row 4: a non-Chromium window keeps its unnamed pane, and the button sits under that pane', T, async (t) => {
    if (!ctx) return t.skip('fixture window did not appear');
    const { text } = await snapWin(ctx.hwnd, 400);
    const all = lines(text);
    const b = all.findIndex((l) => l.includes('"Fixture button"'));
    assert.ok(b >= 0, 'no Fixture button line');
    // Walks up to the button's nearest ancestor line, which must be the unnamed pane.
    let parent = b - 1;
    while (parent >= 0 && indent(all[parent]) >= indent(all[b])) parent--;
    assert.ok(parent >= 0 && BARE_PANE.test(all[parent]), `button parent is not a bare pane line: ${all[parent]}`);
    assert.ok(indent(all[b]) > indent(all[parent]), 'button is not indented under the pane');
  });

  test('row 4: a Chromium window has no unnamed wrapper pane, refs are consecutive, document is near the top', T, async (t) => {
    if (!ctx) return t.skip('fixture window did not appear');
    const listed = await ctx.ask({ op: 'list' });
    assert.equal(listed.error, undefined, JSON.stringify(listed.error));
    const wins = (Array.isArray(listed.result) ? listed.result : listed.result.windows) as Array<{ hwnd: number; class: string }>;
    const chromium = wins.find((w) => w.class === 'Chrome_WidgetWin_1');
    if (!chromium) return t.skip('no visible Chrome_WidgetWin_1 window');
    // Read-only snapshot: no input op is ever sent to this window.
    const { text, nodes } = await snapWin(chromium.hwnd, 400);
    const all = lines(text).filter((l) => !l.startsWith('[truncated'));
    assert.ok(!all.some((l) => /^\s*pane( #\d+)? actions=\[\] \[ref=/.test(l)), 'an unnamed wrapper pane was kept');
    const d = all.findIndex((l) => l.includes('document'));
    if (d >= 0) assert.ok(d < 15, `first document line is line ${d + 1}`);
    const refLines = all.filter((l) => /\[ref=e\d+\]/.test(l));
    assert.equal(nodes, refLines.length, 'nodes does not match the number of ref lines');
    const nums = refLines.map((l) => Number(refOf(l).slice(1)));
    assert.deepEqual(nums, nums.map((_, i) => i + 1), 'refs are not e1..eN in order');
  });

  test('row 6: set_text and click report pointer_drift and foreground_taken_by with the probe-consistent values', T, async (t) => {
    if (!ctx) return t.skip('fixture window did not appear');
    const editable = await refFor('Fixture editable');
    const setText = await inputOp({ op: 'set_text', ref: editable, value: 'm8-38 rows46' });
    assert.equal(setText.r.error, undefined, JSON.stringify(setText.r.error));
    assertInputFields(setText.pre, setText.post, setText.r.result);

    const button = await refFor('Fixture button');
    const click = await inputOp({ op: 'click', ref: button });
    assert.equal(click.r.error, undefined, JSON.stringify(click.r.error));
    assertInputFields(click.pre, click.post, click.r.result);
  });

  test('row 6: key Tab returns both fields with the contract types, or is refused for no keyboard focus', T, async (t) => {
    if (!ctx) return t.skip('fixture window did not appear');
    const { pre, post, r } = await inputOp({ op: 'key', keys: 'Tab' });
    if (r.error) {
      const msg = JSON.stringify(r.error);
      if (msg.includes('has no keyboard focus')) return t.skip('fixture has no keyboard focus');
      assert.fail(msg);
    }
    assertInputFields(pre, post, r.result);
  });
});
