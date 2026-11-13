import { KIT } from './catalogue.js';

export { KIT, VERSION } from './catalogue.js';
export const MAX_DEPTH = 12;
export const MAX_PARTS = 1500;
export const MAX_ROWS = 200;
// Parts Draw.jsx has a component for; every other catalogue part expands to the plain-text box until its batch lands.
export const DRAWN = ['page', 'section', 'header', 'text', 'table', 'buttons'];

const TYPES = { str: (v) => typeof v === 'string' || typeof v === 'number', num: Number.isFinite, bool: (v) => typeof v === 'boolean', arr: Array.isArray, obj: (v) => !!v && typeof v === 'object' && !Array.isArray(v), any: (v) => v !== undefined };
const CHILDREN = new Set(['page', 'section', 'columns', 'grid', 'fold']);
const DROP = Symbol('drop');
const CUT = new WeakMap();

const isObj = TYPES.obj;
const isPart = (v) => isObj(v) && typeof v.type === 'string';
const nameOf = (p) => (isPart(p) ? p.type.slice(0, 60) : '(no type)');
const textOf = (p) => {
  try {
    const s = String(JSON.stringify(p, null, 1));
    return s.length > 400 ? `${s.slice(0, 400)} ...` : s;
  } catch { return '(unreadable input)'; }
};

/** The plain-text box a part becomes: it has no `type`, so it can never pass for a catalogue part. */
export const fallback = (p, why) => ({ fallback: true, name: nameOf(p), why, text: textOf(p) });
export const isFallback = (p) => isObj(p) && p.fallback === true && !('type' in p);

/** A stand-in the flattener leaves where it stopped; only this module can make one. */
const cut = (p, why) => {
  const stub = {};
  CUT.set(stub, fallback(p, why));
  return stub;
};

/** Returns the same part object when it is in the catalogue with right props, else a plain-text fallback naming it. */
export function check(part) {
  if (CUT.has(part)) return CUT.get(part);
  const def = isPart(part) && Object.hasOwn(KIT, part.type) ? KIT[part.type] : null;
  if (!def) return fallback(part, 'not in the catalogue');
  const bad = Object.entries(def.req).find(([k, t]) => !TYPES[t](part[k]))?.[0]
    || Object.entries(def.opt || {}).find(([k, t]) => part[k] !== undefined && !TYPES[t](part[k]))?.[0]
    || Object.entries(def.set || {}).find(([k, s]) => part[k] !== undefined && !s.includes(part[k]))?.[0];
  return bad ? fallback(part, `wrong or missing prop: ${bad}`) : part;
}

const isFlat = (s) => isObj(s) && typeof s.type !== 'string' && typeof s.root === 'string' && isObj(s.parts);

/** Nested JSON becomes { root, parts }: parts by id, each child slot holding ids (table cells hold { ref: id }). A flat spec passes through as it is. */
export function flatten(spec) {
  if (isFlat(spec)) return { root: spec.root, parts: spec.parts };
  if (!isPart(spec)) return { root: 'p1', parts: { p1: spec } };
  const parts = {};
  let n = 0;
  const add = (p, depth) => {
    if (++n > MAX_PARTS + 1) return DROP;
    const id = `p${n}`;
    if (n > MAX_PARTS) parts[id] = cut(p, `screen too big: over ${MAX_PARTS} parts`);
    else if (depth >= MAX_DEPTH) parts[id] = cut(p, 'nested too deep');
    else parts[id] = hoist(p, depth);
    return id;
  };
  const slot = (v, depth, lvl = 0) => (Array.isArray(v)
    ? v.slice(0, MAX_PARTS + 1).map((x) => (Array.isArray(x) ? (lvl ? x : slot(x, depth, 1)) : isPart(x) ? add(x, depth + 1) : x)).filter((x) => x !== DROP)
    : v);
  const hoist = (p, depth) => {
    const o = { ...p };
    if (CHILDREN.has(p.type)) o.children = slot(p.children, depth);
    else if (p.type === 'tabs' && Array.isArray(p.tabs)) o.tabs = p.tabs.map((t) => (isObj(t) && Array.isArray(t.children) ? { ...t, children: slot(t.children, depth) } : t));
    else if (p.type === 'table' && Array.isArray(p.rows)) {
      o.rows = p.rows.map((r) => (Array.isArray(r) ? r.map((c) => { if (!isPart(c)) return c; const id = add(c, depth + 1); return id === DROP ? '' : { ref: id }; }) : r));
    }
    return o;
  };
  return { root: add(spec, 0), parts };
}

/** Turns a spec (nested or flat) into a checked nested tree of parts ready to draw, plus fellBack: what became text and why. Limits and state live in this call. */
export function expand(spec) {
  let flat;
  try { flat = flatten(spec); } catch { flat = { root: 'p1', parts: { p1: null } }; }
  const { root, parts } = flat;
  const fellBack = [];
  let n = 0;
  const fail = (id, f) => { fellBack.push({ part: String(id).slice(0, 40), type: f.name, why: f.why }); return f; };
  const build = (id, depth) => {
    if (typeof id !== 'string' || !Object.hasOwn(parts, id)) return fail(id, fallback(null, `no part with id ${JSON.stringify(String(id).slice(0, 40))}`));
    if (++n > MAX_PARTS) return n === MAX_PARTS + 1 ? fail(id, fallback(null, `screen too big: over ${MAX_PARTS} parts`)) : DROP;
    const raw = parts[id];
    const c = check(raw);
    if (c !== raw) return fail(id, c);
    if (depth >= MAX_DEPTH) return fail(id, fallback(raw, 'nested too deep'));
    if (!DRAWN.includes(raw.type)) return fail(id, fallback(raw, 'not drawn yet'));
    const str = (x, what) => (TYPES.str(x) ? String(x) : (fail(id, fallback(x, `bad ${what}`)), '?'));
    const out = { ...raw };
    if (raw.type === 'page' || raw.type === 'section') {
      out.children = raw.children.slice(0, MAX_PARTS + 1).map((x) => (typeof x === 'string' ? build(x, depth + 1) : fail(id, fallback(x, 'bad child')))).filter((x) => x !== DROP);
    } else if (raw.type === 'header' && raw.tabs) {
      out.tabs = raw.tabs.slice(0, 12).map((t) => str(t, 'tab'));
    } else if (raw.type === 'buttons') {
      out.actions = raw.actions.slice(0, 12).map((a) => (isObj(a) && TYPES.str(a.label) ? { label: String(a.label), primary: a.primary === true } : fail(id, fallback(a, 'bad button'))));
    } else if (raw.type === 'table') {
      const cols = raw.cols.slice(0, 20).map((x) => str(x, 'column'));
      const cell = (x) => (x == null ? '' : TYPES.str(x) ? String(x) : isObj(x) && typeof x.ref === 'string' ? build(x.ref, depth + 1) : fail(id, fallback(x, 'bad cell')));
      out.cols = cols;
      out.rows = raw.rows.slice(0, MAX_ROWS).map((r, i) => (Array.isArray(r) ? cols.map((_, j) => cell(r[j])).map((x) => (x === DROP ? '' : x)) : fail(id, fallback(r, `bad row ${i + 1}`))));
      out.more = Math.max(0, raw.rows.length - MAX_ROWS);
    }
    return out;
  };
  return { root: build(root, 0), fellBack };
}
