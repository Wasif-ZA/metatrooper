import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WIDEN } from '../two-engine-review/bucket.mjs';

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/;
const git = (dir, args) => execFileSync('git', ['-C', dir, '-c', 'user.name=proof', '-c', 'user.email=proof@localhost', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });

const passes = (dir, command) => spawnSync(String(command), { cwd: dir, shell: true, windowsHide: true, timeout: 5 * 60_000 }).status === 0;

/** Old-side line ranges per file of the uncommitted fix, from `git diff -U0 HEAD`. */
export function fixRanges(dir) {
  const ranges = new Map();
  let file = null;
  for (const line of git(dir, ['-c', 'core.quotepath=off', 'diff', '--cached', '-U0', '--no-color', 'HEAD']).split(/\r?\n/)) {
    const f = /^--- a\/(.+?)\t?$/.exec(line);
    if (f) { file = f[1]; continue; }
    if (line.startsWith('--- ')) { file = null; continue; }
    const h = /^@@ -(\d+)(?:,(\d+))? /.exec(line);
    if (h && file) ranges.set(file, [...(ranges.get(file) ?? []), [Number(h[1]), Number(h[1]) + Math.max(h[2] === undefined ? 1 : Number(h[2]), 1) - 1]]);
  }
  return ranges;
}

/** Pass when the fix changes a line inside the finding's lines widened by WIDEN. */
export function diffProof(ranges, finding) {
  return finding.lines.some(([a, b]) => (ranges.get(finding.file) ?? []).some(([s, e]) => s <= b + WIDEN && a - WIDEN <= e));
}

/** Pass when the test command passes with the fix and fails once the fix's non-test files are stashed. */
export function testProof(dir, proof, nonTest) {
  const name = String(proof.test ?? '');
  const [file, title] = name.split('::');
  if (!proof.command || !file || !title) return 'a test proof needs test (file::name) and command';
  if (!String(proof.command).includes(title) && !String(proof.command).includes(path.basename(file))) return 'the command does not name the test';
  if (!nonTest.length) return 'the fix changes no non-test file';
  if (!passes(dir, proof.command)) return 'the test fails with the fix';
  git(dir, ['stash', 'push', '--', ...nonTest]);
  let failsWithout;
  try { failsWithout = !passes(dir, proof.command); } finally { git(dir, ['stash', 'pop']); }
  return failsWithout ? null : 'the test also passes without the fix';
}

function findings(file) {
  const out = new Map();
  try {
    const b = JSON.parse(fs.readFileSync(String(file), 'utf8'));
    for (const k of ['both', 'codex_only', 'gemini_only', 'disagree']) for (const p of b[k] ?? []) {
      const parts = [p.codex, p.gemini].filter(Boolean);
      out.set(p.id, { file: parts[0].file, lines: parts.map((f) => [f.line_start, f.line_end]) });
    }
  } catch {}
  return out;
}

/** Checks every entry of fixes.json and writes proof.json: one verdict per finding id. */
export async function run(ctx) {
  const dir = String(ctx.steps.checkout?.worktree);
  const known = findings(ctx.steps.review?.buckets_abs);
  let entries = [];
  try { entries = JSON.parse(fs.readFileSync(path.join(ctx.runDir, 'fixes.json'), 'utf8')).fixes ?? []; } catch {}
  git(dir, ['add', '-A']);
  const ranges = fixRanges(dir);
  const nonTest = git(dir, ['diff', '--cached', '--name-only', 'HEAD']).split(/\r?\n/).filter((f) => f && !TEST_PATH.test(f));
  const results = {};
  for (const e of Array.isArray(entries) ? entries : []) {
    const f = known.get(e?.finding);
    let why = null;
    if (!f) why = 'not a finding of the review';
    else if (e.status !== 'fixed') why = String(e.reason ?? 'not fixed');
    else if (e.proof?.kind === 'diff') why = diffProof(ranges, f) ? null : 'the fix changes no line near the finding';
    else if (e.proof?.kind === 'test') {
      try { why = testProof(dir, e.proof, nonTest); } catch (err) { why = `proof could not run: ${String(err.message).split('\n')[0]}`; }
    } else why = 'no proof given';
    results[e.finding] = { claimed: e?.status === 'fixed', passed: why === null, why };
  }
  await ctx.writeFile('proof.json', JSON.stringify({ results }, null, 2));
  const all = Object.values(results);
  return { checked: all.length, passed: all.filter((r) => r.passed).length, proof_abs: path.join(ctx.runDir, 'proof.json').replaceAll(path.sep, '/') };
}
