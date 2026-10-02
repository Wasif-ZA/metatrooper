import { execFile } from 'node:child_process';

export interface RowGit { branch: string | null; added: number; deleted: number }

const cache = new Map<string, RowGit>();

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 5000 }, (err, out) => resolve(err ? '' : out));
  });
}

/** Branch and lines added/removed against HEAD for each session folder; slow, so it runs on a timer, never per snapshot. */
export async function refreshRowGit(sessions: Array<{ id: string; cwd: string | null }>): Promise<boolean> {
  let changed = false;
  for (const s of sessions) {
    if (!s.cwd) continue;
    const [branch, stat] = await Promise.all([git(s.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']), git(s.cwd, ['diff', '--shortstat', 'HEAD'])]);
    const next: RowGit = {
      branch: branch.trim() || null,
      added: Number(/(\d+) insertion/.exec(stat)?.[1] ?? 0),
      deleted: Number(/(\d+) deletion/.exec(stat)?.[1] ?? 0),
    };
    const prev = cache.get(s.id);
    if (!prev || prev.branch !== next.branch || prev.added !== next.added || prev.deleted !== next.deleted) changed = true;
    cache.set(s.id, next);
  }
  return changed;
}

export function rowGit(): Record<string, RowGit> {
  return Object.fromEntries(cache);
}
