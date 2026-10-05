import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';

await import(pathToFileURL(fileURLToPath(new URL('../renderer/layouts/rules.js', import.meta.url))));
const reviewSource = await (await import('node:fs/promises')).readFile(new URL('../renderer/layouts/review.js', import.meta.url), 'utf8');
const storeSource = reviewSource.slice(reviewSource.indexOf('const reviewStore ='), reviewSource.indexOf('\nconst reviewView ='));
const { normalise, parseDiff } = new Function(`${storeSource}; return reviewStore;`)();

const { pickLayout, opens } = globalThis.layoutRules;
const run = { pipeline_id: 'two-engine-review' };
const pipe = { layout: 'pr-inline' };
const steps = [];

test('review layout selection follows disagreement, critical, file count, then inline', () => {
  assert.equal(pickLayout(run, pipe, steps, null, { disagree: 1, critical: 1, files: 4 }), 'duel');
  assert.equal(pickLayout(run, pipe, steps, null, { disagree: 0, critical: 1, files: 4 }), 'triage');
  assert.equal(pickLayout(run, pipe, steps, null, { disagree: 0, critical: 0, files: 3 }), 'buckets');
  assert.equal(pickLayout(run, pipe, steps, null, { disagree: 0, critical: 0, files: 2 }), 'pr-inline');
});

test('missing review data defaults to inline and does not auto-open', () => {
  assert.equal(pickLayout(run, pipe, steps, null, null), 'pr-inline');
  assert.equal(opens(run, steps, null), false);
});

test('review screen opens only for disagreement or critical findings', () => {
  assert.equal(opens(run, steps, { disagree: 1, critical: 0 }), true);
  assert.equal(opens(run, steps, { disagree: 0, critical: 1 }), true);
  assert.equal(opens(run, steps, { disagree: 0, critical: 0 }), false);
});

test('review normalisation tolerates malformed bucket entries and missing lines', () => {
  const result = normalise({
    disagree: 'not-an-array',
    both: [null, 'string pair', { codex: { file: 'a.js', severity: 'CrItIcAl', title: 'No line data' } }],
    codex_only: [{ gemini: { file: 'b.js', severity: 'HIGH', title: 'Mixed case' } }],
    gemini_only: {},
  });
  assert.deepEqual(result.items.map((x) => x.sev), ['CrItIcAl', 'HIGH']);
  assert.equal(result.items[0].rank, 0);
  assert.equal(result.items[1].rank, 1);
  assert.equal(result.items[0].from, null);
  assert.equal(result.items[0].to, null);
});

test('unified diff parsing tracks new-side line numbers across multiple hunks', () => {
  const diff = [
    'diff --git a/src/demo.js b/src/demo.js',
    'index 1111111..2222222 100644',
    '--- a/src/demo.js',
    '+++ b/src/demo.js',
    '@@ -1,3 +1,4 @@',
    ' first',
    '-old second',
    '+new second',
    '+inserted third',
    ' fourth',
    '@@ -20,2 +21,3 @@',
    ' twenty one',
    '-old twenty two',
    '+new twenty two',
    '+twenty three',
  ].join('\n');
  const file = parseDiff(diff)[0];
  assert.equal(file.file, 'src/demo.js');
  assert.deepEqual(file.lines.filter((x) => x.kind !== '@').map((x) => [x.kind, x.n, x.text]), [
    [' ', 1, 'first'], ['-', null, 'old second'], ['+', 2, 'new second'], ['+', 3, 'inserted third'], [' ', 4, 'fourth'],
    [' ', 21, 'twenty one'], ['-', null, 'old twenty two'], ['+', 22, 'new twenty two'], ['+', 23, 'twenty three'],
  ]);
});
