import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

interface Price { in: number; out: number; cache_read: number; cache_write: number }

const offsets = new Map<string, number>();
const transcripts = new Map<string, string>();
let seeded = false;

let prices: Record<string, Price> | null = null;
function priceFor(model: string | null): Price | null {
  if (!model) return null;
  prices ??= (JSON.parse(fs.readFileSync(fileURLToPath(new URL('../prices.json', import.meta.url)), 'utf8')) as { models: Record<string, Price> }).models;
  return prices[model] ?? null;
}

export function usdFor(model: string | null, inT: number, outT: number, cacheRead: number, cacheWrite: number): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (inT * p.in + outT * p.out + cacheRead * p.cache_read + cacheWrite * p.cache_write) / 1e6;
}

function newLines(file: string): string[] | null {
  let size: number;
  try { size = fs.statSync(file).size; } catch { return null; }
  let from = offsets.get(file) ?? 0;
  if (size < from) from = 0;
  if (size === from) return null;
  const buf = Buffer.alloc(size - from);
  try {
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
  } catch { return null; }
  const end = buf.lastIndexOf(0x0a) + 1;
  if (end === 0) return null;
  offsets.set(file, from + end);
  return buf.subarray(0, end).toString('utf8').split('\n');
}

/** Reads new complete lines of a Claude transcript from the last byte offset and upserts one usage row per message.id (last record wins). Returns rows written. */
export function readClaudeTranscript(db: DatabaseSync, sessionId: string, transcriptPath: string): number {
  const lines = newLines(transcriptPath);
  if (!lines) return 0;
  const session = db.prepare('SELECT engine_id, run_id, step_id FROM session WHERE id = ?').get(sessionId) as { engine_id: string; run_id: string | null; step_id: string | null } | undefined;
  if (!session) return 0;
  const upsert = db.prepare(
    `INSERT INTO usage (at, run_id, step_id, session_id, engine_id, provider, model, tokens_in, tokens_out, cache_read, cache_write, usd, source, dedupe_key)
     VALUES (?, ?, ?, ?, ?, 'local-cli', ?, ?, ?, ?, ?, ?, 'transcript', ?)
     ON CONFLICT(dedupe_key) DO UPDATE SET at = excluded.at, model = excluded.model, tokens_in = excluded.tokens_in,
       tokens_out = excluded.tokens_out, cache_read = excluded.cache_read, cache_write = excluded.cache_write, usd = excluded.usd`,
  );
  let n = 0;
  for (const line of lines) {
    if (!line) continue;
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    const m = rec?.message;
    if (!m?.id || !m.usage) continue;
    const u = m.usage;
    const t = { i: u.input_tokens ?? 0, o: u.output_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0 };
    const model = typeof m.model === 'string' ? m.model : null;
    upsert.run(rec.timestamp ?? new Date().toISOString(), session.run_id, session.step_id, sessionId, session.engine_id, model, t.i, t.o, t.cr, t.cw, usdFor(model, t.i, t.o, t.cr, t.cw), m.id);
    n++;
  }
  return n;
}

/** Per-session token totals over the deduplicated usage rows. */
export function sessionTokens(db: DatabaseSync, sessionId: string): { in: number; out: number; cache_read: number; cache_write: number } {
  const r = db.prepare(
    `SELECT COALESCE(SUM(tokens_in),0) AS i, COALESCE(SUM(tokens_out),0) AS o, COALESCE(SUM(cache_read),0) AS cr, COALESCE(SUM(cache_write),0) AS cw
     FROM usage WHERE session_id = ?`,
  ).get(sessionId) as { i: number; o: number; cr: number; cw: number };
  return { in: r.i, out: r.o, cache_read: r.cr, cache_write: r.cw };
}

export function noteTranscript(sessionId: string, transcriptPath: string): void {
  transcripts.set(sessionId, transcriptPath);
}

