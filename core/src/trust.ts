import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonicalPath } from './project.ts';
import type { EngineSpec, TrustSpec } from './engines/registry.ts';

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
  if (text.includes(header)) return;
  const body = Object.entries(spec.set ?? {}).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join('\n');
  fs.writeFileSync(file, `${text}${text.endsWith('\n') ? '' : '\n'}\n${header}\n${body}\n`);
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
