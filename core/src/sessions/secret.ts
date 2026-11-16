import { createHash, randomBytes } from 'node:crypto';

/** sha256 of each live session's launch secret, mapped to the session and the approval it was launched with; memory only. */
const byHash = new Map<string, { session: string; approval: string }>();
const bySession = new Map<string, string>();

const hash = (secret: string) => createHash('sha256').update(secret).digest('hex');

/** A fresh secret for the session's environment; any earlier one for the same session stops working. */
export function issueSecret(sessionId: string, approval: string): string {
  dropSecret(sessionId);
  const secret = randomBytes(32).toString('hex');
  const h = hash(secret);
  byHash.set(h, { session: sessionId, approval });
  bySession.set(sessionId, h);
  return secret;
}

/** The session a secret belongs to and its approval, or null for an unknown secret. */
export function proveSecret(secret: string): { session: string; approval: string } | null {
  return byHash.get(hash(secret)) ?? null;
}

export function dropSecret(sessionId: string): void {
  const h = bySession.get(sessionId);
  if (h) byHash.delete(h);
  bySession.delete(sessionId);
}
