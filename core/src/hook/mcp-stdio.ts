export interface ToolDef { name: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean> }

function send(msg: object): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

/** A stdio MCP server: one JSON-RPC message per line, answering initialize, ping, tools/list and tools/call. */
export function serveMcp(name: string, tools: ToolDef[], toolCall: (name: string, args: Record<string, unknown>) => Promise<object>): void {
  const handle = async (msg: { id?: unknown; method?: string; params?: Record<string, unknown> }): Promise<void> => {
    const reply = (result: unknown) => { if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result }); };
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
        return reply({ tools });
      case 'tools/call':
        return reply(await toolCall(String(msg.params?.name ?? ''), (msg.params?.arguments ?? {}) as Record<string, unknown>));
      default:
        if (msg.id !== undefined && msg.method) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } });
    }
  };
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    buf += chunk;
    for (let i; (i = buf.indexOf('\n')) >= 0;) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        void handle(JSON.parse(line));
      } catch {
        send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      }
    }
  });
  process.stdin.on('end', () => process.exit(0));
}
