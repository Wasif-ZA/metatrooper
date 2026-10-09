import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { codexConfigFile, coreDir, homeDir } from '../paths.ts';
import { getSecret } from '../secrets.ts';
import { E, RpcError } from '../pipe/errors.ts';
import type { EngineSpec } from '../engines/registry.ts';
import { mcpWrites, type McpSpec } from './manifest.ts';
import { listPlugins, loadPlugin, raiseMissingSecret, readImportRecord } from './store.ts';

export interface ResolvedServer {
  command: string;
  args: string[];
  env: Record<string, string>;
  refs: Record<string, string>;
  missing: string[];
  headers?: Record<string, string>;
}

/** What the shim needs to start one plugin MCP server: stored secret values, `${VAR}` names it resolves itself, and what is missing. */
export function resolveMcpServer(db: DatabaseSync, pluginId: string, serverId: string): ResolvedServer {
  const plugin = loadPlugin(db, pluginId);
  if (!plugin) throw new RpcError(E.NOT_FOUND, 'plugin not found');
  const server = (plugin.manifest.mcp ?? []).find((s) => s.id === serverId);
  if (!server) throw new RpcError(E.NOT_FOUND, `MCP server ${serverId} not found in ${pluginId}`);
  if (server.transport === 'http') {
    const out: ResolvedServer = { command: '', args: [], env: {}, refs: {}, missing: [], headers: {} };
    for (const [h, tpl] of Object.entries(server.headers ?? {})) {
      out.headers![h] = tpl.replace(/\$\{([A-Z][A-Z0-9_]{0,63})\}/g, (_, key: string) => {
        const value = plugin.permissions.includes(`secrets:${key}`) ? getSecret(pluginId, key) : null;
        if (value === null) {
          if (!out.missing.includes(key)) out.missing.push(key);
          if (plugin.permissions.includes(`secrets:${key}`)) raiseMissingSecret(db, pluginId, key);
          return '';
        }
        return value;
      });
    }
    return out;
  }
  const bindings = readImportRecord(plugin)?.env[serverId] ?? {};
  const out: ResolvedServer = { command: server.command ?? '', args: server.args ?? [], env: { ...(server.env ?? {}) }, refs: {}, missing: [] };
  for (const key of server.env_keys ?? []) {
    if (!plugin.permissions.includes(`secrets:${key}`)) {
      out.missing.push(key);
      continue;
    }
    const b = bindings[key];
    if (b?.kind === 'ref') {
      out.refs[key] = b.name;
      continue;
    }
    const value = getSecret(pluginId, key);
    if (value === null) {
      out.missing.push(key);
      raiseMissingSecret(db, pluginId, key);
    } else out.env[key] = value;
  }
  return out;
}

export function shimPath(): string {
  return path.join(coreDir, 'mcp-shim.js');
}

interface ShimEntry {
  name: string;
  pluginId: string;
  serverId: string;
  http?: { url: string; headers: boolean };
}

export function browserServerPath(): string {
  return path.join(coreDir, 'metatrooper-browser.js');
}

export interface AttachContext {
  pipeline?: boolean;
  approval?: string;
}

/** Whether a server may attach: an external-writes server never joins a pipeline step or a contained or isolated session, and codex gets only no-write, header-free http servers. */
function mayAttach(s: McpSpec, engineId: string, ctx: AttachContext): boolean {
  if (s.transport !== 'http') return true;
  const writes = mcpWrites(s);
  if (writes === 'external' && (ctx.pipeline || ctx.approval === 'contained' || ctx.approval === 'isolated')) return false;
  if (engineId === 'codex') return writes === 'none' && !s.headers && s.auth !== 'header';
  return true;
}

function entriesFor(db: DatabaseSync, engineId: string, ctx: AttachContext): ShimEntry[] {
  const out: ShimEntry[] = [];
  for (const p of listPlugins(db)) {
    if (!p.enabled) continue;
    for (const s of p.manifest.mcp ?? []) {
      if (!s.engines.includes('*') && !s.engines.includes(engineId)) continue;
      if (!mayAttach(s, engineId, ctx)) continue;
      out.push({ name: `${p.id}-${s.id}`.replace(/[^A-Za-z0-9_-]+/g, '-'), pluginId: p.id, serverId: s.id, http: s.transport === 'http' ? { url: s.url ?? '', headers: Boolean(s.headers) } : undefined });
    }
  }
  return out;
}

