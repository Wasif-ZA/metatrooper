import type { DatabaseSync } from 'node:sqlite';

/** Exited ok: outcome succeeded, or cancelled when its last state before exit, idle aside, was done (an opened card moves done to idle). */
export function finishedOk(db: DatabaseSync, sessionId: string): boolean {
  const outcome = (db.prepare('SELECT outcome FROM session WHERE id = ?').get(sessionId) as { outcome: string | null } | undefined)?.outcome;
  if (outcome === 'succeeded') return true;
  if (outcome !== 'cancelled' || !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_state_log'").get()) return false;
  const last = db.prepare("SELECT state FROM session_state_log WHERE session_id = ? AND state NOT IN ('idle', 'exited') ORDER BY rowid DESC LIMIT 1").get(sessionId) as { state: string } | undefined;
  return last?.state === 'done';
}
