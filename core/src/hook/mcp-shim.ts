import net from 'node:net';
import { spawn } from 'node:child_process';
import { corePipe } from '../paths.ts';
import { createDecoder, encode } from '../pipe/framing.ts';
import { resolveCommand } from './resolve.ts';
import type { ToolDef } from './mcp-stdio.ts';

interface Resolved {
  command: string;
  args: string[];
  env: Record<string, string>;
  refs: Record<string, string>;
  missing: string[];
  headers?: Record<string, string>;
}

function request(method: string, params: Record<string, unknown>, timeoutMs = 3000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(corePipe());
    const id = `shim-${process.pid}-${Date.now()}`;
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Ouros core did not answer')); }, timeoutMs);
    const decode = createDecoder((raw) => {
      const r = raw as { id?: string; result?: unknown; error?: { message: string } };
      if (r.id !== id) return;
      clearTimeout(timer);
      socket.destroy();
      if (r.error) reject(new Error(r.error.message));
      else resolve(r.result);
    });
    socket.on('data', (c) => { try { decode(c); } catch {} });
    socket.once('error', () => { clearTimeout(timer); reject(new Error('Ouros core is not running')); });
    socket.once('connect', () => socket.write(encode({ jsonrpc: '2.0', id, method, params, meta: { origin: 'cli' } })));
  });
}

/** Answers the MCP initialize request with an error naming what is missing, then exits. */
function refuse(message: string): void {
  process.stderr.write(`metatrooper mcp-shim: ${message}\n`);
  const timer = setTimeout(() => process.exit(1), 10_000);
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buf += chunk;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg: { id?: unknown; method?: string };
      try { msg = JSON.parse(line); } catch { continue; }
      if (msg.method === 'initialize') {
        clearTimeout(timer);
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message } }) + '\n', () => process.exit(1));
        return;
      }
    }
  });
  process.stdin.on('end', () => process.exit(1));
}

/** Prints an http server's resolved headers as JSON for Claude's headersHelper; exits 1 naming any missing secret. */
async function printHeaders(pluginId: string, serverId: string, token: string): Promise<void> {
  try {
    const r = (await request('mcp.resolve', { plugin_id: pluginId, server_id: serverId, token }, 8000)) as Resolved;
    if (r.missing.length) throw new Error(`set ${r.missing.join(', ')} for ${pluginId}`);
    process.stdout.write(JSON.stringify(r.headers ?? {}) + '\n', () => process.exit(0));
  } catch (e) {
    process.stderr.write(`metatrooper mcp-shim: ${(e as Error).message}\n`, () => process.exit(1));
  }
}

