import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true }).trim();

/** Resolves base and head from `range` or `branch`, adds a detached worktree at head and writes range.json. */
export async function run(ctx) {
  const dir = String(ctx.projectPath);
  const range = String(ctx.inputs.range || '').trim();
  const branch = String(ctx.inputs.branch || '').trim();
  let [base, head] = range ? range.split('..') : [null, branch];
  if (!head || (range && !base)) throw new Error('give a range as base..head, or a branch');
  if ([base, head].some((x) => x?.startsWith('-'))) throw new Error('range and branch must be revisions, not options');
  const sha = (rev) => git(dir, ['rev-parse', '--verify', `${rev}^{commit}`]);
  head = sha(head);
  base = base ? sha(base) : git(dir, ['merge-base', head, String(ctx.inputs.base_branch || 'main')]);
  const worktree = path.join(ctx.runDir, 'pr-worktree').replaceAll(path.sep, '/');
  if (fs.existsSync(worktree)) git(dir, ['worktree', 'remove', '--force', worktree]);
  git(dir, ['worktree', 'add', '--detach', worktree, head]);
  await ctx.writeFile('range.json', JSON.stringify({ base, head, range: `${base}..${head}` }, null, 2));
  return { worktree, base, head, range: `${base}..${head}` };
}
