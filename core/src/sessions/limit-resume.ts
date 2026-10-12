import type { DatabaseSync } from 'node:sqlite';
import { appendEvent } from '../events/append.ts';
import * as term from '../terminal/index.ts';
import { nowIso, ulid } from '../time.ts';

export const RESUME_TEXT = 'Continue where you left off.';
const KEEP = 6;

/** Writes `core.limit-hit` for a session whose Claude turn failed on a rate limit; `resets_at` is the latest reset among used-up Claude windows, else the fullest window's. */
export function limitHit(db: DatabaseSync, sessionId: string, afterSeq: number, now = Date.now()): void {
  const rows = db.prepare("SELECT window, used_pct, resets_at FROM limit_reading WHERE provider = 'claude' AND status = 'ok' AND resets_at IS NOT NULL").all() as Array<{ window: string; used_pct: number | null; resets_at: string }>;
  const live = rows.filter((r) => Date.parse(r.resets_at) > now);
  const full = live.filter((r) => (r.used_pct ?? 0) >= 100).sort((a, b) => Date.parse(b.resets_at) - Date.parse(a.resets_at));
  const pick = full[0] ?? live.sort((a, b) => (b.used_pct ?? 0) - (a.used_pct ?? 0))[0];
  appendEvent('core.limit-hit', sessionId, { window: pick?.window ?? null, resets_at: pick?.resets_at ?? null, after: afterSeq }, db);
}

type Term = Pick<typeof term, 'has' | 'paste' | 'write'>;

/** Pastes the resume line and Enter once per `core.limit-hit` whose reset has passed, while the pty is open, the session still waits for you, the tile's toggle is on and no Claude event came after the failure. */
export function resumeAtReset(db: DatabaseSync, now = Date.now(), t: Term = term): string[] {
  const hits = db.prepare(
    `SELECT e.seq, e.session_id, json_extract(e.payload, '$.resets_at') AS resets_at FROM event e JOIN session s ON s.id = e.session_id
     WHERE e.kind = 'core.limit-hit' AND s.limit_resume = 1 AND s.state = 'waiting_for_you' AND json_extract(e.payload, '$.resets_at') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM event r WHERE r.kind = 'core.limit-resumed' AND r.session_id = e.session_id AND json_extract(r.payload, '$.limit_hit') = e.seq)
       AND NOT EXISTS (SELECT 1 FROM event l WHERE l.session_id = e.session_id AND l.seq > COALESCE(json_extract(e.payload, '$.after'), e.seq)
         AND ((l.kind LIKE 'claude.%' AND l.kind != 'claude.Notification') OR l.kind = 'core.prompt-written'))`,
  ).all() as Array<{ seq: number; session_id: string; resets_at: string }>;
  const pasted: string[] = [];
  for (const h of hits) {
    if (Date.parse(h.resets_at) > now || !t.has(h.session_id)) continue;
    appendEvent('core.limit-resumed', h.session_id, { limit_hit: h.seq }, db);
    if (t.paste(h.session_id, RESUME_TEXT)) t.write(h.session_id, '\r');
    pasted.push(h.session_id);
  }
  return pasted;
}

/** Copies each current `limit_reading` into `limit_history` once per `read_at`, keeping the last 6 per window. */
export function recordReadings(db: DatabaseSync): void {
  db.prepare(
    `INSERT OR IGNORE INTO limit_history (provider, account, window, used_pct, resets_at, read_at)
     SELECT provider, account, window, used_pct, resets_at, read_at FROM limit_reading WHERE status = 'ok' AND used_pct IS NOT NULL`,
  ).run();
  db.prepare(
    `DELETE FROM limit_history WHERE rowid IN (SELECT rowid FROM (
       SELECT rowid, row_number() OVER (PARTITION BY provider, account, window ORDER BY julianday(read_at) DESC) AS n FROM limit_history) WHERE n > ?)`,
  ).run(KEEP);
}

const pad = (n: number) => String(n).padStart(2, '0');
const NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex' };

/** One needs-you item per window and reset when the slope over its last 6 readings runs it out before `resets_at`. */
export function earlyEnd(db: DatabaseSync, now = Date.now()): void {
  const rows = db.prepare('SELECT provider, account, window, used_pct, resets_at, read_at FROM limit_history ORDER BY provider, account, window, julianday(read_at)').all() as Array<{ provider: string; account: string; window: string; used_pct: number; resets_at: string | null; read_at: string }>;
  const groups = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = `${r.provider}\0${r.account}\0${r.window}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const add = db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) SELECT ?, ?, 'other', ?, ? WHERE NOT EXISTS (SELECT 1 FROM needs_you WHERE ref = ?)");
  for (const all of groups.values()) {
    const last = all[all.length - 1];
    const same = all.filter((r) => r.resets_at === last.resets_at);
    if (same.length < KEEP || !last.resets_at) continue;
    const first = same[0];
    const reset = Date.parse(last.resets_at), lastAt = Date.parse(last.read_at);
    const minutes = (lastAt - Date.parse(first.read_at)) / 60_000;
    const slope = (last.used_pct - first.used_pct) / minutes;
    if (!(minutes > 0 && slope > 0 && last.used_pct < 100 && reset > now)) continue;
    const end = lastAt + ((100 - last.used_pct) / slope) * 60_000;
    if (end >= reset || end <= now) continue;
    const d = new Date(end);
    const ref = `limit-early:${last.provider}:${last.account}:${last.window}:${last.resets_at}`;
    add.run(ulid(), nowIso(), ref, `${NAMES[last.provider] ?? last.provider} ${last.window} window ends early at about ${pad(d.getHours())}:${pad(d.getMinutes())}`, ref);
  }
}
