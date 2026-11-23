import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { homeDir, logsDir } from '../paths.ts';
import { MIN_SECRET_LENGTH } from '../redact.ts';
import { deleteSecret, setBrowserSecret } from '../secrets.ts';
import { nowIso } from '../time.ts';
import { BROWSER_SECRETS, browserSecretOrigin, originFile, SECRET_NAME } from './secret-origin.ts';

// M8-50: logins from a password CSV the user exported from their browser (orch1124/b3/import-logins-review.md, option C).
// cc never reads a browser profile. Each login becomes origin-bound browser secrets the agent can type but never read.
export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;
export const MAX_SECRETS = 500;
export const PREFIX = 'login_';
export const USER_PREFIX = 'loginuser_';
const userName = (name: string) => USER_PREFIX + name.slice(PREFIX.length);

export interface LoginRow { url: string; username: string; password: string }
export interface PreviewRow { i: number; origin: string | null; username: string; name: string | null; exists: boolean; skip: string | null }

/** Parses a browser's password export: a header row naming url, username and password (Chrome, Edge and Firefox use these names). Throws on a file that is too big or has no such columns. */
export function parseLoginCsv(text: string): LoginRow[] {
  if (Buffer.byteLength(text, 'utf8') > MAX_CSV_BYTES) throw new Error('the file is over 5 MB');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let k = 0; k < text.length; k++) {
    const c = text[k];
    if (quoted) {
      if (c === '"' && text[k + 1] === '"') { cell += '"'; k++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[k + 1] === '\n') k++;
      row.push(cell); cell = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) throw new Error(`the file has over ${MAX_ROWS} rows`);
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  const head = (rows.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/^﻿/, ''));
  const col = (n: string) => head.indexOf(n);
  const [u, n, p] = [col('url'), col('username'), col('password')];
  if (u < 0 || n < 0 || p < 0) throw new Error('this is not a password export: it needs url, username and password columns');
  return rows.slice(0, MAX_ROWS).map((r) => ({ url: r[u] ?? '', username: r[n] ?? '', password: r[p] ?? '' }));
}

/** The origin a login may be typed into: https, or http on localhost or 127.0.0.1; null otherwise. */
export function loginOrigin(url: string): string | null {
  try {
    const x = new URL(url);
    if (x.protocol === 'https:' && x.hostname && !/^\d+\.\d+\.\d+\.\d+$|^\[/.test(x.hostname)) return x.origin;
    if (x.protocol === 'http:' && (x.hostname === 'localhost' || x.hostname === '127.0.0.1')) return x.origin;
  } catch {}
  return null;
}

function savedNames(): string[] {
  const dir = path.join(homeDir(), 'secrets', BROWSER_SECRETS);
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.dpapi')).map((f) => f.slice(0, -'.dpapi'.length)) : [];
}

/** What an import would do, row by row, with no password in it: origin, username, the secret name, whether it exists, and why a row is skipped. */
export function previewLogins(rows: LoginRow[], existing = new Set(savedNames())): PreviewRow[] {
  const taken = new Map<string, number>();
  return rows.map((r, i) => {
    const origin = loginOrigin(r.url);
    const skip = !origin ? 'not an https site (or http on localhost)' : r.password.length < MIN_SECRET_LENGTH ? `password shorter than ${MIN_SECRET_LENGTH} characters` : null;
    if (skip) return { i, origin, username: r.username.slice(0, 200), name: null, exists: false, skip };
    const host = new URL(origin!).host.replace(/[^A-Za-z0-9]/g, '_').slice(0, 48);
    const n = (taken.get(host) ?? 0) + 1;
    taken.set(host, n);
    const name = `${PREFIX}${host}${n > 1 ? `_${n}` : ''}`;
    return { i, origin, username: r.username.slice(0, 200), name, exists: existing.has(name), skip: null };
  });
}

/** Saves the ticked rows as browser secrets (password as login_<host>, username as loginuser_<host> when long enough to scrub); an existing secret is replaced only when ticked to replace. */
export function importLogins(db: DatabaseSync, rows: LoginRow[], picks: Array<{ i: number; replace?: boolean }>): { imported: number; origins: string[]; skipped: Array<{ i: number; why: string }> } {
  const plan = previewLogins(rows);
  const skipped: Array<{ i: number; why: string }> = [];
  const origins = new Set<string>();
  let room = MAX_SECRETS - savedNames().length;
  let imported = 0;
  for (const pick of picks) {
    const p = plan[pick.i];
    if (!p) { skipped.push({ i: pick.i, why: 'no such row' }); continue; }
    if (p.skip) { skipped.push({ i: p.i, why: p.skip }); continue; }
    if (p.exists && !pick.replace) { skipped.push({ i: p.i, why: 'kept the saved login' }); continue; }
    const withUser = rows[p.i].username.length >= MIN_SECRET_LENGTH;
    if (room < (withUser ? 2 : 1)) { skipped.push({ i: p.i, why: `cc keeps at most ${MAX_SECRETS} browser secrets` }); continue; }
    setBrowserSecret(db, p.name!, p.origin!, rows[p.i].password);
    room--;
    if (withUser) { setBrowserSecret(db, userName(p.name!), p.origin!, rows[p.i].username); room--; }
    origins.add(p.origin!);
    imported++;
  }
  fs.mkdirSync(logsDir(), { recursive: true });
  fs.appendFileSync(path.join(logsDir(), 'logins.log'), JSON.stringify({ at: nowIso(), imported, skipped: skipped.length, origins: [...origins] }) + '\n');
  return { imported, origins: [...origins], skipped };
}

/** The imported logins: name and origin, never a value. */
export function listLogins(): Array<{ name: string; origin: string | null; user: boolean }> {
  const names = savedNames();
  return names.filter((n) => n.startsWith(PREFIX)).sort().map((name) => ({ name, origin: browserSecretOrigin(name), user: names.includes(userName(name)) }));
}

/** Removes an imported login and its username secret. */
export function removeLogin(name: string): void {
  if (!SECRET_NAME.test(name) || !name.startsWith(PREFIX)) throw new Error('not an imported login');
  for (const n of [name, userName(name)]) {
    deleteSecret(BROWSER_SECRETS, n);
    fs.rmSync(originFile(n), { force: true });
  }
}