const STEPS_TOOL: ToolDef = {
  name: 'steps_set',
  description: 'Show your plan to the user as a checklist in Ouros. Call it once you have a plan of 2 or more steps, and again each time a step is done or the plan changes. Send the whole list every time; it replaces the last one. Short step text, up to 30 steps.',
  inputSchema: {
    type: 'object',
    properties: { items: { type: 'array', maxItems: 30, items: { type: 'object', properties: { text: { type: 'string', maxLength: 200 }, done: { type: 'boolean' } }, required: ['text', 'done'] } } },
    required: ['items'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
};

/** The `ouros-steps` MCP server: steps_set appends a core.steps event that the processor writes into session_step. */
async function serveSteps(): Promise<void> {
  const { serveMcp } = await import('./mcp-stdio.ts');
  const { findSession } = await import('./workbench-pipe.ts');
  const { buildPayload } = await import('../redact.ts');
  const { appendEvent } = await import('../events/append.ts');
  serveMcp('ouros-steps', [STEPS_TOOL], async (name, args) => {
    const fail = (text: string) => ({ content: [{ type: 'text', text }], isError: true });
    if (name !== 'steps_set') return fail(`unknown tool ${name}`);
    if (!Array.isArray(args.items)) return fail('items must be an array of {text, done}');
    const sessionId = process.env.TROOP_SESSION_ID || findSession();
    if (!sessionId) return fail('this process is not inside an Ouros session');
    const payload = buildPayload('core.steps', args) as { items: unknown[] };
    try {
      appendEvent('core.steps', sessionId, payload, undefined, 2000)?.close();
    } catch (e) {
      return fail(`steps not saved: ${(e as Error).message}`);
    }
    return { content: [{ type: 'text', text: `saved ${payload.items.length} steps` }] };
  });
}

const UI_TOOL: ToolDef = {
  name: 'ouros_ui',
  description: 'Draw a screen for the user in Ouros as a tab. Send JSON naming catalogue parts; Ouros checks every part and draws it itself. No HTML, script or outside URL is ever drawn. A part that is unknown or has a wrong prop is shown as a plain-text box naming it; its siblings still draw. The same surface id replaces your earlier screen; you cannot replace a surface drawn by another session. Parts drawn so far: page {children}, section {label, children, aside?}, header {title, sub?, big?, tabs?}, text {text, size?: h1|h2|body|small, tone?: plain|mute|ok|error}, table {cols: string[], rows: (string | part)[][], foot?}, buttons {actions: [{label, primary?}]} (buttons do nothing yet). Every other catalogue part is shown as text for now. Up to 12 levels and 1,500 parts. Returns {surface, status: drawn|partly|rejected, fellBack}.',
  inputSchema: {
    type: 'object',
    properties: {
      surface: { type: 'string', description: 'Id, 1 to 64 letters, digits, dots, dashes or underscores, e.g. "run-r0412".' },
      title: { type: 'string', description: 'The tab title.' },
      zone: { type: 'string', enum: ['tab'], default: 'tab' },
      catalogue: { type: 'string', description: 'Catalogue version you wrote against; "1".' },
      spec: { type: 'object', description: 'Usually { "type": "page", "children": [ ... ] }.' },
    },
    required: ['surface', 'spec'],
  },
  annotations: { readOnlyHint: false, destructiveHint: false },
};

/** The `ouros-ui` MCP server: ouros_ui sends the spec to the core's ui.show, which checks and stores it. */
async function serveUi(): Promise<void> {
  const { serveMcp } = await import('./mcp-stdio.ts');
  const { findSession } = await import('./workbench-pipe.ts');
  const { call } = await import('../pipe/client.ts');
  serveMcp('ouros-ui', [UI_TOOL], async (name, args) => {
    const fail = (text: string) => ({ content: [{ type: 'text', text }], isError: true });
    if (name !== 'ouros_ui') return fail(`unknown tool ${name}`);
    const sessionId = process.env.TROOP_SESSION_ID || findSession();
    if (!sessionId) return fail('this process is not inside an Ouros session');
    const out = await call('ui.show', { session_id: sessionId, surface: args.surface, title: args.title, zone: args.zone, catalogue: args.catalogue, spec: args.spec });
    if (out.kind !== 'reply') return fail('the Ouros core is offline; nothing was drawn');
    if (out.reply.error) return fail(out.reply.error.message);
    return { content: [{ type: 'text', text: JSON.stringify(out.reply.result) }] };
  });
}

async function main(): Promise<void> {
  if (process.argv[2] === 'steps') return serveSteps();
  if (process.argv[2] === 'ui') return serveUi();
  if (process.argv[2] === 'headers') return printHeaders(process.argv[3] ?? '', process.argv[4] ?? '', process.argv[5] ?? '');
  const [pluginId, serverId, token = ''] = process.argv.slice(2);
  if (!pluginId || !serverId) return refuse('usage: mcp-shim.js <plugin id> <server id> <token>');
  let r: Resolved;
  try {
    r = (await request('mcp.resolve', { plugin_id: pluginId, server_id: serverId, token })) as Resolved;
  } catch (e) {
    return refuse(`${(e as Error).message}; ${serverId} from ${pluginId} did not start`);
  }
  const env: Record<string, string | undefined> = { ...process.env, ...r.env };
  const missing = [...r.missing];
  const unsetRefs: string[] = [];
  for (const [key, name] of Object.entries(r.refs)) {
    const v = process.env[name];
    if (v === undefined || v === '') unsetRefs.push(key);
    else env[key] = v;
  }
  if (unsetRefs.length) {
    missing.push(...unsetRefs);
    try { await request('mcp.missing', { plugin_id: pluginId, names: unsetRefs, token }); } catch {}
  }
  if (missing.length) return refuse(`set ${missing.join(', ')} for ${pluginId}; MCP server ${serverId} did not start`);

  const resolved = resolveCommand(r.command) ?? [r.command];
  const args = r.args.map((a) => (a === '{{cwd}}' ? process.cwd() : a));
  const child = spawn(resolved[0], [...resolved.slice(1), ...args], { stdio: 'inherit', env, windowsHide: true });
  child.on('error', (e) => {
    process.stderr.write(`metatrooper mcp-shim: could not start ${r.command}: ${e.message}\n`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig));
}

void main();
