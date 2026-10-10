import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BS = String.fromCharCode(92);

export function canonicalPath(p: string): string {
  let s = p.split(BS).join('/');
  s = s.replace(/^([A-Za-z]):/, (_m, d: string) => d.toLowerCase() + ':');
  while (s.length > 1 && s.endsWith('/') && !/^[a-z]:\/$/.test(s)) s = s.slice(0, -1);
  if (/^[a-z]:$/.test(s)) s += '/';
  return s;
}

export function projectId(canonical: string): string {
  return crypto.createHash('sha1').update(canonical).digest('hex');
}

function lower(p: string): string {
  return canonicalPath(p).toLowerCase();
}

function within(p: string, root: string): boolean {
  return p === root || p.startsWith(root.endsWith('/') ? root : root + '/');
}

/** The folder one and two levels above a canonical path. */
function parents(p: string): string[] {
  const one = p.slice(0, Math.max(p.lastIndexOf('/'), 0));
  return [one, one.slice(0, Math.max(one.lastIndexOf('/'), 0))].filter(Boolean).map(canonicalPath);
}

function roots(paths: unknown[]): string[] {
  return paths.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map(lower);
}

// ponytail: contains looks one and two levels down only; a folder further above an ask path is still allowed
/** True when the folder is in an ask path, or an ask path sits one or two levels below it (D46, M5-D7). */
export function isAskPath(p: string, paths: unknown[]): boolean {
  const d = lower(p);
  return roots(paths).some((r) => within(d, r) || parents(r).includes(d));
}

/** True when the folder sits under a tree holding an ask path, short of the drive or filesystem root (D48). */
export function nearAskPath(p: string, paths: unknown[]): boolean {
  const d = lower(p);
  return roots(paths).some((r) => parents(r).some((a) => a.lastIndexOf('/') > 2 && within(d, a)));
}

export function resolveProjectPath(input: string): string {
  const real = fs.realpathSync.native(input);
  let top = real;
  try {
    const out = execFileSync('git', ['-C', real, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    if (out) top = fs.realpathSync.native(out);
  } catch {
    // not a git repo: the folder itself is the project
  }
  return canonicalPath(top);
}
