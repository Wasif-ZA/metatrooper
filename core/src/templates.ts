import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import { E, RpcError } from './pipe/errors.ts';
import { homeDir } from './paths.ts';
import { fillTemplate } from '../../workbench/ui/src/kit/check.js';

// M8-06a,b: a screen the person's agents draw again and again becomes a proposed template (ouros-spec 6a "Your templates").
// Screens from 3 or more sessions with one structure are lined up; leaves that differ become {{gN}} gaps. A proposal is
// kept only when replay holds: filling the template with each past screen's values gives that screen back exactly.
export const PROPOSE_AT = 3;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** The shape of a spec with every leaf value blanked: two screens with the same shape differ only in their values. */
export function shapeOf(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(shapeOf);
  if (isObj(x)) return Object.fromEntries(Object.keys(x).sort().map((k) => [k, k === 'type' ? x[k] : shapeOf(x[k])]));
  return typeof x;
}

/** One template for specs of the same shape: equal leaves stay, differing ones become gaps; with the values each spec fills them with. */
export function lineUp(specs: unknown[]): { template: unknown; values: Array<Record<string, unknown>> } {
  const values: Array<Record<string, unknown>> = specs.map(() => ({}));
  let n = 0;
  const walk = (xs: unknown[]): unknown => {
    const first = xs[0];
    if (Array.isArray(first)) return first.map((_, i) => walk(xs.map((x) => (x as unknown[])[i])));
    if (isObj(first)) return Object.fromEntries(Object.keys(first).map((k) => [k, k === 'type' ? first[k] : walk(xs.map((x) => (x as Record<string, unknown>)[k]))]));
    if (xs.every((x) => isDeepStrictEqual(x, first))) return first;
    const gap = `g${++n}`;
    xs.forEach((x, i) => { values[i][gap] = x; });
    return `{{${gap}}}`;
  };
  return { template: walk(specs), values };
}

/** Replay: the template, filled with each past screen's values, gives back each screen exactly. */
export function replayHolds(template: unknown, specs: unknown[], values: Array<Record<string, unknown>>): boolean {
  return specs.every((s, i) => isDeepStrictEqual(fillTemplate(template, values[i]), s));
}

export interface Proposal { name: string; template: unknown; surfaces: string[]; sessions: number; kept: boolean; why?: string }

/** Proposed templates from the stored screens: one per shape drawn by PROPOSE_AT or more sessions; `kept` only when replay holds. */
export function proposeTemplates(db: DatabaseSync): Proposal[] {
  const groups = new Map<string, Array<{ id: string; session: string; title: string; spec: unknown }>>();
  for (const r of db.prepare('SELECT id, session_id, title, spec FROM ui_surface ORDER BY seq').all() as Array<{ id: string; session_id: string; title: string; spec: string }>) {
    let spec: unknown;
    try { spec = JSON.parse(r.spec); } catch { continue; }
    const key = JSON.stringify(shapeOf(spec));
    const g = groups.get(key) ?? [];
    g.push({ id: r.id, session: r.session_id, title: r.title, spec });
    groups.set(key, g);
  }
  const out: Proposal[] = [];
  for (const g of groups.values()) {
    const sessions = new Set(g.map((x) => x.session)).size;
    if (sessions < PROPOSE_AT) continue;
    const specs = g.map((x) => x.spec);
    const { template, values } = lineUp(specs);
    const name = g[0].title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'screen';
    const kept = replayHolds(template, specs, values);
    out.push({ name, template, surfaces: g.map((x) => x.id), sessions, kept, ...(kept ? {} : { why: 'filling the template did not give every past screen back' }) });
  }
  return out;
}

/** Keeps a proposal the person said yes to, only when replay still holds for it now. */
export function keepTemplate(db: DatabaseSync, name: unknown): { name: string; file: string } {
  if (typeof name !== 'string' || !/^[a-z0-9-]{1,40}$/.test(name)) throw new RpcError(E.INVALID_PARAMS, 'name must be 1 to 40 lower-case letters, digits or dashes');
  const p = proposeTemplates(db).find((x) => x.name === name);
  if (!p) throw new RpcError(E.NOT_FOUND, `no proposed template called ${name}`);
  if (!p.kept) throw new RpcError(E.VALIDATION, `${name} lost on replay: ${p.why}`);
  const file = path.join(homeDir(), 'templates', `${name}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(p.template, null, 1));
  return { name, file };
}
