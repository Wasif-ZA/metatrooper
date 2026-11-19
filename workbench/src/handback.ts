import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GIT_SAFE_ENV } from './gitpane.ts';

export type Git = ((args: string[], input?: string) => string | Promise<string>) & { blob?: (spec: string) => Promise<Buffer> };

const exec = promisify(execFile);

export interface Handback {
  stat: string;
  files: { path: string; added: number | null; deleted: number | null; kind: 'text' | 'binary' | 'submodule' }[];
  untracked: string[];
  message: string;
  command: string;
}

const READ_ONLY = new Set(['diff', 'ls-files', 'ls-tree', 'hash-object', 'merge-base', 'rev-parse', 'show']);

export function gitIn(cwd: string): Git {
  const options = { cwd, maxBuffer: 32 * 1024 * 1024, windowsHide: true, env: { ...process.env, ...GIT_SAFE_ENV } };
  return Object.assign((args: string[], input?: string) => {
    if (!READ_ONLY.has(args[0]) || (args[0] === 'hash-object' && (args.length !== 2 || args[1] !== '--stdin-paths'))) throw new Error(`git ${args[0]} is not allowed in the hand-back tray`);
    const result = exec('git', args, { ...options, encoding: 'utf8' });
    result.child.stdin!.end(input);
    return result.then((r) => r.stdout);
  }, { blob: (spec: string) => exec('git', ['show', spec], { ...options, encoding: 'buffer' }).then((r) => r.stdout) });
}

async function untrackedDiff(git: Git, base: string, file: string, numstat = false): Promise<string> {
  let before: Buffer;
  try { before = git.blob ? await git.blob(`${base}:${file}`) : Buffer.from(await git(['show', `${base}:${file}`])); }
  catch (e) {
    if (!/fatal: path .* (?:does not exist in|exists on disk, but not in) /.test(String((e as { stderr?: string | Buffer }).stderr ?? ''))) throw e;
    try { return await git(['diff', '--no-ext-diff', '--no-textconv', ...(numstat ? ['--numstat'] : []), '--no-index', '--', '/dev/null', file]); }
    catch (e) { return (e as { stdout?: string }).stdout ?? ''; }
  }
  const dir = await mkdtemp(join(tmpdir(), 'troop-diff-'));
  try {
    const old = join(dir, 'before');
    await writeFile(old, before);
    let out: string;
    try { out = await git(['diff', '--no-ext-diff', '--no-textconv', ...(numstat ? ['--numstat'] : []), '--no-index', '--', old, file]); }
    catch (e) { out = (e as { stdout?: string }).stdout ?? ''; }
    return numstat ? out : out.replace(/^diff --git .*$/m, `diff --git a/${file} b/${file}`).replace(/^--- .*$/m, `--- a/${file}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** One file's diff against `base`, including untracked files saved in a checkpoint. */
export async function fileDiff(git: Git, base: string, file: string): Promise<string> {
  const out = await git(['diff', '--no-ext-diff', '--no-textconv', base, '--', file]);
  if (await git(['ls-files', '--others', '--exclude-standard', '--', file])) return untrackedDiff(git, base, file);
  return out;
}

/** Files changed since `base` with line counts (null for binary), and untracked files, for the Diff tab. */
export async function sessionChanges(git: Git, base: string): Promise<{ files: Array<{ path: string; added: number | null; deleted: number | null }>; untracked: string[] }> {
  const [numstat, others] = await Promise.all([git(['diff', base, '--numstat', '--no-renames', '-z']), git(['ls-files', '--others', '--exclude-standard', '-z'])]);
  const untracked = others.split('\0').filter(Boolean);
  const files = numstat.split('\0').filter(Boolean).map((l) => {
    const [a, r, ...name] = l.split('\t');
    return { path: name.join('\t'), added: a === '-' ? null : Number(a), deleted: r === '-' ? null : Number(r) };
  });
  const saved = new Set(files.map((f) => f.path));
  const blobs = new Map<string, string>();
  let hashes: string[] = [];
  if (untracked.length) {
    const [tree, hashed] = await Promise.all([
      git(['ls-tree', '-r', '-z', base]),
      git(['hash-object', '--stdin-paths'], untracked.map((file) => JSON.stringify(file)).join('\n') + '\n'),
    ]);
    for (const entry of tree.split('\0').filter(Boolean)) {
      const tab = entry.indexOf('\t');
      blobs.set(entry.slice(tab + 1), entry.slice(0, tab).split(' ')[2]);
    }
    hashes = hashed.trim().split(/\r?\n/);
  }
  for (const [index, file] of untracked.entries()) {
    const i = files.findIndex((f) => f.path === file);
    if (i < 0) continue;
    if (blobs.get(file) === hashes[index]) { files.splice(i, 1); continue; }
    const counts = (await untrackedDiff(git, base, file, true)).trim().split('\t');
    if (counts.length < 3) files.splice(i, 1);
    else files[i] = { path: file, added: counts[0] === '-' ? null : Number(counts[0]), deleted: counts[1] === '-' ? null : Number(counts[1]) };
  }
  return { files, untracked: untracked.filter((f) => !saved.has(f)) };
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

export async function handback(git: Git, opts: { base?: string; cwd?: string } = {}): Promise<Handback> {
  const range = [opts.base ?? '--cached', '--no-renames'];
  const [statOut, rawOut, numstatOut, untrackedOut] = await Promise.all([
    git(['diff', ...range, '--stat']),
    git(['diff', ...range, '--raw', '--no-abbrev', '-z']),
    git(['diff', ...range, '--numstat', '-z']),
    git(['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const stat = statOut.trimEnd();
  const raw = rawOut.split('\0');
  const modes = new Map<string, string>();
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const m = raw[i].match(/^:(\d+) (\d+) /);
    if (m) modes.set(raw[i + 1], m[1] === '160000' || m[2] === '160000' ? 'submodule' : 'x');
  }
  const numstat = numstatOut.split('\0').filter(Boolean);
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
  const untracked = untrackedOut.split('\0').filter(Boolean);
  const message = draftMessage(files);
  const command = opts.cwd ? `git -C ${shellQuote(opts.cwd)} commit -am ${shellQuote(message)}` : `git commit -m ${shellQuote(message)}`;
  return { stat, files, untracked, message, command };
}
