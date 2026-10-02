import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const diffLines = runInNewContext(`${readFileSync(new URL('../renderer/diff.js', import.meta.url), 'utf8')}\ndiffLines`, {});

test('M2-06 diff lines carry the new-file line for added and context lines and the old-file line for removed ones', () => {
  const diff = [
    'diff --git a/a.js b/a.js',
    '--- a/a.js',
    '+++ b/a.js',
    '@@ -10,3 +10,4 @@ function f() {',
    ' keep',
    '-gone',
    '+new one',
    '+new two',
    ' tail',
    '@@ -40 +41 @@',
    '-old',
    '+fresh',
  ].join('\n');
  const rows = JSON.parse(JSON.stringify(diffLines(diff))).filter((r: { kind: string }) => r.kind !== 'hunk').map((r: { kind: string; line: number; text: string }) => [r.kind, r.line, r.text]);
  assert.deepEqual(rows, [
    ['ctx', 10, ' keep'],
    ['del', 11, '-gone'],
    ['add', 11, '+new one'],
    ['add', 12, '+new two'],
    ['ctx', 13, ' tail'],
    ['del', 40, '-old'],
    ['add', 41, '+fresh'],
  ]);
});
