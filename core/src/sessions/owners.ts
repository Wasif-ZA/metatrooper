import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import { nowIso, ulid } from '../time.ts';

export interface ClaimFile { path: string; owners: string[]; shared: boolean }
export interface Claim { repo: string; turn_base: string | null; from: string; at: string; files: ClaimFile[] }
export interface Owner { id: string; title: string; state: string }
export interface OwnedPath { path: string; owners: Owner[]; shared: boolean; unclaimed: boolean }

const LIVE = "('starting','working','waiting_for_you','done','idle','unknown')";

export const normPath = (p: string) => (process.platform === 'win32' ? p.split('\\').join('/').toLowerCase() : p);

const gitOptions = (cwd: string, timeout: number) => ({ cwd, encoding: 'utf8' as const, windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } });

function git(cwd: string, args: string[], timeout = 5000): string {
  return execFileSync('git', args, { ...gitOptions(cwd, timeout), stdio: ['ignore', 'pipe', 'ignore'] });
}

const execFileAsync = promisify(execFile);

async function gitAsync(cwd: string, args: string[], timeout = 5000): Promise<string> {
  return (await execFileAsync('git', args, gitOptions(cwd, timeout))).stdout;
}

/** The repository root holding `cwd`, or null when it is not in a git work tree. */
export function repoOf(cwd: string | null): string | null {
  if (!cwd) return null;
  try {
    return git(cwd, ['rev-parse', '--show-toplevel']).trim() || null;
  } catch {
    return null;
  }
}

export async function repoOfAsync(cwd: string | null): Promise<string | null> {
  if (!cwd) return null;
  try {
    return (await gitAsync(cwd, ['rev-parse', '--show-toplevel'])).trim() || null;
  } catch {
    return null;
  }
}

/** The registered project whose folder holds `cwd` (the deepest one), or null. */
export function projectFor(projects: Array<{ id: string; path: string }>, cwd: string): { id: string; path: string } | null {
  const c = normPath(cwd.split('\\').join('/')).replace(/\/+$/, '');
  let best: { id: string; path: string } | null = null;
  for (const p of projects) {
    const root = normPath(p.path.split('\\').join('/')).replace(/\/+$/, '');
    if ((c === root || c.startsWith(`${root}/`)) && (!best || root.length > best.path.length)) best = { id: p.id, path: root };
  }
  return best;
}

/** Repo-relative paths changed since `turnBase`, plus untracked files modified at or after `sinceMs`. */
export function turnChanges(repo: string, turnBase: string | null, sinceMs: number): string[] {
  const out = new Set<string>();
  if (turnBase) {
    for (const f of git(repo, ['diff', '--name-only', '-z', turnBase]).split('\0')) if (f) out.add(f);
  }
  for (const f of git(repo, ['ls-files', '--others', '--exclude-standard', '-z', '--full-name']).split('\0')) {
    if (!f) continue;
    try {
      if (fs.statSync(path.join(repo, f)).mtimeMs >= sinceMs) out.add(f);
    } catch {}
  }
  return [...out].sort();
}

/** Uncommitted repo-relative paths, from `git status --porcelain -z`. */
const STATUS_ARGS = ['status', '--porcelain', '-z', '--untracked-files=all'];

export function dirtyPaths(repo: string): string[] {
  return parseStatus(git(repo, STATUS_ARGS));
}

export async function dirtyPathsAsync(repo: string): Promise<string[]> {
  return parseStatus(await gitAsync(repo, STATUS_ARGS));
}

function parseStatus(text: string): string[] {
  const parts = text.split('\0');
  const out: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const e = parts[i];
    if (e.length < 4) continue;
    out.push(e.slice(3));
    if (e[0] === 'R' || e[0] === 'C') i++;
  }
  return out;
}

