import type { DatabaseSync } from 'node:sqlite';
import { appendEvent } from '../events/append.ts';
import { getEngine } from '../engines/registry.ts';
import { lastLines } from '../terminal/index.ts';

const LINES = 20;

/** Every 5 s: a session with no engine event since launch (a SessionStart aside) and whose screen shows its folder trust question gets core.trust-dialog (waiting for you, reason trust); once that question leaves the screen, core.trust-cleared. */
export async function checkTrustDialog(db: DatabaseSync, read: (id: string, n: number) => Promise<string[] | null> = lastLines): Promise<void> {
  const rows = db.prepare(`SELECT s.id, s.engine_id, s.wait_reason FROM session s WHERE s.state NOT IN ('done', 'exited') AND (s.wait_reason = 'trust' OR NOT EXISTS (
    SELECT 1 FROM event e WHERE e.session_id = s.id AND (e.kind GLOB 'claude.*' OR e.kind GLOB 'codex.*' OR e.kind GLOB 'gemini.*' OR e.kind GLOB 'opencode.*' OR e.kind = 'core.activity') AND e.kind NOT GLOB '*.SessionStart'))`).all() as Array<{ id: string; engine_id: string; wait_reason: string | null }>;
  const lastTrust = db.prepare("SELECT kind FROM event WHERE session_id = ? AND kind IN ('core.trust-dialog', 'core.trust-cleared') ORDER BY seq DESC LIMIT 1");
  for (const s of rows) {
    const patterns = getEngine(db, s.engine_id)?.trust_patterns;
    if (!patterns?.length) continue;
    let lines: string[] | null = null;
    try { lines = await read(s.id, LINES); } catch {}
    if (lines === null) continue;
    const text = lines.join('\n').toLowerCase();
    const shown = patterns.some((p) => text.includes(p.toLowerCase()));
    const raised = (lastTrust.get(s.id) as { kind: string } | undefined)?.kind === 'core.trust-dialog';
    if (shown && !raised) appendEvent('core.trust-dialog', s.id, {}, db);
    else if (!shown && raised && s.wait_reason === 'trust') appendEvent('core.trust-cleared', s.id, {}, db);
  }
}
