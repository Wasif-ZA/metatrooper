import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HELPER = new URL('../src/desktop/uia-helper.ps1', import.meta.url);

// The helper's own C# with its own Add-Type lines, then Render fed three nodes whose middle one cannot be read.
test('snapshot refs skip a node that cannot be read, so they run e1..eN with no gap', { skip: process.platform !== 'win32' && 'needs Windows PowerShell', timeout: 120_000 }, () => {
  const source = readFileSync(HELPER, 'utf8');
  const types = source.slice(0, source.indexOf("\n'@") + 4);
  assert.match(types, /namespace TroopUia/);
  const dir = mkdtempSync(join(tmpdir(), 'snapshot-refs-'));
  try {
    const script = join(dir, 'render.ps1');
    writeFileSync(script, `${types}
$nodes = [System.Collections.Generic.List[System.Collections.Generic.KeyValuePair[int,string]]]::new()
foreach ($p in @(@(0, 'a'), @(1, 'gone'), @(1, 'c'))) { $nodes.Add([System.Collections.Generic.KeyValuePair[int,string]]::new([int]$p[0], [string]$p[1])) }
$map = [System.Collections.Generic.Dictionary[string,string]]::new()
$read = [Func[string,string]]{ param($x) if ($x -eq 'gone') { throw 'element not available' }; "node $x" }
$call = [object[]]::new(4); $call[0] = $nodes; $call[1] = $read; $call[2] = $map; $call[3] = 0
$text = [TroopUia.Helper].GetMethod('Render').MakeGenericMethod([string]).Invoke($null, $call)
[Console]::Out.Write((@{ text = $text; n = $call[3]; map = $map } | ConvertTo-Json -Compress))
`);
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.text, 'node a [ref=e1]\n  node c [ref=e2]\n');
    assert.equal(out.n, 2);
    assert.deepEqual(out.map, { e1: 'a', e2: 'c' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
