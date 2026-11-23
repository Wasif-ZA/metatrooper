import { desktopTools, TOOLS as DESKTOP_TOOLS, UNAVAILABLE as DESKTOP_UNAVAILABLE } from './desktop-tools.ts';
import { browserTools, browserToolList, UNAVAILABLE as BROWSER_UNAVAILABLE } from './browser-tools.ts';
import { WorkbenchPipe, type Reply } from './workbench-pipe.ts';
import { screenResult } from './screen-data.ts';
import type { CommandRunner } from '../pipe/commands.ts';
import { toRpcError } from '../pipe/errors.ts';
import { ulid } from '../time.ts';
import type { DatabaseSync } from 'node:sqlite';
import { ancestors, parentTableAsync } from '../browser/ancestry.ts';
import { appendEvent } from '../events/append.ts';
import { buildPayload } from '../redact.ts';
import { mcpReply } from './mcp-stdio.ts';
import { STEPS_TOOL, UI_TOOL, WORKSPACE_TOOL } from './ouros-tools.ts';

export interface McpHello { server?: unknown; session_id?: unknown; pid?: unknown }

export type McpHandler = ((hello: McpHello, msg: Parameters<typeof mcpReply>[3]) => Promise<object | null>) & { close?: (hello: McpHello) => void };

export function coreMcpStdio(db: DatabaseSync, runner: CommandRunner): McpHandler {
  const sessions = new WeakMap<McpHello, string | null>();
  const bridges = new WeakMap<McpHello, { workbench: WorkbenchPipe; tools: (name: string, args: Record<string, unknown>) => Promise<object> }>();
  const handler: McpHandler = async (hello, msg) => {
    const server = hello.server;
    if (server !== 'steps' && server !== 'ui' && server !== 'desktop' && server !== 'browser') {
      return msg?.id !== undefined ? { jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: `unknown ouros server ${server}` } } : null;
    }
    if (!sessions.has(hello)) {
      let session = typeof hello.session_id === 'string' && hello.session_id ? hello.session_id : null;
      if (!session && typeof hello.pid === 'number' && Number.isInteger(hello.pid) && hello.pid > 0) {
        const rows = db.prepare('SELECT id, pid FROM session WHERE pid IS NOT NULL AND ended_at IS NULL').all() as Array<{ id: string; pid: number }>;
        const byPid = new Map(rows.map((row) => [row.pid, row.id]));
        session = ancestors(hello.pid, await parentTableAsync()).map((pid) => byPid.get(pid)).find(Boolean) ?? null;
      }
      if (session) sessions.set(hello, session);
    }
    if (server === 'desktop' || server === 'browser') {
      let bridge = bridges.get(hello);
      if (!bridge) {
        const identity = { sessionId: sessions.get(hello) ?? '', pid: typeof hello.pid === 'number' ? hello.pid : 0 };
        const workbench = new WorkbenchPipe(server === 'desktop' ? DESKTOP_UNAVAILABLE : BROWSER_UNAVAILABLE, identity);
        const core = async (method: string, params: Record<string, unknown>): Promise<Reply> => {
          try {
            return { result: await runner.call({ id: ulid(), method, params, origin: 'cli' }, { ui: false, origin: 'cli' }) };
          } catch (e) {
            const error = toRpcError(e);
            return { error: { code: error.code, message: error.message } };
          }
        };
        bridge = { workbench, tools: (server === 'desktop' ? desktopTools : browserTools)({ ...identity, core, workbench }) };
        bridges.set(hello, bridge);
      }
      const { workbench, tools } = bridge;
      return mcpReply(`metatrooper-${server}`, server === 'desktop' ? DESKTOP_TOOLS : () => browserToolList(workbench), async (name, args) => screenResult(await tools(name, args)), msg);
    }
    return mcpReply(`ouros-${server}`, server === 'steps' ? [STEPS_TOOL] : [UI_TOOL, WORKSPACE_TOOL], async (name, args) => {
      const fail = (text: string) => ({ content: [{ type: 'text', text }], isError: true });
      if (server === 'steps' ? name !== 'steps_set' : name !== 'ouros_ui' && name !== 'ouros_workspace') return fail(`unknown tool ${name}`);
      if (server === 'steps' && !Array.isArray(args.items)) return fail('items must be an array of {text, done}');
      const session = sessions.get(hello);
      if (!session) return fail('this process is not inside a cc session');
      try {
        if (server === 'steps') {
          const payload = buildPayload('core.steps', args) as { items: unknown[] };
          appendEvent('core.steps', session, payload, db);
          return { content: [{ type: 'text', text: `saved ${payload.items.length} steps` }] };
        }
        if (name === 'ouros_workspace') {
          const result = await runner.call({ id: ulid(), method: 'workspace.change', params: { session_id: session, op: args.op, workspace: args.workspace, name: args.name }, origin: 'cli' }, { ui: false, origin: 'cli' });
          return { content: [{ type: 'text', text: JSON.stringify(result) }] };
        }
        const result = await runner.call({ id: ulid(), method: 'ui.show', params: { session_id: session, surface: args.surface, title: args.title, zone: args.zone, catalogue: args.catalogue, spec: args.spec }, origin: 'cli' }, { ui: false, origin: 'cli' });
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (e) {
        return fail(`${server === 'steps' ? 'steps not saved: ' : ''}${e instanceof Error ? e.message : String(e)}`);
      }
    }, msg);
  };
  handler.close = (hello) => { bridges.get(hello)?.workbench.close(); bridges.delete(hello); };
  return handler;
}
