import path from 'node:path';
import readline from 'node:readline';
import { spawn, type ChildProcess } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { coreDir } from '../paths.ts';
import { E, RpcError } from '../pipe/errors.ts';
import type { MethodSpec } from '../pipe/commands.ts';
import { nowIso, ulid } from '../time.ts';
import { ancestors, parentTableAsync } from '../browser/ancestry.ts';
import { beginAction, endAction } from '../watch/watcher.ts';
import { covers, endGrant, liveGrants, sameWindow, takeoverPaused, type GrantRow, type WindowInfo } from '../grants.ts';

export const NOT_GRANTED = 'window not granted; ask the user to give it to you';
export const PAUSED = 'paused by the user';
export const OFF = 'computer use is off: the desktop plugin is disabled';
export const CHUNK = 8;
/** A pause acknowledgement waits this long after the last posted key or click. */
export const POST_SETTLE_MS = 250;
const CONTROL_CHANGED = -32035;
const HELPER_TIMEOUT_MS = 30_000;

export function helperScript(): string {
  return process.env.METATROOPER_UIA_HELPER || path.join(coreDir, 'src', 'desktop', 'uia-helper.ps1');
}

/** The UI Automation helper: one process, one JSON request and one JSON reply per line, in order. */
export class Helper {
  private child: ChildProcess | null = null;
  private waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout; child: ChildProcess }>();
  private next = 0;

  private start(): ChildProcess {
    if (this.child && this.child.exitCode === null && !this.child.killed) return this.child;
    const script = helperScript();
    const child = script.endsWith('.js')
      ? spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })
      : spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    readline.createInterface({ input: child.stdout! }).on('line', (line) => {
      let msg: { id?: number; result?: unknown; error?: string };
      try { msg = JSON.parse(line); } catch { return; }
      const w = typeof msg.id === 'number' ? this.waiting.get(msg.id) : undefined;
      if (!w) return;
      this.waiting.delete(msg.id!);
      clearTimeout(w.timer);
      if (msg.error) w.reject(new RpcError(E.INTERNAL, String(msg.error)));
      else w.resolve(msg.result);
    });
    const fail = () => {
      if (this.child === child) this.child = null;
      for (const [id, w] of this.waiting) {
        if (w.child !== child) continue;
        this.waiting.delete(id);
        clearTimeout(w.timer);
        w.reject(new RpcError(E.INTERNAL, 'the desktop helper stopped'));
      }
    };
    child.once('exit', fail);
    child.once('error', fail);
    child.stdin!.on('error', () => {});
    this.child = child;
    return child;
  }

  private queue: Promise<unknown> = Promise.resolve();

  /** Requests go one at a time; `gate` runs as this one leaves the queue, right before it is written, and may throw to drop it. */
  request<T = any>(op: string, params: Record<string, unknown> = {}, timeoutMs = HELPER_TIMEOUT_MS, gate?: () => void): Promise<T> {
    const run = this.queue.then(() => { gate?.(); return this.send<T>(op, params, timeoutMs); });
    this.queue = run.catch(() => {});
    return run;
  }

  private send<T>(op: string, params: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const child = this.start();
    const id = ++this.next;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        const exited = child.exitCode === null ? new Promise((r) => child.once('exit', r)) : Promise.resolve();
        if (this.child === child) this.stop();
        else try { child.kill(); } catch {}
        exited.then(() => reject(new RpcError(E.INTERNAL, `desktop helper ${op} timed out`)));
      }, timeoutMs);
      this.waiting.set(id, { resolve, reject, timer, child });
      child.stdin!.write(JSON.stringify({ id, op, ...params }) + '\n');
    });
  }

  running(): boolean {
    return Boolean(this.child && this.child.exitCode === null);
  }

  stop(): void {
    try { this.child?.kill(); } catch {}
    this.child = null;
  }
}

