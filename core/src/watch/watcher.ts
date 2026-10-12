import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { settings } from '../settings.ts';
import { nowIso, ulid } from '../time.ts';

export const SLACK_MS = 200;
export const AWAY_MS = 2000;
export const READY_MS = 15_000;
export const HELPER = path.join(path.dirname(fileURLToPath(import.meta.url)), 'input-hook.ps1');

/** One line from the helper: `t` is epoch ms, `idle_ms` the time since the last input (-1 for key and mouse). */
export interface WatchEvent { kind: 'key' | 'mouse' | 'focus' | 'opened' | 'invoked'; t: number; idle_ms: number; hwnd: number; title: string }

const actions = new Map<string, { start: number; end: number }>();

/** Marks a `metatrooper-desktop` action as in flight until `endAction`; returns its id. */
export function beginAction(now = Date.now()): string {
  const id = `da_${ulid(now)}`;
  actions.set(id, { start: now, end: Infinity });
  return id;
}

export function endAction(id: string, now = Date.now()): void {
  const a = actions.get(id);
  if (a) a.end = now;
  for (const [k, v] of actions) if (v.end + 60_000 < now) actions.delete(k);
}

function inFlight(t: number): boolean {
  for (const a of actions.values()) if (t >= a.start - SLACK_MS && t <= a.end + SLACK_MS) return true;
  return false;
}

/** Which needs-you item an event raises: `input` for injected input no action explains, `away` for a UI Automation event after 2 s with no input. */
export function judge(ev: WatchEvent): 'input' | 'away' | null {
  if (inFlight(ev.t)) return null;
  if (ev.kind === 'key' || ev.kind === 'mouse') return 'input';
  return ev.idle_ms >= AWAY_MS ? 'away' : null;
}

const TEXT = {
  input: 'input from another program in',
  away: 'the desktop changed while you were away from it, in',
};

/** Raises one open item per kind and window, and sets the take-over flag (D62) when `desktop.watch_pause` is on. */
export function raise(db: DatabaseSync, ev: WatchEvent): boolean {
  const kind = judge(ev);
  if (!kind) return false;
  const ref = `watch:${kind}:${ev.hwnd}`;
  const text = `${TEXT[kind]} "${ev.title || 'a window with no title'}" (the watcher cannot name the program behind it)`;
  db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) SELECT ?, ?, 'other', ?, ? WHERE NOT EXISTS (SELECT 1 FROM needs_you WHERE kind = 'other' AND ref = ? AND resolved_at IS NULL)")
    .run(ulid(), nowIso(), ref, text, ref);
  if (settings().desktop.watch_pause) db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('takeover_paused_at', ?)").run(nowIso());
  return true;
}

/** Runs the hook helper while any grant is live; `meta.input_watcher` is 'on', 'off' (the helper failed or was blocked) or 'idle'. */
export class Watcher {
  private db: DatabaseSync;
  private policy: string;
  private child: ChildProcess | null = null;
  private failed = false;

  constructor(db: DatabaseSync, opts: { policy?: string } = {}) {
    this.db = db;
    this.policy = opts.policy ?? 'Bypass';
    this.state('idle');
  }

  private state(value: string): void {
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('input_watcher', ?)").run(value);
  }

  tick(): void {
    const live = Boolean(this.db.prepare('SELECT 1 FROM grant WHERE ended_at IS NULL LIMIT 1').get());
    if (live && !this.child && !this.failed) this.start();
    if (!live && (this.child || this.failed)) {
      this.stop();
      this.failed = false;
      this.state('idle');
    }
  }

  private start(): void {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', this.policy, '-File', HELPER], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    this.child = child;
    let ready = false;
    const fail = () => {
      clearTimeout(timer);
      if (this.child !== child) return;
      this.child = null;
      this.failed = true;
      this.state('off');
      child.kill();
    };
    const timer = setTimeout(() => { if (!ready) fail(); }, READY_MS);
    child.on('error', fail);
    child.on('exit', fail);
    readline.createInterface({ input: child.stdout! }).on('line', (line) => {
      let msg: (WatchEvent & { ready?: boolean }) | null = null;
      try { msg = JSON.parse(line); } catch { return; }
      if (msg?.ready) {
        ready = true;
        clearTimeout(timer);
        this.state('on');
      } else if (msg) {
        try { raise(this.db, msg); } catch {}
      }
    });
  }

  stop(): void {
    const child = this.child;
    this.child = null;
    if (!child) return;
    child.stdin?.end();
    child.kill();
  }
}
