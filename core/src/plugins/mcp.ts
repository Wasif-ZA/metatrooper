import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { coreDir, homeDir } from '../paths.ts';
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

/** Engine arguments that point each attached plugin MCP server at the shim; the real command and secrets never appear. */
export function mcpAttachArgs(db: DatabaseSync, engine: EngineSpec, sessionId: string): string[] {
  const entries = entriesFor(db, engine.id);
  if (!entries.length) return [];
  const node = process.execPath.split(String.fromCharCode(92)).join('/');
  const shim = shimPath().split(String.fromCharCode(92)).join('/');
  switch (engine.mcp_attach?.kind) {
    case 'claude-mcp-config-flag': {
      const file = path.join(homeDir(), 'mcp', `${sessionId}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const mcpServers = Object.fromEntries(entries.map((e) => [e.name, { command: node, args: [shim, e.pluginId, e.serverId] }]));
      fs.writeFileSync(file, JSON.stringify({ mcpServers }, null, 2) + '\n');
      return ['--mcp-config', file.split(String.fromCharCode(92)).join('/')];
    }
    case 'codex-config':
      return entries.flatMap((e) => [
        '-c', `mcp_servers.${e.name}.command=${JSON.stringify(node)}`,
        '-c', `mcp_servers.${e.name}.args=${JSON.stringify([shim, e.pluginId, e.serverId])}`,
      ]);
    default:
      return [];
  }
}
