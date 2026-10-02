import { execFileSync } from 'node:child_process';

export type Git = (args: string[]) => string;

export interface Handback {
  stat: string;
  files: { path: string; added: number | null; deleted: number | null; kind: 'text' | 'binary' | 'submodule' }[];
  untracked: string[];
  message: string;
  command: string;
}

const READ_ONLY = new Set(['diff', 'ls-files', 'merge-base']);

export function gitIn(cwd: string): Git {
  return (args) => {
    if (!READ_ONLY.has(args[0])) throw new Error(`git ${args[0]} is not allowed in the hand-back tray`);
    return execFileSync('git', args, { cwd, encoding: 'utf8' });
  };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function draftMessage(files: Handback['files']): string {
  if (files.length === 0) return 'Update';
  const names = files.slice(0, 3).map((f) => f.path.split('/').pop());
  const more = files.length > 3 ? ` and ${files.length - 3} more` : '';
  return `Update ${names.join(', ')}${more}`;
}

export function handback(git: Git, opts: { base?: string; cwd?: string } = {}): Handback {
  const range = opts.base ? [opts.base] : ['--cached'];
  const stat = git(['diff', ...range, '--stat']).trimEnd();
  const raw = git(['diff', ...range, '--raw', '--no-abbrev', '-z']).split('\0');
  const modes = new Map<string, string>();
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const m = raw[i].match(/^:(\d+) (\d+) /);
    if (m) modes.set(raw[i + 1], m[1] === '160000' || m[2] === '160000' ? 'submodule' : 'x');
  }
  const numstat = git(['diff', ...range, '--numstat', '-z']).split('\0').filter(Boolean);
  const files: Handback['files'] = [];
  for (const line of numstat) {
    const m = line.match(/^(\S+)\t(\S+)\t(.*)$/);
    if (!m) continue;
    const binary = m[1] === '-' && m[2] === '-';
    const submodule = modes.get(m[3]) === 'submodule';
    files.push({
      path: m[3],
      added: binary || submodule ? null : Number(m[1]),
      deleted: binary || submodule ? null : Number(m[2]),
      kind: submodule ? 'submodule' : binary ? 'binary' : 'text',
    });
  }
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean);
  const message = draftMessage(files);
  const command = opts.cwd ? `git -C ${shellQuote(opts.cwd)} commit -am ${shellQuote(message)}` : `git commit -m ${shellQuote(message)}`;
  return { stat, files, untracked, message, command };
}
