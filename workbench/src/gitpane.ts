import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { posix } from 'node:path';
import type { OwnedPath } from '../../core/src/sessions/owners.ts';

export type Run = (args: string[], input?: string) => Promise<string>;

const exec = promisify(execFile);

export interface GitFile { path: string; code: string; added: number | null; deleted: number | null }
export interface GitView { branch: string; ahead: number; behind: number; staged: GitFile[]; changes: GitFile[]; log: string; groups?: OwnerGroup[] }
export interface OwnerGroup { key: string; title: string; state: string; files: GitFile[]; stage: boolean }

/** Unstaged changes grouped by owning session; a shared file sits only in the shared group, which has no stage action. */
export function ownerGroups(changes: GitFile[], owned: OwnedPath[]): OwnerGroup[] {
  const by = new Map(owned.map((o) => [o.path, o]));
  const groups = new Map<string, OwnerGroup>();
  const put = (key: string, title: string, state: string, stage: boolean, f: GitFile) => {
    const g = groups.get(key) ?? { key, title, state, files: [], stage };
    g.files.push(f);
    groups.set(key, g);
  };
  for (const f of changes) {
    const o = by.get(f.path);
    if (o && o.shared) put('shared', 'Shared, stage by hand', o.owners.map((x) => x.title).join(', '), false, f);
    else if (o && o.owners.length) put(`owner:${o.owners[0].id}`, o.owners[0].title, o.owners[0].state, true, f);
    else put('unclaimed', 'No owner', '', true, f);
  }
  const rank = (g: OwnerGroup) => (g.key === 'shared' ? 1 : g.key === 'unclaimed' ? 2 : 0);
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

export const GIT_SAFE_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false' };

/** git in `cwd` with the repo's code-running settings off; `input` goes to stdin, which is always closed. */
export function runIn(cwd: string): Run {
  return async (args, input?: string) => {
    const p = exec('git', args, { cwd, encoding: 'utf8', timeout: 60000, windowsHide: true, env: { ...process.env, ...GIT_SAFE_ENV } });
    p.child.stdin?.on('error', () => {});
    p.child.stdin?.end(input ?? '', 'utf8');
    return (await p).stdout;
  };
}

function counts(out: string): Map<string, [number | null, number | null]> {
  const m = new Map<string, [number | null, number | null]>();
  for (const line of out.split('\0')) {
    const [a, d, ...name] = line.split('\t');
    if (name.length) m.set(name.join('\t'), [a === '-' ? null : Number(a), d === '-' ? null : Number(d)]);
  }
  return m;
}

/** Branch, ahead/behind, staged and unstaged files with line counts, and the last 30 commits as subject TAB relative date. */
export async function gitView(git: Run): Promise<GitView> {
  const [status, stagedOut, unstagedOut, log] = await Promise.all([
    git(['status', '--porcelain=v1', '-b', '-z']),
    git(['diff', '--cached', '--numstat', '--no-renames', '-z']).catch(() => ''),
    git(['diff', '--numstat', '--no-renames', '-z']),
    git(['log', '--format=%s%x09%ar', '-30']).catch(() => ''),
  ]);
  const parts = status.split('\0');
  const head = parts.shift() ?? '';
  const branch = /^## (?:No commits yet on )?(.+?)(?:\.\.\.| \[|$)/.exec(head)?.[1] ?? 'HEAD';
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0);
  const staged = counts(stagedOut);
  const unstaged = counts(unstagedOut);
  const view: GitView = { branch, ahead, behind, staged: [], changes: [], log: log.trimEnd() };
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const x = e[0], y = e[1], path = e.slice(3);
    if (x === 'R' || x === 'C') i++;
    if (x !== ' ' && x !== '?') view.staged.push({ path, code: x, ...pair(staged.get(path)) });
    if (y !== ' ') view.changes.push({ path, code: y === '?' ? 'U' : y, ...pair(unstaged.get(path)) });
  }
  return view;
}

