import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './helpers.ts';

const checkout = await import(pathToFileURL(`${root}/pipelines/pr-review-fix/checkout.mjs`).href);
const proof = await import(pathToFileURL(`${root}/pipelines/pr-review-fix/proof.mjs`).href);
const handback = await import(pathToFileURL(`${root}/pipelines/pr-review-fix/handback.mjs`).href);
const { execFileSync } = await import('node:child_process');
const fixture = path.join(root, 'tests/fixtures/pr-review-fix');
const planted = JSON.parse(await fs.readFile(path.join(fixture, 'planted.json'), 'utf8'));
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=fixture', '-c', 'user.email=fixture@localhost', ...args], { encoding: 'utf8', windowsHide: true }).trim();

async function setup(t: test.TestContext) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'm5-06-pro-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const repo = path.join(temp, 'repo');
  await fs.mkdir(repo);
  git(repo, 'init', '-q', '-b', 'main');
  await fs.cp(path.join(fixture, 'base'), repo, { recursive: true });
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'base');
  const base = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-qb', 'pr');
  await fs.cp(path.join(fixture, 'head/src'), path.join(repo, 'src'), { recursive: true });
  git(repo, 'add', '.');
  git(repo, 'commit', '-qm', 'PR head');
  const head = git(repo, 'rev-parse', 'HEAD');
  const runDir = path.join(temp, 'run');
  await fs.mkdir(runDir);
  const reviewDir = path.join(runDir, 'review');
  const rereviewDir = path.join(runDir, 'rereview');
  await fs.mkdir(reviewDir);
  await fs.mkdir(rereviewDir);
  const findings = planted.bugs.map((f: any) => ({
    id: f.id,
    codex: { title: f.title, file: f.file, line_start: f.line_start, line_end: f.line_end },
    gemini: { title: f.title, file: f.file, line_start: f.line_start, line_end: f.line_end },
  }));
  const buckets = { both: findings, codex_only: [], gemini_only: [], disagree: [] };
  const reviewFile = path.join(reviewDir, 'review-buckets.json');
  const rereviewFile = path.join(rereviewDir, 'review-buckets.json');
  await fs.writeFile(reviewFile, JSON.stringify(buckets));
  await fs.writeFile(rereviewFile, JSON.stringify({ both: [], codex_only: [], gemini_only: [], disagree: [] }));
  const ctx: any = {
    projectPath: repo,
    runDir,
    inputs: { range: `${base}..${head}` },
    steps: { review: { buckets_abs: reviewFile }, rereview: { buckets_abs: rereviewFile } },
    async writeFile(name: string, contents: string) { await fs.writeFile(path.join(runDir, name), contents); },
  };
  ctx.steps.checkout = await checkout.run(ctx);
  ctx.steps.checkout.worktree = ctx.steps.checkout.worktree;
  return { repo, runDir, reviewFile, rereviewFile, ctx };
}

async function applyAllFixes(worktree: string) {
  for (const f of ['total.js', 'discount.js']) await fs.copyFile(path.join(fixture, 'base/src', f), path.join(worktree, 'src', f));
  const paginate = path.join(worktree, 'src', 'paginate.js');
  const lines = (await fs.readFile(paginate, 'utf8')).split('\n');
  lines[6] = lines[6].replace('Math.ceil(count / size)', 'Math.ceil(Number(count) / size)');
  await fs.writeFile(paginate, lines.join('\n'));
}

function proofEntries() {
  return [
    { finding: 'total', status: 'fixed', proof: { kind: 'test', test: planted.bugs[0].test, command: planted.bugs[0].command } },
    { finding: 'discount', status: 'fixed', proof: { kind: 'test', test: planted.bugs[1].test, command: planted.bugs[1].command } },
    { finding: 'paginate', status: 'fixed', proof: { kind: 'diff' } },
  ];
}

