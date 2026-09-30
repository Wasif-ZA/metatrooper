import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';

interface Price { in: number; out: number; cache_read: number; cache_write: number }

const offsets = new Map<string, number>();

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

/** Reads new complete lines of a Claude transcript from the last byte offset and upserts one usage row per message.id (last record wins). Returns rows written. */
export function readClaudeTranscript(db: DatabaseSync, sessionId: string, transcriptPath: string): number {
  let size: number;
  try { size = fs.statSync(transcriptPath).size; } catch { return 0; }
  let from = offsets.get(transcriptPath) ?? 0;
  if (size < from) from = 0;
  if (size === from) return 0;
  const fd = fs.openSync(transcriptPath, 'r');
  const buf = Buffer.alloc(size - from);
  try { fs.readSync(fd, buf, 0, buf.length, from); } finally { fs.closeSync(fd); }
  const end = buf.lastIndexOf(0x0a) + 1;
  if (end === 0) return 0;
  offsets.set(transcriptPath, from + end);
  const session = db.prepare('SELECT engine_id FROM session WHERE id = ?').get(sessionId) as { engine_id: string } | undefined;
  if (!session) return 0;
  const upsert = db.prepare(
    `INSERT INTO usage (at, session_id, engine_id, provider, model, tokens_in, tokens_out, cache_read, cache_write, usd, source, dedupe_key)
     VALUES (?, ?, ?, 'local-cli', ?, ?, ?, ?, ?, ?, 'transcript', ?)
     ON CONFLICT(dedupe_key) DO UPDATE SET at = excluded.at, model = excluded.model, tokens_in = excluded.tokens_in,
       tokens_out = excluded.tokens_out, cache_read = excluded.cache_read, cache_write = excluded.cache_write, usd = excluded.usd`,
  );
  let n = 0;
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    if (!line) continue;
    let rec: any;
    try { rec = JSON.parse(line); } catch { continue; }
    const m = rec?.message;
    if (!m?.id || !m.usage) continue;
    const u = m.usage;
    const t = { i: u.input_tokens ?? 0, o: u.output_tokens ?? 0, cr: u.cache_read_input_tokens ?? 0, cw: u.cache_creation_input_tokens ?? 0 };
    const model = typeof m.model === 'string' ? m.model : null;
    upsert.run(rec.timestamp ?? new Date().toISOString(), sessionId, session.engine_id, model, t.i, t.o, t.cr, t.cw, usdFor(model, t.i, t.o, t.cr, t.cw), m.id);
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
