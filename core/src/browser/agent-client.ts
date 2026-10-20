import net from 'node:net';
import { browserPipe } from '../paths.ts';
import { openReaderDb } from '../store/db.ts';
import { createDecoder, encode } from '../pipe/framing.ts';
import { ancestors, parentTable } from '../browser/ancestry.ts';
import { call as coreCall } from '../pipe/client.ts';
import { actionHash, APPROVAL_TIMEOUT_MS, type Control } from '../approvals.ts';

const CALL_TIMEOUT_MS = 30_000;
const UNAVAILABLE = 'browser not available: the MetaTrooper workbench is closed';

const pane = { pane_id: { type: 'string', description: 'From panes; may be omitted when this session owns exactly one pane.' } };
const budget = {
  max_tokens: { type: 'integer', default: 4000 },
  continue: { type: 'string', description: 'The cursor named at the end of a cut answer; returns the next part.' },
};
const READ_ONLY = new Set(['panes', 'snapshot', 'screenshot', 'read', 'console', 'network', 'wait_for']);
export const TOOLS: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean> }> = [
  { name: 'panes', description: 'List the browser panes this session may drive.', inputSchema: { type: 'object', properties: {} } },
  { name: 'navigate', description: 'Load a URL in a pane; opens a pane for this session when it has none. Returns the page state.', inputSchema: { type: 'object', properties: { ...pane, url: { type: 'string' } }, required: ['url'] } },
  { name: 'back', description: 'Go back one page. Returns the page state.', inputSchema: { type: 'object', properties: { ...pane } } },
  { name: 'snapshot', description: 'Accessibility tree as text, child frames and shadow roots included; actionable nodes carry [ref=e12], or [ref=f1e12] inside a frame. interactive: only nodes with a ref and their ancestors. since_last: lines added (+) and removed (-) since your previous snapshot of this pane. scope_ref: only the subtree under that ref.', inputSchema: { type: 'object', properties: { ...pane, ...budget, scope_ref: { type: 'string' }, interactive: { type: 'boolean', default: false }, since_last: { type: 'boolean', default: false } } } },
  { name: 'read', description: 'The main text of the page, one line per block; search keeps only lines containing it.', inputSchema: { type: 'object', properties: { ...pane, ...budget, search: { type: 'string' } } } },
  { name: 'click', description: 'Click the node with this ref. Returns the page state and the interactive snapshot diff.', inputSchema: { type: 'object', properties: { ...pane, ref: { type: 'string' } }, required: ['ref'] } },
  { name: 'type', description: 'Replace the text of the node with this ref. Returns the page state and the interactive snapshot diff.', inputSchema: { type: 'object', properties: { ...pane, ref: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['ref', 'text'] } },
  { name: 'key', description: 'Press a key or chord on the focused element, e.g. "Enter", "Tab", "Control+A".', inputSchema: { type: 'object', properties: { ...pane, keys: { type: 'string' } }, required: ['keys'] } },
  { name: 'select', description: 'Choose an option in a select element. Returns the page state and the interactive snapshot diff.', inputSchema: { type: 'object', properties: { ...pane, ref: { type: 'string' }, value: { type: 'string' } }, required: ['ref', 'value'] } },
  { name: 'scroll', description: 'Scroll the page, or a node into view.', inputSchema: { type: 'object', properties: { ...pane, ref: { type: 'string' }, dy: { type: 'integer' } }, required: ['dy'] } },
  { name: 'wait_for', description: 'Wait until text or a ref appears.', inputSchema: { type: 'object', properties: { ...pane, text: { type: 'string' }, ref: { type: 'string' }, timeout_ms: { type: 'integer', default: 10000 } } } },
  { name: 'screenshot', description: 'JPEG of the viewport, the full page, or one element (ref); no side over 1,568 px.', inputSchema: { type: 'object', properties: { ...pane, full_page: { type: 'boolean', default: false }, ref: { type: 'string' }, format: { type: 'string', enum: ['jpeg', 'png'], default: 'jpeg' } } } },
  { name: 'evaluate', description: 'Run a JavaScript expression in an isolated world; result capped at 20 KB.', inputSchema: { type: 'object', properties: { ...pane, expression: { type: 'string' } }, required: ['expression'] } },
  { name: 'console', description: 'Last 200 console messages.', inputSchema: { type: 'object', properties: { ...pane, since_ms: { type: 'integer' } } } },
  { name: 'network', description: 'Last 200 requests.', inputSchema: { type: 'object', properties: { ...pane, since_ms: { type: 'integer' } } } },
  { name: 'dialog', description: 'Accept or dismiss the open alert, confirm or beforeunload dialog.', inputSchema: { type: 'object', properties: { ...pane, accept: { type: 'boolean' }, prompt_text: { type: 'string' } }, required: ['accept'] } },
].map((t) => ({ ...t, annotations: READ_ONLY.has(t.name) ? { readOnlyHint: true } : { readOnlyHint: false, destructiveHint: true } }));

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
  private unbound: string | null = null;

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
        const token = process.env.TROOP_BROWSER_TOKEN || undefined;
        this.sessionId ??= findSession() ?? (token ? process.env.TROOP_SESSION_ID || null : null);
        if (this.sessionId) {
          const r = await this.raw('browser.hello', { session_id: this.sessionId, pid: process.pid, ...(token ? { token } : {}) });
          if (r.error) { this.sessionId = null; this.unbound = `the browser refused this session: ${r.error.message}`; }
        } else this.unbound = 'no MetaTrooper session is an ancestor of this process; run it from an agent session';
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
    if (!this.sessionId && this.unbound && method !== 'browser.panes') return { error: { code: -32030, message: this.unbound } };
    return this.raw(method, params);
  }
}

