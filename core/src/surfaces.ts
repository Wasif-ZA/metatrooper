import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { homeDir } from './paths.ts';
import { E, RpcError } from './pipe/errors.ts';
import { nowIso, ulid } from './time.ts';
import { KIT, VERSION, expand, flatten, isFallback } from '../../workbench/ui/src/kit/check.js';

export const MAX_SPEC_BYTES = 256 * 1024;
const ID = /^[A-Za-z0-9._-]{1,64}$/;

export interface UiResult { surface: string; status: 'drawn' | 'partly' | 'rejected'; fellBack: Array<{ part: string; type: string; why: string }>; waiting?: string[] }

const GATE_TEXT = ['title', 'text', 'why', 'aside'];

/** An agent can never draw a real gate: every gate part keeps only its plain text (title, text, why, aside) and loses any action, hash or other field, so it draws as the inert grey card (M8-28a, Wasif #32). */
export function inertGates(x: unknown, depth = 0): unknown {
  if (depth > 64 || !x || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map((y) => inertGates(y, depth + 1));
  const o = x as Record<string, unknown>;
  if (o.type === 'gate') return Object.fromEntries([['type', 'gate'], ...GATE_TEXT.filter((k) => typeof o[k] === 'string').map((k) => [k, o[k]])]);
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, inertGates(v, depth + 1)]));
}

/** Stores or replaces a screen an agent session drew; the workbench opens it as a tab. Only the session that drew a surface may redraw it. */
export function showSurface(db: DatabaseSync, p: Record<string, unknown>): UiResult {
  const sessionId = typeof p.session_id === 'string' ? p.session_id : '';
  const row = sessionId ? (db.prepare('SELECT project_id FROM session WHERE id = ?').get(sessionId) as { project_id: string } | undefined) : undefined;
  if (!row) throw new RpcError(E.NOT_FOUND, 'session not found; ouros_ui can only be called from a cc session');
  const surface = p.surface;
  if (typeof surface !== 'string' || !ID.test(surface)) throw new RpcError(E.INVALID_PARAMS, 'surface must be 1 to 64 letters, digits, dots, dashes or underscores');
  const zone = p.zone === undefined ? 'tab' : p.zone;
  if (zone !== 'tab') throw new RpcError(E.INVALID_PARAMS, 'zone must be "tab"; the other zones are not built yet');
  const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim().slice(0, 80) : surface;
  const catalogue = typeof p.catalogue === 'string' ? p.catalogue.slice(0, 20) : VERSION;
  if (!p.spec || typeof p.spec !== 'object') throw new RpcError(E.INVALID_PARAMS, 'spec must be an object, usually { type: "page", children: [...] }');
  if (Buffer.byteLength(JSON.stringify(p.spec), 'utf8') > MAX_SPEC_BYTES) throw new RpcError(E.INVALID_PARAMS, `spec is over ${MAX_SPEC_BYTES / 1024} KB`);
  const spec = inertGates(p.spec) as object;
  const text = JSON.stringify(spec);
  if (Buffer.byteLength(text, 'utf8') > MAX_SPEC_BYTES) throw new RpcError(E.INVALID_PARAMS, `spec is over ${MAX_SPEC_BYTES / 1024} KB`);
  const owner = db.prepare('SELECT session_id FROM ui_surface WHERE id = ?').get(surface) as { session_id: string } | undefined;
  if (owner && owner.session_id !== sessionId) throw new RpcError(E.VALIDATION, 'that surface belongs to another session; pick a different surface id');
  const { root, fellBack, waiting = [] } = expand(spec, 'tab', readData(surface), loadTemplates(row.project_id));
  const status = isFallback(root) ? 'rejected' : fellBack.length ? 'partly' : 'drawn';
  db.prepare(
    `INSERT INTO ui_surface (id, session_id, project_id, zone, title, catalogue, spec, status, seq, updated_at)
     VALUES (?, ?, ?, 'tab', ?, ?, ?, ?, (SELECT coalesce(max(seq), 0) + 1 FROM ui_surface), ?)
     ON CONFLICT(id) DO UPDATE SET title = excluded.title, catalogue = excluded.catalogue, spec = excluded.spec, status = excluded.status, seq = excluded.seq, updated_at = excluded.updated_at`,
  ).run(surface, sessionId, row.project_id, title, catalogue, text, status, nowIso());
  return { surface, status, fellBack, ...(waiting.length ? { waiting } : {}) };
}

