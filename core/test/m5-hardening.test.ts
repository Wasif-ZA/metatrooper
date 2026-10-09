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
const checkBuild = await import(pathToFileURL(`${root}/pipelines/spec-to-pr/check-build.mjs`).href);
const { detect } = await import(pathToFileURL(`${root}/plugins/repo/bin/repo.js`).href);
const { execFileSync } = await import('node:child_process');

test('T1 normalises path and line aliases before bucketing', () => {
  const buckets = bucket.bucketFindings(
    { verdict: 'reject', findings: [{ file: './a.js', line: 11 }] },
    { verdict: 'reject', findings: [{ file: 'a.js', line_start: 11, line_end: 11 }] },
    new Map([['a.js', [[10, 14]]]]),
  );
  assert.equal(buckets.both.length, 1);
});

test('T2 rejects findings outside the project root and normalises Windows paths', () => {
  const findings = (file) => ({ verdict: 'reject', findings: [{ file, line: 5, title: file }] });
  for (const file of ['D:/other/a.js', '/etc/passwd']) {
    const result = bucket.bucketFindings(findings(file), { verdict: 'reject', findings: [] }, null, 'C:/proj');
    assert.equal(result.unplaced.length, 1);
    assert.equal(result.unplaced[0].codex.file, file);
  }
  const result = bucket.bucketFindings(findings('C:\\proj\\src\\a.js'), { verdict: 'reject', findings: [] }, null, 'C:/proj');
  assert.equal(result.codex_only[0].codex.file, 'src/a.js');
});

test('H2 unread rejected findings and unplaced findings require human review', async (t) => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-h2-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const reviewFile = path.join(runDir, 'review-buckets.json');
  let data = { codex_verdict: 'reject', codex_unparsed: true, gemini_verdict: 'accept' };
  await fs.writeFile(reviewFile, JSON.stringify(data));
  const ctx = { runDir, steps: { review: { buckets_abs: reviewFile }, rereview: { buckets_abs: reviewFile } }, async writeFile() {} };
  let result = await handback.run(ctx);
  assert.ok(result.items.some((item) => item.kind === 'human' && item.text.includes('could not be read')));
  data = { codex_verdict: 'accept', gemini_verdict: 'accept', unplaced: [{ title: 'loose finding', file: 'src/a.js', line: 3 }] };
  await fs.writeFile(reviewFile, JSON.stringify(data));
  result = await handback.run(ctx);
  assert.ok(result.items.some((item) => item.kind === 'human' && item.text.includes('could not be placed')));
  const rereviewFile = path.join(runDir, 'rereview-buckets.json');
  await fs.writeFile(rereviewFile, JSON.stringify({ ...data, unplaced: [] }));
  data.unplaced = [{ title: 'rereview loose finding' }];
  await fs.writeFile(rereviewFile, JSON.stringify(data));
  ctx.steps.rereview.buckets_abs = rereviewFile;
  result = await handback.run(ctx);
  assert.ok(result.items.some((item) => item.kind === 'human' && item.text.includes('could not be placed')));
});

test('S3 check-build uses merge-base when build-0.base is absent', async (t) => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-s3-'));
  const repoDir = path.join(runDir, 'repo');
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  await fs.mkdir(repoDir);
  const git = (args) => execFileSync('git', ['-C', repoDir, ...args], { encoding: 'utf8' }).trim();
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test']);
  git(['commit', '--allow-empty', '-qm', 'base']);
  git(['checkout', '-qb', 'feature']);
  git(['commit', '--allow-empty', '-qm', 'feature']);
  const ctx = { runDir, inputs: { base_branch: 'main' }, steps: { build: { worktree: repoDir } } };
  assert.deepEqual(await checkBuild.run(ctx), { commits: 1, tests_added: 0, summary: '1 commit on the branch, none touching a test file' });
  ctx.inputs.base_branch = 'nope';
  await assert.rejects(checkBuild.run(ctx), /cannot find the commit/);
});

test('R1 detects pytest files and tolerates tests as a plain file', async (t) => {
  const pytestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-r1-py-'));
  t.after(() => fs.rm(pytestDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(pytestDir, 'tests', 'unit'), { recursive: true });
  await fs.writeFile(path.join(pytestDir, 'tests', 'unit', 'test_app.py'), '');
  assert.equal(detect(pytestDir).runner, 'pytest');

  const fileDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-r1-file-'));
  t.after(() => fs.rm(fileDir, { recursive: true, force: true }));
  await fs.writeFile(path.join(fileDir, 'tests'), '');
  assert.deepEqual(detect(fileDir), { runner: 'none', command: [] });
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