/** Every claim of one repo, newest first. */
export function claimsOf(db: DatabaseSync, repo: string): Array<Claim & { session_id: string; seq: number }> {
  const key = normPath(repo);
  const rows = db.prepare(`SELECT seq, session_id, payload FROM event WHERE kind = 'core.claim' AND ${process.platform === 'win32' ? "lower(replace(json_extract(payload, '$.repo'), char(92), '/'))" : "json_extract(payload, '$.repo')"} = ? ORDER BY seq DESC`).all(key) as Array<{ seq: number; session_id: string; payload: string }>;
  const out: Array<Claim & { session_id: string; seq: number }> = [];
  for (const r of rows) {
    try {
      const c = JSON.parse(r.payload) as Claim;
      if (normPath(c.repo) === key) out.push({ ...c, session_id: r.session_id, seq: r.seq });
    } catch {}
  }
  return out;
}

/** The latest claim entry naming `file` in `repo`, with the claim's time. */
export function latestClaim(claims: Array<Claim & { session_id: string }>, file: string): (ClaimFile & { at: string }) | null {
  for (const c of claims) {
    const f = c.files.find((x) => x.path === file);
    if (f) return { ...f, at: c.at };
  }
  return null;
}

/** A session's name in notices: its terminal title (or engine and folder) and its first 8 id characters. */
export function labelOf(db: DatabaseSync, id: string, titles: Record<string, string | undefined> = {}): string {
  const s = db.prepare('SELECT engine_id, cwd FROM session WHERE id = ?').get(id) as { engine_id: string; cwd: string | null } | undefined;
  const title = titles[id] || (s ? `${s.engine_id} in ${path.basename(s.cwd ?? '') || 'its folder'}` : 'a session');
  return `${title} (${id.slice(0, 8)})`;
}

/** Adds a notice comment for a session unless one with the same key was written before. */
export function notice(db: DatabaseSync, sessionId: string, key: string, text: string): boolean {
  const tag = `[notice ${createHash('sha1').update(key).digest('hex').slice(0, 12)}]`;
  if (db.prepare("SELECT 1 FROM comment WHERE session_id = ? AND kind = 'notice' AND body LIKE ? LIMIT 1").get(sessionId, `${tag}%`)) return false;
  db.prepare("INSERT INTO comment (id, at, session_id, kind, body) VALUES (?, ?, ?, 'notice', ?)").run(ulid(), nowIso(), sessionId, `${tag} ${text}`);
  return true;
}

function lastCommitMs(repo: string, file: string): number {
  try {
    const t = git(repo, ['log', '-1', '--format=%ct', '--', file]).trim();
    return t ? Number(t) * 1000 : 0;
  } catch {
    return 0;
  }
}

interface TurnSession { id: string; cwd: string | null; turn_base: string | null; state: string }