function pair(c: [number | null, number | null] | undefined) {
  return { added: c ? c[0] : null, deleted: c ? c[1] : null };
}

export interface StatusFile { path: string; from?: string; index: string; worktree: string; conflict?: true }
export interface Status { branch: string; upstream: string | null; ahead: number; behind: number; files: StatusFile[] }

/** Parses `git status --porcelain=v2 --branch -z`: X is the index column, Y the work tree; untracked shows as `??`. */
export function parseStatusV2(out: string): Status {
  const s: Status = { branch: 'HEAD', upstream: null, ahead: 0, behind: 0, files: [] };
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.startsWith('# branch.head ')) s.branch = e.slice(14);
    else if (e.startsWith('# branch.upstream ')) s.upstream = e.slice(18);
    else if (e.startsWith('# branch.ab ')) { const m = /\+(\d+) -(\d+)/.exec(e); if (m) { s.ahead = Number(m[1]); s.behind = Number(m[2]); } }
    else if (e.startsWith('1 ')) s.files.push({ path: e.split(' ').slice(8).join(' '), index: e[2], worktree: e[3] });
    else if (e.startsWith('2 ')) s.files.push({ path: e.split(' ').slice(9).join(' '), from: parts[++i], index: e[2], worktree: e[3] });
    else if (e.startsWith('u ')) s.files.push({ path: e.split(' ').slice(10).join(' '), index: e[2], worktree: e[3], conflict: true });
    else if (e.startsWith('? ')) s.files.push({ path: e.slice(2), index: '?', worktree: '?' });
  }
  return s;
}

/** Repo-relative paths a stage or unstage may name: plain strings, never the whole tree. */
export function namedPaths(rels: unknown): string[] | null {
  if (!Array.isArray(rels) || !rels.length || rels.length > 20000) return null;
  const whole = (r: string) => { const n = posix.normalize(r.replace(/\\/g, '/')).replace(/\/+$/, ''); return !n || n === '.' || n === '..' || n.startsWith('../') || n.startsWith('/') || /^[A-Za-z]:/.test(n); };
  const gitDir = (r: string) => r.split(/[\\/]/).some((s) => s.replace(/[. ]+$/, '').toLowerCase() === '.git');
  return rels.every((r) => typeof r === 'string' && r && !r.includes('\0') && r.length < 4096 && !whole(r) && !gitDir(r)) ? rels as string[] : null;
}

/** One write from the Git tab. Paths go after `--`, the message goes on stdin, nothing passes through a shell. */
export async function gitAct(git: Run, op: string, arg: unknown): Promise<void> {
  const path = typeof arg === 'string' ? arg : '';
  const named = (verb: string[]) => { const list = namedPaths(arg); if (!list) throw new Error('name the files'); return git(['--literal-pathspecs', ...verb, '--', ...list]); };
  switch (op) {
    case 'stage-paths': {
      const list = namedPaths(arg);
      if (!list) throw new Error('name the files');
      await git(['--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'], list.join('\0'));
      return;
    }
    case 'unstage-paths': await named(['restore', '--staged']); return;
    case 'stage': await git(['add', '--', path || '.']); return;
    case 'stage-group': {
      const list = Array.isArray(arg) ? arg : [];
      if (!list.length || list.some((p) => typeof p !== 'string' || !p)) throw new Error('nothing to stage in this group');
      await git(['add', '--', ...list]);
      return;
    }
    case 'unstage': await git(['restore', '--staged', '--', path || '.']); return;
    case 'commit':
      if (!path.trim() || path.includes('\0') || path.length > 64 * 1024) throw new Error('write a commit message first');
      if (!(await git(['diff', '--cached', '--name-only'])).trim()) throw new Error('nothing staged; press + on a file first');
      await git(['commit', '-F', '-'], path.trim());
      return;
    case 'push': await git(['push']); return;
    case 'pull': await git(['pull', '--ff-only']); return;
    default: throw new Error(`unknown git action ${op}`);
  }
}
