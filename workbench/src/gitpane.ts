import { execFileSync } from 'node:child_process';

export type Run = (args: string[]) => string;

export interface GitFile { path: string; code: string; added: number | null; deleted: number | null }
export interface GitView { branch: string; ahead: number; behind: number; staged: GitFile[]; changes: GitFile[]; log: string }

export function runIn(cwd: string): Run {
  return (args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, windowsHide: true });
}

function counts(out: string): Map<string, [number | null, number | null]> {
  const m = new Map<string, [number | null, number | null]>();
  for (const line of out.split('\n')) {
    const [a, d, ...name] = line.split('\t');
    if (name.length) m.set(name.join('\t'), [a === '-' ? null : Number(a), d === '-' ? null : Number(d)]);
  }
  return m;
}

/** Branch, ahead/behind, staged and unstaged files with line counts, and the last 50 commits as a graph. */
export function gitView(git: Run): GitView {
  const parts = git(['status', '--porcelain=v1', '-b', '-z']).split('\0');
  const head = parts.shift() ?? '';
  const branch = /^## (?:No commits yet on )?(.+?)(?:\.\.\.| \[|$)/.exec(head)?.[1] ?? 'HEAD';
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] ?? 0);
  const behind = Number(/behind (\d+)/.exec(head)?.[1] ?? 0);
  let staged = new Map<string, [number | null, number | null]>();
  try { staged = counts(git(['diff', '--cached', '--numstat'])); } catch {}
  const unstaged = counts(git(['diff', '--numstat']));
  const view: GitView = { branch, ahead, behind, staged: [], changes: [], log: '' };
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    const x = e[0], y = e[1], path = e.slice(3);
    if (x === 'R' || x === 'C') i++;
    if (x !== ' ' && x !== '?') view.staged.push({ path, code: x, ...pair(staged.get(path)) });
    if (y !== ' ') view.changes.push({ path, code: y === '?' ? 'U' : y, ...pair(unstaged.get(path)) });
  }
  try { view.log = git(['log', '--graph', '--date=short', '--format=%h %ad %s%d', '-50']).trimEnd(); } catch {}
  return view;
}

function pair(c: [number | null, number | null] | undefined) {
  return { added: c ? c[0] : null, deleted: c ? c[1] : null };
}

/** One write from the Git tab. Paths go after `--`, the message is one argv entry, nothing passes through a shell. */
export function gitAct(git: Run, op: string, arg: unknown): void {
  const path = typeof arg === 'string' ? arg : '';
  switch (op) {
    case 'stage': git(['add', '--', path || '.']); return;
    case 'unstage': git(['restore', '--staged', '--', path || '.']); return;
    case 'commit':
      if (!path.trim()) throw new Error('write a commit message first');
      if (!git(['diff', '--cached', '--name-only']).trim()) throw new Error('nothing staged; press + on a file first');
      git(['commit', '-m', path.trim()]);
      return;
    case 'push': git(['push']); return;
    default: throw new Error(`unknown git action ${op}`);
  }
}
