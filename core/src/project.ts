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

export function isAcuPath(p: string): boolean {
  return /(^|\/)work\/acu(\/|$)/i.test(p.split(BS).join('/'));
}

function child(dir: string, name: string): string | null {
  try {
    const e = fs.readdirSync(dir, { withFileTypes: true }).find((d) => d.isDirectory() && d.name.toLowerCase() === name);
    return e ? `${dir}/${e.name}` : null;
  } catch {
    return null;
  }
}

// ponytail: checks one and two levels down only; a folder further above work/ACU is still allowed
export function containsAcu(canonical: string): boolean {
  if (/(^|\/)work$/i.test(canonical) && child(canonical, 'acu')) return true;
  const work = child(canonical, 'work');
  return Boolean(work && child(work, 'acu'));
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