/** Claims the files a session changed in the turn that just ended as one `core.claim` event; null outside a git repository. */
export function claimTurn(db: DatabaseSync, sessionId: string, endSeq: number, titles: Record<string, string | undefined> = {}): Claim | null {
  const s = db.prepare('SELECT id, cwd, turn_base, state FROM session WHERE id = ?').get(sessionId) as TurnSession | undefined;
  const repo = repoOf(s?.cwd ?? null);
  if (!s || !repo) return null;
  const start = db.prepare("SELECT seq, at FROM event WHERE session_id = ? AND seq < ? AND kind IN ('claude.UserPromptSubmit','core.activity','launch') ORDER BY seq DESC LIMIT 1").get(sessionId, endSeq) as { seq: number; at: string } | undefined;
  const end = db.prepare('SELECT at FROM event WHERE seq = ?').get(endSeq) as { at: string } | undefined;
  const from = start?.at ?? nowIso();
  const at = end?.at ?? nowIso();
  let changed: string[];
  try {
    const dirty = new Set(dirtyPaths(repo));
    changed = turnChanges(repo, s.turn_base, Date.parse(from)).filter((f) => dirty.has(f));
  } catch {
    return null;
  }
  const key = normPath(repo);
  const others = (db.prepare(`SELECT id, cwd, state FROM session WHERE id != ? AND state IN ${LIVE}`).all(sessionId) as Array<{ id: string; cwd: string | null; state: string }>)
    .filter((o) => { const r = repoOf(o.cwd); return r !== null && normPath(r) === key; });
  const overlapping = others.filter((o) => o.state === 'working' || o.state === 'waiting_for_you'
    || db.prepare("SELECT 1 FROM event WHERE session_id = ? AND kind LIKE 'claude.%' AND julianday(at) >= julianday(?) AND julianday(at) <= julianday(?) LIMIT 1").get(o.id, from, at));
  const hints = new Map<string, Set<string>>();
  const named = (id: string, file: string) => {
    if (!hints.has(id)) {
      const rows = db.prepare("SELECT json_extract(payload, '$.tool_input.file_path') AS f FROM event WHERE session_id = ? AND kind IN ('claude.PreToolUse','claude.PostToolUse') AND json_extract(payload, '$.tool_name') IN ('Edit','Write','MultiEdit') AND julianday(at) >= julianday(?) AND julianday(at) <= julianday(?)").all(id, from, at) as Array<{ f: string | null }>;
      hints.set(id, new Set(rows.filter((r) => typeof r.f === 'string').map((r) => normPath(path.resolve(repo, r.f!)))));
    }
    return hints.get(id)!.has(normPath(path.join(repo, file)));
  };
  const prior = claimsOf(db, repo);
  const live = new Set(others.map((o) => o.id));
  const files: ClaimFile[] = [];
  for (const f of changed) {
    let owners = [sessionId];
    if (overlapping.length) {
      const hinted = [sessionId, ...overlapping.map((o) => o.id)].filter((id) => named(id, f));
      if (hinted.length === 1 && hinted[0] !== sessionId) continue;
      if (hinted.length !== 1) owners = [sessionId, ...overlapping.map((o) => o.id)];
    }
    const before = latestClaim(prior, f);
    if (before) {
      const still = before.owners.filter((id) => live.has(id) && !owners.includes(id));
      if (still.length && lastCommitMs(repo, f) < Date.parse(before.at)) owners = [...owners, ...still];
    }
    files.push({ path: f, owners, shared: owners.length > 1 });
  }
  const claim: Claim = { repo, turn_base: s.turn_base, from, at, files };
  db.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.claim', ?, 1)").run(nowIso(), sessionId, JSON.stringify(claim));
  const byPair = new Map<string, { ids: string[]; paths: string[] }>();
  for (const f of files.filter((x) => x.shared)) {
    const ids = [...f.owners].sort();
    const k = ids.join(',');
    const g = byPair.get(k) ?? { ids, paths: [] };
    g.paths.push(f.path);
    byPair.set(k, g);
  }
  for (const g of byPair.values()) {
    for (const id of g.ids) {
      const rest = g.ids.filter((x) => x !== id).map((x) => labelOf(db, x, titles)).join(', ');
      notice(db, id, `shared:${g.ids.join(',')}:${g.paths.join(',')}`, `Also changed by session ${rest}, uncommitted: ${g.paths.join(', ')}. Edit only your own lines, and stage these files by hand.`);
    }
  }
  return claim;
}

const LOG_ARG_CHARS = 8000;

function claimedPaths(claims: Claim[], dirty: string[]): string[] {
  return dirty.filter((p) => latestClaim(claims, p));
}

/** Newest commit time in ms per path from `git log -z --name-only --format=%x01%ct`, which lists newest first. */
function parseCommitTimes(text: string, into: Map<string, number>): void {
  let at = 0;
  for (const token of text.split('\0')) {
    if (token.startsWith('\x01')) { at = Number(token.slice(1)) * 1000; continue; }
    const name = token.startsWith('\n') ? token.slice(1) : token;
    if (name && !into.has(name)) into.set(name, at);
  }
}

