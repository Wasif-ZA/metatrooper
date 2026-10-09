import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './helpers.ts';

const bucket = await import(pathToFileURL(`${root}/pipelines/two-engine-review/bucket.mjs`).href);
const compare = await import(pathToFileURL(`${root}/pipelines/spec-to-pr/compare-tests.mjs`).href);
const handback = await import(pathToFileURL(`${root}/pipelines/spec-build-review-handback/handback.mjs`).href);
const report = await import(pathToFileURL(`${root}/pipelines/e2e-browser-qa/report.mjs`).href);

test('T1 normalises path and line aliases before bucketing', () => {
  const buckets = bucket.bucketFindings(
    { verdict: 'reject', findings: [{ file: './a.js', line: 11 }] },
    { verdict: 'reject', findings: [{ file: 'a.js', line_start: 11, line_end: 11 }] },
    new Map([['a.js', [[10, 14]]]]),
  );
  assert.equal(buckets.both.length, 1);
});

test('T4 parses a findings array when a quoted body contains an opening bracket', () => {
  assert.deepEqual(bucket.findingsInText('Notes x[ y\n[{"file":"a","body":"arr[0"}]'), [{ file: 'a', body: 'arr[0' }]);
});

test('T5 hunk ranges preserve spaces in filenames', () => {
  const ranges = bucket.hunkRanges('+++ b/my file.js\t\n@@ -1 +1,2 @@\n');
  assert.deepEqual([...ranges.keys()], ['my file.js']);
});

test('S8 crashed test output is unknown rather than zero new failures', () => {
  const result = compare.compareFailures('unknown', 'unknown');
  assert.equal(result.new_failures, 'unknown');
  assert.equal(compare.summaryLine(result), 'new failures: unknown (test output not parsed)');
});

test('E1 malformed findings JSON throws', async () => {
  await assert.rejects(report.run({ async readFile() { return '[{"severity":"high"'; }, steps: {}, async writeFile() {} }), SyntaxError);
});

test('S2 check-build rejects a clean tree with no build commit', async (t) => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-s2-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(runDir, 'worktrees'), { recursive: true });
  await fs.writeFile(path.join(runDir, 'worktrees', 'build-0.base'), 'HEAD\n');
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '-q', runDir]);
  execFileSync('git', ['-C', runDir, 'config', 'user.email', 'test@example.com']);
  execFileSync('git', ['-C', runDir, 'config', 'user.name', 'Test']);
  execFileSync('git', ['-C', runDir, 'commit', '--allow-empty', '-qm', 'base']);
  await fs.writeFile(path.join(runDir, 'worktrees', 'build-0.base'), execFileSync('git', ['-C', runDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }));
  const checkBuild = await import(pathToFileURL(`${root}/pipelines/spec-to-pr/check-build.mjs`).href);
  await assert.rejects(checkBuild.run({ runDir, steps: { build: { worktree: runDir } } }), /build made no commit/);
});

test('H1 missing review results are the first hand-back item', async (t) => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-h1-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  let written = '';
  const result = await handback.run({ runDir, steps: { build: { worktree: 'C:/work' } }, async writeFile(_name: string, content: string) { written = content; } });
  assert.match(result.items[0].text, /^Review results missing for review:/);
  assert.match(written, /1\. \[human\] Review results missing for review:/);
});

test('H6 hand-back follows buckets_abs when stale child review folders remain', async (t) => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-h6-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const stale = path.join(runDir, 'review', 'stale', 'review-buckets.json');
  const current = path.join(runDir, 'review', 'child-run', 'review-buckets.json');
  await fs.mkdir(path.dirname(stale), { recursive: true });
  await fs.mkdir(path.dirname(current), { recursive: true });
  await fs.writeFile(stale, JSON.stringify({ disagree: [{ title: 'stale result' }] }));
  await fs.writeFile(current, JSON.stringify({ disagree: [{ title: 'current result' }] }));
  let written = '';
  const result = await handback.run({ runDir, steps: { review: { buckets_abs: current }, rereview: { buckets_abs: current }, build: { worktree: 'C:/work' } }, async writeFile(_name: string, content: string) { written = content; } });
  assert.match(written, /current result/);
  assert.doesNotMatch(written, /stale result/);
  assert.match(result.items[0].text, /current result/);
});
