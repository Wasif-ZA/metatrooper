import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { E, RpcError } from './pipe/errors.ts';
import { homeDir, repoDir } from './paths.ts';
import { nowIso } from './time.ts';

// The workspace as data (ouros-spec section 6c): an agent sets a layout, cc checks it, the old one stays one key away.
export const VIEWS = ['explorer', 'editor', 'agent', 'terminal', 'wall', 'kit', 'surface'];
export const RAIL = ['files', 'search', 'git', 'debug', 'agents', 'ext', 'todo'];
const HISTORY = 20;
export const EXAMPLES = path.join(repoDir, 'workbench', 'ui', 'src', 'workspaces');
export const exampleNames = (): string[] => { try { return fs.readdirSync(EXAMPLES).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort(); } catch { return []; } };
const MAX_BYTES = 256 * 1024;

export type Workspace = { name: string; by?: string; asked?: string; rail: string[]; layout: unknown };
export interface Change { applied: boolean; reasons: string[]; setter: string; asked: string; at: string }
interface State { current: Workspace | null; history: Array<Workspace | null>; saved: Record<string, Workspace>; last: Change | null }

/** Why a layout cannot be built; empty when it can. `hasSurface` says whether a saved screen exists. */
export function checkWorkspace(ws: unknown, hasSurface: (id: string) => boolean): string[] {
  const bad: string[] = [];
  const w = ws as Record<string, unknown> | null;
  if (!w || typeof w !== 'object' || Array.isArray(w) || !w.layout || typeof w.layout !== 'object') return ['the layout is missing'];
  if (typeof w.name !== 'string' || !w.name.trim()) bad.push('the layout has no name');
  if (!Array.isArray(w.rail)) bad.push('the side bar has no buttons');
  else for (const r of w.rail) if (!RAIL.includes(r as string)) bad.push(`"${String(r)}" is not a side bar button`);
  const walk = (n: unknown, d: number): void => {
    if (d > 4) { bad.push('panes nest deeper than 4'); return; }
    const p = n as Record<string, unknown> | null;
    if (!p || typeof p !== 'object' || Array.isArray(p)) { bad.push('a pane is empty'); return; }
    if (p.split !== undefined) {
      const kids = p.children, sizes = p.sizes;
      if (!['row', 'col'].includes(p.split as string) || !Array.isArray(kids) || !Array.isArray(sizes) || sizes.length !== kids.length || sizes.some((s) => !Number.isFinite(s) || (s as number) < 8)) { bad.push('a split has bad sizes'); return; }
      if (kids.length < 2) { bad.push('a split needs at least 2 panes'); return; }
      for (const c of kids) walk(c, d + 1);
    } else if (!VIEWS.includes(p.view as string)) bad.push(`"${String(p.view)}" is not a pane cc can show`);
    else if (p.view === 'surface' && (typeof p.spec !== 'string' || !hasSurface(p.spec))) bad.push(`no screen called "${String(p.spec)}"`);
    else if (p.view === 'kit' && (!p.part || typeof p.part !== 'object')) bad.push('a kit pane has no part');
  };
  walk(w.layout, 1);
  return [...new Set(bad)];
}

const fileOf = (projectId: string) => path.join(homeDir(), 'workspaces', `${projectId.replace(/[^A-Za-z0-9_-]/g, '_')}.json`);

function load(projectId: string): State {
  try { return { current: null, history: [], saved: {}, last: null, ...JSON.parse(fs.readFileSync(fileOf(projectId), 'utf8')) }; } catch { return { current: null, history: [], saved: {}, last: null }; }
}

