import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { homeDir } from '../../../core/src/paths.ts';
import type { DatabaseSync } from 'node:sqlite';
import { createDecoder, encode } from '../../../core/src/pipe/framing.ts';
import { ancestors, parentTable } from '../../../core/src/browser/ancestry.ts';
import { ToolError, type PaneManager, type PaneRow } from './panes.ts';

const TOOLS = new Set(['navigate', 'back', 'snapshot', 'click', 'type', 'select', 'scroll', 'wait_for', 'screenshot', 'evaluate', 'console', 'network', 'dialog']);

type Bound = { kind: 'session'; sessionId: string } | { kind: 'core' } | null;

export interface ServerDeps {
  db: () => DatabaseSync | null;
  uiKey: () => string | null;
  panes: PaneManager;
  refreshPanes: () => void;
  /** Opens a pane owned by the session through the core's `pane.open` and returns its id. */
  openPane: (projectId: string, sessionId: string) => Promise<string>;
}

/** Panes a session may drive: those it owns, and those of its own run and fan-out index. */
export function ownedPanes(db: DatabaseSync, sessionId: string): PaneRow[] {
  return db.prepare(
    `SELECT * FROM browser_pane bp WHERE bp.open = 1 AND (bp.session_id = ?
       OR (bp.session_id IS NULL AND bp.run_id IS NOT NULL
           AND bp.run_id = (SELECT run_id FROM session WHERE id = ?)
           AND bp.variant = (SELECT fanout_index FROM run_step WHERE session_id = ? LIMIT 1)))
     ORDER BY bp.id`,
  ).all(sessionId, sessionId, sessionId) as unknown as PaneRow[];
}

function clearDeadSocket(pipePath: string): Promise<void> {
  if (process.platform === 'win32' || !fs.existsSync(pipePath)) return Promise.resolve();
  return new Promise((resolve) => {
    const probe = net.connect(pipePath);
    probe.once('connect', () => { probe.destroy(); resolve(); });
    probe.once('error', () => {
      try { fs.unlinkSync(pipePath); } catch {}
      resolve();
    });
  });
}

export async function startBrowserServer(pipePath: string, deps: ServerDeps): Promise<net.Server> {
  await clearDeadSocket(pipePath);
  const server = net.createServer((socket) => {
    let bound: Bound = null;
    const send = (msg: object) => { if (!socket.destroyed) socket.write(encode(msg)); };
    const fail = (id: unknown, code: number, message: string) => send({ jsonrpc: '2.0', id, error: { code, message } });

    const handle = async (msg: { id?: unknown; method?: unknown; params?: unknown }) => {
      const id = typeof msg.id === 'string' ? msg.id : null;
      if (!id || typeof msg.method !== 'string') return fail(id, -32600, 'invalid request');
      const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, any>;
      const db = deps.db();
      if (!db) return fail(id, -32099, 'the MetaTrooper database is not there yet');
      const method = msg.method;

      if (method === 'browser.hello') {
        if (typeof params.ui_key === 'string') {
          const key = deps.uiKey();
          if (!key || params.ui_key !== key) return fail(id, -32030, 'ui key does not match');
          bound = { kind: 'core' };
          return send({ jsonrpc: '2.0', id, result: { ok: true, bound: 'core' } });
        }
        const s = typeof params.session_id === 'string'
          ? (db.prepare('SELECT id, pid FROM session WHERE id = ? AND ended_at IS NULL').get(params.session_id) as { id: string; pid: number | null } | undefined)
          : undefined;
        if (!s || !s.pid || !Number.isInteger(params.pid)) return fail(id, -32030, 'unknown session');
        if (!ancestors(Number(params.pid), parentTable()).includes(s.pid)) return fail(id, -32030, 'that session is not an ancestor of the caller');
        bound = { kind: 'session', sessionId: s.id };
        return send({ jsonrpc: '2.0', id, result: { ok: true, bound: 'session' } });
      }

      if (method === 'browser.panes') {
        if (bound?.kind !== 'session') return send({ jsonrpc: '2.0', id, result: [] });
        const rows = ownedPanes(db, bound.sessionId);
        return send({ jsonrpc: '2.0', id, result: rows.map((r) => ({ pane_id: r.id, url: r.url, variant: r.variant, dev_port: r.dev_port })) });
      }

      if (method === 'browser.capture') {
        if (bound?.kind !== 'core') return fail(id, -32030, 'browser.capture is for the core connection only');
        deps.refreshPanes();
        const row = db.prepare('SELECT id FROM browser_pane WHERE id = ? AND open = 1').get(String(params.pane_id ?? ''));
        if (!row || !deps.panes.has(String(params.pane_id))) return fail(id, -32002, 'pane not found');
        const r = await deps.panes.capture(String(params.pane_id), String(params.label ?? 'before'));
        return send({ jsonrpc: '2.0', id, result: r });
      }

      if (method === 'browser.board_capture') {
        if (bound?.kind !== 'core') return fail(id, -32030, 'browser.board_capture is for the core connection only');
        const projectId = String(params.project_id ?? '');
        const out = path.resolve(String(params.out_path ?? ''));
        const rel = path.relative(path.join(homeDir(), 'boards'), out);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !out.endsWith('.png')) return fail(id, -32602, 'out_path must be a .png under the boards folder');
        if (!db.prepare('SELECT 1 FROM project WHERE id = ?').get(projectId)) return fail(id, -32002, 'project not found');
        try {
          return send({ jsonrpc: '2.0', id, result: await deps.panes.boardCapture(projectId, String(params.url ?? ''), out) });
        } catch (e) {
          return fail(id, e instanceof ToolError ? e.code : -32099, (e as Error).message);
        }
      }

      const tool = method.startsWith('browser.') ? method.slice(8) : '';
      if (!TOOLS.has(tool)) return fail(id, -32601, `unknown method ${method}`);
      if (bound?.kind !== 'session') return fail(id, -32030, 'this connection is not bound to a session');
      const owned = ownedPanes(db, bound.sessionId);
      let paneId = typeof params.pane_id === 'string' ? params.pane_id : null;
      if (!paneId && owned.length === 1) paneId = owned[0].id;
      if (!paneId && !owned.length && tool === 'navigate') {
        const s = db.prepare('SELECT project_id FROM session WHERE id = ?').get(bound.sessionId) as { project_id: string | null } | undefined;
        if (!s?.project_id) return fail(id, -32002, 'this session has no project to open a browser pane in');
        paneId = await deps.openPane(s.project_id, bound.sessionId);
        owned.push({ id: paneId } as PaneRow);
      }
      if (!paneId) return fail(id, -32602, owned.length ? 'pane_id is required: this session has several panes' : 'this session has no browser pane');
      if (!owned.some((r) => r.id === paneId)) return fail(id, -32030, 'pane not owned by the calling session');
      if (!deps.panes.has(paneId)) {
        deps.refreshPanes();
        for (let i = 0; i < 40 && !deps.panes.has(paneId); i++) await new Promise((r) => setTimeout(r, 50));
      }
      const result = await deps.panes.tool(paneId, tool, params);
      return send({ jsonrpc: '2.0', id, result });
    };

    const decode = createDecoder((raw) => {
      const msg = raw as { id?: unknown };
      handle(raw as never).catch((e) => fail(typeof msg?.id === 'string' ? msg.id : null, e instanceof ToolError ? e.code : -32099, (e as Error).message));
    });
    socket.on('data', (chunk) => {
      try {
        decode(chunk);
      } catch {
        fail(null, -32700, 'parse error');
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipePath, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
