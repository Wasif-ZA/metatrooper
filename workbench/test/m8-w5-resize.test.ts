import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

test('FIX-W5 moves every parked view and overlay on resize and preserves the visible pane', () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [
    '--experimental-test-module-mocks', '--no-warnings',
    fileURLToPath(new URL('./fixtures/m8-w5-resize.ts', import.meta.url)),
  ], { encoding: 'utf8', timeout: 20000, env });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stdout + result.stderr);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /resize fixture assertions completed/);
});

test('main window resize listener calls the public PaneManager layout', () => {
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const listeners = [...source.matchAll(/win\.on\(\s*(['"])resize\1\s*,\s*(\([^)]*\)\s*=>\s*[^;\n]+);/g)];
  assert.equal(listeners.length, 1);
  const panes = readFileSync(new URL('../src/browser/panes.ts', import.meta.url), 'utf8');
  assert.match(panes, /^  (?:public )?layout\(\): void \{/m);
  assert.doesNotMatch(panes, /\b(?:private|protected)\s+layout\(/);
  let calls = 0;
  const context = vm.createContext({ panes: { layout: () => { calls++; } } });
  const listener = vm.runInContext('(' + listeners[0][2].replace(/\)\s*$/, '') + ')', context);
  listener();
  assert.equal(calls, 1);
  context.panes = null as any;
  assert.doesNotThrow(() => listener());
});
