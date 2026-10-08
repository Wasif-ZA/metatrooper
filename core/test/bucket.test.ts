import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { root } from './helpers.ts';

const { bucketFindings, hunkRanges } = await import(pathToFileURL(`${root}/pipelines/two-engine-review/bucket.mjs`).href);
const finding = (file: string, line_start: number, line_end = line_start, severity = 'major') => ({ file, line_start, line_end, severity, title: `${file}:${line_start}` });
const verdict = (...findings: object[]) => ({ verdict: 'reject', findings });
const diff = [
  'diff --git a/src/a.js b/src/a.js', '--- a/src/a.js', '+++ b/src/a.js', '@@ -10,1 +10,1 @@',
  '-old', '+new',
  'diff --git a/src/b.js b/src/b.js', '--- a/src/b.js', '+++ b/src/b.js', '@@ -10,1 +10,1 @@',
  '-old', '+new', '',
].join('\n');

test('M4-19 findings outside widened file hunks are separated into outside_change', () => {
  const buckets = bucketFindings(
    verdict(finding('src/a.js', 31), finding('src/no-hunk.js', 10)),
    verdict(), hunkRanges(diff),
  );
  assert.deepEqual(buckets.outside_change.map((row: any) => row.codex), [finding('src/a.js', 31), finding('src/no-hunk.js', 10)]);

  const inside = bucketFindings(verdict(finding('src/a.js', 13)), verdict(), hunkRanges(diff));
  assert.equal(inside.codex_only[0].codex.line_start, 13);
  assert.deepEqual(inside.outside_change, []);
});

test('empty diff preserves the original four buckets', () => {
  const buckets = bucketFindings(verdict(finding('src/a.js', 31)), verdict(), null);
  assert.deepEqual(Object.keys(buckets).sort(), ['both', 'codex_only', 'disagree', 'gemini_only', 'outside_change']);
  assert.deepEqual(buckets.outside_change, []);
  assert.equal(buckets.codex_only.length, 1);
});

test('review normalise keeps outside findings out of critical and disagree counts', () => {
  const reviewUrl = new URL('../../workbench/renderer/layouts/review.js', import.meta.url);
  const source = readFileSync(reviewUrl, 'utf8');
  const storeSource = source.slice(source.indexOf('const reviewStore ='), source.indexOf('\nconst reviewView ='));
  const { normalise } = new Function(`${storeSource}; return reviewStore;`)();
  const result = normalise({ outside_change: [{ severity: 'critical' }], codex_only: [], gemini_only: [], both: [], disagree: [] });
  assert.equal(result.items.length, 0);
  assert.equal(result.critical, 0);
  assert.equal(result.disagree, 0);
});
