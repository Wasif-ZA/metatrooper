import net from 'node:net';
import { spawn } from 'node:child_process';
import { corePipe } from '../paths.ts';
import { createDecoder, encode } from '../pipe/framing.ts';
import { resolveCommand } from './resolve.ts';

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
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('MetaTrooper core did not answer')); }, timeoutMs);
    const decode = createDecoder((raw) => {
      const r = raw as { id?: string; result?: unknown; error?: { message: string } };
      if (r.id !== id) return;
      clearTimeout(timer);
      socket.destroy();
      if (r.error) reject(new Error(r.error.message));
      else resolve(r.result);
    });
    socket.on('data', (c) => { try { decode(c); } catch {} });
    socket.once('error', () => { clearTimeout(timer); reject(new Error('MetaTrooper core is not running')); });
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
async function printHeaders(pluginId: string, serverId: string): Promise<void> {
  try {
    const r = (await request('mcp.resolve', { plugin_id: pluginId, server_id: serverId }, 8000)) as Resolved;
    if (r.missing.length) throw new Error(`set ${r.missing.join(', ')} for ${pluginId}`);
    process.stdout.write(JSON.stringify(r.headers ?? {}) + '\n', () => process.exit(0));
  } catch (e) {
    process.stderr.write(`metatrooper mcp-shim: ${(e as Error).message}\n`, () => process.exit(1));
  }
}

async function main(): Promise<void> {
  if (process.argv[2] === 'headers') return printHeaders(process.argv[3] ?? '', process.argv[4] ?? '');
  const [pluginId, serverId] = process.argv.slice(2);
  if (!pluginId || !serverId) return refuse('usage: mcp-shim.js <plugin id> <server id>');
  let r: Resolved;
  try {
    r = (await request('mcp.resolve', { plugin_id: pluginId, server_id: serverId })) as Resolved;
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
    try { await request('mcp.missing', { plugin_id: pluginId, names: unsetRefs }); } catch {}
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
