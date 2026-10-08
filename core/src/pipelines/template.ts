import crypto from 'node:crypto';

export interface Ref {
  raw: string;
  root: 'inputs' | 'steps' | 'run' | 'project' | 'pipeline' | 'port' | 'variants' | 'index';
  name?: string;
  step?: string;
  field?: 'outputs' | 'output_path';
  key?: string;
  index?: number | 'i';
}

const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** Parses one reference; null when it is outside the allowed grammar in pipeline.schema.json. */
export function parseRef(expr: string): Ref | null {
  let m = /^inputs\.([A-Za-z0-9_-]+)$/.exec(expr);
  if (m) return { raw: expr, root: 'inputs', name: m[1] };
  m = /^steps\.([a-z0-9-]+)\.output_path$/.exec(expr);
  if (m) return { raw: expr, root: 'steps', step: m[1], field: 'output_path' };
  m = /^steps\.([a-z0-9-]+)\.outputs\.([A-Za-z0-9_-]+)(?:\[(\d+|i)\])?$/.exec(expr);
  if (m) return { raw: expr, root: 'steps', step: m[1], field: 'outputs', key: m[2], index: m[3] === undefined ? undefined : m[3] === 'i' ? 'i' : Number(m[3]) };
  if (expr === 'run.dir' || expr === 'run.id') return { raw: expr, root: 'run', name: expr.slice(4) };
  if (expr === 'project.path') return { raw: expr, root: 'project', name: 'path' };
  if (expr === 'pipeline.dir') return { raw: expr, root: 'pipeline', name: 'dir' };
  if (expr === 'port') return { raw: expr, root: 'port' };
  if (expr === 'index') return { raw: expr, root: 'index' };
  m = /^variants\.picked\.(worktree|branch)$/.exec(expr);
  if (m) return { raw: expr, root: 'variants', key: m[1] };
  return null;
}

export function refsIn(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((m) => m[1]);
}

/** Every template string in a value: strings themselves, and string leaves of objects and arrays. */
export function templateStrings(v: unknown): string[] {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(templateStrings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(templateStrings);
  return [];
}

export interface Scope {
  inputs: Record<string, unknown>;
  steps: (id: string) => { outputs: unknown[]; outputPaths: string[]; fanout: boolean } | null;
  run: { id: string; dir: string };
  project: { path: string };
  pipeline?: { dir: string };
  picked?: () => { worktree: string; branch: string } | null;
  index?: number;
  port?: number;
}

function show(v: unknown): string {
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function lookup(ref: Ref, scope: Scope): unknown {
  switch (ref.root) {
    case 'inputs':
      return scope.inputs[ref.name as string];
    case 'run':
      return ref.name === 'id' ? scope.run.id : scope.run.dir;
    case 'project':
      return scope.project.path;
    case 'pipeline':
      if (!scope.pipeline) throw new Error('{{pipeline.dir}} needs a pipeline file on disk');
      return scope.pipeline.dir;
    case 'port':
      if (scope.port === undefined) throw new Error('{{port}} is only available to dev_command');
      return scope.port;
    case 'index':
      if (scope.index === undefined) throw new Error('{{index}} is only available in a fan-out step');
      return scope.index;
    case 'variants': {
      const v = scope.picked?.();
      if (!v) throw new Error('no variant is picked; pick a tile, then Continue');
      return ref.key === 'branch' ? v.branch : v.worktree;
    }
    case 'steps': {
      const s = scope.steps(ref.step as string);
      if (!s) throw new Error(`step ${ref.step} has no result yet`);
      if (ref.field === 'output_path') return s.outputPaths.join('\n');
      const values = s.outputs.map((o) => (o as Record<string, unknown> | null)?.[ref.key as string]);
      const base: unknown = s.fanout ? values : values[0];
      if (ref.index === undefined) return base;
      const i = ref.index === 'i' ? scope.index : ref.index;
      if (i === undefined) throw new Error(`${ref.raw} uses [i] outside a fan-out step`);
      return Array.isArray(base) ? base[i] : undefined;
    }
  }
}

export function resolveString(text: string, scope: Scope): string {
  return text.replace(TOKEN, (_m, expr: string) => {
    const ref = parseRef(expr);
    if (!ref) throw new Error(`unknown reference {{${expr}}}`);
    return show(lookup(ref, scope));
  });
}

/** Resolves every string leaf of a `with` object or a template string. */
export function resolveValue(v: unknown, scope: Scope): unknown {
  if (typeof v === 'string') return resolveString(v, scope);
  if (Array.isArray(v)) return v.map((x) => resolveValue(x, scope));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveValue(x, scope)]));
  return v;
}

/** JSON with object keys sorted and no whitespace. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function actionHash(v: Record<string, unknown>): string {
  return sha256(canonicalJson(v));
}

/** Front matter between leading `---` lines: `key: value` scalars (JSON values allowed) and `- item` lists. */
export function parseFrontMatter(text: string): Record<string, unknown> | null {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return null;
  const out: Record<string, unknown> = {};
  let listKey: string | null = null;
  for (let n = 1; n < lines.length; n++) {
    const line = lines[n];
    if (line.trim() === '---') return out;
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s+(.*)$/.exec(line) ?? /^-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (out[listKey] as unknown[]).push(scalar(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    if (kv[2] === '') {
      out[kv[1]] = [];
      listKey = kv[1];
    } else {
      out[kv[1]] = scalar(kv[2]);
      listKey = null;
    }
  }
  return null;
}

function scalar(s: string): unknown {
  const t = s.trim();
  if (/^(true|false|null)$/.test(t) || /^-?\d+(\.\d+)?$/.test(t) || /^[[{"]/.test(t)) {
    try {
      return JSON.parse(t);
    } catch {}
  }
  if (/^'.*'$/.test(t)) return t.slice(1, -1);
  return t;
}
