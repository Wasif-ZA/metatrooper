import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { settings } from './settings.ts';

export type UsageOpts = { window: 'today' | 'week' | 'run'; run_id?: string; now?: Date };

// Builds the usage and event WHERE clauses and params for a window.
function scope(o: UsageOpts): { u: string; e: string; args: SQLInputValue[] } {
  if (o.window === 'run') return { u: 'run_id = ?', e: 'session_id IN (SELECT id FROM session WHERE run_id = ?)', args: [o.run_id ?? ''] };
  const now = o.now ?? new Date();
  const since = o.window === 'week' ? new Date(now.getTime() - 7 * 86400_000) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return { u: 'at >= ?', e: 'at >= ?', args: [since.toISOString()] };
}

// Sums a PostToolUse/UserPromptSubmit length field over events of the window, as 1 token per 3 chars.
function lenTokens(db: DatabaseSync, w: ReturnType<typeof scope>, kind: string, field: string, tools?: string): number {
  const pick = tools ? `AND (json_extract(payload, '$.tool_name') ${tools})` : '';
  const r = db.prepare(`SELECT COALESCE(SUM((COALESCE(json_extract(payload, '$.${field}'), 0) + 2) / 3), 0) AS n FROM event WHERE kind = ? AND ${w.e} ${pick}`).get(kind, ...w.args) as { n: number };
  return r.n;
}

/** Token totals for a window with an estimated where-it-went split that always sums to total. */
export function usageSummary(db: DatabaseSync, o: UsageOpts) {
  const w = scope(o);
  const t = db.prepare(`SELECT COALESCE(SUM(tokens_in), 0) AS i, COALESCE(SUM(tokens_out), 0) AS o, COALESCE(SUM(cache_read), 0) AS cr, COALESCE(SUM(cache_write), 0) AS cw FROM usage WHERE ${w.u}`).get(...w.args) as { i: number; o: number; cr: number; cw: number };
  const total = t.i + t.o + t.cr + t.cw;
  const post = 'claude.PostToolUse';
  const est = [
    lenTokens(db, w, post, 'response_length', "= 'Read'"),
    lenTokens(db, w, post, 'response_length', "IN ('Bash', 'PowerShell')"),
    lenTokens(db, w, post, 'response_length', "LIKE '%screenshot%' OR json_extract(payload, '$.tool_name') LIKE '%snapshot%'"),
    lenTokens(db, w, 'claude.UserPromptSubmit', 'prompt_length'),
  ];
  const avail = Math.max(0, total - t.o);
  const sum = est.reduce((a, b) => a + b, 0);
  const k = sum > avail ? avail / sum : 1;
  const [file_reads, shell, screenshots, instructions] = est.map((n) => Math.floor(n * k));
  const other = total - t.o - file_reads - shell - screenshots - instructions;
  const parts = [['file_reads', file_reads], ['shell', shell], ['screenshots', screenshots], ['instructions', instructions], ['replies', t.o], ['other', other]].map(([kind, tokens]) => ({ kind, tokens }));
  const by_agent = db.prepare(`SELECT session_id, engine_id, SUM(tokens_in + tokens_out + cache_read + cache_write) AS tokens FROM usage WHERE ${w.u} GROUP BY session_id, engine_id ORDER BY tokens DESC`).all(...w.args);
  return { window: o.window, total, in: t.i, out: t.o, cache_read: t.cr, cache_write: t.cw, parts, by_agent, estimate: true };
}

/** Files read more than once per session in the window; a pure query that never touches Read. */
export function repeatReads(db: DatabaseSync, o: UsageOpts) {
  const w = scope(o);
  return db.prepare(`SELECT session_id, json_extract(payload, '$.tool_input.file_path') AS file_path, COUNT(*) AS count FROM event WHERE kind = 'claude.PreToolUse' AND json_extract(payload, '$.tool_name') = 'Read' AND ${w.e} GROUP BY session_id, file_path HAVING file_path IS NOT NULL AND COUNT(*) > 1 ORDER BY count DESC`).all(...w.args);
}

/** The four token savers with their on state; a saving appears only from a measured A/B record, so it is null. */
export function saverReport(s = settings()) {
  return (['shrink_shell', 'lean_handoffs', 'small_screenshots', 'cheap_model'] as const).map((id) => ({ id, on: s.savers[id] === true, saving: null }));
}
