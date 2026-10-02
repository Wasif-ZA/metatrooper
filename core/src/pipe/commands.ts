import type { DatabaseSync } from 'node:sqlite';
import { nowIso, ulid } from '../time.ts';
import { E, RpcError, toRpcError } from './errors.ts';

export interface Request {
  id: string;
  method: string;
  params: Record<string, unknown>;
  origin: string;
}

export interface CallContext {
  ui: boolean;
  origin: string;
}

export type Handler = (params: Record<string, unknown>, ctx: CallContext) => unknown | Promise<unknown>;

export interface MethodSpec {
  handler: Handler;
  needsUi?: boolean;
  queued?: boolean;
}

export const NOT_QUEUED = new Set([
  'core.ping', 'core.stop', 'ui.hello', 'session.focus', 'engines.check', 'pipeline.validate',
  'plugin.preview', 'plugin.install', 'plugin.secret.set', 'mcp.resolve',
]);

export function isQueueable(method: string): boolean {
  return !NOT_QUEUED.has(method) && !method.startsWith('browser.');
}

export const SENSITIVE_PARAMS = ['prompt', 'body'];

/** Replaces free-text params with their length; pending rows keep them so the queue can still run them. */
export function scrubParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (SENSITIVE_PARAMS.includes(k) && typeof v === 'string') out[`${k}_length`] = v.length;
    else out[k] = v;
  }
  return out;
}

function storedOutcome(row: { status: string; result: string | null }): unknown {
  const parsed = row.result ? JSON.parse(row.result) : null;
  if (row.status === 'error') throw new RpcError(parsed?.code ?? E.INTERNAL, parsed?.message ?? 'error', parsed?.data);
  return parsed;
}

export class CommandRunner {
  private db: DatabaseSync;
  private methods: Map<string, MethodSpec>;
  private waiters = new Map<string, Array<() => void>>();

  constructor(db: DatabaseSync, methods: Map<string, MethodSpec>) {
    this.db = db;
    this.methods = methods;
  }

  async call(req: Request, ctx: CallContext): Promise<unknown> {
    const spec = this.methods.get(req.method);
    if (!spec) throw new RpcError(E.METHOD_NOT_FOUND, `unknown method ${req.method}`);
    if (spec.needsUi && !ctx.ui) throw new RpcError(E.NEEDS_UI, `${req.method} needs a trusted UI connection (ui.hello)`);
    if (!isQueueable(req.method)) return spec.handler(req.params, ctx);
    return this.runOnce(req, spec, ctx);
  }

  private async runOnce(req: Request, spec: MethodSpec, ctx: CallContext): Promise<unknown> {
    const claimed = this.db
      .prepare(
        `INSERT INTO command (id, at, origin, method, params, status) VALUES (?, ?, ?, ?, ?, 'accepted')
         ON CONFLICT(id) DO UPDATE SET status = 'accepted' WHERE command.status = 'queued'`,
      )
      .run(req.id, nowIso(), req.origin, req.method, JSON.stringify(req.params ?? {}));
    if (Number(claimed.changes) === 0) return this.awaitStored(req.id);
    return this.execute(req.id, req.method, req.params ?? {}, spec, ctx);
  }

  private async execute(id: string, method: string, params: Record<string, unknown>, spec: MethodSpec, ctx: CallContext): Promise<unknown> {
    this.db.prepare("UPDATE command SET status = 'running' WHERE id = ?").run(id);
    try {
      const result = await spec.handler(params, ctx);
      this.db
        .prepare("UPDATE command SET status = 'ok', result = ?, done_at = ? WHERE id = ?")
        .run(JSON.stringify(result ?? {}), nowIso(), id);
      return result ?? {};
    } catch (e) {
      const err = toRpcError(e);
      this.db
        .prepare("UPDATE command SET status = 'error', result = ?, done_at = ? WHERE id = ?")
        .run(JSON.stringify(err.toJSON()), nowIso(), id);
      throw err;
    } finally {
      this.db.prepare('UPDATE command SET params = ? WHERE id = ?').run(JSON.stringify(scrubParams(params)), id);
      for (const w of this.waiters.get(id) ?? []) w();
      this.waiters.delete(id);
    }
  }

