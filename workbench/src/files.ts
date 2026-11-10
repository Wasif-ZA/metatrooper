import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runIn } from './gitpane.ts';

export const MAX_FILE_BYTES = 512 * 1024;
const HIDDEN = new Set(['.git']);
const NOT_FILE = { error: 'not a file in this project' };

/** The real path of `rel` under `root`, or null when it is missing, resolves outside the root (.. or a link) or into .git. */
export function inside(root: string, rel: string): string | null {
  if (typeof rel !== 'string' || rel.includes('\0')) return null;
  try {
    const base = fs.realpathSync(root);
    const full = fs.realpathSync(path.resolve(base, rel));
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    return touchesGit(path.relative(fs.realpathSync.native(base), fs.realpathSync.native(full))) ? null : full;
  } catch {
    return null;
  }
}

/** True when any segment names .git; Windows also reaches it as `.git.`, `.git ` and the short name `GIT~1`. */
function touchesGit(p: string): boolean {
  return p.split(/[\\/]/).some((s) => s.replace(/[. ]+$/, '').toLowerCase() === '.git' || /^git~\d+$/i.test(s));
}

/** A path a write may name: relative, no .git, and no Windows trap (a stream colon, a trailing dot or space, a device name). */
function writable(rel: unknown): rel is string {
  return typeof rel === 'string' && !!rel && rel.length < 4096 && !/[\0:<>"|?*]/.test(rel) && !path.isAbsolute(rel) && !touchesGit(rel)
    && rel.split(/[\\/]/).every((s) => !/[. ]$/.test(s) || s === '.' || s === '..') && !rel.split(/[\\/]/).some((s) => /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s));
}

/** Opens the real path once, then proves the handle is that regular file and the path still resolves to it inside the root. */
function openChecked(root: string, rel: string, flags: 'r' | 'r+'): { fd: number; stat: fs.Stats; full: string } | null {
  const full = inside(root, rel);
  if (!full) return null;
  let fd: number;
  try { fd = fs.openSync(full, flags); } catch { return null; }
  try {
    const stat = fs.fstatSync(fd);
    const now = fs.statSync(full, { bigint: true });
    const held = fs.fstatSync(fd, { bigint: true });
    const same = held.dev === now.dev && held.ino === now.ino;
    if (stat.isFile() && same && inside(root, rel) === full) return { fd, stat, full };
  } catch {}
  fs.closeSync(fd);
  return null;
}

/** One folder's entries, folders first then by name; null when `rel` is not a folder inside the root. */
export function listDir(root: string, rel: string): Array<{ name: string; dir: boolean }> | null {
  const full = inside(root, rel);
  if (!full) return null;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(full, { withFileTypes: true }); } catch { return null; }
  return entries.filter((e) => !HIDDEN.has(e.name) && (e.isDirectory() || e.isFile()))
    .map((e) => ({ name: e.name, dir: e.isDirectory() }))
    .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
}

export function openOutside(root: string, rel: string): string | { error: string } {
  const full = inside(root, rel);
  if (!full) return NOT_FILE;
  if (!/^(pdf|png|jpg|jpeg|gif|webp|svg|html|htm)$/i.test(path.extname(full).slice(1))) return { error: 'this file type cannot be opened outside' };
  try {
    return fs.statSync(full).isFile() ? full : NOT_FILE;
  } catch {
    return NOT_FILE;
  }
}

function readAll(fd: number, size: number): Buffer {
  const buf = Buffer.alloc(size);
  let n = 0;
  while (n < size) {
    const got = fs.readSync(fd, buf, n, size - n, n);
    if (!got) break;
    n += got;
  }
  return buf.subarray(0, n);
}