const browser = new Browser();

const CHECKED = new Set(['click', 'type', 'select', 'key']);
const CONTROL_CHANGED = -32035;
type Reply = { result?: unknown; error?: { code: number; message: string } };

/** Describes the target, asks the core's approval.check, then sends the call with the checked control as `expect`; a changed control checks again. */
async function checkedCall(name: string, args: Record<string, unknown>): Promise<Reply> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const d = await browser.call('browser.describe', { ...args, tool: name });
    if (d.error) return d;
    const { session_id, origin, control, password, hidden } = d.result as { session_id: string; origin: string; control: Control | null; password: boolean; hidden: boolean };
    const check = { session_id, surface: 'browser', target: origin || 'about:blank', action: name, args, control };
    const out = await coreCall('approval.check', { ...check, password, hidden, action_hash: actionHash(check) }, { waitMs: APPROVAL_TIMEOUT_MS + 10_000 });
    if (out.kind !== 'reply') return { error: { code: -32099, message: 'not sent: the MetaTrooper core is offline, so this action cannot be checked' } };
    if (out.reply.error) return { error: out.reply.error };
    const v = out.reply.result as { decision: string; reason?: string };
    if (v.decision === 'deny') return { error: { code: -32030, message: `not sent: ${v.reason}` } };
    if (v.decision === 'rejected') return { error: { code: -32030, message: 'not approved: the user rejected this action' } };
    if (v.decision === 'expired') return { error: { code: -32030, message: 'not approved in time' } };
    const r = await browser.call(`browser.${name}`, { ...args, expect: { ...(control ?? { name: '', automation_id: '' }), origin, hidden, password } });
    if (r.error?.code !== CONTROL_CHANGED) return r;
  }
  return { error: { code: CONTROL_CHANGED, message: 'the control kept changing; nothing was sent' } };
}

/** One browser tool call for this process's session; click, type, select and key go through the approval check first. */
export async function runTool(name: string, args: Record<string, unknown>): Promise<Reply> {
  if (!TOOLS.some((t) => t.name === name)) return { error: { code: -32601, message: `unknown tool ${name}` } };
  const { expect: _drop, ...clean } = args ?? {};
  return CHECKED.has(name) ? checkedCall(name, clean) : browser.call(`browser.${name}`, clean);
}

/** runTool with the reply shaped as MCP tool content. */
export async function toolCall(name: string, args: Record<string, unknown>): Promise<object> {
  const r = await runTool(name, args);
  if (r.error) return { content: [{ type: 'text', text: r.error.message }], isError: true };
  const result = r.result as { data_base64?: string; mime?: string; text?: string; truncated?: boolean } | undefined;
  if (name === 'screenshot' && result?.data_base64) {
    const content: object[] = [{ type: 'image', data: result.data_base64, mimeType: result.mime ?? 'image/jpeg' }];
    if (result.truncated) content.push({ type: 'text', text: 'truncated: the page is taller than 16,384 px' });
    return { content };
  }
  if ((name === 'snapshot' || name === 'read') && typeof result?.text === 'string') return { content: [{ type: 'text', text: result.text }] };
  return { content: [{ type: 'text', text: JSON.stringify(result ?? {}) }] };
}

