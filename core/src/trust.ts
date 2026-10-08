import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalPath } from './project.ts';
import { loadEngines, type EngineSpec, type TrustSpec } from './engines/registry.ts';

const BS = String.fromCharCode(92);

export function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p;
}

function styled(dir: string, style: TrustSpec['path_style']): string {
  const posix = canonicalPath(dir);
  if (style === 'posix') return posix;
  const win = posix.split('/').join(BS);
  return style === 'windows-lower' ? win.toLowerCase() : win;
}

function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.troop-tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function descend(root: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  let node = root;
  for (const k of keys) {
    if (!node[k] || typeof node[k] !== 'object' || Array.isArray(node[k])) node[k] = {};
    node = node[k] as Record<string, unknown>;
  }
  return node;
}

function applyJsonMap(file: string, spec: TrustSpec, key: string): void {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const map = descend(doc, spec.at);
  const current = (map[key] && typeof map[key] === 'object' ? map[key] : {}) as Record<string, unknown>;
  if (Object.entries(spec.set ?? {}).every(([k, v]) => current[k] === v)) return;
  map[key] = { ...current, ...spec.set };
  writeAtomic(file, JSON.stringify(doc, null, 2));
}

function applyJsonList(file: string, spec: TrustSpec, key: string): void {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const parent = descend(doc, spec.at.slice(0, -1));
  const field = spec.at[spec.at.length - 1];
  const list = Array.isArray(parent[field]) ? (parent[field] as unknown[]) : [];
  if (list.some((p) => typeof p === 'string' && p.toLowerCase() === key.toLowerCase())) return;
  parent[field] = [...list, key];
  writeAtomic(file, JSON.stringify(doc, null, 2));
}

function applyTomlTable(file: string, spec: TrustSpec, key: string): void {
  if (key.includes("'")) throw new Error('path cannot be a TOML literal key');
  const text = fs.readFileSync(file, 'utf8');
  const header = `[${spec.at.join('.')}.'${key}']`;
  const basic = `[${spec.at.join('.')}.${JSON.stringify(key)}]`;
  if (text.split(/\r?\n/).some((l) => l.trim() === header || l.trim() === basic)) return;
  const body = Object.entries(spec.set ?? {}).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n');
  writeAtomic(file, `${text}${text.endsWith('\n') ? '' : '\n'}\n${header}\n${body}\n`);
}

function removeKey(file: string, spec: TrustSpec, key: string): void {
  if (spec.kind === 'toml-table') {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const headers = [`[${spec.at.join('.')}.'${key}']`, `[${spec.at.join('.')}.${JSON.stringify(key)}]`];
    const start = lines.findIndex((l) => headers.includes(l.trim()));
    if (start < 0) return;
    let end = lines.findIndex((l, i) => i > start && l.trim().startsWith('['));
    if (end < 0) end = lines.at(-1) === '' ? lines.length - 1 : lines.length;
    const from = start > 0 && lines[start - 1].trim() === '' ? start - 1 : start;
    writeAtomic(file, [...lines.slice(0, from), ...lines.slice(end)].join('\n'));
    return;
  }
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (spec.kind === 'json-map') {
    const map = spec.at.reduce<any>((n, k) => (n && typeof n === 'object' ? n[k] : undefined), doc);
    if (!map || typeof map !== 'object' || !(key in map)) return;
    delete map[key];
  } else {
    const parent = spec.at.slice(0, -1).reduce<any>((n, k) => (n && typeof n === 'object' ? n[k] : undefined), doc);
    const field = spec.at[spec.at.length - 1];
    if (!parent || !Array.isArray(parent[field])) return;
    const kept = parent[field].filter((p: unknown) => !(typeof p === 'string' && p.toLowerCase() === key.toLowerCase()));
    if (kept.length === parent[field].length) return;
    parent[field] = kept;
  }
  writeAtomic(file, JSON.stringify(doc, null, 2));
}

/** Removes a folder's trust entries from every engine's trust store, for a worktree that is being removed; returns the engine ids whose store it read. */
export function untrustFolder(dir: string, engines: EngineSpec[] = loadEngines()): string[] {
  let real = dir;
  try { real = fs.realpathSync.native(dir); } catch {}
  const done: string[] = [];
  for (const e of engines) {
    const spec = e.trust;
    if (!spec) continue;
    const file = expandHome(spec.file);
    if (!fs.existsSync(file)) continue;
    try {
      removeKey(file, spec, styled(real, spec.path_style));
      done.push(e.id);
    } catch {
      // a store we cannot parse is left untouched
    }
  }
  return done;
}

/** Marks a folder as trusted for every engine that declares a trust store; returns the engine ids it updated. */
export function trustFolder(dir: string, engines: EngineSpec[]): string[] {
  const done: string[] = [];
  for (const e of engines) {
    const spec = e.trust;
    if (!spec) continue;
    const file = expandHome(spec.file);
    if (!fs.existsSync(file)) continue;
    const key = styled(dir, spec.path_style);
    try {
      if (spec.kind === 'json-map') applyJsonMap(file, spec, key);
      else if (spec.kind === 'json-list') applyJsonList(file, spec, key);
      else applyTomlTable(file, spec, key);
      done.push(e.id);
    } catch {
      // a store we cannot parse is left untouched
    }
  }
  return done;
}
