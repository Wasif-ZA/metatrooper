import { execFile } from 'node:child_process';

export interface RowGit { branch: string | null; added: number; deleted: number; changed: string[] }

export type OwnedPaths = Array<{ path: string; owners: Array<{ id: string }> }>;

const cache = new Map<string, RowGit>();

/** Session id to the paths it owns, from session.owners `paths`; a shared path counts for every owner. */
export function ownedBy(paths: OwnedPaths): Record<string, string[]> {
  const owned: Record<string, string[]> = {};
  for (const p of paths) for (const o of p.owners) (owned[o.id] ??= []).push(p.path);
  return owned;
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 5000 }, (err, out) => resolve(err ? '' : out));
  });
}

/** Branch, lines added/removed against HEAD, and the uncommitted paths the session owns (`owned`, from session.owners); slow, so it runs on a timer, never per snapshot. */
export async function refreshRowGit(sessions: Array<{ id: string; cwd: string | null }>, owned: Record<string, string[]> = {}): Promise<boolean> {
  let changed = false;
  for (const s of sessions) {
    if (!s.cwd) continue;
    const [branch, stat] = await Promise.all([git(s.cwd, ['rev-parse', '--abbrev-ref', 'HEAD']), git(s.cwd, ['diff', '--shortstat', 'HEAD'])]);
    const next: RowGit = {
      branch: branch.trim() || null,
      added: Number(/(\d+) insertion/.exec(stat)?.[1] ?? 0),
      deleted: Number(/(\d+) deletion/.exec(stat)?.[1] ?? 0),
      changed: owned[s.id] ?? [],
    };
    const prev = cache.get(s.id);
    if (!prev || prev.branch !== next.branch || prev.added !== next.added || prev.deleted !== next.deleted || JSON.stringify(prev.changed) !== JSON.stringify(next.changed)) changed = true;
    cache.set(s.id, next);
  }
  return changed;
}

export function rowGit(): Record<string, RowGit> {
  return Object.fromEntries(cache);
}
