import net from 'node:net';
import { browserPipe } from '../paths.ts';
import { openReaderDb } from '../store/db.ts';
import { createDecoder, encode } from '../pipe/framing.ts';
import { ancestors, parentTable } from '../browser/ancestry.ts';

const CALL_TIMEOUT_MS = 30_000;

export type Reply = { result?: unknown; error?: { code: number; message: string } };

/** The MetaTrooper session this process belongs to: the first ancestor whose pid is a session's launcher pid. */
export function findSession(): string | null {
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

/** One connection to `\\.\pipe\metatrooper-browser`, bound to this process's session with `browser.hello`. */
export class WorkbenchPipe {
  private socket: net.Socket | null = null;
  private pending = new Map<string, (r: Reply) => void>();
  private next = 0;
  private unavailable: string;
  sessionId: string | null | undefined;

  constructor(unavailable: string) {
    this.unavailable = unavailable;
  }

  private connect(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) return Promise.resolve(this.socket);
    return new Promise((resolve, reject) => {
      const s = net.connect(browserPipe());
      const decode = createDecoder((raw) => {
        const r = raw as { id?: string } & Reply;
        const w = typeof r.id === 'string' ? this.pending.get(r.id) : undefined;
        if (w) {
          this.pending.delete(r.id as string);
          w(r);
        }
      });
      s.on('data', (c) => { try { decode(c); } catch {} });
      const drop = () => {
        this.socket = null;
        for (const w of this.pending.values()) w({ error: { code: -32099, message: this.unavailable } });
        this.pending.clear();
      };
      s.once('error', () => { drop(); reject(new Error(this.unavailable)); });
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

  private raw(method: string, params: Record<string, unknown>): Promise<Reply> {
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

  /** Whether the workbench answers; also binds the session. */
  async available(): Promise<boolean> {
    try {
      await this.connect();
      return true;
    } catch {
      return false;
    }
  }

  async call(method: string, params: Record<string, unknown>): Promise<Reply> {
    if (!(await this.available())) return { error: { code: -32099, message: this.unavailable } };
    return this.raw(method, params);
  }
}
