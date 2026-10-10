import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { repoDir } from '../paths.ts';
import { validate } from '../jsonschema.ts';
import { secretStoreWarning } from '../secrets.ts';
import type { EngineSpec } from '../engines/registry.ts';

export interface ActionSpec {
  id: string;
  title?: string;
  run: string[];
  external?: boolean;
  destination_field?: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  timeout_seconds?: number;
}

export interface McpSpec {
  id: string;
  command?: string;
  args?: string[];
  env_keys?: string[];
  env?: Record<string, string>;
  engines: string[];
  transport?: 'stdio' | 'http';
  url?: string;
  headers?: Record<string, string>;
  auth?: 'none' | 'header' | 'engine-oauth';
  writes?: 'none' | 'project' | 'external';
}

/** Secret names a header value templates, in order. */
export function headerSecretNames(value: string): string[] {
  return [...value.matchAll(/\$\{([A-Z][A-Z0-9_]{0,63})\}/g)].map((m) => m[1]);
}

/** An http server with no `writes` counts as external. */
export function mcpWrites(s: McpSpec): 'none' | 'project' | 'external' {
  return s.writes ?? (s.transport === 'http' ? 'external' : 'none');
}

export interface Manifest {
  schema: 1;
  id: string;
  version: string;
  name: string;
  description?: string;
  platforms?: string[];
  permissions?: string[];
  engines?: EngineSpec[];
  actions?: ActionSpec[];
  pipelines?: string[];
  panes?: Array<{ id: string; title?: string; entry: string }>;
  mcp?: McpSpec[];
  pane_methods?: string[];
}

export const MANIFEST_FILE = 'troop-plugin.json';

export const PANE_FORBIDDEN_METHODS = new Set([
  'core.stop', 'ui.hello', 'gate.resolve', 'hooks.install', 'hooks.uninstall',
  'plugin.install', 'plugin.remove', 'plugin.preview', 'plugin.secret.set', 'mcp.resolve', 'mcp.missing',
  'notify.sink.set', 'notify.sink.test', 'notify.sink.remove',
]);

let schemaCache: Record<string, unknown> | null = null;

function manifestSchema(): Record<string, unknown> {
  schemaCache ??= JSON.parse(fs.readFileSync(path.join(repoDir, 'contracts', 'plugin-manifest.schema.json'), 'utf8'));
  return schemaCache as Record<string, unknown>;
}

export function engineSchemaErrors(engine: unknown): string[] {
  const root = manifestSchema();
  return validate({ $ref: '#/$defs/engine' }, engine, root);
}

export function currentPlatform(): string {
  return process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
}

export function manifestHash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** Reads troop-plugin.json from a plugin folder; throws with a readable message when it is missing or not JSON. */
export function readManifest(dir: string): { manifest: unknown; text: string } {
  const file = path.join(dir, MANIFEST_FILE);
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    throw new Error(`no ${MANIFEST_FILE} in ${dir}`);
  }
  try {
    return { manifest: JSON.parse(text), text };
  } catch (e) {
    throw new Error(`${MANIFEST_FILE} is not valid JSON: ${(e as Error).message}`);
  }
}

export function insideDir(root: string, rel: string): string | null {
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null;
  const abs = path.resolve(root, rel);
  const r = path.relative(root, abs);
  if (r === '' || r.startsWith('..') || path.isAbsolute(r)) return null;
  return abs;
}

function isPathLike(cmd: string): boolean {
  return cmd.includes('/') || cmd.includes(String.fromCharCode(92));
}

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