/** Engine arguments that point each plugin MCP server at the shim, plus `metatrooper-browser` when the session needs the browser; no real command or secret appears. */
export function mcpAttachArgs(db: DatabaseSync, engine: EngineSpec, sessionId: string, browser = false, ctx: AttachContext = {}): string[] {
  const node = process.execPath.split(String.fromCharCode(92)).join('/');
  const shim = shimPath().split(String.fromCharCode(92)).join('/');
  const servers: Array<{ name: string; args: string[]; http?: { url: string; headers: boolean } }> = [
    ...(browser ? [{ name: 'metatrooper-browser', args: [browserServerPath().split(String.fromCharCode(92)).join('/')] }] : []),
    ...entriesFor(db, engine.id, ctx).map((e) => ({ name: e.name, args: [shim, e.pluginId, e.serverId], http: e.http })),
  ];
  switch (engine.mcp_attach?.kind) {
    case 'claude-mcp-config-flag': {
      if (!servers.length) return [];
      const file = path.join(homeDir(), 'mcp', `${sessionId}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const mcpServers = Object.fromEntries(servers.map((s) => [s.name, s.http
        ? { type: 'http', url: s.http.url, ...(s.http.headers ? { headersHelper: `"${node}" "${shim}" headers ${s.args[1]} ${s.args[2]}` } : {}) }
        : { command: node, args: s.args }]));
      fs.writeFileSync(file, JSON.stringify({ mcpServers }, null, 2) + '\n');
      // One token: --mcp-config is variadic and would swallow a positional prompt that follows it.
      return [`--mcp-config=${file.split(String.fromCharCode(92)).join('/')}`];
    }
    case 'codex-config': {
      const file = codexConfigFile();
      const user = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(CODEX_BLOCK, '') : '';
      return servers
        .filter((s) => !new RegExp(`^\\[mcp_servers\\.${s.name}\\]`, 'm').test(user))
        .flatMap((s) => s.http ? ['-c', `mcp_servers.${s.name}.url=${JSON.stringify(s.http.url)}`] : ['-c', `mcp_servers.${s.name}.command=${JSON.stringify(node)}`, '-c', `mcp_servers.${s.name}.args=${JSON.stringify(s.args)}`]);
    }
    default:
      return [];
  }
}

/** The block older versions wrote into Codex's config.toml; only removeCodexMcp still looks for it. */
const CODEX_BLOCK = /^# metatrooper mcp: begin[^\n]*\n[\s\S]*?^# metatrooper mcp: end[^\n]*(\n|$)/m;

/** Deletes a session's per-session MCP and settings files. */
export function removeSessionFiles(sessionId: string): void {
  for (const name of [`${sessionId}.json`, `${sessionId}.settings.json`]) {
    try { fs.rmSync(path.join(homeDir(), 'mcp', name), { force: true }); } catch {}
  }
}

/** Deletes per-session files whose session has exited or no longer exists. */
export function sweepSessionFiles(db: DatabaseSync): void {
  const dir = path.join(homeDir(), 'mcp');
  if (!fs.existsSync(dir)) return;
  const get = db.prepare('SELECT state FROM session WHERE id = ?');
  for (const name of fs.readdirSync(dir)) {
    const s = get.get(name.split('.')[0]) as { state: string } | undefined;
    if (!s || s.state === 'exited') fs.rmSync(path.join(dir, name), { force: true });
  }
}

export function removeCodexMcp(): void {
  const file = codexConfigFile();
  if (!fs.existsSync(file)) return;
  const current = fs.readFileSync(file, 'utf8');
  const after = current.replace(CODEX_BLOCK, '').replace(/\n+$/, '\n');
  if (after !== current) fs.writeFileSync(file, after);
}
