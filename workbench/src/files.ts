import fs from 'node:fs';
import path from 'node:path';

export const MAX_FILE_BYTES = 512 * 1024;
const HIDDEN = new Set(['.git']);

/** The real path of `rel` under `root`, or null when it is missing or resolves outside the root (.. or a link). */
function inside(root: string, rel: string): string | null {
  if (typeof rel !== 'string' || rel.includes('\0')) return null;
  try {
    const base = fs.realpathSync(root);
    const full = fs.realpathSync(path.resolve(base, rel));
    return full === base || full.startsWith(base + path.sep) ? full : null;
  } catch {
    return null;
  }
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

/** A text file's content; `{ error }` for a path outside the root, a folder, a file over MAX_FILE_BYTES or one with a NUL byte. */
export function readText(root: string, rel: string): { text: string } | { error: string } {
  const full = inside(root, rel);
  if (!full) return { error: 'not a file in this project' };
  let stat: fs.Stats;
  try { stat = fs.statSync(full); } catch { return { error: 'not a file in this project' }; }
  if (!stat.isFile()) return { error: 'not a file in this project' };
  if (stat.size > MAX_FILE_BYTES) return { error: `too large to show (${Math.round(stat.size / 1024)} KiB)` };
  const buf = fs.readFileSync(full);
  if (buf.includes(0)) return { error: 'not a text file' };
  return { text: buf.toString('utf8') };
}
