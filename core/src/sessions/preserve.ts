import fs from 'node:fs';
import path from 'node:path';
import { canonical } from '../paths.ts';
import { E, RpcError } from '../pipe/errors.ts';
import { gitAsync } from './owners.ts';

export function validatePreserve(patterns: string[]): void {
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || !pattern.trim() || path.posix.isAbsolute(pattern) || path.win32.isAbsolute(pattern) || /^[a-z]:/i.test(pattern) || pattern.includes('..')) {
      throw new RpcError(E.VALIDATION, `invalid preserve pattern: ${pattern === '' ? '(empty)' : String(pattern)}`);
    }
  }
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(canonical(root), canonical(file));
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

async function refuseLinks(root: string, file: string): Promise<void> {
  if (!inside(root, file)) throw new RpcError(E.VALIDATION, `preserve path outside tree: ${file}`);
  let current = file;
  while (current !== root) {
    try {
      if ((await fs.promises.lstat(current)).isSymbolicLink()) throw new RpcError(E.VALIDATION, `preserve symlink refused: ${current}`);
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const parent = path.dirname(current);
    if (parent === current) throw new RpcError(E.VALIDATION, `preserve path outside tree: ${file}`);
    current = parent;
  }
}

export async function preserveFiles(source: string, destination: string, patterns: string[]): Promise<void> {
  validatePreserve(patterns);
  if (!patterns.length) return;
  source = path.resolve(source);
  destination = path.resolve(destination);
  const files = new Set<string>();
  for (const flags of [['--ignored'], []]) {
    const output = await gitAsync(source, ['ls-files', '--others', '--exclude-standard', ...flags, '-z'], 60_000, {}, false);
    for (const file of output.split('\0')) if (file && patterns.some((pattern) => path.matchesGlob(file, pattern))) files.add(file);
  }
  for (const file of files) {
    const from = path.resolve(source, file), to = path.resolve(destination, file);
    await refuseLinks(source, from);
    await refuseLinks(destination, to);
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    await refuseLinks(destination, to);
    await fs.promises.copyFile(from, to);
  }
}
