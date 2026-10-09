import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const FALLBACK = 'Also read the source files it touches.';
export const HINT = 'Call get_review_context_tool on the changed files first, with changed_files set to them and detail_level "minimal". Read a whole source file only when that is not enough, and list every whole file you read as files_read in your front matter.';

function excludeGraph(dir) {
  let file;
  try {
    file = execFileSync('git', ['-C', dir, 'rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  } catch {
    return;
  }
  const abs = path.resolve(dir, file);
  const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  if (text.split(/\r?\n/).some((l) => l.trim() === '.code-review-graph/')) return;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, `${text && !text.endsWith('\n') ? '\n' : ''}.code-review-graph/\n`);
}

export async function run(ctx) {
  const dir = String(ctx.inputs.path || ctx.projectPath);
  if (!(ctx.plugins ?? []).includes('code-map')) {
    console.log('code map plugin not installed');
    return { available: false, hint: FALLBACK };
  }
  const probe = spawnSync('code-review-graph', ['--version'], { timeout: 5000, windowsHide: true });
  if (probe.status !== 0) {
    console.log('code map not installed');
    return { available: false, hint: FALLBACK };
  }
  excludeGraph(dir);
  const verb = fs.existsSync(path.join(dir, '.code-review-graph')) ? 'update' : 'build';
  const r = spawnSync('code-review-graph', [verb], { cwd: dir, timeout: 300_000, windowsHide: true, encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1' } });
  if (r.status !== 0) {
    const reason = r.error ? r.error.message : `code-review-graph ${verb} exited ${r.status}: ${(r.stderr || '').trim().split(/\r?\n/).slice(-3).join(' ')}`;
    return { available: false, hint: FALLBACK, reason };
  }
  return { available: true, hint: HINT };
}
