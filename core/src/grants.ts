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
    ? db.prepare('SELECT * FROM grant WHERE ended_at IS NULL AND session_id = ? ORDER BY created_at').all(sessionId)
    : db.prepare('SELECT * FROM grant WHERE ended_at IS NULL ORDER BY created_at').all();
  return rows as unknown as GrantRow[];
}

export function endGrant(db: DatabaseSync, id: string): boolean {
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