/** Schema errors first; the rules the schema cannot say follow, checked only when the shape is right. */
export function validateManifest(manifest: unknown, dir: string | null): string[] {
  const errors = validate(manifestSchema(), manifest);
  if (errors.length) return errors;
  const m = manifest as Manifest;
  const perms = new Set(m.permissions ?? []);

  for (const [list, name] of [[m.engines, 'engines'], [m.actions, 'actions'], [m.panes, 'panes'], [m.mcp, 'mcp']] as const) {
    for (const id of duplicates((list ?? []).map((x) => x.id))) errors.push(`/${name}: duplicate id ${id}`);
  }
  (m.mcp ?? []).forEach((s, i) => {
    for (const [h, value] of Object.entries(s.headers ?? {})) {
      for (const key of headerSecretNames(value)) {
        if (!perms.has(`secrets:${key}`)) errors.push(`/mcp/${i}/headers/${h}: ${key} needs the permission secrets:${key}`);
      }
    }
    for (const key of s.env_keys ?? []) {
      if (!perms.has(`secrets:${key}`)) errors.push(`/mcp/${i}/env_keys: ${key} needs the permission secrets:${key}`);
      if (s.env && key in s.env) errors.push(`/mcp/${i}/env: ${key} is a secret in env_keys and cannot also be a literal`);
    }
  });
  (m.pane_methods ?? []).forEach((method, i) => {
    if (PANE_FORBIDDEN_METHODS.has(method)) errors.push(`/pane_methods/${i}: ${method} cannot be called from a pane`);
  });
  if (dir) {
    (m.actions ?? []).forEach((a, i) => {
      if (isPathLike(a.run[0]) && !insideDir(dir, a.run[0])) errors.push(`/actions/${i}/run/0: path must stay inside the plugin folder`);
      else if (isPathLike(a.run[0]) && !fs.existsSync(insideDir(dir, a.run[0]) as string)) errors.push(`/actions/${i}/run/0: ${a.run[0]} does not exist`);
    });
    (m.panes ?? []).forEach((p, i) => {
      const abs = insideDir(dir, p.entry);
      if (!abs) errors.push(`/panes/${i}/entry: path must stay inside the plugin folder`);
      else if (!fs.existsSync(abs)) errors.push(`/panes/${i}/entry: ${p.entry} does not exist`);
    });
    (m.pipelines ?? []).forEach((p, i) => {
      const abs = insideDir(dir, p);
      if (!abs) errors.push(`/pipelines/${i}: path must stay inside the plugin folder`);
      else if (!fs.existsSync(abs)) errors.push(`/pipelines/${i}: ${p} does not exist`);
    });
  }
  return errors;
}

const PERMISSION_WORDS: Record<string, string> = {
  'project:read': 'Read files in the project folder (declared only: Windows does not block other reads)',
  'project:write': 'Change files in the project folder (declared only: Windows does not block other writes)',
  'run:write': 'Write files in the run folder',
  network: 'Connect to the internet (declared only: MetaTrooper does not block network access)',
  browser: 'Drive browser panes it opens through the core',
  clipboard: 'Write to the clipboard',
};

export function describePermission(p: string): string {
  if (p.startsWith('secrets:')) return `Receive the secret ${p.slice(8)} as an environment variable`;
  return PERMISSION_WORDS[p] ?? p;
}

export interface InstallScreen {
  plugin: { id: string; name: string; version: string; description: string };
  permissions: Array<{ permission: string; text: string; new: boolean }>;
  external_actions: Array<{ id: string; title: string; destination_field: string }>;
  engines: Array<{ id: string; command: string; roles: string[] }>;
  mcp_servers: Array<{ id: string; command: string; engines: string[]; host?: string; signin?: string; writes?: string }>;
  warnings: string[];
}

/** The facts the install screen shows, in plain words; `previous` marks permissions an upgrade adds. */
export function installScreen(m: Manifest, previous: string[] | null): InstallScreen {
  const before = new Set(previous ?? []);
  const warnings = [
    'Plugins run as you. Windows does not sandbox their files or network in this version; only secrets, browser and clipboard are enforced.',
  ];
  if ((m.permissions ?? []).includes('network')) warnings.push('This plugin connects to the internet, and MetaTrooper does not block it.');
  const storeWarning = (m.permissions ?? []).some((p) => p.startsWith('secrets:')) ? secretStoreWarning() : null;
  if (storeWarning) warnings.push(storeWarning);
  if (previous && (m.permissions ?? []).some((p) => !before.has(p))) warnings.push('This version asks for permissions the installed version did not have.');
  return {
    plugin: { id: m.id, name: m.name, version: m.version, description: m.description ?? '' },
    permissions: (m.permissions ?? []).map((p) => ({ permission: p, text: describePermission(p), new: previous !== null && !before.has(p) })),
    external_actions: (m.actions ?? []).filter((a) => a.external).map((a) => ({ id: a.id, title: a.title ?? a.id, destination_field: a.destination_field ?? '' })),
    engines: (m.engines ?? []).map((e) => ({ id: e.id, command: e.command, roles: e.roles })),
    mcp_servers: (m.mcp ?? []).map((s) => s.transport === 'http'
      ? { id: s.id, command: s.url ?? '', engines: s.engines, host: new URL(s.url ?? 'https://invalid').host, signin: s.headers ? 'MetaTrooper (header secret)' : 'the engine', writes: mcpWrites(s) }
      : { id: s.id, command: [s.command, ...(s.args ?? [])].join(' '), engines: s.engines }),
    warnings,
  };
}
