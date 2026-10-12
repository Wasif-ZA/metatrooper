import { execFile } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { ownersAsync, repoOfAsync } from '../../core/src/sessions/owners.ts';

export interface RowGit { branch: string | null; added: number; deleted: number; changed: string[] }

export type OwnedPaths = Array<{ path: string; owners: Array<{ id: string }> }>;

const cache = new Map<string, RowGit>();

/** Session id to the paths it owns, from session.owners `paths`; a shared path counts for every owner. */
export function ownedBy(paths: OwnedPaths): Record<string, string[]> {
  const owned: Record<string, string[]> = {};
  for (const p of paths) for (const o of p.owners) (owned[o.id] ??= []).push(p.path);
  return owned;
}

/** ownedBy over every distinct repo the sessions sit in, so a session in its own git worktree reads the claims keyed by that worktree. */
export async function ownedIn(db: DatabaseSync, cwds: Array<string | null>): Promise<Record<string, string[]>> {
  const repos = new Set((await Promise.all([...new Set(cwds)].map(repoOfAsync))).filter((r): r is string => !!r));
  return ownedBy((await Promise.all([...repos].map((r) => ownersAsync(db, r)))).flat());
}

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 5000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, out) => resolve(err ? '' : out));
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
  // A session left out (exited, still shown) keeps its branch and line counts but its changed list follows the owners map.
  const ids = new Set(sessions.map((s) => s.id));
  for (const [id, prev] of cache) {
    const files = owned[id] ?? [];
    if (ids.has(id) || JSON.stringify(prev.changed) === JSON.stringify(files)) continue;
    cache.set(id, { ...prev, changed: files });
    changed = true;
  }
  return changed;
}

export function rowGit(): Record<string, RowGit> {
  return Object.fromEntries(cache);
}