/** Reads every known Claude transcript. On first call, seeds paths from the newest claude event of each open session. */
export function readMeters(db: DatabaseSync): number {
  if (!seeded) {
    seeded = true;
    const rows = db.prepare(
      `SELECT e.session_id AS sid, json_extract(e.payload, '$.transcript_path') AS tp FROM event e JOIN session s ON s.id = e.session_id
       WHERE s.ended_at IS NULL AND e.kind LIKE 'claude.%' AND json_extract(e.payload, '$.transcript_path') IS NOT NULL ORDER BY e.seq`,
    ).all() as Array<{ sid: string; tp: string }>;
    for (const r of rows) transcripts.set(r.sid, r.tp);
  }
  let n = 0;
  const ended = db.prepare('SELECT ended_at FROM session WHERE id = ?');
  const gone = (sid: string) => {
    const r = ended.get(sid) as { ended_at: string | null } | undefined;
    return !r || r.ended_at !== null;
  };
  for (const [sid, tp] of transcripts) {
    n += readClaudeTranscript(db, sid, tp);
    if (gone(sid)) { transcripts.delete(sid); offsets.delete(tp); }
  }
  for (const [sid, f] of codexFiles) {
    n += readCodexSession(db, sid, f);
    if (gone(sid)) { codexFiles.delete(sid); offsets.delete(f); codexTurns.delete(f); }
  }
  return n;
}

interface Totals { input_tokens?: number; cached_input_tokens?: number; cache_write_input_tokens?: number; output_tokens?: number }
const codexFiles = new Map<string, string>();
const codexTurns = new Map<string, { turn: string | null; model: string | null; base: Totals; last: Totals }>();

export function noteCodexSession(sessionId: string, file: string): void {
  codexFiles.set(sessionId, file);
}

/** Reads new lines of a Codex session file and upserts one usage row per turn id: the turn's growth in total_token_usage. */
export function readCodexSession(db: DatabaseSync, sessionId: string, file: string): number {
  const lines = newLines(file);
  if (!lines) return 0;
  const session = db.prepare('SELECT engine_id, run_id, step_id FROM session WHERE id = ?').get(sessionId) as { engine_id: string; run_id: string | null; step_id: string | null } | undefined;
  if (!session) return 0;
  let st = codexTurns.get(file);
  if (!st) codexTurns.set(file, (st = { turn: null, model: null, base: {}, last: {} }));
  const upsert = db.prepare(
    `INSERT INTO usage (at, run_id, step_id, session_id, engine_id, provider, model, tokens_in, tokens_out, cache_read, cache_write, usd, source, dedupe_key)
     VALUES (?, ?, ?, ?, ?, 'local-cli', ?, ?, ?, ?, ?, ?, 'codex-session', ?)
     ON CONFLICT(dedupe_key) DO UPDATE SET at = excluded.at, model = excluded.model, tokens_in = excluded.tokens_in,
       tokens_out = excluded.tokens_out, cache_read = excluded.cache_read, cache_write = excluded.cache_write, usd = excluded.usd`,
  );
  const d = (k: keyof Totals) => (st!.last[k] ?? 0) - (st!.base[k] ?? 0);
  let n = 0;
  for (const line of lines) {
    if (!line) continue;
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    const p = rec?.payload;
    if (rec?.type === 'turn_context' && typeof p?.model === 'string') st.model = p.model;
    if (rec?.type !== 'event_msg') continue;
    if (p?.type === 'task_started' && typeof p.turn_id === 'string') {
      st.turn = p.turn_id;
      st.base = st.last;
    }
    if (p?.type === 'token_count' && p.info?.total_token_usage && st.turn) {
      st.last = p.info.total_token_usage;
      const cr = d('cached_input_tokens');
      const cw = d('cache_write_input_tokens');
      const i = d('input_tokens') - cr;
      const o = d('output_tokens');
      upsert.run(rec.timestamp ?? new Date().toISOString(), session.run_id, session.step_id, sessionId, session.engine_id, st.model, i, o, cr, cw, usdFor(st.model, i, o, cr, cw), `codex:${sessionId}:${st.turn}`);
      n++;
    }
  }
  return n;
}