/** A text file's content and mtime, read through one checked handle; `{ error }` outside the root, a folder, over MAX_FILE_BYTES or with a NUL byte. */
export function readText(root: string, rel: string): { text: string; mtimeMs: number } | { error: string } {
  const h = openChecked(root, rel, 'r');
  if (!h) return NOT_FILE;
  try {
    if (h.stat.size > MAX_FILE_BYTES) return { error: `too large to show (${Math.round(h.stat.size / 1024)} KiB)` };
    const buf = readAll(h.fd, h.stat.size);
    if (buf.includes(0)) return { error: 'not a text file' };
    return { text: buf.toString('utf8'), mtimeMs: h.stat.mtimeMs };
  } catch {
    return NOT_FILE;
  } finally {
    fs.closeSync(h.fd);
  }
}

/** `text` with LF endings and no BOM, then the old file's CRLF (if it has any) and BOM put back. */
function keepStyle(old: Buffer, text: string): string {
  const s = old.toString('utf8');
  const out = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  return (s.startsWith('﻿') ? '﻿' : '') + (s.includes('\r\n') ? out.replace(/\n/g, '\r\n') : out);
}

/** Saves `text` over an existing file through one checked handle; `baseMtimeMs` null skips the changed-on-disk check. */
export function writeText(root: string, rel: unknown, text: unknown, baseMtimeMs: unknown): { ok: true; mtimeMs: number } | { error: string; conflict?: true } {
  if (typeof rel !== 'string' || typeof text !== 'string' || rel.includes('\0') || text.includes('\0')) return { error: 'bad file or text' };
  if (Buffer.byteLength(text, 'utf8') > MAX_FILE_BYTES) return { error: `too large to save (over ${MAX_FILE_BYTES / 1024} KiB)` };
  if (touchesGit(rel)) return { error: 'git internals cannot be edited' };
  if (!writable(rel)) return NOT_FILE;
  const h = openChecked(root, rel, 'r+');
  if (!h) return NOT_FILE;
  try {
    if (typeof baseMtimeMs === 'number' && baseMtimeMs !== h.stat.mtimeMs) return { error: 'changed on disk', conflict: true };
    if (h.stat.size > MAX_FILE_BYTES) return { error: 'too large to save' };
    const old = readAll(h.fd, h.stat.size);
    if (old.includes(0)) return { error: 'not a text file' };
    const bytes = Buffer.from(keepStyle(old, text), 'utf8');
    if (bytes.length > MAX_FILE_BYTES) return { error: 'too large to save' };
    let n = 0;
    while (n < bytes.length) n += fs.writeSync(h.fd, bytes, n, bytes.length - n, n);
    fs.ftruncateSync(h.fd, bytes.length);
    fs.fsyncSync(h.fd);
    return { ok: true, mtimeMs: fs.fstatSync(h.fd).mtimeMs };
  } catch (e) {
    return { error: `could not save: ${(e as Error).message.split('\n')[0]}` };
  } finally {
    fs.closeSync(h.fd);
  }
}

/** The real parent folder inside the root and the new entry's name, for a path that does not exist yet. */
function newEntry(root: string, rel: unknown): { dir: string; name: string } | null {
  if (!writable(rel)) return null;
  const name = path.basename(rel);
  if (!name || name === '.' || name === '..') return null;
  const dir = inside(root, path.dirname(rel));
  if (!dir) return null;
  try { fs.lstatSync(path.join(dir, name)); return null; } catch {}
  return { dir, name };
}

/** Makes an empty file or one folder; never overwrites and never makes missing parents. */
export function createEntry(root: string, rel: unknown, kind: unknown): { ok: true } | { error: string } {
  const e = newEntry(root, rel);
  if (!e || (kind !== 'file' && kind !== 'dir')) return { error: 'cannot create that here' };
  try {
    if (kind === 'dir') fs.mkdirSync(path.join(e.dir, e.name));
    else fs.closeSync(fs.openSync(path.join(e.dir, e.name), 'wx'));
    return { ok: true };
  } catch (err) {
    return { error: `could not create: ${(err as Error).message.split('\n')[0]}` };
  }
}

