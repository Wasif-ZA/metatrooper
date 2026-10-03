import { execFileSync } from 'node:child_process';
import path from 'node:path';

export async function run(ctx) {
  const range = String(ctx.inputs.range || 'HEAD');
  if (range.startsWith('-')) throw new Error(`range must be a revision, not an option: ${range}`);
  const diff = execFileSync('git', ['-C', ctx.projectPath, 'diff', range], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  await ctx.writeFile('review.diff', diff);
  return { diff_file: path.join(ctx.runDir, 'review.diff').split('\\').join('/'), lines: diff ? diff.split('\n').length : 0 };
}