export function getSurface(db: DatabaseSync, id: string): Record<string, unknown> {
  const r = db.prepare('SELECT id, session_id, project_id, zone, title, catalogue, spec, status, seq, updated_at FROM ui_surface WHERE id = ?').get(id) as (Record<string, unknown> & { spec: string }) | undefined;
  if (!r) throw new RpcError(E.NOT_FOUND, 'surface not found');
  const spec = JSON.parse(r.spec);
  return { ...r, spec, data: readData(id), templates: usedTemplates(spec, loadTemplates(String(r.project_id))) };
}

/** Only the templates a spec names in its use parts, and those they name in turn, so ui.get stays small. */
export function usedTemplates(spec: unknown, all: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (x: unknown, depth: number): void => {
    if (depth > 4 || !x || typeof x !== 'object') return;
    if (Array.isArray(x)) { for (const y of x) walk(y, depth); return; }
    const o = x as Record<string, unknown>;
    if (o.type === 'use' && typeof o.template === 'string' && Object.hasOwn(all, o.template) && !Object.hasOwn(out, o.template)) { out[o.template] = all[o.template]; walk(all[o.template], depth + 1); }
    for (const v of Object.values(o)) walk(v, depth);
  };
  walk(spec, 0);
  return out;
}

/** The folder of one project's templates; templates and assets belong to one workspace (M8-09d). */
export const templatesDir = (projectId: string) => path.join(homeDir(), 'templates', projectId.replace(/[^A-Za-z0-9_-]/g, '_'));

/** One project's templates (ouros-spec 6a): <home>/templates/<project>/<name>.json, each a saved screen with {{gaps}}; at most 200, 256 KB each. */
export function loadTemplates(projectId: string): Record<string, unknown> {
  const dir = templatesDir(projectId);
  const out: Record<string, unknown> = {};
  let names: string[] = [];
  try { names = fs.readdirSync(dir).filter((f) => /^[A-Za-z0-9._-]{1,64}\.json$/.test(f)).sort().slice(0, 200); } catch { return out; }
  for (const f of names) {
    try {
      const file = path.join(dir, f);
      if (fs.statSync(file).size > MAX_SPEC_BYTES) continue;
      const t = JSON.parse(fs.readFileSync(file, 'utf8'));
      out[f.slice(0, -5)] = t && typeof t === 'object' && 'spec' in t ? t.spec : t;
    } catch {}
  }
  return out;
}

export const MAX_DATA_BYTES = 64 * 1024;
const dataFile = (id: string) => path.join(homeDir(), 'surface-data', `${id}.json`);
function readData(id: string): Record<string, unknown> {
  try { const d = JSON.parse(fs.readFileSync(dataFile(id), 'utf8')); return d && typeof d === 'object' && !Array.isArray(d) ? d : {}; } catch { return {}; }
}

