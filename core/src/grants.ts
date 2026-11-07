import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from './time.ts';

/** What the UI Automation helper reports about one window; `root` is its `GetAncestor(GA_ROOT)`. */
export interface WindowInfo {
  alive: boolean;
  hwnd: number;
  root: number;
  pid: number;
  process_start: string;
  exe: string;
  /** The full image path, '' when it cannot be read. */
  exe_path?: string;
  title: string;
  class: string;
  owner_chain: number[];
  file_dialog: boolean;
  elevated: boolean;
  rect: number[];
  minimized: boolean;
}

export interface GrantRow {
  id: string;
  session_id: string;
  hwnd: number;
  pid: number;
  process_start: string;
  exe: string;
  title: string;
  created_at: string;
  ended_at: string | null;
}

function metaGet(db: DatabaseSync, key: string): string | null {
  return (db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
}

function metaMap(db: DatabaseSync, key: string): Record<string, string> {
  try { return JSON.parse(metaGet(db, key) ?? '{}') ?? {}; } catch { return {}; }
}

function metaSetMap(db: DatabaseSync, key: string, map: Record<string, string>): void {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, JSON.stringify(map));
}

/** The take-over flag (D62) or a pin drift: paused unless the session's own resume time is later than the pause time. */
export function takeoverPaused(db: DatabaseSync, sessionId: string): boolean {
  const resumed = metaMap(db, 'takeover_resumed');
  const at = metaGet(db, 'takeover_paused_at');
  if (at && (!resumed[sessionId] || resumed[sessionId] <= at)) return true;
  const drift = metaMap(db, 'drift_paused')[sessionId];
  return Boolean(drift) && (!resumed[sessionId] || resumed[sessionId] <= drift);
}

/** Whole-string, case-sensitive match where `*` is any run of characters and the rest is literal. */
export function titleMatches(pattern: string, title: string): boolean {
  return new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s\\S]*')}$`).test(title);
}

export function grantPin(db: DatabaseSync, grantId: string): string | null {
  return metaMap(db, 'grant_pins')[grantId] ?? null;
}

export function setGrantPin(db: DatabaseSync, grantId: string, pattern: string | null): void {
  const pins = metaMap(db, 'grant_pins');
  if (pattern === null) delete pins[grantId]; else pins[grantId] = pattern;
  metaSetMap(db, 'grant_pins', pins);
}

/** Whether the grant is pinned and the window title no longer matches. */
export function pinDrifted(db: DatabaseSync, g: GrantRow, title: string): boolean {
  const pin = grantPin(db, g.id);
  return pin !== null && !titleMatches(pin, title);
}

/** Pauses the session until the user resumes it. */
export function pauseForDrift(db: DatabaseSync, sessionId: string): void {
  const d = metaMap(db, 'drift_paused');
  d[sessionId] = nowIso();
  metaSetMap(db, 'drift_paused', d);
}

/** The grant's own window, alive, with the pid and process start the grant was made with. */
export function sameWindow(g: GrantRow, w: WindowInfo): boolean {
  return w.alive && w.root === g.hwnd && w.pid === g.pid && w.process_start === g.process_start;
}

/** The grant covers the window itself and every window whose owner chain reaches it, same pid and process start. */
export function covers(g: GrantRow, w: WindowInfo): boolean {
  return w.alive && !w.elevated && (w.root === g.hwnd || w.owner_chain.includes(g.hwnd)) && w.pid === g.pid && w.process_start === g.process_start;
}

export function liveGrants(db: DatabaseSync, sessionId?: string): GrantRow[] {
  const rows = sessionId
    ? db.prepare('SELECT * FROM grant WHERE ended_at IS NULL AND session_id = ? ORDER BY julianday(created_at), id').all(sessionId)
    : db.prepare('SELECT * FROM grant WHERE ended_at IS NULL ORDER BY julianday(created_at), id').all();
  return rows as unknown as GrantRow[];
}

export function endGrant(db: DatabaseSync, id: string): boolean {
  if (grantPin(db, id) !== null) setGrantPin(db, id, null);
  return Number(db.prepare('UPDATE grant SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(nowIso(), id).changes) > 0;
}

/** Ends every live grant; run on core start, since grants never survive a restart. */
export function endAllGrants(db: DatabaseSync): void {
  db.prepare('UPDATE grant SET ended_at = ? WHERE ended_at IS NULL').run(nowIso());
}

/** Ends grants whose session has ended. */
export function endOrphanGrants(db: DatabaseSync): void {
  db.prepare('UPDATE grant SET ended_at = ? WHERE ended_at IS NULL AND session_id IN (SELECT id FROM session WHERE ended_at IS NOT NULL)').run(nowIso());
}
