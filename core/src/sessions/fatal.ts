import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { nowIso, ulid } from '../time.ts';
import { getEngine } from '../engines/registry.ts';
import { lastLines } from '../terminal/index.ts';

const LINES = 20;
const FROZEN_MS = 60_000;

/** Per working session: the fatal pattern on screen, a hash of the screen it was seen on, and since when. */
const seen = new Map<string, { pattern: string; hash: string; since: number; raised: boolean }>();

/** Every 5 s: a working session whose engine declares fatal_patterns and whose last 20 lines show one, unchanged for 60 s, gets one failed item naming the pattern. */
export async function checkFatal(db: DatabaseSync, now = Date.now(), read: (id: string, n: number) => Promise<string[] | null> = lastLines): Promise<void> {
  const rows = db.prepare("SELECT id, engine_id FROM session WHERE state = 'working'").all() as Array<{ id: string; engine_id: string }>;
  const working = new Set(rows.map((r) => r.id));
  for (const id of seen.keys()) if (!working.has(id)) seen.delete(id);
  for (const s of rows) {
    const patterns = getEngine(db, s.engine_id)?.fatal_patterns;
    if (!patterns?.length) continue;
    let lines: string[] | null = null;
    try { lines = await read(s.id, LINES); } catch {}
    const text = (lines ?? []).join('\n');
    const lower = text.toLowerCase();
    const pattern = patterns.find((p) => lower.includes(p.toLowerCase()));
    if (!pattern) { seen.delete(s.id); continue; }
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const m = seen.get(s.id);
    if (!m || m.hash !== hash || m.pattern !== pattern) { seen.set(s.id, { pattern, hash, since: now, raised: false }); continue; }
    if (m.raised || now - m.since < FROZEN_MS) continue;
    m.raised = true;
    db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) SELECT ?, ?, 'failed', ?, ? WHERE NOT EXISTS (SELECT 1 FROM needs_you WHERE ref = ? AND kind = 'failed' AND resolved_at IS NULL AND read_at IS NULL)")
      .run(ulid(), nowIso(), s.id, `${s.engine_id} failed: ${pattern}`, s.id);
  }
}
