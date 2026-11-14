import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ZIP_NODE = 'C:\\Apps\\cc-0.1.0-win-x64\\resources\\node\\node.exe';
const ZIP_APP = 'C:\\Apps\\cc-0.1.0-win-x64\\resources\\app';

test('hooks run the bundled node.exe when the core runs from the portable zip, and bare node from a source install', async () => {
  const { nodeBin } = await import('../src/hooks/install.ts');
  assert.equal(nodeBin(ZIP_NODE, ZIP_APP), 'C:/Apps/cc-0.1.0-win-x64/resources/node/node.exe');
  assert.equal(nodeBin('C:\\Program Files\\nodejs\\node.exe', 'C:\\src\\metatrooper'), 'node');
  assert.equal(nodeBin('/usr/bin/node', '/home/u/metatrooper'), 'node');
});

test('a hook command quotes the bundled node path and refuses one the hook shell would expand', async () => {
  const { nodeCommand } = await import('../src/hooks/install.ts');
  const bin = 'C:/Program Files/cc/resources/node/node.exe';
  assert.equal(nodeCommand('C:/Program Files/cc/resources/app/core/event.js', 'claude.Stop', bin), `"${bin}" "C:/Program Files/cc/resources/app/core/event.js" claude.Stop`);
  assert.equal(nodeCommand('C:/x/core/event.js', 'claude.Stop', 'node'), 'node "C:/x/core/event.js" claude.Stop');
  // PowerShell rejects a command line that starts with a quoted path, so a path that needs no quotes gets none.
  assert.equal(nodeCommand('C:/Apps/cc/resources/app/core/event.js', 'claude.Stop', 'C:/Apps/cc/resources/node/node.exe'), 'C:/Apps/cc/resources/node/node.exe "C:/Apps/cc/resources/app/core/event.js" claude.Stop');
  assert.match(nodeCommand('C:/x/core/event.js', 'claude.Stop', 'C:/a b&c/node.exe'), /^"C:\/a b&c\/node.exe" /);
  assert.throws(() => nodeCommand('C:/x/core/event.js', 'claude.Stop', 'C:/Users/%USERNAME%/cc/resources/node/node.exe'), /%USERNAME%/);
});

test('no hook or notify line in the installer names bare node directly', () => {
  const src = readFileSync(new URL('../src/hooks/install.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\[\s*'node'\s*,/);
  assert.doesNotMatch(src, /`node "/);
});
