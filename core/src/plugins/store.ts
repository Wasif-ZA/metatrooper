import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { homeDir } from '../paths.ts';
import { nowIso, ulid } from '../time.ts';
import { tx } from '../store/db.ts';
import { E, RpcError } from '../pipe/errors.ts';
import { deleteSecrets, hasSecret, setSecret } from '../secrets.ts';
import {
  currentPlatform, installScreen, manifestHash, MANIFEST_FILE, readManifest, validateManifest,
  type InstallScreen, type Manifest,
} from './manifest.ts';
import { importFromSource, type EnvBinding, type ImportPlan } from './importers.ts';

export type PluginSource = 'native' | 'claude-import' | 'codex-import' | 'agy-import' | 'builtin';

export interface InstalledPlugin {
  id: string;
  version: string;
  path: string;
  manifest: Manifest;
  source: PluginSource;
  permissions: string[];
  enabled: boolean;
}

/** Written next to an imported plugin's manifest. Holds `${VAR}` names and where values live, never a value. */
export interface ImportRecord {
  source: PluginSource;
  original: string;
  env: Record<string, Record<string, { kind: 'dpapi' } | { kind: 'ref'; name: string }>>;
  skills: string[];
  hooks: string[];
  skipped: string[];
}

export const IMPORT_FILE = 'import.json';

export function pluginsDir(): string {
  return path.join(homeDir(), 'plugins');
}

function isGitUrl(s: string): boolean {
  return /^(https?:\/\/|ssh:\/\/|git@|git:\/\/)/.test(s) || /\.git$/.test(s);
}

interface Prepared {
  dir: string;
  text: string;
  manifest: unknown;
  source: PluginSource;
  staged: boolean;
  imported: ImportPlan | null;
  errors: string[];
}

function prepare(source: string): Prepared {
  const imported = importFromSource(source);
  if (imported) {
    const text = JSON.stringify(imported.manifest, null, 2) + '\n';
    return { dir: '', text, manifest: imported.manifest, source: imported.source, staged: false, imported, errors: imported.errors };
  }
  if (isGitUrl(source)) {
    const dir = path.join(pluginsDir(), `.staging-${ulid().toLowerCase()}`);
    fs.mkdirSync(pluginsDir(), { recursive: true });
    try {
      execFileSync('git', ['clone', '--depth', '1', '--', source, dir], { stdio: 'pipe', timeout: 120_000, windowsHide: true });
    } catch (e) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new RpcError(E.VALIDATION, `git clone failed: ${String((e as { stderr?: Buffer }).stderr ?? e).trim()}`, { errors: ['git clone failed'] });
    }
    return { ...readOrFail(dir, true), source: 'native', staged: true, imported: null };
  }
  const dir = path.resolve(source);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new RpcError(E.NOT_FOUND, `plugin folder not found: ${source}`);
  return { ...readOrFail(dir, false), source: 'native', staged: false, imported: null };
}

function readOrFail(dir: string, staged: boolean): { dir: string; text: string; manifest: unknown; errors: string[] } {
  try {
    const { manifest, text } = readManifest(dir);
    return { dir, text, manifest, errors: [] };
  } catch (e) {
    if (staged) fs.rmSync(dir, { recursive: true, force: true });
    throw new RpcError(E.VALIDATION, (e as Error).message, { errors: [(e as Error).message] });
  }
}

function discard(p: Prepared): void {
  if (p.staged) fs.rmSync(p.dir, { recursive: true, force: true });
}

function checks(db: DatabaseSync, p: Prepared): string[] {
  const errors = [...p.errors, ...validateManifest(p.manifest, p.dir || null)];
  if (errors.length) return errors;
  const m = p.manifest as Manifest;
  const platforms = m.platforms ?? ['windows'];
  if (!platforms.includes(currentPlatform())) errors.push(`/platforms: this plugin does not support ${currentPlatform()}`);
  for (const e of m.engines ?? []) {
    const owner = db.prepare('SELECT plugin_id FROM engine WHERE id = ?').get(e.id) as { plugin_id: string | null } | undefined;
    if (owner && owner.plugin_id !== m.id) errors.push(`/engines: engine id ${e.id} is already used by ${owner.plugin_id ?? 'a built-in engine'}`);
  }
  return errors;
}

export interface Preview {
  valid: boolean;
  errors: string[];
  manifest_hash: string;
  source: PluginSource;
  screen: (InstallScreen & { skills: string[]; hooks: string[]; skipped: string[]; secrets_migrated: string[] }) | null;
}

