import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { WIDEN } from '../two-engine-review/bucket.mjs';

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/;
const git = (dir, args) => execFileSync('git', ['-C', dir, '-c', 'user.name=proof', '-c', 'user.email=proof@localhost', ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });

const cleanEnv = () => { const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; return env; };
const RUNNER = /^(node --test|npm (run )?test|npx (vitest|jest|mocha)|pnpm (run )?test|yarn test|pytest|py -m pytest|python3? -m pytest|uv run pytest|go test|cargo test)(\s|$)/;
const SHELL_OPS = /[;&|<>`$%^\n]|\(|\)/;
// ponytail: an allow-listed runner can still run arbitrary test code; real containment is the sandbox host (M2).
const runTest = (dir, command) => {
  const r = spawnSync(String(command), { cwd: dir, shell: true, windowsHide: true, timeout: 5 * 60_000, env: cleanEnv(), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { ok: r.status === 0, failed: typeof r.status === 'number' && r.status !== 0, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
};
const MISSING_MODULE = /Cannot find module|ERR_MODULE_NOT_FOUND|ModuleNotFoundError|No module named/;

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

const headBytes = (dir, f) => {
  try { return execFileSync('git', ['-C', dir, 'show', `HEAD:${f}`], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }); } catch { return null; }
};

/** Pass when the test command passes with the fix and fails once the fix's non-test files are put back to HEAD. */
export function testProof(dir, proof, nonTest) {
  const name = String(proof.test ?? '');
  const [file, title] = name.split('::');
  if (!proof.command || !file || !title) return 'a test proof needs test (file::name) and command';
  const command = String(proof.command).trim();
  if (!RUNNER.test(command) || SHELL_OPS.test(command)) return 'the command must be one test runner call with no shell operators';
  if (!command.includes(title) && !command.includes(path.basename(file))) return 'the command does not name the test';
  if (!fs.existsSync(path.join(dir, file))) return `the test file ${file} does not exist`;
  if (!nonTest.length) return 'the fix changes no non-test file';
  if (!runTest(dir, command).ok) return 'the test fails with the fix';
  const saved = nonTest.map((f) => { const p = path.join(dir, f); return [p, fs.existsSync(p) ? fs.readFileSync(p) : null, headBytes(dir, f)]; });
  let without;
  try {
    for (const [p, , old] of saved) old === null ? fs.rmSync(p, { force: true }) : fs.writeFileSync(p, old);
    without = runTest(dir, command);
  } finally {
    for (const [p, now] of saved) now === null ? fs.rmSync(p, { force: true }) : fs.writeFileSync(p, now);
  }
  if (without.ok) return 'the test also passes without the fix';
  if (!without.failed) return 'the test timed out or was killed without the fix, which proves nothing';
  if (MISSING_MODULE.test(without.output)) return 'without the fix the test fails only because a file the fix added is missing';
  return null;
}

function findings(frozen, file) {
  const out = new Map();
  try {
    const b = frozen ?? JSON.parse(fs.readFileSync(String(file), 'utf8'));
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
  const known = findings(ctx.steps.freeze?.buckets, ctx.steps.review?.buckets_abs);
  const picked = ctx.steps.freeze?.pick ? new Set(ctx.steps.freeze.pick) : null;
  let entries = [];
  try { entries = JSON.parse(fs.readFileSync(path.join(ctx.runDir, 'fixes.json'), 'utf8')).fixes ?? []; } catch {}
  git(dir, ['add', '-A']);
  const results = {};
  try {
  const ranges = fixRanges(dir);
  const nonTest = git(dir, ['diff', '--cached', '--name-only', 'HEAD']).split(/\r?\n/).filter((f) => f && !TEST_PATH.test(f));
  for (const e of Array.isArray(entries) ? entries : []) {
    const f = known.get(e?.finding);
    let why = null;
    if (!f) why = 'not a finding of the review';
    else if (picked && !picked.has(e.finding)) why = 'not picked at the gate';
    else if (e.status !== 'fixed') why = String(e.reason ?? 'not fixed');
    else if (e.proof?.kind === 'diff') why = diffProof(ranges, f) ? null : 'the fix changes no line near the finding';
    else if (e.proof?.kind === 'test') {
      try { why = testProof(dir, e.proof, nonTest); } catch (err) { why = `proof could not run: ${String(err.message).split('\n')[0]}`; }
    } else why = 'no proof given';
    results[e.finding] = { claimed: e?.status === 'fixed', passed: why === null, why };
  }
  } finally {
    git(dir, ['reset', '-q']);
  }
  await ctx.writeFile('proof.json', JSON.stringify({ results }, null, 2));
  const all = Object.values(results);
  return { checked: all.length, passed: all.filter((r) => r.passed).length, proof_abs: path.join(ctx.runDir, 'proof.json').replaceAll(path.sep, '/') };
}
