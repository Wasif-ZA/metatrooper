import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Splits a unified diff into per-file sections with their old and new paths. */
export function fileSections(diff) {
  return diff.split(/(?=^diff --git )/m).filter(Boolean).map((text) => {
    const m = /^diff --git a\/(\S+) b\/(\S+)$/m.exec(text);
    const plus = /^\+\+\+ b\/(.+?)\t?$/m.exec(text);
    const file = m ? m[2] : plus ? plus[1] : null;
    return { file, old: m ? m[1] : file, added: /^new file mode/m.test(text), deleted: /^deleted file mode/m.test(text), text };
  });
}

function difftAvailable() {
  return spawnSync('difft', ['--version'], { windowsHide: true, timeout: 5000 }).status === 0;
}

/** True when difftastic finds no syntax change between the range's version of a file and the working tree. */
function formatOnly(dir, range, section, tmp) {
  if (!section.file || section.added || section.deleted) return false;
  const old = spawnSync('git', ['-C', dir, 'show', `${range}:${section.old}`], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (old.status !== 0) return false;
  const oldFile = path.join(tmp, `old${path.extname(section.file)}`);
  fs.writeFileSync(oldFile, old.stdout);
  return spawnSync('difft', ['--check-only', '--exit-code', oldFile, path.join(dir, section.file)], { windowsHide: true, timeout: 10_000 }).status === 0;
}

export async function run(ctx) {
  const range = String(ctx.inputs.range || 'HEAD');
  if (range.startsWith('-')) throw new Error(`range must be a revision, not an option: ${range}`);
  const dir = String(ctx.inputs.path || ctx.projectPath);
  if (ctx.inputs.path) execFileSync('git', ['-C', dir, 'add', '--intent-to-add', '--all'], { windowsHide: true });
  let diff = execFileSync('git', ['-C', dir, '-c', 'core.quotepath=off', 'diff', range], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const skipped = [];
  if (diff && difftAvailable()) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-difft-'));
    try {
      const kept = [];
      for (const s of fileSections(diff)) {
        if (formatOnly(dir, range, s, tmp)) skipped.push(s.file);
        else kept.push(s.text);
      }
      diff = kept.join('');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  await ctx.writeFile('review.diff', diff);
  if (skipped.length) await ctx.writeFile('format-only.txt', `${skipped.join('\n')}\n`);
  return { diff_file: path.join(ctx.runDir, 'review.diff').split('\\').join('/'), lines: diff ? diff.split('\n').length : 0 };
}