const str = (p: Record<string, unknown>, k: string) => {
  const v = p[k];
  if (typeof v !== 'string' || !v) throw new RpcError(E.INVALID_PARAMS, `${k} is required`);
  return v;
};
const hwndOf = (v: unknown): number => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw new RpcError(E.INVALID_PARAMS, 'window must be a window handle from windows');
  return n;
};

interface Described { control: { automation_id: string; name: string; role: string } | null; password: boolean; hidden?: boolean; rect: number[] | null }

/** Grants, the take-over flag and every desktop read and input, through one helper. */
export class Desktop {
  readonly helper = new Helper();
  private db: DatabaseSync;
  private uiPid: number | null = null;
  private bound = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();
  private inFlight: Promise<unknown> | null = null;
  private postedAt = 0;
  private rects = new Map<string, { rect: number[]; minimized: boolean }>();
  private ticking = false;

  constructor(db: DatabaseSync) {
    this.db = db;
    try { db.prepare("DELETE FROM meta WHERE key IN ('takeover_paused_at', 'takeover_resumed')").run(); } catch {}
  }

  private meta(key: string): string | null {
    return (this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  }

  /** Computer use is on while the built-in `desktop` plugin is enabled (spec.md Rollback). */
  enabled(): boolean {
    try {
      return Boolean((this.db.prepare("SELECT enabled FROM plugin WHERE id = 'desktop'").get() as { enabled: number } | undefined)?.enabled);
    } catch {
      return false;
    }
  }

  private on(): void {
    if (!this.enabled()) throw new RpcError(E.VALIDATION, OFF);
  }

  paused(sessionId: string): boolean {
    return takeoverPaused(this.db, sessionId);
  }

  /** Sets the flag, then waits for the chunk in flight; the reply is the acknowledgement. */
  async pause(): Promise<{ paused_at: string }> {
    const at = nowIso();
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('takeover_paused_at', ?)").run(at);
    while (this.inFlight) await this.inFlight.catch(() => {});
    const wait = this.postedAt + POST_SETTLE_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    return { paused_at: at };
  }

  resume(sessionId: string): void {
    if (!this.db.prepare('SELECT 1 FROM session WHERE id = ?').get(sessionId)) throw new RpcError(E.NOT_FOUND, 'session not found');
    let resumed: Record<string, string> = {};
    try { resumed = JSON.parse(this.meta('takeover_resumed') ?? '{}'); } catch {}
    resumed[sessionId] = nowIso();
    this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('takeover_resumed', ?)").run(JSON.stringify(resumed));
  }

  /** Whether `target` names a live grant of the session (approval.check's desktop rule). */
  granted(sessionId: string, target: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM grant WHERE id = ? AND session_id = ? AND ended_at IS NULL').get(target, sessionId));
  }

  info(hwnd: number): Promise<WindowInfo> {
    return this.helper.request<WindowInfo>('info', { hwnd });
  }

  /** The session's grant covering this window; a grant whose own window changed identity is ended on the way. */
  async resolve(sessionId: string, hwnd: number): Promise<{ grant: GrantRow; info: WindowInfo }> {
    this.on();
    const grants = liveGrants(this.db, sessionId);
    if (!grants.length) throw new RpcError(E.PANE_NOT_OWNED, NOT_GRANTED);
    const w = await this.info(hwnd);
    if (!w.alive || w.elevated || (this.uiPid !== null && w.pid === this.uiPid)) throw new RpcError(E.PANE_NOT_OWNED, NOT_GRANTED);
    for (const g of grants) {
      if (w.root === g.hwnd && !sameWindow(g, w)) { endGrant(this.db, g.id); continue; }
      if (!covers(g, w)) continue;
      if (w.root !== g.hwnd && !sameWindow(g, await this.info(g.hwnd))) { endGrant(this.db, g.id); continue; }
      return { grant: g, info: w };
    }
    throw new RpcError(E.PANE_NOT_OWNED, NOT_GRANTED);
  }

  /** The session's launcher pid must be among the caller's ancestors. */
  private async bind(p: Record<string, unknown>): Promise<string> {
    const sessionId = str(p, 'session_id');
    const pid = p.pid;
    const s = this.db.prepare('SELECT pid FROM session WHERE id = ? AND ended_at IS NULL').get(sessionId) as { pid: number | null } | undefined;
    if (!s || !s.pid || typeof pid !== 'number' || !Number.isInteger(pid)) throw new RpcError(E.PANE_NOT_OWNED, 'unknown session');
    const key = `${sessionId} ${pid}`;
    if (!this.bound.has(key)) {
      if (!ancestors(pid, await parentTableAsync()).includes(s.pid)) throw new RpcError(E.PANE_NOT_OWNED, 'that session is not an ancestor of the caller');
      this.bound.add(key);
    }
    return sessionId;
  }

  /** Runs one input at a time, so a pause drops every call still queued behind it. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.catch(() => {}).then(fn);
    this.chain = run.catch(() => {});
    return run;
  }

  /** Sends one input; the pause and the grant are rechecked as the request leaves the helper queue, right before it is written. */
  private async dispatch(sessionId: string, grantId: string, op: string, params: Record<string, unknown>, note = ''): Promise<Record<string, unknown>> {
    let watchId: string | null = null;
    const gate = () => {
      if (this.paused(sessionId)) throw new RpcError(E.PANE_NOT_OWNED, PAUSED + note);
      if (!this.enabled() || !this.granted(sessionId, grantId)) throw new RpcError(E.PANE_NOT_OWNED, NOT_GRANTED + note);
      watchId = beginAction();
    };
    const posted = op === 'key' || op === 'click';
    const p = this.helper.request<Record<string, unknown>>(op, params, undefined, gate)
      .catch((e: Error) => { throw /^control changed$/.test(e.message) ? new RpcError(CONTROL_CHANGED, `the control changed since it was checked; nothing was sent${note}`) : e; })
      .finally(() => { if (posted && watchId !== null) this.postedAt = Date.now(); });
    this.inFlight = p;
    try { return await p; } finally { if (this.inFlight === p) this.inFlight = null; if (watchId !== null) endAction(watchId); }
  }

  async describe(sessionId: string, hwnd: number, ref?: string): Promise<Described & { grant_id: string; file_dialog: boolean; pid: number }> {
    const { grant, info } = await this.resolve(sessionId, hwnd);
    const d = await this.helper.request<Described>('describe', { hwnd, ref, pid: info.pid });
    return { grant_id: grant.id, control: d.control, password: d.password === true, hidden: d.hidden === true, file_dialog: info.file_dialog, rect: d.rect, pid: info.pid };
  }

  async act(p: Record<string, unknown>, sessionId: string): Promise<Record<string, unknown>> {
    const hwnd = hwndOf(p.window);
    const action = str(p, 'action');
    if (!['click', 'type', 'key', 'scroll'].includes(action)) throw new RpcError(E.INVALID_PARAMS, 'action must be click, type, key or scroll');
    const ref = typeof p.ref === 'string' && p.ref ? p.ref : undefined;
    if ((action === 'click' || action === 'type') && !ref) throw new RpcError(E.INVALID_PARAMS, 'ref is required');
    return this.serial(async () => {
      if (this.paused(sessionId)) throw new RpcError(E.PANE_NOT_OWNED, PAUSED);
      const now = await this.describe(sessionId, hwnd, ref);
      const expect = (p.expect && typeof p.expect === 'object' ? p.expect : {}) as Record<string, unknown>;
      const c = now.control ?? { name: '', automation_id: '', role: '' };
      if (expect.grant_id !== undefined && expect.grant_id !== now.grant_id) throw new RpcError(CONTROL_CHANGED, 'the window changed; nothing was sent');
      if ((expect.name ?? '') !== c.name || (expect.automation_id ?? '') !== c.automation_id || (expect.role ?? '') !== c.role
        || Boolean(expect.password) !== now.password || Boolean(expect.hidden) !== now.hidden || Boolean(expect.file_dialog) !== now.file_dialog) {
        throw new RpcError(CONTROL_CHANGED, 'the control changed since it was checked; nothing was sent');
      }
      const seen = { check: 1, name: c.name, automation_id: c.automation_id, role: c.role, password: now.password ? 1 : 0, hidden: now.hidden ? 1 : 0, pid: now.pid };
      if (action !== 'type') return this.dispatch(sessionId, now.grant_id, action, { hwnd, ref, keys: p.keys, dy: p.dy, ...seen });
      const chars = Array.from(typeof p.text === 'string' ? p.text : '');
      let out: Record<string, unknown> = { status: 'unverifiable' };
      let focusLost = false;
      let done = 0;
      do {
        const n = Math.min(done + CHUNK, chars.length);
        const note = `; ${done} of ${chars.length} characters were typed`;
        if (this.paused(sessionId)) throw new RpcError(E.PANE_NOT_OWNED, PAUSED + note);
        if (done > 0 && (await this.resolve(sessionId, hwnd).catch(() => null))?.grant.id !== now.grant_id) throw new RpcError(E.PANE_NOT_OWNED, NOT_GRANTED + note);
        out = await this.dispatch(sessionId, now.grant_id, 'set_text', { hwnd, ref, value: chars.slice(0, n).join(''), ...seen }, note);
        if (out.focus_returned === false) focusLost = true;
        done = n;
      } while (done < chars.length);
      return focusLost ? { ...out, focus_returned: false } : out;
    });
  }

  /** Ends grants whose window closed or changed identity, and keeps each live grant's rectangle. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    if (!this.enabled()) {
      for (const g of liveGrants(this.db)) endGrant(this.db, g.id);
      if (this.helper.running()) this.helper.stop();
      return;
    }
    const grants = liveGrants(this.db);
    if (!grants.length) { this.rects.clear(); return; }
    this.ticking = true;
    try {
      for (const g of grants) {
        let w: WindowInfo;
        try { w = await this.info(g.hwnd); } catch { continue; }
        if (!sameWindow(g, w)) { endGrant(this.db, g.id); this.rects.delete(g.id); }
        else this.rects.set(g.id, { rect: w.rect, minimized: w.minimized });
      }
    } finally {
      this.ticking = false;
    }
  }

  methods(m: Map<string, MethodSpec>): void {
    m.set('desktop.ui-window', { needsUi: true, handler: (p) => {
      if (typeof p.pid !== 'number' || !Number.isInteger(p.pid)) throw new RpcError(E.INVALID_PARAMS, 'pid is required');
      this.uiPid = p.pid;
      return {};
    } });
    m.set('grant.candidates', { needsUi: true, handler: async () => {
      this.on();
      if (this.uiPid === null) throw new RpcError(E.VALIDATION, 'the workbench has not reported its own windows yet');
      const { windows } = await this.helper.request<{ windows: Array<WindowInfo> }>('list');
      return { windows: windows.filter((w) => w.pid !== this.uiPid && !w.elevated && w.title).map((w) => ({ hwnd: w.hwnd, title: w.title, exe: w.exe, pid: w.pid })) };
    } });
    m.set('grant.window', { needsUi: true, handler: async (p) => {
      const sessionId = str(p, 'session_id');
      const hwnd = hwndOf(p.hwnd);
      this.on();
      if (!this.db.prepare('SELECT 1 FROM session WHERE id = ? AND ended_at IS NULL').get(sessionId)) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (this.uiPid === null) throw new RpcError(E.VALIDATION, 'the workbench has not reported its own windows yet');
      const w = await this.info(hwnd);
      if (!w.alive) throw new RpcError(E.VALIDATION, 'that window is gone');
      if (w.pid === this.uiPid) throw new RpcError(E.VALIDATION, 'the MetaTrooper workbench cannot be granted');
      if (w.elevated) throw new RpcError(E.VALIDATION, 'an elevated window cannot be granted');
      if (w.root !== hwnd) throw new RpcError(E.VALIDATION, 'only a top-level window can be granted');
      const live = liveGrants(this.db, sessionId).find((g) => sameWindow(g, w));
      if (live) return { grant_id: live.id };
      const id = `gr_${ulid()}`;
      this.db.prepare('INSERT INTO grant (id, session_id, hwnd, pid, process_start, exe, title, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, sessionId, hwnd, w.pid, w.process_start, w.exe, w.title, nowIso());
      this.rects.set(id, { rect: w.rect, minimized: w.minimized });
      return { grant_id: id };
    } });
    m.set('grant.revoke', { needsUi: true, handler: (p) => {
      const id = str(p, 'grant_id');
      if (!this.db.prepare('SELECT 1 FROM grant WHERE id = ?').get(id)) throw new RpcError(E.NOT_FOUND, 'grant not found');
      endGrant(this.db, id);
      return {};
    } });
    m.set('grant.live', { needsUi: true, handler: () => ({
      grants: liveGrants(this.db).map((g) => ({ id: g.id, session_id: g.session_id, hwnd: g.hwnd, title: g.title, rect: this.rects.get(g.id)?.rect ?? null, minimized: this.rects.get(g.id)?.minimized ?? false })),
    }) });
    m.set('takeover.pause', { needsUi: true, handler: () => this.pause() });
    m.set('takeover.resume', { needsUi: true, handler: (p) => { this.resume(str(p, 'session_id')); return {}; } });

    m.set('desktop.windows', { handler: async (p) => {
      const sessionId = await this.bind(p);
      this.on();
      const grants = liveGrants(this.db, sessionId);
      if (!grants.length) return { windows: [] };
      const { windows } = await this.helper.request<{ windows: WindowInfo[] }>('list');
      const out: Array<Record<string, unknown>> = [];
      for (const g of grants) {
        const own = windows.find((w) => sameWindow(g, w));
        if (!own) { endGrant(this.db, g.id); continue; }
        out.push({ window: g.hwnd, title: own.title, exe: g.exe, grant_id: g.id, owner: 0 });
        for (const w of windows) if (w.hwnd !== g.hwnd && covers(g, w)) out.push({ window: w.hwnd, title: w.title, exe: w.exe, grant_id: g.id, owner: w.owner_chain[0] ?? g.hwnd });
      }
      return { windows: out };
    } });
    m.set('desktop.describe', { handler: async (p) => {
      const sessionId = await this.bind(p);
      const { pid: _, ...d } = await this.describe(sessionId, hwndOf(p.window), typeof p.ref === 'string' && p.ref ? p.ref : undefined);
      return d;
    } });
    m.set('desktop.snapshot', { handler: async (p) => {
      const sessionId = await this.bind(p);
      const hwnd = hwndOf(p.window);
      const { info } = await this.resolve(sessionId, hwnd);
      const max = typeof p.max_nodes === 'number' && p.max_nodes > 0 ? Math.min(Math.floor(p.max_nodes), 2000) : 400;
      return this.helper.request('snapshot', { hwnd, max_nodes: max, pid: info.pid });
    } });
    m.set('desktop.screenshot', { handler: async (p) => {
      const sessionId = await this.bind(p);
      const hwnd = hwndOf(p.window);
      const { info } = await this.resolve(sessionId, hwnd);
      return this.helper.request('screenshot', { hwnd, pid: info.pid });
    } });
    m.set('desktop.find', { handler: async (p) => {
      const sessionId = await this.bind(p);
      const hwnd = hwndOf(p.window);
      const { info } = await this.resolve(sessionId, hwnd);
      return this.helper.request('find_text', { hwnd, text: str(p, 'text'), pid: info.pid });
    } });
    m.set('desktop.act', { handler: async (p) => this.act(p, await this.bind(p)) });
  }
}