/** Renames or moves an entry inside the root; the target must not exist yet. */
export function renameEntry(root: string, from: unknown, to: unknown): { ok: true } | { error: string } {
  if (!writable(from)) return { error: 'cannot rename that' };
  const src = inside(root, from);
  const e = newEntry(root, to);
  if (!src || !e || src === fs.realpathSync(root)) return { error: 'cannot rename that' };
  try {
    // ponytail: target checked then renamed, a file made in between is replaced; fine for one user's editor.
    fs.renameSync(src, path.join(e.dir, e.name));
    return { ok: true };
  } catch (err) {
    return { error: `could not rename: ${(err as Error).message.split('\n')[0]}` };
  }
}

export interface SearchHit { path: string; line: number; text: string }
const MAX_HITS = 200;
const cut = (s: string) => s.trim().slice(0, 240);

/** Case-insensitive fixed-string search over tracked and untracked-not-ignored files: ripgrep, else git grep. */
export async function searchText(root: string, query: unknown): Promise<{ hits: SearchHit[]; more: boolean }> {
  if (typeof query !== 'string' || query.length < 2 || query.length > 200 || query.includes('\0')) return { hits: [], more: false };
  try {
    return await rgSearch(root, query);
  } catch {
    return gitSearch(root, query);
  }
}

function rgSearch(root: string, query: string): Promise<{ hits: SearchHit[]; more: boolean }> {
  return new Promise((resolve, reject) => {
    const args = ['--json', '--no-config', '-F', '-i', '--hidden', '-g', '!.git', '--max-count', '50', '--max-filesize', '2M', '--path-separator', '/', '-e', query];
    const rg = spawn('rg', args, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }).on('error', (e) => { clearTimeout(timer); if (!started) reject(e); else resolve({ hits, more }); });
    const hits: SearchHit[] = [];
    let more = false;
    let rest = '';
    let started = false;
    const timer = setTimeout(() => { more = true; rg.kill(); }, 10_000);
    rg.on('spawn', () => { started = true; });
    rg.stdout.setEncoding('utf8');
    rg.stdout.on('data', (chunk: string) => {
      const lines = (rest + chunk).split('\n');
      rest = lines.pop() ?? '';
      for (const l of lines) {
        if (more) return;
        let m: { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string } } };
        try { m = JSON.parse(l); } catch { continue; }
        if (m.type !== 'match' || !m.data?.path?.text || !m.data.line_number) continue;
        if (hits.length === MAX_HITS) { more = true; rg.kill(); return; }
        hits.push({ path: m.data.path.text.replace(/^\.\//, ''), line: m.data.line_number, text: cut(m.data.lines?.text ?? '') });
      }
    });
    rg.on('close', () => { clearTimeout(timer); resolve({ hits, more }); });
  });
}

async function gitSearch(root: string, query: string): Promise<{ hits: SearchHit[]; more: boolean }> {
  let out: string;
  try {
    out = await runIn(root)(['grep', '-n', '-I', '-F', '-i', '--untracked', '--no-color', '-z', '-e', query]);
  } catch (e) {
    out = (e as { stdout?: string }).stdout ?? '';
  }
  const hits: SearchHit[] = [];
  for (const l of out.split('\n')) {
    const [file, line, ...text] = l.split('\0');
    if (!file || !line || !Number(line)) continue;
    if (hits.length === MAX_HITS) return { hits, more: true };
    hits.push({ path: file.replace(/\\/g, '/'), line: Number(line), text: cut(text.join('\0')) });
  }
  return { hits, more: false };
}

/** Up to `limit` paths that contain every word of `query`, best first: name starts with it, name contains it, then path contains it; shorter paths win ties. */
export function rankFiles(paths: string[], query: string, limit = 50): string[] {
  const words = query.toLowerCase().split(/[ ]+/).filter(Boolean);
  if (!words.length) return [];
  const scored: Array<[number, string]> = [];
  for (const p of paths) {
    const low = p.toLowerCase();
    if (!words.every((w) => low.includes(w))) continue;
    const name = low.slice(low.lastIndexOf('/') + 1);
    scored.push([name.startsWith(words[0]) ? 0 : name.includes(words[0]) ? 1 : 2, p]);
  }
  return scored.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1])).slice(0, limit).map((x) => x[1]);
}
