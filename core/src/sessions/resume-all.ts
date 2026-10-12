import type { DatabaseSync } from 'node:sqlite';
import { appendEvent } from '../events/append.ts';
import { processEvents } from '../events/processor.ts';
import { getEngine } from '../engines/registry.ts';
import { nowIso, ulid } from '../time.ts';
import { screenText } from '../terminal/index.ts';

export const MAX_AT_ONCE = 3;
export const GAP_MS = 2000;
export const JITTER_MS = 1000;
/** The longest a resumed session counts as resuming while it stays `starting`. */
export const WINDOW_MS = 10_000;
export const AUTH_FAILURES = 2;

export interface Waiting { id: string; engine: string }

/** Terminal sessions that were live when the core stopped: rows the last core left open. Read before any event is processed. */
export function liveAtStart(db: DatabaseSync): Waiting[] {
  return db.prepare("SELECT id, engine_id AS engine FROM session WHERE host = 'pty' AND state != 'exited' AND hidden = 0 AND run_id IS NULL ORDER BY julianday(started_at), id")
    .all() as unknown as Waiting[];
}

/** Appends core.process-gone with a null pid for each session. */
export function markGone(db: DatabaseSync, list: Waiting[]): void {
  for (const s of list) appendEvent('core.process-gone', s.id, { pid: null }, db);
}

export interface ResumeDeps {
  /** Starts the session again; returns the new session id, or null when it could not start. */
  resume(id: string): Promise<string | null>;
  stateOf(id: string): string | undefined;
  screenText(id: string): Promise<string | null>;
  authError(engine: string): string | undefined;
  /** Raises the one needs-you item for an engine that stopped being resumed. */
  raise(engine: string): void;
  now(): number;
  rand(): number;
}

interface Flight { id: string; engine: string; at: number; counted: boolean }

/** Resumes a queue of sessions: at most MAX_AT_ONCE resuming at a time, GAP_MS plus up to JITTER_MS apart, and no more of an engine after AUTH_FAILURES screens match its auth_error. */
export class Resumer {
  readonly started = new Map<string, string>();
  readonly blocked = new Set<string>();
  private flying: Flight[] = [];
  private failures = new Map<string, number>();
  private nextAt = 0;
  private busy = false;
  private queue: Waiting[];
  private deps: ResumeDeps;

  constructor(queue: Waiting[], deps: ResumeDeps) {
    this.queue = [...queue];
    this.deps = deps;
  }

  inFlight(): number {
    return this.flying.length;
  }

  done(): boolean {
    return !this.queue.length && !this.flying.length;
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.check();
      await this.launch();
    } finally {
      this.busy = false;
    }
  }

  private async check(): Promise<void> {
    for (const f of [...this.flying]) {
      const state = this.deps.stateOf(f.id);
      const over = state !== 'starting' || this.deps.now() - f.at >= WINDOW_MS;
      if (!f.counted && this.authFailed(f.engine, await this.deps.screenText(f.id))) {
        f.counted = true;
        const n = (this.failures.get(f.engine) ?? 0) + 1;
        this.failures.set(f.engine, n);
        if (n >= AUTH_FAILURES && !this.blocked.has(f.engine)) {
          this.blocked.add(f.engine);
          this.queue = this.queue.filter((q) => q.engine !== f.engine);
          this.deps.raise(f.engine);
        }
      }
      if (over) this.flying = this.flying.filter((x) => x !== f);
    }
  }

  private authFailed(engine: string, text: string | null): boolean {
    const rule = this.deps.authError(engine);
    if (!rule || !text) return false;
    try {
      return new RegExp(rule, 'i').test(text.slice(-4096));
    } catch {
      return false;
    }
  }

  private async launch(): Promise<void> {
    while (this.queue.length && this.flying.length < MAX_AT_ONCE && this.deps.now() >= this.nextAt) {
      const next = this.queue.shift()!;
      const id = await this.deps.resume(next.id);
      if (!id) continue;
      this.started.set(next.id, id);
      this.flying.push({ id, engine: next.engine, at: this.deps.now(), counted: false });
      this.nextAt = this.deps.now() + GAP_MS + this.deps.rand() * JITTER_MS;
    }
  }
}

/** The core's Resumer: resumes through session.resume, points the window selection at the new id, and raises an `other` needs-you item per blocked engine. */
export function coreResumer(db: DatabaseSync, queue: Waiting[], resume: (id: string) => Promise<{ session_id: string }>): Resumer {
  const state = db.prepare('SELECT state FROM session WHERE id = ?');
  const reselect = db.prepare('UPDATE ui_selection SET session_id = ? WHERE session_id = ?');
  const inbox = db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) SELECT ?, ?, 'other', ?, ? WHERE NOT EXISTS (SELECT 1 FROM needs_you WHERE ref = ? AND kind = 'other' AND resolved_at IS NULL)");
  return new Resumer(queue, {
    resume: async (old) => {
      try {
        if (state.get(old) && (state.get(old) as { state: string }).state !== 'exited') processEvents(db);
        const r = await resume(old);
        reselect.run(r.session_id, old);
        return r.session_id;
      } catch (e) {
        console.error(`session ${old} not resumed: ${(e as Error).message}`);
        return null;
      }
    },
    stateOf: (id) => (state.get(id) as { state: string } | undefined)?.state,
    screenText,
    authError: (engine) => getEngine(db, engine)?.auth_error,
    raise: (engine) => {
      const login = getEngine(db, engine)?.login;
      const ref = `resume:${engine}`;
      inbox.run(ulid(), nowIso(), ref, `${engine} needs signing in, so its sessions were not resumed after the restart${login ? ` (${login})` : ''}`, ref);
    },
    now: Date.now,
    rand: Math.random,
  });
}
