import type { DatabaseSync } from 'node:sqlite';
import { E, RpcError } from './pipe/errors.ts';
import { nowIso, ulid } from './time.ts';
import { VERSION, expand, isFallback } from '../../workbench/ui/src/kit/check.js';

export const MAX_SPEC_BYTES = 256 * 1024;
const ID = /^[A-Za-z0-9._-]{1,64}$/;

export interface UiResult { surface: string; status: 'drawn' | 'partly' | 'rejected'; fellBack: Array<{ part: string; type: string; why: string }> }

/** Stores or replaces a screen an agent session drew; the workbench opens it as a tab. Only the session that drew a surface may redraw it. */
export function showSurface(db: DatabaseSync, p: Record<string, unknown>): UiResult {
  const sessionId = typeof p.session_id === 'string' ? p.session_id : '';
  const row = sessionId ? (db.prepare('SELECT project_id FROM session WHERE id = ?').get(sessionId) as { project_id: string } | undefined) : undefined;
  if (!row) throw new RpcError(E.NOT_FOUND, 'session not found; ouros_ui can only be called from an Ouros session');
  const surface = p.surface;
  if (typeof surface !== 'string' || !ID.test(surface)) throw new RpcError(E.INVALID_PARAMS, 'surface must be 1 to 64 letters, digits, dots, dashes or underscores');
  const zone = p.zone === undefined ? 'tab' : p.zone;
  if (zone !== 'tab') throw new RpcError(E.INVALID_PARAMS, 'zone must be "tab"; the other zones are not built yet');
  const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, 80) : surface;
  const catalogue = typeof p.catalogue === 'string' ? p.catalogue.slice(0, 20) : VERSION;
  const spec = p.spec;
  if (!spec || typeof spec !== 'object') throw new RpcError(E.INVALID_PARAMS, 'spec must be an object, usually { type: "page", children: [...] }');
  const text = JSON.stringify(spec);
  if (Buffer.byteLength(text, 'utf8') > MAX_SPEC_BYTES) throw new RpcError(E.INVALID_PARAMS, `spec is over ${MAX_SPEC_BYTES / 1024} KB`);
  const owner = db.prepare('SELECT session_id FROM ui_surface WHERE id = ?').get(surface) as { session_id: string } | undefined;
  if (owner && owner.session_id !== sessionId) throw new RpcError(E.VALIDATION, 'that surface belongs to another session; pick a different surface id');
  const { root, fellBack } = expand(spec);
  const status = isFallback(root) ? 'rejected' : fellBack.length ? 'partly' : 'drawn';
  db.prepare(
    `INSERT INTO ui_surface (id, session_id, project_id, zone, title, catalogue, spec, status, seq, updated_at)
     VALUES (?, ?, ?, 'tab', ?, ?, ?, ?, (SELECT coalesce(max(seq), 0) + 1 FROM ui_surface), ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, catalogue = excluded.catalogue, spec = excluded.spec, status = excluded.status, seq = excluded.seq, updated_at = excluded.updated_at`,
  ).run(surface, sessionId, row.project_id, title, catalogue, text, status, nowIso());
  return { surface, status, fellBack };
}

export function getSurface(db: DatabaseSync, id: string): Record<string, unknown> {
  const r = db.prepare('SELECT id, session_id, project_id, zone, title, catalogue, spec, status, seq, updated_at FROM ui_surface WHERE id = ?').get(id) as (Record<string, unknown> & { spec: string }) | undefined;
  if (!r) throw new RpcError(E.NOT_FOUND, 'surface not found');
  return { ...r, spec: JSON.parse(r.spec) };
}

export const MAX_EVENT_LINE = 4000;
export interface UiEventResult { delivered: boolean; to: 'session' | 'inbox' | null; dropped?: 'stale' | 'repeat'; seq: number; typed?: boolean }

const plainValue = (v: unknown) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/** A click on a drawn screen: dropped when the screen was redrawn since (stale seq) or the same event was already sent for this seq; else one `[ouros-ui]` line queued for the owning session, or a needs-you item when that session has ended. */
export function surfaceEvent(db: DatabaseSync, p: Record<string, unknown>, typeInto: (sessionId: string, engineId: string, text: string) => boolean | null): UiEventResult {
  const id = p.surface;
  if (typeof id !== 'string' || !ID.test(id)) throw new RpcError(E.INVALID_PARAMS, 'surface must be a surface id');
  const r = db.prepare('SELECT u.session_id, u.title, u.seq, s.state, s.engine_id FROM ui_surface u JOIN session s ON s.id = u.session_id WHERE u.id = ?').get(id) as
    | { session_id: string; title: string; seq: number; state: string; engine_id: string }
    | undefined;
  if (!r) throw new RpcError(E.NOT_FOUND, 'surface not found');
  if (p.seq !== r.seq) return { delivered: false, to: null, dropped: 'stale', seq: r.seq };
  const event = p.event;
  if (typeof event !== 'string' || event.length < 1 || event.length > 200 || /[\x00-\x1f\x7f-\x9f]/.test(event)) throw new RpcError(E.INVALID_PARAMS, 'event must be 1 to 200 characters with no control characters');
  const raw = p.context ?? {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new RpcError(E.INVALID_PARAMS, 'context must be an object of strings, numbers and booleans');
  const entries = Object.entries(raw);
  if (entries.length > 50 || entries.some(([k, v]) => k.length > 80 || !plainValue(v))) throw new RpcError(E.INVALID_PARAMS, 'context must be at most 50 keys of strings, numbers and booleans');
  const head = JSON.stringify({ surface: id, seq: r.seq, event }).slice(0, -1) + ',"context":';
  const line = `[ouros-ui] ${head}${JSON.stringify(Object.fromEntries(entries))}}`;
  if (line.length > MAX_EVENT_LINE) throw new RpcError(E.INVALID_PARAMS, `the event line is over ${MAX_EVENT_LINE} characters`);
  const sent = db.prepare("SELECT 1 FROM comment WHERE session_id = ? AND kind = 'notice' AND instr(body, ?) > 0 UNION ALL SELECT 1 FROM needs_you WHERE ref = ? AND kind = 'other' AND instr(text, ?) > 0 LIMIT 1");
  const key = `[ouros-ui] ${head}`;
  if (sent.get(r.session_id, key, r.session_id, key)) return { delivered: false, to: null, dropped: 'repeat', seq: r.seq };
  const inbox = () => {
    db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'other', ?, ?)")
      .run(ulid(), nowIso(), r.session_id, `Your click on "${r.title}" did not reach its ${r.engine_id} session (it has ended or has no terminal), so it is kept here: ${line}`);
    return { delivered: true, to: 'inbox' as const, seq: r.seq };
  };
  if (r.state === 'exited') return inbox();
  db.prepare("INSERT INTO comment (id, at, session_id, kind, body) VALUES (?, ?, ?, 'notice', ?)").run(ulid(), nowIso(), r.session_id, line);
  const typed = typeInto(r.session_id, r.engine_id, line);
  return typed === false ? inbox() : { delivered: true, to: 'session', seq: r.seq, typed: Boolean(typed) };
}