async function hashNonTestFiles(repo: string) {
  const files = git(repo, 'ls-files').split(/\r?\n/).filter((f) => f && !/(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$/.test(f));
  const pairs = await Promise.all(files.map(async (file) => [file, await fs.readFile(path.join(repo, file))] as const));
  return JSON.stringify(pairs.map(([file, contents]) => [file, contents.toString('base64')]));
}

async function runProofAndHandback(f: Awaited<ReturnType<typeof setup>>, entries: any[]) {
  f.ctx.steps.proof = { worktree: f.ctx.steps.checkout.worktree };
  await fs.writeFile(path.join(f.runDir, 'picks.json'), JSON.stringify({ pick: planted.bugs.map((x: any) => x.id) }));
  await fs.writeFile(path.join(f.runDir, 'fixes.json'), JSON.stringify({ fixes: entries }));
  const proofResult = await proof.run(f.ctx);
  const handbackResult = await handback.run(f.ctx);
  return { proofResult, handbackResult, md: await fs.readFile(path.join(f.runDir, 'handback.md'), 'utf8') };
}

test('M5-06a accepts only meaningful tests and a diff touching the finding', async (t) => {
  const f = await setup(t);
  await applyAllFixes(f.ctx.steps.checkout.worktree);
  const before = await hashNonTestFiles(f.ctx.steps.checkout.worktree);
  const result = await runProofAndHandback(f, proofEntries());
  const after = await hashNonTestFiles(f.ctx.steps.checkout.worktree);
  assert.equal(before, after);
  assert.equal(result.handbackResult.fixed, 1);
  assert.equal(result.handbackResult.claimed, 2);
  assert.equal(result.handbackResult.still_found, 0);
  assert.ok(result.handbackResult.items.some((item: any) => item.kind === 'fixed' && item.text.includes('total')));
  assert.ok(result.handbackResult.items.some((item: any) => item.kind === 'claimed' && item.text.includes('discount')));
  assert.ok(result.handbackResult.items.some((item: any) => item.kind === 'claimed' && item.text.includes('paginate')));
});

test('M5-06b a matching rereview finding overrides a passing proof', async (t) => {
  const f = await setup(t);
  await applyAllFixes(f.ctx.steps.checkout.worktree);
  await runProofAndHandback(f, proofEntries());
  const finding = planted.bugs[0];
  const overlap = { id: 'total-again', codex: { title: finding.title, file: finding.file, line_start: finding.line_start, line_end: finding.line_end }, gemini: null };
  await fs.writeFile(f.rereviewFile, JSON.stringify({ both: [overlap], codex_only: [], gemini_only: [], disagree: [] }));
  const result = await handback.run(f.ctx);
  assert.equal(result.fixed, 0);
  assert.equal(result.still_found, 1);
  assert.match((await fs.readFile(path.join(f.runDir, 'handback.md'), 'utf8')), /still found after the fix \(its proof passed\)/);
});

test('test proofs reject a generic command and a command that omits the named test', async (t) => {
  const f = await setup(t);
  await applyAllFixes(f.ctx.steps.checkout.worktree);
  await fs.writeFile(path.join(f.runDir, 'picks.json'), JSON.stringify({ pick: planted.bugs.map((x: any) => x.id) }));
  await fs.writeFile(path.join(f.runDir, 'fixes.json'), JSON.stringify({ fixes: [
    { finding: 'total', status: 'fixed', proof: { kind: 'test', test: planted.bugs[0].test, command: 'true' } },
    { finding: 'discount', status: 'fixed', proof: { kind: 'test', test: planted.bugs[1].test, command: 'node --test test/total.test.js' } },
  ] }));
  await proof.run(f.ctx);
  const results = JSON.parse(await fs.readFile(path.join(f.runDir, 'proof.json'), 'utf8')).results;
  assert.equal(results.total.passed, false);
  assert.match(results.total.why, /command does not name the test/);
  assert.equal(results.discount.passed, false);
  assert.match(results.discount.why, /command does not name the test/);
});

test('checkout rejects a range with a nonexistent head', async (t) => {
  const f = await setup(t);
  f.ctx.inputs.range = `${git(f.repo, 'rev-parse', 'main')}..no-such-head`;
  await assert.rejects(checkout.run(f.ctx));
});

test('M5-06c gates both review passes through the two-engine pipeline before either reviewer', async () => {
  const prPipeline = JSON.parse(await fs.readFile(path.join(root, 'pipelines/pr-review-fix.json'), 'utf8'));
  const twoEngine = JSON.parse(await fs.readFile(path.join(root, 'pipelines/two-engine-review.json'), 'utf8'));
  const reviewSteps = prPipeline.steps.filter((s: any) => s.id === 'review' || s.id === 'rereview');
  assert.equal(reviewSteps.length, 2);
  for (const step of reviewSteps) assert.equal(step.uses, 'pipeline:two-engine-review');
  const ids = twoEngine.steps.map((s: any) => s.id);
  for (const required of ['scan', 'send-check', 'codex-review', 'gemini-review']) assert.ok(ids.includes(required));
  assert.ok(ids.indexOf('scan') < ids.indexOf('codex-review'));
  assert.ok(ids.indexOf('scan') < ids.indexOf('gemini-review'));
  assert.ok(ids.indexOf('send-check') < ids.indexOf('codex-review'));
  assert.ok(ids.indexOf('send-check') < ids.indexOf('gemini-review'));
});
