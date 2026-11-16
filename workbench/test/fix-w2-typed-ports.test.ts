import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('pane created from stored row initializes with empty typed-port set', () => {
  // Reads panes.ts source to verify pane creation initializes typed with an empty set.
  const panesSource = readFileSync(new URL('../src/browser/panes.ts', import.meta.url), 'utf8');

  // Asserts typed property in create() is initialized to an empty Set.
  assert.match(panesSource, /typed:\s*new Set\(\)/);

  // Asserts typed property is never initialized directly from row.url or loopbackPort.
  assert.doesNotMatch(panesSource, /typed:\s*new Set\([^)]*url/i);
  assert.doesNotMatch(panesSource, /typed:\s*new Set\([^)]*loopbackPort/i);

  // Asserts userNavigate specifically adds to typed set upon user navigation.
  assert.match(panesSource, /async userNavigate\([^)]*\)[\s\S]*?pane\.typed\.add/);
});