export function previewPlugin(db: DatabaseSync, source: string): Preview {
  const p = prepare(source);
  try {
    const errors = checks(db, p);
    const hash = manifestHash(p.text);
    if (errors.length) return { valid: false, errors, manifest_hash: hash, source: p.source, screen: null };
    const m = p.manifest as Manifest;
    const prev = db.prepare('SELECT permissions FROM plugin WHERE id = ?').get(m.id) as { permissions: string } | undefined;
    const screen = installScreen(m, prev ? JSON.parse(prev.permissions) : null);
    return {
      valid: true,
      errors: [],
      manifest_hash: hash,
      source: p.source,
      screen: {
        ...screen,
        skills: p.imported?.skills ?? [],
        hooks: p.imported?.hooks ?? [],
        skipped: p.imported?.skipped ?? [],
        secrets_migrated: literalKeys(p.imported),
      },
    };
  } finally {
    discard(p);
  }
}

function literalKeys(plan: ImportPlan | null): string[] {
  const keys = new Set<string>();
  for (const env of Object.values(plan?.env ?? {})) for (const [k, b] of Object.entries(env)) if (b.kind === 'literal') keys.add(k);
  return [...keys].sort();
}

export interface InstallRequest {
  source: string;
  approved_permissions: string[];
  manifest_hash?: string;
  secrets?: Record<string, string>;
}

export function installPlugin(db: DatabaseSync, req: InstallRequest): { plugin_id: string; missing_secrets: string[] } {
  const p = prepare(req.source);
  try {
    const errors = checks(db, p);
    if (errors.length) throw new RpcError(E.VALIDATION, 'plugin manifest is invalid', { errors });
    if (req.manifest_hash && req.manifest_hash !== manifestHash(p.text)) {
      throw new RpcError(E.VALIDATION, 'the plugin changed since the install screen was shown', { errors: ['manifest_hash differs'] });
    }
    const m = p.manifest as Manifest;
    const asked = new Set(m.permissions ?? []);
    const approved = new Set(req.approved_permissions);
    const unapproved = [...asked].filter((x) => !approved.has(x));
    const extra = [...approved].filter((x) => !asked.has(x));
    if (unapproved.length || extra.length) {
      throw new RpcError(E.VALIDATION, 'approved permissions must match the permissions the plugin asks for', {
        errors: [...unapproved.map((x) => `not approved: ${x}`), ...extra.map((x) => `not asked for: ${x}`)],
      });
    }
    for (const name of Object.keys(req.secrets ?? {})) {
      if (!asked.has(`secrets:${name}`)) throw new RpcError(E.VALIDATION, `secret ${name} has no secrets:${name} permission`, { errors: [`not asked for: secrets:${name}`] });
    }

    const finalDir = placeFiles(p, m);
    tx(db, () => {
      const now = nowIso();
      db.prepare(
        `INSERT INTO plugin (id, version, path, manifest, source, permissions, enabled, installed_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
         ON CONFLICT(id) DO UPDATE SET version = excluded.version, path = excluded.path, manifest = excluded.manifest,
           source = excluded.source, permissions = excluded.permissions, enabled = 1, installed_at = excluded.installed_at`,
      ).run(m.id, m.version, finalDir, JSON.stringify(m), p.source, JSON.stringify([...asked]), now);
      const keep = new Set((m.engines ?? []).map((e) => e.id));
      for (const row of db.prepare('SELECT id FROM engine WHERE plugin_id = ?').all(m.id) as Array<{ id: string }>) {
        if (!keep.has(row.id)) dropEngine(db, row.id);
      }
      const up = db.prepare(
        `INSERT INTO engine (id, plugin_id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET spec_json = excluded.spec_json, cost_rank = excluded.cost_rank, provider = excluded.provider`,
      );
      for (const e of m.engines ?? []) up.run(e.id, m.id, JSON.stringify(e), e.cost_rank, e.provider ?? 'local-cli');
      db.prepare("UPDATE needs_you SET resolved_at = ? WHERE kind = 'missing-secret' AND ref = ? AND resolved_at IS NULL").run(now, m.id);
    });

    for (const [name, value] of Object.entries(req.secrets ?? {})) setSecret(db, m.id, name, value);
    for (const env of Object.values(p.imported?.env ?? {})) {
      for (const [name, b] of Object.entries(env)) if (b.kind === 'literal' && !(req.secrets ?? {})[name]) setSecret(db, m.id, name, b.value);
    }
    const refs = new Set<string>();
    for (const env of Object.values(p.imported?.env ?? {})) for (const [k, b] of Object.entries(env)) if (b.kind === 'ref') refs.add(k);
    const missing = [...asked].filter((x) => x.startsWith('secrets:')).map((x) => x.slice(8)).filter((k) => !refs.has(k) && !hasSecret(m.id, k));
    for (const name of missing) raiseMissingSecret(db, m.id, name);
    return { plugin_id: m.id, missing_secrets: missing };
  } catch (e) {
    discard(p);
    throw e;
  }
}

