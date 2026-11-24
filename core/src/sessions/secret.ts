import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** sha256 of each live session's launch secret, mapped to the session and the approval it was launched with. The hash (never the secret) is also kept on the session row, so a running session keeps its proof after a core restart. */
const byHash = new Map<string, { session: string; approval: string }>();
const bySession = new Map<string, string>();

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

let store: DatabaseSync | null = null;
/** The core's database, where the hashes are kept; tests that never call it stay memory only. */
export function useSecretStore(db: DatabaseSync | null): void { store = db; }

/** A fresh secret for the session's environment; any earlier one for the same session stops working. */
export function issueSecret(sessionId: string, approval: string): string {
  dropSecret(sessionId);
  const secret = randomBytes(32).toString('hex');
  const h = hash(secret);
  byHash.set(h, { session: sessionId, approval });
  bySession.set(sessionId, h);
  try { store?.prepare('UPDATE session SET secret_hash = ? WHERE id = ?').run(h, sessionId); } catch {}
  return secret;
}

/** The session a secret belongs to and its approval, or null for an unknown secret. */
export function proveSecret(secret: string): { session: string; approval: string } | null {
  const h = hash(secret);
  const known = byHash.get(h);
  if (known) return known;
  // after a restart: a live session's row still holds the hash and the profile it was launched with
  let row: { id: string; approval: string | null } | undefined;
  try { row = store?.prepare("SELECT id, approval FROM session WHERE secret_hash = ? AND ended_at IS NULL AND state != 'exited'").get(h) as typeof row; } catch {}
  if (!row) return null;
  const found = { session: row.id, approval: row.approval ?? 'ask' };
  byHash.set(h, found);
  bySession.set(row.id, h);
  return found;
}

/** The approval profile a live session was launched with, or null when it holds no secret. */
export function approvalOf(sessionId: string): string | null {
  const h = bySession.get(sessionId);
  const known = h ? byHash.get(h)?.approval : undefined;
  if (known) return known;
  // a live session launched with a secret keeps its profile on its row (B2 review of f4a98bef, N2)
  try {
    const row = store?.prepare("SELECT approval FROM session WHERE id = ? AND secret_hash IS NOT NULL AND ended_at IS NULL AND state != 'exited'").get(sessionId) as { approval: string | null } | undefined;
    return row ? row.approval ?? 'ask' : null;
  } catch { return null; }
}

export function dropSecret(sessionId: string): void {
  const h = bySession.get(sessionId);
  if (h) byHash.delete(h);
  bySession.delete(sessionId);
  try { store?.prepare('UPDATE session SET secret_hash = NULL WHERE id = ?').run(sessionId); } catch {}
}
