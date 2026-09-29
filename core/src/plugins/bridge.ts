import fs from 'node:fs';
import path from 'node:path';
import { PANE_FORBIDDEN_METHODS, type Manifest } from './manifest.ts';

export const PANE_SCHEME = 'troop-plugin';
export const PANE_SANDBOX = 'allow-scripts';
export const PANE_READS = new Set(['runs', 'run', 'board', 'steps']);

export function paneCsp(pluginId: string): string {
  return `default-src ${PANE_SCHEME}://${pluginId} data:; connect-src 'none'`;
}

/** Maps a `troop-plugin://<id>/<path>` request to a file inside the plugin folder, or null for anything that escapes it. */
export function resolvePaneFile(pluginDir: string, urlPath: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.split(/[?#]/)[0]).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (!rel || rel.includes('\0') || /^[a-zA-Z]:/.test(rel) || rel.split(/[\\/]/).includes('..')) return null;
  const root = fs.realpathSync.native(pluginDir);
  const abs = path.resolve(root, rel);
  if (!fs.existsSync(abs)) return null;
  const real = fs.realpathSync.native(abs);
  const r = path.relative(root, real);
  if (!r || r.startsWith('..') || path.isAbsolute(r) || !fs.statSync(real).isFile()) return null;
  return real;
}

export interface PanePlugin {
  id: string;
  permissions: string[];
  manifest: Pick<Manifest, 'pane_methods'>;
}

export type PaneDecision =
  | { allow: true; kind: 'read'; query: string; id?: string }
  | { allow: true; kind: 'command'; method: string; params: Record<string, unknown> }
  | { allow: true; kind: 'clipboard.write'; text: string }
  | { allow: true; kind: 'open'; url: string }
  | { allow: false; reason: string };

/** Decides one postMessage from a pane; `framePluginId` is the plugin the workbench loaded the sending frame for. */
export function checkPaneMessage(plugin: PanePlugin, framePluginId: string, msg: unknown): PaneDecision {
  if (!msg || typeof msg !== 'object') return { allow: false, reason: 'message must be an object' };
  const m = msg as Record<string, unknown>;
  if (m.plugin_id !== plugin.id || framePluginId !== plugin.id) return { allow: false, reason: 'sender frame does not belong to this plugin' };
  switch (m.type) {
    case 'read':
      if (typeof m.query !== 'string' || !PANE_READS.has(m.query)) return { allow: false, reason: 'unknown read query' };
      if (m.id !== undefined && typeof m.id !== 'string') return { allow: false, reason: 'id must be a string' };
      return { allow: true, kind: 'read', query: m.query, id: m.id as string | undefined };
    case 'command': {
      if (typeof m.method !== 'string') return { allow: false, reason: 'method must be a string' };
      if (PANE_FORBIDDEN_METHODS.has(m.method) || !(plugin.manifest.pane_methods ?? []).includes(m.method)) {
        return { allow: false, reason: `${m.method} is not in this plugin's pane_methods` };
      }
      const params = m.params ?? {};
      if (typeof params !== 'object' || Array.isArray(params)) return { allow: false, reason: 'params must be an object' };
      return { allow: true, kind: 'command', method: m.method, params: params as Record<string, unknown> };
    }
    case 'clipboard.write':
      if (!plugin.permissions.includes('clipboard')) return { allow: false, reason: 'plugin was not approved for clipboard' };
      if (typeof m.text !== 'string') return { allow: false, reason: 'text must be a string' };
      return { allow: true, kind: 'clipboard.write', text: m.text };
    case 'open': {
      if (typeof m.url !== 'string') return { allow: false, reason: 'url must be a string' };
      let u: URL;
      try {
        u = new URL(m.url);
      } catch {
        return { allow: false, reason: 'url is not valid' };
      }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return { allow: false, reason: 'only http and https links open' };
      return { allow: true, kind: 'open', url: u.href };
    }
    default:
      return { allow: false, reason: 'unknown message type' };
  }
}
