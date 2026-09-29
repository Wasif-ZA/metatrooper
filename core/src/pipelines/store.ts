import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { repoDir } from '../paths.ts';
import { nowIso } from '../time.ts';
import { listPlugins, loadPlugin } from '../plugins/store.ts';
import { MANIFEST_FILE, readManifest, validateManifest, type ActionSpec, type Manifest } from '../plugins/manifest.ts';
import { validatePipeline, type Pipeline, type ValidationContext } from './validate.ts';

interface Found {
  id: string;
  source: string;
  path: string;
  json: unknown;
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function jsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => path.join(dir, f)).sort();
}

/** Every pipeline file the core can see; a later source wins on a clashing id (built-in, then plugin, then project). */
export function scanPipelines(db: DatabaseSync): Map<string, Found> {
  const found = new Map<string, Found>();
  const add = (source: string, file: string) => {
    const json = readJson(file) as { id?: unknown } | null;
    const id = typeof json?.id === 'string' ? json.id : path.basename(file, '.json');
    found.set(id, { id, source, path: file, json });
  };
  for (const f of jsonFiles(path.join(repoDir, 'pipelines'))) add('builtin', f);
  for (const p of listPlugins(db)) {
    if (!p.enabled) continue;
    for (const rel of p.manifest.pipelines ?? []) add(`plugin:${p.id}`, path.resolve(p.path, rel));
  }
  for (const row of db.prepare('SELECT path FROM project ORDER BY last_opened').all() as Array<{ path: string }>) {
    for (const f of jsonFiles(path.join(row.path, '.troop', 'pipelines'))) add('project', f);
  }
  return found;
}

export function validationContext(db: DatabaseSync, found: Map<string, Found>, dir: string | null): ValidationContext {
  return {
    dir,
    pipeline: (id) => (found.get(id)?.json as Pipeline | undefined) ?? null,
    action: (pluginId, actionId) => pluginAction(db, pluginId, actionId),
  };
}

export function pluginAction(db: DatabaseSync, pluginId: string, actionId: string): ActionSpec | null {
  return (loadPlugin(db, pluginId)?.manifest.actions ?? []).find((a) => a.id === actionId) ?? null;
}

/** Scans every source and upserts `pipeline` rows with their validation result. */
export function syncPipelines(db: DatabaseSync): Map<string, Found> {
  const found = scanPipelines(db);
  const up = db.prepare(
    `INSERT INTO pipeline (id, source, path, version, valid, errors) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET source = excluded.source, path = excluded.path, version = excluded.version,
       valid = excluded.valid, errors = excluded.errors`,
  );
  for (const f of found.values()) {
    const errors = f.json === null ? ['file is not valid JSON'] : validatePipeline(f.json, validationContext(db, found, path.dirname(f.path)));
    const version = Math.floor(fs.statSync(f.path).mtimeMs / 1000);
    up.run(f.id, f.source, f.path, version, errors.length ? 0 : 1, errors.length ? JSON.stringify(errors) : null);
  }
  return found;
}

/** Registers first-party plugins shipped in the repo's `plugins/` folder as source `builtin`, approved as declared. */
export function syncBuiltinPlugins(db: DatabaseSync): void {
  const dir = path.join(repoDir, 'plugins');
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    const root = path.join(dir, name);
    if (!fs.existsSync(path.join(root, MANIFEST_FILE))) continue;
    let manifest: unknown;
    try {
      manifest = readManifest(root).manifest;
    } catch {
      continue;
    }
    if (validateManifest(manifest, root).length) continue;
    const m = manifest as Manifest;
    const existing = db.prepare('SELECT source FROM plugin WHERE id = ?').get(m.id) as { source: string } | undefined;
    if (existing && existing.source !== 'builtin') continue;
    db.prepare(
      `INSERT INTO plugin (id, version, path, manifest, source, permissions, enabled, installed_at) VALUES (?, ?, ?, ?, 'builtin', ?, 1, ?)
       ON CONFLICT(id) DO UPDATE SET version = excluded.version, path = excluded.path, manifest = excluded.manifest, permissions = excluded.permissions`,
    ).run(m.id, m.version, root, JSON.stringify(m), JSON.stringify(m.permissions ?? []), nowIso());
  }
}