  private async awaitStored(id: string): Promise<unknown> {
    for (;;) {
      const row = this.db.prepare('SELECT status, result FROM command WHERE id = ?').get(id) as
        | { status: string; result: string | null }
        | undefined;
      if (!row) throw new RpcError(E.NOT_FOUND, `command ${id} vanished`);
      if (row.status === 'ok' || row.status === 'error') return storedOutcome(row);
      await new Promise<void>((resolve) => {
        const list = this.waiters.get(id) ?? [];
        list.push(resolve);
        this.waiters.set(id, list);
        setTimeout(resolve, 200);
      });
    }
  }

  /** Startup recovery per pipe-protocol.md: interrupted running rows fail, accepted rows re-run, queued rows run. */
  async recover(): Promise<void> {
    const running = this.db.prepare("SELECT id, method FROM command WHERE status = 'running'").all() as Array<{ id: string; method: string }>;
    for (const r of running) {
      const err = new RpcError(E.INTERRUPTED, 'interrupted by core restart');
      this.db
        .prepare("UPDATE command SET status = 'error', result = ?, done_at = ? WHERE id = ?")
        .run(JSON.stringify(err.toJSON()), nowIso(), r.id);
      this.db
        .prepare('INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, ?, ?, ?)')
        .run(ulid(), nowIso(), 'interrupted-command', r.id, `${r.method} was interrupted by a core restart and was not re-run`);
    }
    const finished = this.db.prepare("SELECT id, params FROM command WHERE status IN ('ok','error')").all() as Array<{ id: string; params: string }>;
    const rewrite = this.db.prepare('UPDATE command SET params = ? WHERE id = ?');
    for (const r of finished) {
      let params: Record<string, unknown>;
      try { params = JSON.parse(r.params || '{}'); } catch { continue; }
      const scrubbed = JSON.stringify(scrubParams(params));
      if (scrubbed !== r.params) rewrite.run(scrubbed, r.id);
    }
    await this.runPending(true);
  }

  /** Runs rows queued by clients while the core is up (a pipe reply that took longer than 300 ms). */
  async drainQueued(): Promise<void> {
    await this.runPending(false);
  }

  private async runPending(includeAccepted: boolean): Promise<void> {
    const statuses = includeAccepted ? "('accepted','queued')" : "('queued')";
    const pending = this.db
      .prepare(`SELECT id, method, params, origin, status FROM command WHERE status IN ${statuses} ORDER BY CASE status WHEN 'accepted' THEN 0 ELSE 1 END, rowid`)
      .all() as Array<{ id: string; method: string; params: string; origin: string; status: string }>;
    for (const row of pending) {
      const spec = this.methods.get(row.method);
      const params = JSON.parse(row.params || '{}');
      if (!spec || !isQueueable(row.method) || spec.needsUi) {
        const err = new RpcError(spec ? E.NEEDS_UI : E.METHOD_NOT_FOUND, spec ? `${row.method} cannot run from the queue` : `unknown method ${row.method}`);
        this.db
          .prepare("UPDATE command SET status = 'error', result = ?, done_at = ?, params = ? WHERE id = ?")
          .run(JSON.stringify(err.toJSON()), nowIso(), JSON.stringify(scrubParams(params)), row.id);
        continue;
      }
      if (row.status === 'queued') {
        const claimed = this.db.prepare("UPDATE command SET status = 'accepted' WHERE id = ? AND status = 'queued'").run(row.id);
        if (Number(claimed.changes) === 0) continue;
      }
      try {
        await this.execute(row.id, row.method, params, spec, { ui: false, origin: row.origin });
      } catch {
        // the error is stored on the row
      }
    }
  }
}
