import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, patchSides, sameZone } from '../ui/src/editor.js';

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

test('applyPatch rebuilds the agent copy from the base and its patch', () => {
  assert.equal(applyPatch(before, patch), after);
  assert.equal(applyPatch(before.replace(/\n/g, '\r\n'), patch), after);
  assert.equal(applyPatch('', '@@ -0,0 +1,2 @@\n+x\n+y\n'), 'x\ny\n');
  assert.equal(applyPatch('', '@@ -0,0 +1,2 @@\n+x\n+y\n\\ No newline at end of file\n'), 'x\ny');
  assert.equal(applyPatch('a\nb', '@@ -2 +2 @@\n-b\n\\ No newline at end of file\n+b2\n'), 'a\nb2\n');
});

test('applyPatch refuses a base the patch does not fit', () => {
  assert.equal(applyPatch(before.replace('b', 'X'), patch), null);
  assert.equal(applyPatch('a\n', 'Binary files differ\n'), null);
});

test('applyPatch and patchSides handle a 200,000-line file', () => {
  const big = 'x\n'.repeat(200_000);
  const edit = '@@ -1 +1 @@\n-x\n+y\n';
  const want = 'y\n' + 'x\n'.repeat(199_999);
  assert.equal(applyPatch(big, edit), want);
  assert.equal(patchSides(edit, want)!.modified, want);
});

test('a view zone is kept only while key, height, side and line all match', () => {
  const z = { height: 150, side: 'new', line: 4 };
  assert.equal(sameZone('draft', z, { key: 'draft', height: 150, side: 'new', line: 4 }), true);
  assert.equal(sameZone('draft', z, { key: 'draft', height: 150, side: 'new', line: 9 }), false);
  assert.equal(sameZone('draft', z, { key: 'draft', height: 150, side: 'old', line: 4 }), false);
  assert.equal(sameZone('draft', z, { key: 'draft', height: 26, side: 'new', line: 4 }), false);
});
