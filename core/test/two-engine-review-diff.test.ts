import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { run } from '../../pipelines/two-engine-review/diff.mjs';

async function git(dir, ...args) {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' });
}

async function repository(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-diff-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  await git(dir, 'init');
  await git(dir, 'config', 'user.email', 'test@example.invalid');
  await git(dir, 'config', 'user.name', 'Test');
  await fs.writeFile(path.join(dir, 'tracked.txt'), 'before\n');
  await git(dir, 'add', 'tracked.txt');
  await git(dir, 'commit', '-m', 'initial');
  await fs.writeFile(path.join(dir, 'tracked.txt'), 'after\n');
  await fs.writeFile(path.join(dir, 'new.txt'), 'new file\n');
  return dir;
}

async function capture(t, projectPath, inputs) {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'review-diff-output-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  const ctx = { inputs, projectPath, runDir, async writeFile(name, contents) { await fs.writeFile(path.join(runDir, name), contents); } };
  const result = await run(ctx);
  return { result, diff: await fs.readFile(path.join(runDir, 'review.diff'), 'utf8') };
}

test('supplied path diff includes modified tracked and new untracked files', async (t) => {
  const repo = await repository(t);
  const { diff } = await capture(t, os.tmpdir(), { path: repo });
  assert.match(diff, /diff --git a\/tracked\.txt b\/tracked\.txt/);
  assert.match(diff, /-before\n\+after/);
  assert.match(diff, /diff --git a\/new\.txt b\/new\.txt/);
  assert.match(diff, /\+new file/);
});

test('omitted path diffs tracked changes in projectPath', async (t) => {
  const repo = await repository(t);
  const { diff } = await capture(t, repo, {});
  assert.match(diff, /diff --git a\/tracked\.txt b\/tracked\.txt/);
  assert.doesNotMatch(diff, /new\.txt/);
  assert.equal(execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), ' M tracked.txt\n?? new.txt'.trim());
});
