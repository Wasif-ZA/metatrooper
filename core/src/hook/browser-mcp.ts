import net from 'node:net';
import { browserPipe } from '../paths.ts';
import { openReaderDb } from '../store/db.ts';
import { createDecoder, encode } from '../pipe/framing.ts';
import { ancestors, parentTable } from '../browser/ancestry.ts';

const CALL_TIMEOUT_MS = 30_000;
const UNAVAILABLE = 'browser not available: the MetaTrooper workbench is closed';

const pane = { pane_id: { type: 'string', description: 'From panes; may be omitted when this session owns exactly one pane.' } };
const TOOLS: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> = [
  { name: 'panes', description: 'List the browser panes this session may drive.', inputSchema: { type: 'object', properties: {} } },
  { name: 'navigate', description: 'Load a URL in a pane.', inputSchema: { type: 'object', properties: { ...pane, url: { type: 'string' } }, required: ['url'] } },
  { name: 'back', description: 'Go back one page.', inputSchema: { type: 'object', properties: { ...pane } } },
  { name: 'snapshot', description: 'Accessibility tree as text; actionable nodes carry [ref=eN].', inputSchema: { type: 'object', properties: { ...pane, max_nodes: { type: 'integer', default: 400 } } } },
  { name: 'click', description: 'Click the node with this ref.', inputSchema: { type: 'object', properties: { ...pane, ref: { type: 'string' } }, required: ['ref'] } },
  { name: 'type', description: 'Type text into the node with this ref.', inputSchema: { type: 'object', properties: { ...pane, ref: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['ref', 'text'] } },
  { name: 'select', description: 'Choose an option in a select element.', inputSchema: { type: 'object', properties: { ...pane, ref: { type: 'string' }, value: { type: 'string' } }, required: ['ref', 'value'] } },
  { name: 'scroll', description: 'Scroll the page, or a node into view.', inputSchema: { type: 'object', properties: { ...pane, ref: { type: 'string' }, dy: { type: 'integer' } }, required: ['dy'] } },
  { name: 'wait_for', description: 'Wait until text or a ref appears.', inputSchema: { type: 'object', properties: { ...pane, text: { type: 'string' }, ref: { type: 'string' }, timeout_ms: { type: 'integer', default: 10000 } } } },
  { name: 'screenshot', description: 'PNG of the viewport, or the full page.', inputSchema: { type: 'object', properties: { ...pane, full_page: { type: 'boolean', default: false } } } },
  { name: 'evaluate', description: 'Run a JavaScript expression in an isolated world; result capped at 20 KB.', inputSchema: { type: 'object', properties: { ...pane, expression: { type: 'string' } }, required: ['expression'] } },
  { name: 'console', description: 'Last 200 console messages.', inputSchema: { type: 'object', properties: { ...pane, since_ms: { type: 'integer' } } } },
  { name: 'network', description: 'Last 200 requests.', inputSchema: { type: 'object', properties: { ...pane, since_ms: { type: 'integer' } } } },
];

/** The MetaTrooper session this process belongs to: the first ancestor whose pid is a session's launcher pid. */
function findSession(): string | null {
  const db = openReaderDb();
  if (!db) return null;
  try {
    const rows = db.prepare('SELECT id, pid FROM session WHERE pid IS NOT NULL AND ended_at IS NULL').all() as Array<{ id: string; pid: number }>;
    const byPid = new Map(rows.map((r) => [r.pid, r.id]));
    for (const pid of ancestors(process.pid, parentTable())) {
      const id = byPid.get(pid);
      if (id) return id;
    }
    return null;
  } finally {
    db.close();
  }
}

class Browser {
  private socket: net.Socket | null = null;
  private pending = new Map<string, (r: { result?: unknown; error?: { code: number; message: string } }) => void>();
  private next = 0;
  private sessionId: string | null | undefined;

  private connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    return new Promise((resolve, reject) => {
      const s = net.connect(browserPipe());
      const decode = createDecoder((raw) => {
        const r = raw as { id?: string; result?: unknown; error?: { code: number; message: string } };
        const w = typeof r.id === 'string' ? this.pending.get(r.id) : undefined;
        if (w) {
          this.pending.delete(r.id as string);
          w(r);
        }
      });
      s.on('data', (c) => { try { decode(c); } catch {} });
      const drop = () => {
        this.socket = null;
        for (const w of this.pending.values()) w({ error: { code: -32099, message: UNAVAILABLE } });
        this.pending.clear();
      };
      s.once('error', () => { drop(); reject(new Error(UNAVAILABLE)); });
      s.once('close', drop);
      s.once('connect', async () => {
        this.socket = s;
        this.sessionId ??= findSession();
        if (this.sessionId) {
          const r = await this.raw('browser.hello', { session_id: this.sessionId, pid: process.pid });
          if (r.error) this.sessionId = null;
        }
        resolve(s);
      });
    });
  }

  private raw(method: string, params: Record<string, unknown>): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
    const id = `b${process.pid}-${++this.next}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ error: { code: -32099, message: `${method} timed out after 30 s` } });
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
      this.socket?.write(encode({ jsonrpc: '2.0', id, method, params }));
    });
  }

  async call(method: string, params: Record<string, unknown>): Promise<{ result?: unknown; error?: { code: number; message: string } }> {
    try {
      await this.connect();
    } catch {
      return { error: { code: -32099, message: UNAVAILABLE } };
    }
    return this.raw(method, params);
  }
}

const browser = new Browser();

function send(msg: object): void {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function toolCall(name: string, args: Record<string, unknown>): Promise<object> {
  if (!TOOLS.some((t) => t.name === name)) return { content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true };
  const r = await browser.call(`browser.${name}`, args ?? {});
  if (r.error) return { content: [{ type: 'text', text: r.error.message }], isError: true };
  const result = r.result as { png_base64?: string; text?: string; truncated?: boolean } | undefined;
  if (name === 'screenshot' && result?.png_base64) {
    const content: object[] = [{ type: 'image', data: result.png_base64, mimeType: 'image/png' }];
    if (result.truncated) content.push({ type: 'text', text: 'truncated: the page is taller than 16,384 px' });
    return { content };
  }
  if (name === 'snapshot' && typeof result?.text === 'string') return { content: [{ type: 'text', text: result.text }] };
  return { content: [{ type: 'text', text: JSON.stringify(result ?? {}) }] };
}

async function handle(msg: { id?: unknown; method?: string; params?: Record<string, unknown> }): Promise<void> {
  const reply = (result: unknown) => { if (msg.id !== undefined) send({ jsonrpc: '2.0', id: msg.id, result }); };
  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'metatrooper-browser', version: '1.0.0' },
      });
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call':
      return reply(await toolCall(String(msg.params?.name ?? ''), (msg.params?.arguments ?? {}) as Record<string, unknown>));
    default:
      if (msg.id !== undefined && msg.method) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method ${msg.method}` } });
  }
}

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
