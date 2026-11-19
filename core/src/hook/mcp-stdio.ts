export interface ToolDef { name: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean> }

function send(msg: object): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

export async function mcpReply(name: string, tools: ToolDef[] | (() => Promise<ToolDef[]>), toolCall: (name: string, args: Record<string, unknown>) => Promise<object>, msg: { id?: unknown; method?: string; params?: Record<string, unknown> }): Promise<object | null> {
  const reply = (result: unknown) => msg.id !== undefined ? { jsonrpc: '2.0', id: msg.id, result } : null;
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name, version: '1.0.0' },
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: typeof tools === 'function' ? await tools() : tools });
    case 'tools/call':
      return reply(await toolCall(String(msg.params?.name ?? ''), (msg.params?.arguments ?? {}) as Record<string, unknown>));
    default:
      return msg.id !== undefined && msg.method ? { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } } : null;
  }
}

/** A stdio MCP server: one JSON-RPC message per line, answering initialize, ping, tools/list and tools/call. */
export function serveMcp(name: string, tools: ToolDef[] | (() => Promise<ToolDef[]>), toolCall: (name: string, args: Record<string, unknown>) => Promise<object>): void {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buf += chunk;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      let msg: { id?: unknown; method?: string; params?: Record<string, unknown> };
      try {
        msg = JSON.parse(line);
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
        continue;
      }
      mcpReply(name, tools, toolCall, msg).then((reply) => { if (reply) send(reply); }).catch((e) => send({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } }));
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