/** M8-08c: sets one value at a JSON pointer in a surface's data; parts bound to it with {bind: "/path"} redraw with no parts resent. Only the session that drew the surface may. */
export function setSurfaceData(db: DatabaseSync, p: Record<string, unknown>): { surface: string; seq: number } {
  const id = p.surface;
  if (typeof id !== 'string' || !ID.test(id)) throw new RpcError(E.INVALID_PARAMS, 'surface must be a surface id');
  const r = db.prepare('SELECT session_id FROM ui_surface WHERE id = ?').get(id) as { session_id: string } | undefined;
  if (!r) throw new RpcError(E.NOT_FOUND, 'surface not found; draw it with ouros_ui first');
  if (r.session_id !== p.session_id) throw new RpcError(E.VALIDATION, 'that surface belongs to another session');
  const ptr = p.path;
  if (typeof ptr !== 'string' || !/^(\/[^/]{1,80}){1,8}$/.test(ptr)) throw new RpcError(E.INVALID_PARAMS, 'path must be a JSON pointer such as /tokens, at most 8 levels');
  const keys = ptr.split('/').slice(1).map((k) => k.replaceAll('~1', '/').replaceAll('~0', '~'));
  if (keys.some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype')) throw new RpcError(E.INVALID_PARAMS, 'path names a reserved key');
  const data = readData(id);
  let at: Record<string, unknown> = data;
  for (const k of keys.slice(0, -1)) {
    const next = at[k];
    at = (at[k] = next && typeof next === 'object' && !Array.isArray(next) ? next : {}) as Record<string, unknown>;
  }
  at[keys[keys.length - 1]] = p.value;
  const text = JSON.stringify(data);
  if (Buffer.byteLength(text, 'utf8') > MAX_DATA_BYTES) throw new RpcError(E.INVALID_PARAMS, `surface data is over ${MAX_DATA_BYTES / 1024} KB`);
  fs.mkdirSync(path.dirname(dataFile(id)), { recursive: true });
  fs.writeFileSync(`${dataFile(id)}.tmp`, text);
  fs.renameSync(`${dataFile(id)}.tmp`, dataFile(id));
  db.prepare('UPDATE ui_surface SET seq = (SELECT coalesce(max(seq), 0) + 1 FROM ui_surface), updated_at = ? WHERE id = ?').run(nowIso(), id);
  return { surface: id, seq: (db.prepare('SELECT seq FROM ui_surface WHERE id = ?').get(id) as { seq: number }).seq };
}

export const MAX_EVENT_LINE = 4000;
export interface UiEventResult { delivered: boolean; to: 'session' | 'inbox' | null; dropped?: 'stale' | 'repeat'; seq: number; typed?: boolean }

const plainValue = (v: unknown) => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/** A click on a drawn screen: dropped when the screen was redrawn since (stale seq) or the same event was already sent for this seq; else one `[ouros-ui]` line queued for the owning session, or a needs-you item when that session has exited or `typeInto` returns false (no open terminal). */
export function surfaceEvent(db: DatabaseSync, p: Record<string, unknown>, typeInto: (sessionId: string, engineId: string, text: string, state: string, stateAt: string) => boolean | 'sent' | null): UiEventResult {
  const id = p.surface;
  if (typeof id !== 'string' || !ID.test(id)) throw new RpcError(E.INVALID_PARAMS, 'surface must be a surface id');
  const r = db.prepare('SELECT u.session_id, u.title, u.seq, s.state, s.state_at, s.engine_id FROM ui_surface u JOIN session s ON s.id = u.session_id WHERE u.id = ?').get(id) as
    | { session_id: string; title: string; seq: number; state: string; state_at: string; engine_id: string }
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
  const typed = typeInto(r.session_id, r.engine_id, line, r.state, r.state_at);
  if (typed === false) return inbox();
  const at = nowIso();
  db.prepare("INSERT INTO comment (id, at, session_id, kind, body, prompt_at) VALUES (?, ?, ?, 'notice', ?, ?)").run(ulid(), at, r.session_id, line, typed === 'sent' ? at : null);
  return { delivered: true, to: 'session', seq: r.seq, typed: Boolean(typed) };
}

export const PROPOSAL_AT = 3;

/** M8-10a: unknown parts that 3 or more screens fell back on, each with the props they were sent and the screens that asked. A proposal is only shown; nothing is added to the catalogue. */
export function catalogueProposals(db: DatabaseSync): Array<{ part: string; props: string[]; surfaces: string[] }> {
  const by = new Map<string, { props: Set<string>; surfaces: Set<string> }>();
  for (const r of db.prepare('SELECT id, spec FROM ui_surface ORDER BY id').all() as Array<{ id: string; spec: string }>) {
    let parts: Record<string, unknown>;
    try { parts = flatten(JSON.parse(r.spec)).parts as Record<string, unknown>; } catch { continue; }
    for (const p of Object.values(parts)) {
      const part = p as Record<string, unknown> | null;
      if (!part || typeof part.type !== 'string' || Object.hasOwn(KIT, part.type)) continue;
      const name = part.type.slice(0, 60);
      const e = by.get(name) ?? { props: new Set<string>(), surfaces: new Set<string>() };
      for (const k of Object.keys(part)) if (k !== 'type') e.props.add(k.slice(0, 40));
      e.surfaces.add(r.id);
      by.set(name, e);
    }
  }
  return [...by].filter(([, e]) => e.surfaces.size >= PROPOSAL_AT).map(([part, e]) => ({ part, props: [...e.props].sort(), surfaces: [...e.surfaces] }));
}
