import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { codexConfigFile, coreDir, homeDir } from '../paths.ts';
import { getSecret } from '../secrets.ts';
import { E, RpcError } from '../pipe/errors.ts';
import type { EngineSpec } from '../engines/registry.ts';
import { listPlugins, loadPlugin, raiseMissingSecret, readImportRecord } from './store.ts';

export interface ResolvedServer {
  command: string;
  args: string[];
  env: Record<string, string>;
  refs: Record<string, string>;
  missing: string[];
}

/** What the shim needs to start one plugin MCP server: stored secret values, `${VAR}` names it resolves itself, and what is missing. */
export function resolveMcpServer(db: DatabaseSync, pluginId: string, serverId: string): ResolvedServer {
  const plugin = loadPlugin(db, pluginId);
  if (!plugin) throw new RpcError(E.NOT_FOUND, 'plugin not found');
  const server = (plugin.manifest.mcp ?? []).find((s) => s.id === serverId);
  if (!server) throw new RpcError(E.NOT_FOUND, `MCP server ${serverId} not found in ${pluginId}`);
  const bindings = readImportRecord(plugin)?.env[serverId] ?? {};
  const out: ResolvedServer = { command: server.command, args: server.args ?? [], env: {}, refs: {}, missing: [] };
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
}

export function browserServerPath(): string {
  return path.join(coreDir, 'metatrooper-browser.js');
}

function entriesFor(db: DatabaseSync, engineId: string): ShimEntry[] {
  const out: ShimEntry[] = [];
  for (const p of listPlugins(db)) {
    if (!p.enabled) continue;
    for (const s of p.manifest.mcp ?? []) {
      if (!s.engines.includes('*') && !s.engines.includes(engineId)) continue;
      out.push({ name: `${p.id}-${s.id}`.replace(/[^A-Za-z0-9_-]+/g, '-'), pluginId: p.id, serverId: s.id });
    }
  }
  return out;
}

/** Engine arguments that attach `metatrooper-browser` and point each plugin MCP server at the shim; no real command or secret appears. */
export function mcpAttachArgs(db: DatabaseSync, engine: EngineSpec, sessionId: string): string[] {
  const node = process.execPath.split(String.fromCharCode(92)).join('/');
  const shim = shimPath().split(String.fromCharCode(92)).join('/');
  const servers: Array<{ name: string; args: string[] }> = [
    { name: 'metatrooper-browser', args: [browserServerPath().split(String.fromCharCode(92)).join('/')] },
    ...entriesFor(db, engine.id).map((e) => ({ name: e.name, args: [shim, e.pluginId, e.serverId] })),
  ];
  switch (engine.mcp_attach?.kind) {
    case 'claude-mcp-config-flag': {
      const file = path.join(homeDir(), 'mcp', `${sessionId}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const mcpServers = Object.fromEntries(servers.map((s) => [s.name, { command: node, args: s.args }]));
      fs.writeFileSync(file, JSON.stringify({ mcpServers }, null, 2) + '\n');
      return ['--mcp-config', file.split(String.fromCharCode(92)).join('/')];
    }
    case 'codex-config':
      syncCodexMcp(node, servers);
      return [];
    default:
      return [];
  }
}

const CODEX_BEGIN = '# metatrooper mcp: begin (written by MetaTrooper; troop hooks uninstall removes it)';
const CODEX_END = '# metatrooper mcp: end';
const CODEX_BLOCK = /^# metatrooper mcp: begin[^\n]*\n[\s\S]*?^# metatrooper mcp: end[^\n]*(\n|$)/m;

/** Keeps one MetaTrooper block of mcp_servers tables in Codex's config.toml; a name the user already defines is left to the user. */
export function syncCodexMcp(node: string, servers: Array<{ name: string; args: string[] }>): void {
  const file = codexConfigFile();
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const left = current.replace(CODEX_BLOCK, '');
  const rest = left.trim() ? left.replace(/\n*$/, '\n') : '';
  const own = servers.filter((s) => !new RegExp(`^\\[mcp_servers\\.${s.name}\\]`, 'm').test(rest));
  const tables = own.flatMap((s) => [`[mcp_servers.${s.name}]`, `command = ${JSON.stringify(node)}`, `args = ${JSON.stringify(s.args)}`, '']);
  const after = own.length ? `${rest}${rest ? '\n' : ''}${[CODEX_BEGIN, ...tables, CODEX_END].join('\n')}\n` : rest;
  if (after === current) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, after);
}

export function removeCodexMcp(): void {
  const file = codexConfigFile();
  if (!fs.existsSync(file)) return;
  const current = fs.readFileSync(file, 'utf8');
  const after = current.replace(CODEX_BLOCK, '').replace(/\n+$/, '\n');
  if (after !== current) fs.writeFileSync(file, after);
}