function store(projectId: string, s: State): void {
  const f = fileOf(projectId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(`${f}.tmp`, JSON.stringify(s));
  fs.renameSync(`${f}.tmp`, f);
}

const view = (projectId: string, s: State) => ({ project_id: projectId, current: s.current, usual: s.current === null, undo: s.history.length, saved: Object.keys(s.saved).sort(), examples: exampleNames(), last: s.last });

function sessionOf(db: DatabaseSync, p: Record<string, unknown>): { id: string; engine: string; project: string } {
  const id = typeof p.session_id === 'string' ? p.session_id : '';
  const row = id ? db.prepare('SELECT engine_id, project_id FROM session WHERE id = ?').get(id) as { engine_id: string; project_id: string } | undefined : undefined;
  if (!row) throw new RpcError(E.NOT_FOUND, 'session not found; ouros_workspace can only be called from a cc session');
  return { id, engine: row.engine_id, project: row.project_id };
}

/** `ouros_workspace`: op set (a whole layout), save (name the current one), restore (a saved one) or example (a shipped layout). A refused layout leaves the old one and says why. */
export function changeWorkspace(db: DatabaseSync, p: Record<string, unknown>): ReturnType<typeof view> {
  const who = sessionOf(db, p);
  const s = load(who.project);
  const op = p.op ?? 'set';
  const setter = `${who.engine} (${who.id.slice(-6)})`;
  if (op === 'save') {
    if (typeof p.name !== 'string' || !p.name.trim()) throw new RpcError(E.INVALID_PARAMS, 'name the layout to save');
    if (!s.current) throw new RpcError(E.VALIDATION, 'the current layout is your usual one; there is nothing to save');
    s.saved[p.name.trim().slice(0, 60)] = { ...s.current, name: p.name.trim().slice(0, 60) };
    store(who.project, s);
    return view(who.project, s);
  }
  let ws: unknown;
  if (op === 'restore') {
    if (typeof p.name !== 'string' || !Object.hasOwn(s.saved, p.name)) throw new RpcError(E.NOT_FOUND, `no saved layout called "${String(p.name)}"`);
    ws = s.saved[p.name];
  } else if (op === 'example') {
    if (typeof p.name !== 'string' || !exampleNames().includes(p.name)) throw new RpcError(E.NOT_FOUND, `no example layout called "${String(p.name)}"; examples: ${exampleNames().join(', ')}`);
    ws = JSON.parse(fs.readFileSync(path.join(EXAMPLES, `${p.name}.json`), 'utf8'));
  } else if (op === 'set') ws = p.workspace;
  else throw new RpcError(E.INVALID_PARAMS, 'op must be set, save, restore or example');
  const text = JSON.stringify(ws ?? null);
  const reasons = Buffer.byteLength(text, 'utf8') > MAX_BYTES ? ['the layout is over 256 KB'] : checkWorkspace(ws, (id) => Boolean(db.prepare('SELECT 1 FROM ui_surface WHERE id = ?').get(id)));
  const asked = ws && typeof (ws as Workspace).asked === 'string' ? String((ws as Workspace).asked).slice(0, 300) : '';
  if (!reasons.length) {
    s.history = [...s.history, s.current].slice(-HISTORY);
    s.current = JSON.parse(text) as Workspace;
  }
  s.last = { applied: !reasons.length, reasons, setter, asked, at: nowIso() };
  store(who.project, s);
  return view(who.project, s);
}

export function getWorkspace(projectId: string): ReturnType<typeof view> {
  return view(projectId, load(projectId));
}

/** Undo (Ctrl Z): the layout before the last change. */
export function undoWorkspace(projectId: string): ReturnType<typeof view> {
  const s = load(projectId);
  if (!s.history.length) throw new RpcError(E.VALIDATION, 'there is no earlier layout to go back to');
  s.current = s.history.pop() ?? null;
  s.last = null;
  store(projectId, s);
  return view(projectId, s);
}

/** My usual (Ctrl Alt 0): back to your default layout; Undo can still bring the last one back. */
export function usualWorkspace(projectId: string): ReturnType<typeof view> {
  const s = load(projectId);
  if (s.current !== null) s.history = [...s.history, s.current].slice(-HISTORY);
  s.current = null;
  s.last = null;
  store(projectId, s);
  return view(projectId, s);
}
