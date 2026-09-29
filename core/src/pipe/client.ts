import fs from 'node:fs';
import net from 'node:net';
import { corePipe, uiKeyFile } from '../paths.ts';
import { nowIso, ulid } from '../time.ts';
import { openCoreDb } from '../store/db.ts';
import { encode, createDecoder } from './framing.ts';
import { isQueueable } from './commands.ts';

export const QUEUE_AFTER_MS = 300;

export interface RpcReply {
  id: string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class PipeClient {
  private socket: net.Socket;
  private pending = new Map<string, (r: RpcReply) => void>();
  private closed = false;

  private constructor(socket: net.Socket) {
    this.socket = socket;
    const decode = createDecoder((raw) => {
      const r = raw as RpcReply;
      const waiter = r && typeof r.id === 'string' ? this.pending.get(r.id) : undefined;
      if (waiter) {
        this.pending.delete(r.id as string);
        waiter(r);
      }
    });
    socket.on('data', (chunk) => { try { decode(chunk); } catch {} });
    const fail = () => {
      this.closed = true;
      for (const [id, w] of this.pending) w({ id, error: { code: -32099, message: 'pipe closed' } });
      this.pending.clear();
    };
    socket.on('error', fail);
    socket.on('close', fail);
  }

  static connect(pipePath = corePipe(), timeoutMs = 1000): Promise<PipeClient> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(pipePath);
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('core offline')); }, timeoutMs);
      socket.once('connect', () => { clearTimeout(timer); resolve(new PipeClient(socket)); });
      socket.once('error', (e) => { clearTimeout(timer); reject(e); });
    });
  }

  send(method: string, params: Record<string, unknown> = {}, id: string = ulid()): { id: string; reply: Promise<RpcReply> } {
    const reply = new Promise<RpcReply>((resolve) => {
      if (this.closed) return resolve({ id, error: { code: -32099, message: 'pipe closed' } });
      this.pending.set(id, resolve);
      this.socket.write(encode({ jsonrpc: '2.0', id, method, params, meta: { origin: 'cli', sent_at: nowIso() } }));
    });
    return { id, reply };
  }

  async hello(): Promise<boolean> {
    let key: string;
    try {
      key = fs.readFileSync(uiKeyFile(), 'utf8').trim();
    } catch {
      return false;
    }
    const r = await this.send('ui.hello', { ui_key: key }).reply;
    return !r.error;
  }

  close(): void {
    this.socket.destroy();
  }
}

export function enqueue(id: string, method: string, params: Record<string, unknown>): void {
  const db = openCoreDb();
  try {
    db.prepare(
      `INSERT INTO command (id, at, origin, method, params, status) VALUES (?, ?, 'cli', ?, ?, 'queued')
       ON CONFLICT(id) DO NOTHING`,
    ).run(id, nowIso(), method, JSON.stringify(params));
  } finally {
    db.close();
  }
}

export type CallOutcome =
  | { kind: 'reply'; reply: RpcReply }
  | { kind: 'queued'; id: string }
  | { kind: 'offline' };

export interface CallOptions {
  ui?: boolean;
  onQueued?: (id: string) => void;
  waitMs?: number;
}

export async function call(method: string, params: Record<string, unknown> = {}, opts: CallOptions = {}): Promise<CallOutcome> {
  const id = ulid();
  const queueable = isQueueable(method);
  let client: PipeClient;
  try {
    client = await PipeClient.connect(corePipe(), QUEUE_AFTER_MS);
  } catch {
    if (!queueable) return { kind: 'offline' };
    enqueue(id, method, params);
    opts.onQueued?.(id);
    return { kind: 'queued', id };
  }
  try {
    if (opts.ui) await client.hello();
    const { reply } = client.send(method, params, id);
    let queued = false;
    const timer = queueable
      ? setTimeout(() => {
          queued = true;
          enqueue(id, method, params);
          opts.onQueued?.(id);
        }, QUEUE_AFTER_MS)
      : null;
    const waited = await Promise.race([
      reply,
      new Promise<null>((r) => setTimeout(() => r(null), opts.waitMs ?? 30_000)),
    ]);
    if (timer) clearTimeout(timer);
    if (waited) return { kind: 'reply', reply: waited };
    return queued ? { kind: 'queued', id } : { kind: 'offline' };
  } finally {
    client.close();
  }
}