/** One `git log` per group of paths whose names stay under LOG_ARG_CHARS, well inside the 32,767-character Windows command line. */
function logBatches(paths: string[]): string[][] {
  const out: string[][] = [];
  const flush = (group: string[]) => out.push(['--literal-pathspecs', 'log', '-z', '--no-renames', '--name-only', '--diff-merges=dense-combined', '--format=%x01%ct', '--', ...group]);
  let group: string[] = [];
  let chars = 0;
  for (const p of paths) {
    if (group.length && chars + p.length + 3 > LOG_ARG_CHARS) { flush(group); group = []; chars = 0; }
    group.push(p);
    chars += p.length + 3;
  }
  if (group.length) flush(group);
  return out;
}

/** Last commit time in ms of each path; a path missing from the map was never committed. The whole history is walked, since --since stops at the first commit with an older date. */
export function commitTimes(repo: string, paths: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const args of logBatches(paths)) {
    try { parseCommitTimes(git(repo, args), out); } catch {}
  }
  return out;
}

export async function commitTimesAsync(repo: string, paths: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const args of logBatches(paths)) {
    try { parseCommitTimes(await gitAsync(repo, args), out); } catch {}
  }
  return out;
}

/** Owner of each uncommitted path in `repo`: the latest claim naming it, unless the path was committed after that claim. */
export function owners(db: DatabaseSync, repo: string, titles: Record<string, string | undefined> = {}): OwnedPath[] {
  const claims = claimsOf(db, repo);
  const dirty = dirtyPaths(repo);
  return ownersFrom(db, claims, dirty, commitTimes(repo, claimedPaths(claims, dirty)), titles);
}

export async function ownersAsync(db: DatabaseSync, repo: string, titles: Record<string, string | undefined> = {}): Promise<OwnedPath[]> {
  const dirty = await dirtyPathsAsync(repo);
  const claims = claimsOf(db, repo);
  return ownersFrom(db, claims, dirty, await commitTimesAsync(repo, claimedPaths(claims, dirty)), titles);
}

/** owners() once the git facts are in hand: `times` holds each claimed path's last commit time in ms. */
export function ownersFrom(db: DatabaseSync, claims: Claim[], dirty: string[], times: Map<string, number>, titles: Record<string, string | undefined> = {}): OwnedPath[] {
  const session = db.prepare('SELECT state FROM session WHERE id = ?');
  return dirty.map((p) => {
    const c = latestClaim(claims, p);
    if (!c || (times.get(p) ?? 0) >= Date.parse(c.at)) return { path: p, owners: [], shared: false, unclaimed: true };
    const list = c.owners.map((id) => ({ id, title: labelOf(db, id, titles), state: (session.get(id) as { state: string } | undefined)?.state ?? 'unknown' }));
    return { path: p, owners: list, shared: c.shared, unclaimed: false };
  });
}

/** For the PreToolUse hook: the live session other than `sessionId` that holds `file` in its latest claim, read from claims only. */
export function otherOwner(db: DatabaseSync, sessionId: string, file: string, cwd: string): { id: string; state: string; at: string } | null {
  const abs = normPath(path.resolve(cwd, file));
  const like = `%${path.basename(abs).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = db.prepare("SELECT session_id, payload FROM event WHERE kind = 'core.claim' AND payload LIKE ? ESCAPE '\\' ORDER BY seq DESC").all(like) as Array<{ session_id: string; payload: string }>;
  for (const r of rows) {
    let c: Claim;
    try { c = JSON.parse(r.payload); } catch { continue; }
    const f = c.files.find((x) => normPath(path.join(c.repo, x.path)) === abs);
    if (!f) continue;
    for (const id of f.owners) {
      if (id === sessionId) continue;
      const s = db.prepare(`SELECT state FROM session WHERE id = ? AND state IN ${LIVE}`).get(id) as { state: string } | undefined;
      if (s) return { id, state: s.state, at: c.at };
    }
    return null;
  }
  return null;
}
