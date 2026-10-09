import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const TEST_PATH = /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$|_test\.(py|go)$/;

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true }).trim();

/** Fails the run when the build left no commit or a dirty tree; reports whether the commits touch a test file. */
export async function run(ctx) {
  const dir = String(ctx.steps.build?.worktree);
  const base = fs.readFileSync(path.join(ctx.runDir, 'worktrees', 'build-0.base'), 'utf8').trim();
  const commits = Number(git(dir, ['rev-list', '--count', `${base}..HEAD`]));
  const dirty = git(dir, ['status', '--porcelain']).split(/\r?\n/).filter(Boolean);
  if (commits < 1) throw new Error('the build made no commit');
  if (dirty.length) throw new Error(`the build left ${dirty.length} uncommitted change${dirty.length === 1 ? '' : 's'}: ${dirty.slice(0, 5).join(', ')}`);
  const tests = git(dir, ['diff', '--name-only', base, 'HEAD']).split(/\r?\n/).filter((f) => TEST_PATH.test(f));
  return { commits, tests_added: tests.length, summary: `${commits} commit${commits === 1 ? '' : 's'} on the branch${tests.length ? '' : ', none touching a test file'}` };
}
