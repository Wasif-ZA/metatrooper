import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// M8-38 rows 7 and 8 against the real uia-helper.ps1 and a live WinForms fixture; contracts/desktop-tools.md is the oracle.
const HELPER = fileURLToPath(new URL('../src/desktop/uia-helper.ps1', import.meta.url));
const ORDER = ['Invoke', 'Toggle', 'Select', 'SetValue'];
const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

const FIXTURE = `
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
$f = New-Object System.Windows.Forms.Form
$f.Text = 'M8-38 test fixture'; $f.ShowInTaskbar = $false; $f.StartPosition = 'Manual'; $f.Location = New-Object System.Drawing.Point(40, 40); $f.Width = 700; $f.Height = 900
$p = New-Object System.Windows.Forms.FlowLayoutPanel; $p.Dock = 'Fill'
function Add($c, $name) { $c.AccessibleName = $name; $p.Controls.Add($c) }
$b = New-Object System.Windows.Forms.Button; $b.Text = 'Fixture button'; Add $b 'Fixture button'
$c = New-Object System.Windows.Forms.CheckBox; $c.Text = 'Fixture check'; Add $c 'Fixture check'
$r = New-Object System.Windows.Forms.RadioButton; $r.Text = 'Fixture radio'; Add $r 'Fixture radio'
$e = New-Object System.Windows.Forms.TextBox; $e.Text = 'editable'; Add $e 'Fixture editable'
$o = New-Object System.Windows.Forms.TextBox; $o.Text = 'locked'; $o.ReadOnly = $true; Add $o 'Fixture readonly'
$l = New-Object System.Windows.Forms.Label; $l.Text = 'Fixture label'; Add $l 'Fixture label'
1..25 | ForEach-Object { $x = New-Object System.Windows.Forms.Label; $x.Text = "Filler $_"; Add $x "Filler $_" }
$f.Controls.Add($p)
$f.Add_Shown({ [Console]::Out.WriteLine('HWND ' + $f.Handle.ToInt64()); [Console]::Out.Flush() })
[System.Windows.Forms.Application]::Run($f)
`;

type Ctx = { helper: ChildProcess; fixture: ChildProcess; hwnd: number; dir: string; ask: (req: Record<string, unknown>) => Promise<any> };
let ctx: Ctx | null = null;
let skipReason = process.platform === 'win32' ? '' : 'needs Windows UI Automation';

before(async () => {
  if (skipReason) return;
  const dir = mkdtempSync(join(tmpdir(), 'm8-38-'));
  const script = join(dir, 'fixture.ps1');
  writeFileSync(script, FIXTURE);
  const fixture = spawn('powershell.exe', [...PS, '-STA', '-File', script], { stdio: ['ignore', 'pipe', 'ignore'] });
  const hwnd = await new Promise<number>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('fixture window did not appear')), 60000);
    readline.createInterface({ input: fixture.stdout! }).on('line', (l) => { const m = /^HWND (\d+)/.exec(l); if (m) { clearTimeout(t); resolve(Number(m[1])); } });
    fixture.on('exit', () => reject(new Error('fixture exited')));
  }).catch((e) => { skipReason = String(e.message); return 0; });
  const helper = spawn('powershell.exe', [...PS, '-File', HELPER], { stdio: ['pipe', 'pipe', 'ignore'] });
  const waiting = new Map<number, (r: any) => void>();
  readline.createInterface({ input: helper.stdout! }).on('line', (l) => { const r = JSON.parse(l); waiting.get(r.id)?.(r); });
  let n = 0;
  const ask = (req: Record<string, unknown>) => new Promise<any>((resolve) => { const id = ++n; waiting.set(id, resolve); helper.stdin!.write(JSON.stringify({ id, ...req }) + '\n'); });
  ctx = { helper, fixture, hwnd, dir, ask };
});

after(() => {
  if (!ctx) return;
  ctx.helper.kill();
  ctx.fixture.kill();
  rmSync(ctx.dir, { recursive: true, force: true });
});

async function snap(max: number) {
  const r = await ctx!.ask({ op: 'snapshot', hwnd: ctx!.hwnd, max_nodes: max });
  assert.equal(r.error, undefined);
  return r.result as { text: string; nodes: number; truncated: boolean };
}

const lines = (text: string) => text.split('\n').filter((l) => l.length > 0);
const actionsOf = (line: string) => {
  const m = / actions=\[([^\]]*)\]/.exec(line);
  assert.ok(m, `no actions=[...] on: ${line}`);
  return m[1] === '' ? [] : m[1].split(',');
};
const lineFor = (text: string, name: string) => {
  const hit = lines(text).filter((l) => l.includes(`"${name}"`));
  assert.ok(hit.length >= 1, `no node named ${name}`);
  return hit[0];
};
const MARKER = /^\[truncated: max_nodes=(\d+); more nodes remain\]$/;
const T = { timeout: 180000 };

test('row 7: every node line carries actions=[...] before its ref, in contract order', T, async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { text } = await snap(400);
  const node = lines(text).filter((l) => !l.startsWith('[truncated'));
  assert.ok(node.length >= 20);
  for (const l of node) {
    assert.match(l, / actions=\[[A-Za-z,]*\] \[ref=e\d+\]$/);
    const a = actionsOf(l);
    assert.deepEqual(a, ORDER.filter((x) => a.includes(x)), `out of order or unknown action on: ${l}`);
  }
});

test('row 7: the supported subset per control', T, async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { text } = await snap(400);
  assert.deepEqual(actionsOf(lineFor(text, 'Fixture button')), ['Invoke']);
  assert.deepEqual(actionsOf(lineFor(text, 'Fixture check')), ['Toggle']);
  assert.deepEqual(actionsOf(lineFor(text, 'Fixture radio')), ['Select']);
});

test('row 7: SetValue only for a writable value; a read-only value gets none', T, async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { text } = await snap(400);
  assert.deepEqual(actionsOf(lineFor(text, 'Fixture editable')), ['SetValue']);
  assert.deepEqual(actionsOf(lineFor(text, 'Fixture readonly')), []);
});

test('row 7: a node with no supported pattern prints the empty list', T, async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { text } = await snap(400);
  assert.match(lineFor(text, 'Fixture label'), / actions=\[\] \[ref=e\d+\]$/);
});

test('row 8: a snapshot that fits is not truncated and has no marker', T, async (t) => {
  if (skipReason) return t.skip(skipReason);
  const full = await snap(2000);
  assert.equal(full.truncated, false);
  assert.ok(!full.text.includes('[truncated'));
  assert.equal(full.nodes, lines(full.text).length);
});

test('row 8: reaching the cap exactly with no nodes left is not truncated', T, async (t) => {
  if (skipReason) return t.skip(skipReason);
  const total = (await snap(2000)).nodes;
  const exact = await snap(total);
  assert.equal(exact.nodes, total);
  assert.equal(exact.truncated, false);
  assert.ok(!exact.text.includes('[truncated'));
});

test('row 8: a cap with nodes remaining is truncated and ends with the marker naming the cap', T, async (t) => {
  if (skipReason) return t.skip(skipReason);
  const total = (await snap(2000)).nodes;
  for (const cap of [total - 1, 25]) {
    const r = await snap(cap);
    assert.equal(r.truncated, true, `cap ${cap}`);
    assert.equal(r.nodes, cap);
    const all = lines(r.text);
    assert.match(all[all.length - 1], MARKER);
    assert.equal(Number(MARKER.exec(all[all.length - 1])![1]), cap);
    assert.equal(all.filter((l) => l.startsWith('[truncated')).length, 1);
    assert.equal(all.length, cap + 1);
  }
});
