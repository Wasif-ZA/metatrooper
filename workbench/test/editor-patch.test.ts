import test from 'node:test';
import assert from 'node:assert/strict';
import { patchSides } from '../ui/src/editor.js';

const before = 'a\nb\nc\nd\ne\nf\ng\nh\n';
const after = 'a\nB\nc\nd\ne\nf\nh\nnew\n';
const patch = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n@@ -6,3 +6,3 @@\n f\n-g\n h\n+new\n';

test('patchSides rebuilds the old file from the patch and the new file', () => {
  assert.deepEqual(patchSides(patch, after), { original: before, modified: after });
  assert.deepEqual(patchSides(patch, after.replace(/\n/g, '\r\n')), { original: before, modified: after });
});

test('patchSides falls back to the hunks when the new file does not match', () => {
  assert.deepEqual(patchSides(patch, 'unrelated\n'), { original: 'a\nb\nc\nf\ng\nh', modified: 'a\nB\nc\nf\nh\nnew' });
  assert.deepEqual(patchSides('@@ -0,0 +1,2 @@\n+x\n+y\n', 'x\ny\n'), { original: '', modified: 'x\ny\n' });
  assert.equal(patchSides('Binary files differ\n', 'x'), null);
});
