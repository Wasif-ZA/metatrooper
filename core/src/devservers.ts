import { execFile } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { ancestors, parentTableAsync } from './browser/ancestry.ts';
import { anyOpen, ptyPid } from './terminal/index.ts';
import { nowIso, ulid } from './time.ts';

export const WATCH_MS = 60_000;
const TAIL = 256;
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
const URL_RE = /http:\/\/(localhost|127\.0\.0\.1|\[::1\]):(\d{1,5})(?=[^\d])([/?#][^\s'"<>`]*)?/g;

/** Every `http://localhost|127.0.0.1|[::1]:<port>` URL in terminal text, escapes removed; a URL whose port could still be cut off at the end of the text is left out. */
export function parseUrls(text: string): Array<{ url: string; port: number }> {
  const out: Array<{ url: string; port: number }> = [];
  for (const m of text.replace(ANSI, '').matchAll(URL_RE)) {
    const port = Number(m[2]);
    if (port < 1 || port > 65535) continue;
    out.push({ url: `http://${m[1]}:${port}${(m[3] ?? '/').replace(/[.,;:)\]}]+$/, '') || '/'}`, port });
  }
  return out;
}

/** Listening TCP ports on a loopback or any-address socket and their owning pids, from `netstat -ano` lines. */
export function parseNetstat(out: string): Map<number, Set<number>> {
  const ports = new Map<number, Set<number>>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+):(\d+)\s+(0\.0\.0\.0:0|\[::\]:0)\s+\S+\s+(\d+)\s*$/i.exec(line);
    if (!m || !/^(127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::\]|\[::1\])$/.test(m[1])) continue;
    const port = Number(m[2]);
    if (!ports.has(port)) ports.set(port, new Set());
    ports.get(port)!.add(Number(m[4]));
  }
  return ports;
}

/** The processes this module asks; tests replace them. */
export const probe = {
  /** `netstat -ano` output. Windows only; elsewhere it is empty. */
  netstat(): Promise<string> {
    if (process.platform !== 'win32') return Promise.resolve('');
    return new Promise((resolve) => execFile('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true, timeout: 10_000 }, (_e, out) => resolve(out || '')));
  },
  parentTableAsync,
};

/** The listening-port table now. */
export async function listening(): Promise<Map<number, Set<number>>> {
  return parseNetstat(await probe.netstat());
}

/** `had`: the port was listening at the print; null until a fresh netstat says, when the snapshot was stale at the print. */
interface Pending { session: string; project: string; port: number; url: string; had: boolean | null; until: number }

/** `ancestry` when the pid descends from the pty, `printed` when the port was not listening at the print, otherwise null. */
export function ownership(pid: number, root: number | null, parents: Map<number, number>, hadAtPrint: boolean): 'ancestry' | 'printed' | null {
  if (root && ancestors(pid, parents).includes(root)) return 'ancestry';
  return hadAtPrint ? null : 'printed';
}

const SNAPSHOT_FRESH_MS = 3000;

let snapshot = new Map<number, Set<number>>();
let snapshotAt = 0;
const pending = new Map<string, Pending>();
/** Session and port pairs decided as not owned, until when they are not watched again. */
const refused = new Map<string, number>();
const tails = new Map<string, string>();
let running: Promise<void> | null = null;
let fresh = false;
let again = false;

/** Scans one chunk of a session's terminal output for dev-server URLs and starts watching each new port. */
export function scanOutput(db: DatabaseSync, sessionId: string, data: string): void {
  const text = (tails.get(sessionId) ?? '') + data;
  tails.set(sessionId, text.slice(-TAIL));
  const urls = parseUrls(text);
  if (!urls.length) return;
  const s = db.prepare('SELECT project_id FROM session WHERE id = ? AND ended_at IS NULL').get(sessionId) as { project_id: string | null } | undefined;
  if (!s?.project_id) return;
  const ready = db.prepare("SELECT 1 FROM session_dev_server WHERE session_id = ? AND port = ? AND status = 'ready'");
  let added = false;
  for (const { url, port } of urls) {
    const key = `${sessionId}:${port}`;
    if (pending.has(key) || (refused.get(key) ?? 0) > Date.now() || ready.get(sessionId, port)) continue;
    pending.set(key, { session: sessionId, project: s.project_id, port, url, had: Date.now() - snapshotAt > SNAPSHOT_FRESH_MS ? null : snapshot.has(port), until: Date.now() + WATCH_MS });
    added = true;
  }
  if (!added) return;
  fresh = true;
  void pollDevServers(db);
}

/** Refreshes the listening-port snapshot and decides each watched URL; overlapping calls run once more after the current one. */
export function pollDevServers(db: DatabaseSync): Promise<void> {
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await decide(db).catch(() => {});
    } while (again);
  })().finally(() => { running = null; });
  return running;
}

async function decide(db: DatabaseSync): Promise<void> {
  if (!pending.size && !anyOpen()) return;
  const early = fresh ? probe.parentTableAsync() : null;
  fresh = false;
  const now = await listening();
  snapshot = now;
  snapshotAt = Date.now();
  let parents: Map<number, number> | null = null;
  for (const [key, p] of [...pending]) {
    if (Date.now() > p.until) { pending.delete(key); continue; }
    p.had ??= now.has(p.port);
    const pids = now.get(p.port);
    if (!pids?.size) continue;
    pending.delete(key);
    if (pids.size > 1) { refused.set(key, Date.now() + WATCH_MS); continue; }
    const [pid] = pids;
    parents ??= await (early ?? probe.parentTableAsync());
    if (!parents.has(pid)) parents = await probe.parentTableAsync();
    const by = ownership(pid, ptyPid(p.session), parents, p.had);
    if (!by) { refused.set(key, Date.now() + WATCH_MS); continue; }
    db.prepare("INSERT INTO session_dev_server (id, session_id, project_id, port, url, pid, matched_by, status, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?)")
      .run(`ds_${ulid()}`, p.session, p.project, p.port, p.url, pid, by, nowIso());
  }
}

/** Turns `stopped` each ready row whose session ended, whose port stopped listening, or whose port another pid now holds. */
export async function sweepDevServers(db: DatabaseSync): Promise<void> {
  const rows = db.prepare("SELECT d.id, d.port, d.pid, s.ended_at FROM session_dev_server d JOIN session s ON s.id = d.session_id WHERE d.status = 'ready'").all() as Array<{ id: string; port: number; pid: number | null; ended_at: string | null }>;
  if (!rows.length) return;
  const now = await listening();
  const stop = db.prepare("UPDATE session_dev_server SET status = 'stopped' WHERE id = ?");
  for (const r of rows) {
    const pids = now.get(r.port);
    if (r.ended_at || !pids || pids.size !== 1 || !pids.has(Number(r.pid))) stop.run(r.id);
  }
}

/** Stops a session's rows and watches when its terminal exits. */
export function devServersGone(db: DatabaseSync, sessionId: string): void {
  tails.delete(sessionId);
  for (const [key, p] of pending) if (p.session === sessionId) pending.delete(key);
  for (const key of refused.keys()) if (key.startsWith(`${sessionId}:`)) refused.delete(key);
  db.prepare("UPDATE session_dev_server SET status = 'stopped' WHERE session_id = ? AND status = 'ready'").run(sessionId);
}
