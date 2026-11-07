import type { DatabaseSync } from 'node:sqlite';
import { E, RpcError } from '../pipe/errors.ts';
import { nowIso } from '../time.ts';

export const ACTION_HELD = 'this risky action has an unresolved outcome; it is held until its result is verified or the user releases it';

export function actionHeld(db: DatabaseSync, hash: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM desktop_action_outcome WHERE action_hash = ? AND status IN ('pending', 'unverifiable')").get(hash));
}

export function beginRiskyAction(db: DatabaseSync, hash: string, sessionId: string, target: string, window: number, titleHash: string | null): void {
  const row = db.prepare(`INSERT INTO desktop_action_outcome (action_hash, session_id, target, status, updated_at, window, verify_title_hash) VALUES (?, ?, ?, 'pending', ?, ?, ?)
    ON CONFLICT(action_hash) DO UPDATE SET status = 'pending', updated_at = excluded.updated_at, window = excluded.window, verify_title_hash = excluded.verify_title_hash
    WHERE desktop_action_outcome.status IN ('confirmed', 'released')`).run(hash, sessionId, target, nowIso(), window, titleHash);
  if (!Number(row.changes)) throw new RpcError(E.PANE_NOT_OWNED, ACTION_HELD);
}

export function finishRiskyAction(db: DatabaseSync, hash: string, status: unknown): void {
  db.prepare("UPDATE desktop_action_outcome SET status = ?, updated_at = ? WHERE action_hash = ? AND status = 'pending'")
    .run(status === 'confirmed' ? 'confirmed' : 'unverifiable', nowIso(), hash);
}

export function releaseRiskyAction(db: DatabaseSync, sessionId: string, hash: string): { status: string } {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new RpcError(E.INVALID_PARAMS, 'action_hash must be a sha256 hex hash');
  const row = db.prepare("UPDATE desktop_action_outcome SET status = 'released', updated_at = ? WHERE session_id = ? AND action_hash = ? AND status = 'unverifiable'")
    .run(nowIso(), sessionId, hash);
  if (!Number(row.changes)) throw new RpcError(E.GATE_STALE, 'no completed held action matches this session and hash');
  return { status: 'released' };
}
