import { execFile } from 'node:child_process';
import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { ownersAsync, repoOfAsync } from '../../core/src/sessions/owners.ts';

export type Pr = { number: number; state: string; url: string; checks: 'pass' | 'fail' | 'pending' | null };
export interface RowGit { root: string | null; branch: string | null; added: number; deleted: number; changed: string[]; commit: string | null; pr: Pr | null }
/** The pull request for `branch` of the repo at `top`, or null; called once per distinct repo and branch each refresh. */
export type PrLookup = (top: string, branch: string) => Promise<Pr | null>;
export const noPr: PrLookup = async () => null;

export type OwnedPaths = Array<{ path: string; owners: Array<{ id: string }> }>;

const cache = new Map<string, RowGit>();
const PR_EVERY_MS = 60_000;
const prCache = new Map<string, { at: number; by: PrLookup; pr: Promise<Pr | null> }>();
const CACHE_MAX = 200;

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

function run(cmd: string, cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 5000, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } }, (err, out) => resolve(err ? '' : out));
  });
}
const git = (cwd: string, args: string[]) => run('git', cwd, args);

/** One word for a statusCheckRollup: any failed check fails, all finished ok pass, else pending; no checks is null. */
export function checksOf(rollup: Array<{ status?: string; conclusion?: string; state?: string }> | null | undefined): Pr['checks'] {
  if (!rollup?.length) return null;
  const word = (c: { status?: string; conclusion?: string; state?: string }) => String(c.conclusion || c.state || c.status || '').toUpperCase();
  if (rollup.some((c) => ['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(word(c)))) return 'fail';
  return rollup.every((c) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(word(c))) ? 'pass' : 'pending';
}

/** `gh pr view` for the branch; read-only, null when there is no PR or gh fails. */
export const ghPr: PrLookup = async (top, branch) => {
  try {
    const p = JSON.parse(await run('gh', top, ['pr', 'view', branch, '--json', 'number,state,url,statusCheckRollup'])) as { number: number; state: string; url: string; statusCheckRollup?: Array<Record<string, string>> };
    return { number: p.number, state: p.state, url: p.url, checks: checksOf(p.statusCheckRollup) };
  } catch {
    return null;
  }
};

function runOut(cmd: string, cwd: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 60000 }, (err, out, errOut) => resolve(err ? { ok: false, out: String(errOut || err.message).trim() } : { ok: true, out }));
  });
}

/** Merges the PR of the branch checked out at `cwd` with `gh pr merge --merge`; in the demo (`demoFile` set) a --no-ff merge into the main worktree, then the PR is marked MERGED there. */
export async function mergePr(cwd: string, demoFile: string | null): Promise<{ ok: true } | { error: string }> {
  const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (!branch || branch === 'HEAD') return { error: 'no branch is checked out in this folder' };
  const fresh = () => { for (const k of prCache.keys()) if (k.endsWith(`\n${branch}`)) prCache.delete(k); };
  if (!demoFile) {
    const r = await runOut('gh', cwd, ['pr', 'merge', branch, '--merge']);
    if (r.ok) fresh();
    return r.ok ? { ok: true } : { error: r.out.split('\n')[0] || 'gh pr merge failed' };
  }
  const main = (await git(cwd, ['worktree', 'list', '--porcelain'])).match(/^worktree (.+)$/m)?.[1];
  if (!main) return { error: 'no main worktree found' };
  const r = await runOut('git', main, ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.invalid', 'merge', '--no-ff', '--no-edit', branch]);
  if (!r.ok) return { error: r.out.split('\n')[0] || 'git merge failed' };
  const gh = JSON.parse(fs.readFileSync(demoFile, 'utf8'));
  if (gh.prs?.[branch]) gh.prs[branch].state = 'MERGED';
  fs.writeFileSync(demoFile, JSON.stringify(gh, null, 2));
  fresh();
  return { ok: true };
}

export type Issue = { number: number; title: string; labels: string[]; assignees: string[]; url: string };

/** `gh issue list` of open issues for the repo at `cwd`; read-only, [] when gh fails. */
export async function ghIssues(cwd: string): Promise<Issue[]> {
  try {
    const rows = JSON.parse(await run('gh', cwd, ['issue', 'list', '--state', 'open', '--limit', '100', '--json', 'number,title,labels,assignees,url'])) as Array<{ number: number; title: string; labels?: Array<{ name: string }>; assignees?: Array<{ login: string }>; url: string }>;
    return rows.map((r) => ({ number: r.number, title: r.title, labels: (r.labels ?? []).map((l) => l.name), assignees: (r.assignees ?? []).map((a) => a.login), url: r.url }));
  } catch {
    return [];
  }
}

/** Branch, lines added/removed against HEAD, and the uncommitted paths the session owns (`owned`, from session.owners); slow, so it runs on a timer, never per snapshot. */
export async function refreshRowGit(sessions: Array<{ id: string; cwd: string | null }>, owned: Record<string, string[]> = {}, prOf: PrLookup = noPr): Promise<boolean> {
  let changed = false;
  const prs = new Map<string, Promise<Pr | null>>();
  const reads = new Map<string, Promise<string[]>>();
  for (const s of sessions) {
    if (!s.cwd) continue;
    const cwd = s.cwd;
    if (!reads.has(cwd)) reads.set(cwd, Promise.all([git(cwd, ['rev-parse', '--show-toplevel', '--abbrev-ref', 'HEAD']), git(cwd, ['rev-parse', '--short', 'HEAD']), git(cwd, ['diff', '--shortstat', 'HEAD'])]));
    const [head, commit, stat] = await reads.get(cwd)!;
    const [top = '', branch = ''] = head.trim().split(/\r?\n/);
    const key = `${top}\n${branch}`;
    if (top && branch && branch !== 'HEAD' && !prs.has(key)) {
      const hit = prCache.get(key);
      if (!hit || prOf !== hit.by || Date.now() - hit.at > PR_EVERY_MS) prCache.set(key, { at: Date.now(), by: prOf, pr: prOf(top, branch).catch(() => null) });
      prs.set(key, prCache.get(key)!.pr);
    }
    const next: RowGit = {
      root: top || null,
      branch: branch || null,
      added: Number(/(\d+) insertion/.exec(stat)?.[1] ?? 0),
      deleted: Number(/(\d+) deletion/.exec(stat)?.[1] ?? 0),
      changed: owned[s.id] ?? [],
      commit: commit.trim() || null,
      pr: (await prs.get(key)) ?? null,
    };
    const prev = cache.get(s.id);
    if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) changed = true;
    cache.delete(s.id);
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
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  while (prCache.size > CACHE_MAX) prCache.delete(prCache.keys().next().value as string);
  return changed;
}

export function rowGit(): Record<string, RowGit> {
  return Object.fromEntries(cache);
}