function placeFiles(p: Prepared, m: Manifest): string {
  const target = path.join(pluginsDir(), m.id);
  if (p.imported) {
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, MANIFEST_FILE), p.text);
    const record: ImportRecord = {
      source: p.imported.source,
      original: p.imported.original,
      env: Object.fromEntries(Object.entries(p.imported.env).map(([server, env]) => [
        server,
        Object.fromEntries(Object.entries(env).map(([k, b]: [string, EnvBinding]) => [k, b.kind === 'ref' ? { kind: 'ref' as const, name: b.name } : { kind: 'dpapi' as const }])),
      ])),
      skills: p.imported.skills,
      hooks: p.imported.hooks,
      skipped: p.imported.skipped,
    };
    fs.writeFileSync(path.join(target, IMPORT_FILE), JSON.stringify(record, null, 2) + '\n');
    return target;
  }
  if (p.staged) {
    fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(p.dir, target);
    p.staged = false;
    return target;
  }
  return p.dir;
}

export function raiseMissingSecret(db: DatabaseSync, pluginId: string, name: string): void {
  const text = `set ${name} for ${pluginId}`;
  const open = db.prepare("SELECT id FROM needs_you WHERE kind = 'missing-secret' AND ref = ? AND text = ? AND resolved_at IS NULL").get(pluginId, text);
  if (!open) db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'missing-secret', ?, ?)").run(ulid(), nowIso(), pluginId, text);
}

function engineInUse(db: DatabaseSync, id: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM session WHERE engine_id = ? LIMIT 1').get(id) ?? db.prepare('SELECT 1 FROM run_step WHERE engine_id = ? LIMIT 1').get(id),
  );
}

function dropEngine(db: DatabaseSync, id: string): boolean {
  if (engineInUse(db, id)) return false;
  db.prepare('DELETE FROM engine_check WHERE engine_id = ?').run(id);
  db.prepare('DELETE FROM engine WHERE id = ?').run(id);
  return true;
}

/** Removes a plugin, its files under ~/.metatrooper/plugins and its secrets; engines that sessions still name keep their row, disabled. */
export function removePlugin(db: DatabaseSync, id: string): void {
  const row = db.prepare('SELECT path FROM plugin WHERE id = ?').get(id) as { path: string } | undefined;
  if (!row) throw new RpcError(E.NOT_FOUND, 'plugin not found');
  tx(db, () => {
    let kept = false;
    for (const e of db.prepare('SELECT id FROM engine WHERE plugin_id = ?').all(id) as Array<{ id: string }>) {
      if (!dropEngine(db, e.id)) kept = true;
    }
    deleteSecrets(db, id);
    db.prepare("UPDATE needs_you SET resolved_at = ? WHERE kind = 'missing-secret' AND ref = ? AND resolved_at IS NULL").run(nowIso(), id);
    if (kept) db.prepare('UPDATE plugin SET enabled = 0 WHERE id = ?').run(id);
    else db.prepare('DELETE FROM plugin WHERE id = ?').run(id);
  });
  const managed = path.resolve(pluginsDir());
  const rel = path.relative(managed, path.resolve(row.path));
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) fs.rmSync(row.path, { recursive: true, force: true });
}

function toPlugin(r: Record<string, unknown>): InstalledPlugin {
  return {
    id: String(r.id),
    version: String(r.version),
    path: String(r.path),
    manifest: JSON.parse(String(r.manifest)) as Manifest,
    source: r.source as PluginSource,
    permissions: JSON.parse(String(r.permissions)) as string[],
    enabled: Number(r.enabled) === 1,
  };
}

/** An installed, enabled plugin; null otherwise, so nothing from an unapproved or removed plugin can run. */
export function loadPlugin(db: DatabaseSync, id: string): InstalledPlugin | null {
  const r = db.prepare('SELECT * FROM plugin WHERE id = ? AND enabled = 1').get(id) as Record<string, unknown> | undefined;
  return r ? toPlugin(r) : null;
}

export function listPlugins(db: DatabaseSync): InstalledPlugin[] {
  return (db.prepare('SELECT * FROM plugin ORDER BY id').all() as Array<Record<string, unknown>>).map(toPlugin);
}

export function readImportRecord(plugin: InstalledPlugin): ImportRecord | null {
  const f = path.join(plugin.path, IMPORT_FILE);
  return plugin.source.endsWith('-import') && fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as ImportRecord) : null;
}

export function setPluginSecret(db: DatabaseSync, pluginId: string, name: string, value: string): void {
  const plugin = loadPlugin(db, pluginId);
  if (!plugin) throw new RpcError(E.NOT_FOUND, 'plugin not found');
  if (!plugin.permissions.includes(`secrets:${name}`)) throw new RpcError(E.VALIDATION, `${pluginId} was not approved for secrets:${name}`, { errors: [`not approved: secrets:${name}`] });
  setSecret(db, pluginId, name, value);
  db.prepare("UPDATE needs_you SET resolved_at = ? WHERE kind = 'missing-secret' AND ref = ? AND text = ? AND resolved_at IS NULL")
    .run(nowIso(), pluginId, `set ${name} for ${pluginId}`);
}
