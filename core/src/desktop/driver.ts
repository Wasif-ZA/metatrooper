import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn, type ChildProcess } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { coreDir, repoDir } from '../paths.ts';
import { E, RpcError } from '../pipe/errors.ts';
import type { MethodSpec } from '../pipe/commands.ts';
import { nowIso, ulid } from '../time.ts';
import { actionHash, desktopKeysProblem, riskReason } from '../approvals.ts';
import { treeChanges, type TreeNodes } from './changes.ts';
import { actionHeld, ACTION_HELD, beginRiskyAction, ensureActionOutcomes, finishRiskyAction, releaseRiskyAction } from './action-outcomes.ts';
import { ancestors, parentTableAsync } from '../browser/ancestry.ts';
import { beginAction, endAction } from '../watch/watcher.ts';
import { covers, endGrant, liveGrants, sameWindow, takeoverPaused, type GrantRow, type WindowInfo } from '../grants.ts';

export const NOT_GRANTED = 'window not granted; ask the user to give it to you';
export const PAUSED = 'paused by the user';
export const OFF = 'computer use is off: the desktop plugin is disabled';
export const CHUNK = 8;
const NOT_RUNNING = 'the workbench is not running';
/** A pause acknowledgement waits this long after the last posted key or click. */
export const POST_SETTLE_MS = 250;
const CONTROL_CHANGED = -32035;
const SALT = crypto.randomBytes(16);
/** An opaque stand-in for the element's runtime id, so an approval stays bound to the control it was checked on. */
const tokenOf = (rid: string, pid: number) => crypto.createHmac('sha256', SALT).update(`${pid}:${rid}`).digest('hex').slice(0, 32);
const HELPER_TIMEOUT_MS = 30_000;
const titleHash = (title: string) => crypto.createHash('sha256').update(title).digest('hex');

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

/** An executable path as written and with links resolved, lowercased. */
const exeKeys = (exe: string): string[] => {
  const keys = [path.resolve(exe).toLowerCase()];
  try { keys.push(fs.realpathSync.native(exe).toLowerCase()); } catch {}
  return keys;
};

/** This install's workbench Electron executable, as written and with links resolved, lowercased; empty when it cannot be identified. */
export function workbenchExes(): Set<string> {
  const dir = path.join(repoDir, 'workbench', 'node_modules', 'electron');
  try { return new Set(exeKeys(path.join(dir, 'dist', fs.readFileSync(path.join(dir, 'path.txt'), 'utf8').trim()))); } catch { return new Set(); }
}

const NO_WORKBENCH_EXE = 'no window can be given: the workbench executable could not be identified (workbench/node_modules/electron/path.txt is unreadable)';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

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

interface Described { control: { automation_id: string; name: string; role: string } | null; password: boolean; hidden?: boolean; rect: number[] | null; rid?: string; minimized?: boolean; covered_by?: string; covered_pid?: number }

type WindowRead = { hwnd: number; title: string; text: string };
const CAP_LINE = 200;
const CAP_LINES = 20;
const CAP_WINDOWS = 8;
const cleanLines = (text: string) => text.split('\n').map((l) => l.replace(/\s*\[ref=[^\]]*\]/g, '').trimEnd()).filter(Boolean);
const capped = (lines: string[]) => ({ kept: lines.slice(0, CAP_LINES).map((l) => l.slice(0, CAP_LINE)), more: Math.max(0, lines.length - CAP_LINES) });

/** The capped added and removed lines per granted window between a read before and a read after the take-over. */
export function changeSummary(before: Map<string, WindowRead>, after: Map<string, WindowRead | null>): { resumed_at: string; windows: Array<Record<string, unknown>> } {
  const windows: Array<Record<string, unknown>> = [];
  for (const id of new Set([...after.keys(), ...before.keys()])) {
    if (windows.length >= CAP_WINDOWS) break;
    const was = before.get(id);
    const now = after.get(id);
    if (!now) { windows.push({ window: was?.hwnd, gone: true }); continue; }
    const lines = cleanLines(now.text);
    if (!was) { const all = capped(lines); windows.push({ window: now.hwnd, title: now.title, added: [], removed: [], more: all.more, no_before: true, now: all.kept }); continue; }
    const old = cleanLines(was.text);
    const oldSet = new Set(old);
    const newSet = new Set(lines);
    const added = capped(lines.filter((l) => !oldSet.has(l)));
    const removed = capped(old.filter((l) => !newSet.has(l)));
    windows.push({ window: now.hwnd, ...(was.title !== now.title ? { title_before: was.title } : {}), title: now.title, added: added.kept, removed: removed.kept, more: added.more + removed.more });
  }
  return { resumed_at: nowIso(), windows };
}

/** Grants, the take-over flag and every desktop read and input, through one helper. */
export class Desktop {
  readonly helper = new Helper();
  private db: DatabaseSync;
  private uiPid: number | null = null;
  /** The workbench process's start time, so a later process reusing its pid is not taken for it ('' when it was not running). */
  private uiStart = '';
  private reports = 0;
  /** Why no window can be granted: the workbench's take-over key is not registered, or the workbench that registered it closed. */
  private noTakeover: string | null = 'the workbench has not reported its take-over key';
  private bound = new Set<string>();
  private chain: Promise<unknown> = Promise.resolve();
  private inFlight: Promise<unknown> | null = null;
  private postedAt = 0;
  private rects = new Map<string, { rect: number[]; minimized: boolean }>();
  private ticking = false;
  /** A core started with --demo may grant the windows of the workbench that reported itself to it (M6-16). */
  private demo: boolean;
  private workbench = workbenchExes();
  /** Per requesting session, the read of its granted windows taken right after a pause; held in memory only. */
  private before = new Map<string, Promise<Map<string, WindowRead>>>();
  /** Per session, the change summary waiting for takeover.status to hand it over once. */
  private summaries = new Map<string, object>();

  constructor(db: DatabaseSync, opts: { demo?: boolean } = {}) {
    ensureActionOutcomes(db);
    this.db = db;
    this.demo = Boolean(opts.demo);
    db.prepare("UPDATE desktop_action_outcome SET status = 'unverifiable' WHERE status = 'pending'").run();
    try { db.prepare("DELETE FROM meta WHERE key IN ('takeover_paused_at', 'takeover_resumed', 'takeover_requests')").run(); } catch {}
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

  /** Whether no session here may be given this window: any workbench, or any window when the workbench or its exe cannot be identified, except a demo core's own workbench. */
  private refused(w: { pid: number; process_start: string; exe_path?: string }): boolean {
    if (!this.workbench.size || !w.exe_path) return true;
    const pidMatch = this.uiPid !== null && w.pid === this.uiPid;
    const isWorkbench = exeKeys(w.exe_path).some((k) => this.workbench.has(k));
    if (this.demo && pidMatch && isWorkbench && this.uiStart && w.process_start === this.uiStart) return false;
    return pidMatch || isWorkbench;
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
    for (const sessionId of Object.keys(this.requests())) if (!this.before.has(sessionId)) this.before.set(sessionId, this.readWindows(sessionId).then((m) => new Map([...m].flatMap(([id, r]) => (r ? [[id, r] as const] : [])))));
    return { paused_at: at };
  }

  private requests(): Record<string, { at: string; reason: string }> {
    try { return JSON.parse(this.meta('takeover_requests') ?? '{}'); } catch { return {}; }
  }

  /** Each live grant's title and snapshot text through the grant-checked read; null for a window that cannot be read. */
  private async readWindows(sessionId: string): Promise<Map<string, WindowRead | null>> {
    const out = new Map<string, WindowRead | null>();
    for (const g of liveGrants(this.db, sessionId)) {
      try {
        const title = (await this.info(g.hwnd)).title;
        const snap = await this.read<{ text?: string }>(sessionId, g.hwnd, 'snapshot', { max_nodes: 400 });
        out.set(g.id, { hwnd: g.hwnd, title, text: String(snap.text ?? '') });
      } catch { out.set(g.id, null); }
    }
    return out;
  }

  async resume(sessionId: string): Promise<void> {
    if (!this.db.prepare('SELECT 1 FROM session WHERE id = ?').get(sessionId)) throw new RpcError(E.NOT_FOUND, 'session not found');
    if (this.requests()[sessionId] || this.before.has(sessionId)) {
      const before = await (this.before.get(sessionId) ?? Promise.resolve(new Map<string, WindowRead>()));
      this.summaries.set(sessionId, changeSummary(before, await this.readWindows(sessionId)));
      const requests = this.requests();
      delete requests[sessionId];
      this.before.delete(sessionId);
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('takeover_requests', ?)").run(JSON.stringify(requests));
    }
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
    if (!w.alive || w.elevated || this.refused(w)) throw new RpcError(E.PANE_NOT_OWNED, NOT_GRANTED);
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
  private async dispatch(sessionId: string, grantId: string, op: string, params: Record<string, unknown>, note = '', beforeSend?: () => void): Promise<Record<string, unknown>> {
    let watchId: string | null = null;
    const gate = () => {
      if (this.paused(sessionId)) throw new RpcError(E.PANE_NOT_OWNED, PAUSED + note);
      if (!this.enabled() || !this.granted(sessionId, grantId)) throw new RpcError(E.PANE_NOT_OWNED, NOT_GRANTED + note);
      const unpausable = this.noTakeover ?? (this.uiStart && alive(this.uiPid!) ? null : NOT_RUNNING);
      if (unpausable) throw new RpcError(E.PANE_NOT_OWNED, `not sent: ${unpausable}, so the agent could not be paused${note}`);
      beforeSend?.();
      watchId = beginAction(Date.now(), Number(params.pid) || 0, Number(params.hwnd) || 0);
    };
    const posted = op === 'key' || op === 'click';
    // the helper compares the workbench's start time right before it writes, so a reused pid is caught there
    const p = this.helper.request<Record<string, unknown>>(op, { ...params, ui_pid: this.uiPid, ui_start: this.uiStart }, undefined, gate)
      .then((r) => { if (posted) this.postedAt = Date.now(); return r; }, (e: Error) => {
        if (/^control changed$/.test(e.message)) throw new RpcError(CONTROL_CHANGED, `the control changed since it was checked; nothing was sent${note}`);
        if (e.message === NOT_RUNNING) throw new RpcError(E.PANE_NOT_OWNED, `not sent: ${NOT_RUNNING}, so the agent could not be paused${note}`);
        if (posted && watchId !== null) this.postedAt = Date.now();
        throw e;
      });
    this.inFlight = p;
    try { return await p; } finally { if (this.inFlight === p) this.inFlight = null; if (watchId !== null) endAction(watchId); }
  }

  /** For a read: the grant is checked again as the request leaves the helper queue. */
  private still(sessionId: string, grantId: string): () => void {
    return () => { if (!this.enabled() || !this.granted(sessionId, grantId)) throw new RpcError(E.PANE_NOT_OWNED, NOT_GRANTED); };
  }

  /** Reads one granted window through the helper. */
  private async read<T>(sessionId: string, hwnd: number, op: string, params: Record<string, unknown> = {}): Promise<T> {
    const { grant, info } = await this.resolve(sessionId, hwnd);
    return this.helper.request<T>(op, { hwnd, ...params, pid: info.pid }, undefined, this.still(sessionId, grant.id));
  }

  async describe(sessionId: string, hwnd: number, ref?: string): Promise<Omit<Described, 'covered_pid'> & { grant_id: string; file_dialog: boolean; pid: number; rid: string; minimized: boolean; covered_by: string }> {
    const { grant, info } = await this.resolve(sessionId, hwnd);
    const d = await this.helper.request<Described>('describe', { hwnd, ref, pid: info.pid }, undefined, this.still(sessionId, grant.id));
    // a window of the granted app itself, or of the workbench (its overlay and frames), is not a cover
    const cover = typeof d.covered_by === 'string' && d.covered_pid !== grant.pid && d.covered_pid !== this.uiPid ? d.covered_by : '';
    return { grant_id: grant.id, control: d.control, password: d.password === true, hidden: d.hidden === true, file_dialog: info.file_dialog, rect: d.rect, pid: info.pid, rid: String(d.rid ?? ''), minimized: d.minimized === true, covered_by: cover };
  }

  async act(p: Record<string, unknown>, sessionId: string): Promise<Record<string, unknown>> {
    const hwnd = hwndOf(p.window);
    const action = str(p, 'action');
    if (!['click', 'type', 'key', 'scroll'].includes(action)) throw new RpcError(E.INVALID_PARAMS, 'action must be click, type, key or scroll');
    const ref = typeof p.ref === 'string' && p.ref ? p.ref : undefined;
    if ((action === 'click' || action === 'type') && !ref) throw new RpcError(E.INVALID_PARAMS, 'ref is required');
    const keysProblem = action === 'key' ? desktopKeysProblem(p.keys) : null;
    if (keysProblem) throw new RpcError(E.INVALID_PARAMS, keysProblem);
    return this.serial(async () => {
      if (this.paused(sessionId)) throw new RpcError(E.PANE_NOT_OWNED, PAUSED);
      const now = await this.describe(sessionId, hwnd, ref);
      const expect = (p.expect && typeof p.expect === 'object' ? p.expect : {}) as Record<string, unknown>;
      const c = now.control ?? { name: '', automation_id: '', role: '' };
      if (expect.grant_id !== undefined && expect.grant_id !== now.grant_id) throw new RpcError(CONTROL_CHANGED, 'the window changed; nothing was sent');
      if (expect.token !== undefined && expect.token !== tokenOf(now.rid, now.pid)) throw new RpcError(CONTROL_CHANGED, 'the control changed since it was checked; nothing was sent');
      if ((expect.name ?? '') !== c.name || (expect.automation_id ?? '') !== c.automation_id || (expect.role ?? '') !== c.role
        || Boolean(expect.password) !== now.password || Boolean(expect.hidden) !== now.hidden || Boolean(expect.file_dialog) !== now.file_dialog) {
        throw new RpcError(CONTROL_CHANGED, 'the control changed since it was checked; nothing was sent');
      }
      const check = { session_id: sessionId, surface: 'desktop', target: now.grant_id, action, args: p, control: now.control, password: now.password, hidden: now.hidden, file_dialog: now.file_dialog };
      const hash = actionHash(check);
      if (actionHeld(this.db, hash)) throw new RpcError(E.PANE_NOT_OWNED, ACTION_HELD);
      const risky = riskReason(check) !== null;
      let verifyTitleHash: string | null = null;
      if (p.verify_title !== undefined) {
        if (typeof p.verify_title !== 'string' || !p.verify_title || p.verify_title.length > 2000) throw new RpcError(E.INVALID_PARAMS, 'verify_title must be 1 to 2000 characters');
        const before = await this.resolve(sessionId, hwnd);
        if (before.info.title === p.verify_title) throw new RpcError(E.INVALID_PARAMS, 'verify_title already matches before the action');
        verifyTitleHash = titleHash(p.verify_title);
      }
      let started = false;
      const send = async (op: string, params: Record<string, unknown>, note = '') => {
        const out = await this.dispatch(sessionId, now.grant_id, op, params, note, () => {
          if (risky && !started) { beginRiskyAction(this.db, hash, sessionId, now.grant_id, hwnd, verifyTitleHash); started = true; }
        });
        return out;
      };
      const complete = (out: Record<string, unknown>) => {
        if (started) finishRiskyAction(this.db, hash, out.status);
        return risky ? { ...out, action_hash: hash } : out;
      };
      const nodes = (t: unknown) => Array.isArray(t) && t.every(n => Array.isArray(n) && n.length === 2 && typeof n[0] === 'string' && typeof n[1] === 'string') ? t as TreeNodes : null;
      // drops the raw tree reads from the result and adds their diff as changes
      const finish = (first: Record<string, unknown>, last: Record<string, unknown>) => {
        const { tree_after, ...rest } = last;
        delete rest.tree_before;
        const before = nodes(first.tree_before);
        const after = nodes(tree_after);
        return complete(before && after ? { ...rest, changes: treeChanges(before, after) } : rest);
      };
      try {
        const seen = { check: 1, name: c.name, automation_id: c.automation_id, role: c.role, password: now.password ? 1 : 0, hidden: now.hidden ? 1 : 0, file_dialog: now.file_dialog ? 1 : 0, rid: now.rid, pid: now.pid };
        if (action !== 'type') { const r = await send(action, { hwnd, ref, keys: p.keys, dy: p.dy, tree_before: 1, tree_after: 1, ...seen }); return finish(r, r); }
        const chars = Array.from(typeof p.text === 'string' ? p.text : '');
        let out: Record<string, unknown> = { status: 'unverifiable' };
        let first: Record<string, unknown> = {};
        let focusLost = false;
        let drift = false;
        let taken = '';
        let done = 0;
        do {
          const n = Math.min(done + CHUNK, chars.length);
          const note = `; ${done} of ${chars.length} characters were typed`;
          if (this.paused(sessionId)) throw new RpcError(E.PANE_NOT_OWNED, PAUSED + note);
          if (done > 0 && (await this.resolve(sessionId, hwnd).catch(() => null))?.grant.id !== now.grant_id) throw new RpcError(E.PANE_NOT_OWNED, NOT_GRANTED + note);
          out = await send('set_text', { hwnd, ref, value: chars.slice(0, n).join(''), tree_before: done === 0 ? 1 : 0, tree_after: n >= chars.length ? 1 : 0, ...seen }, note);
          if (done === 0) first = out;
          if (out.focus_returned === false) focusLost = true;
          if (out.pointer_drift === true) drift = true;
          if (!taken && typeof out.foreground_taken_by === 'string') taken = out.foreground_taken_by;
          done = n;
        } while (done < chars.length);
        const folded: Record<string, unknown> = { ...out };
        if (focusLost) folded.focus_returned = false;
        if ('pointer_drift' in out) folded.pointer_drift = drift;
        if ('foreground_taken_by' in out) folded.foreground_taken_by = taken;
        return finish(first, folded);
      } catch (e) {
        if (started) finishRiskyAction(this.db, hash, 'unverifiable');
        throw e;
      }
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
    this.ticking = true;
    try {
      const pid = this.uiPid;
      // the start time needs the helper, so it is read only while a grant could be driven
      const gone = !this.noTakeover && (!this.uiStart || !alive(pid!) || (liveGrants(this.db).length > 0 && await this.processStart(pid!, this.uiStart) !== this.uiStart));
      if (gone && !this.noTakeover && pid === this.uiPid) {
        this.noTakeover = 'the workbench that registered the take-over key has closed';
        for (const g of liveGrants(this.db)) endGrant(this.db, g.id);
      }
      const grants = liveGrants(this.db);
      if (!grants.length) { this.rects.clear(); return; }
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

  /** A process's start time from the helper, '' when it is not running, `fallback` when the helper fails. */
  private async processStart(pid: number, fallback: string): Promise<string> {
    try { return String((await this.helper.request<{ process_start: string }>('process', { process: pid })).process_start ?? ''); }
    catch { return fallback; }
  }

  methods(m: Map<string, MethodSpec>): void {
    m.set('desktop.ui-window', { needsUi: true, handler: async (p) => {
      if (typeof p.pid !== 'number' || !Number.isInteger(p.pid) || p.pid <= 0) throw new RpcError(E.INVALID_PARAMS, 'pid is required, a positive process id');
      const key = typeof p.takeover_key === 'string' ? p.takeover_key : '';
      const noTakeover = key && p.takeover_error === null ? null
        : key && typeof p.takeover_error === 'string' && p.takeover_error ? `the take-over key ${key} did not register (${p.takeover_error})`
        : 'the workbench has not reported its take-over key';
      const report = ++this.reports;
      // a failure applies at once; a success waits for the start time and yields to any report made meanwhile
      const start = noTakeover ? '' : await this.processStart(p.pid, '');
      if (report !== this.reports) return {};
      this.uiPid = p.pid;
      this.uiStart = start;
      this.noTakeover = noTakeover;
      if (noTakeover) for (const g of liveGrants(this.db)) endGrant(this.db, g.id);
      return {};
    } });
    m.set('grant.candidates', { needsUi: true, handler: async () => {
      this.on();
      if (this.uiPid === null) throw new RpcError(E.VALIDATION, 'the workbench has not reported its own windows yet');
      if (!this.workbench.size) throw new RpcError(E.VALIDATION, NO_WORKBENCH_EXE);
      const { windows } = await this.helper.request<{ windows: Array<WindowInfo> }>('list');
      return { windows: windows.filter((w) => !this.refused(w) && !w.elevated && w.title).map((w) => ({ hwnd: w.hwnd, title: w.title, exe: w.exe, pid: w.pid, process_start: w.process_start })) };
    } });
    m.set('grant.window', { needsUi: true, handler: async (p) => {
      const sessionId = str(p, 'session_id');
      const hwnd = hwndOf(p.hwnd);
      if (typeof p.pid !== 'number' || !Number.isInteger(p.pid) || typeof p.process_start !== 'string') throw new RpcError(E.INVALID_PARAMS, 'pid and process_start are required, from the grant.candidates entry the user picked');
      this.on();
      if (!this.db.prepare('SELECT 1 FROM session WHERE id = ? AND ended_at IS NULL').get(sessionId)) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (this.uiPid === null) throw new RpcError(E.VALIDATION, 'the workbench has not reported its own windows yet');
      const pausable = () => { if (this.noTakeover) throw new RpcError(E.VALIDATION, `no window can be given: ${this.noTakeover}, so the agent could not be paused; set a free desktop.takeover_key and restart the workbench`); };
      pausable();
      const w = await this.info(hwnd);
      this.on();
      pausable();
      if (!this.db.prepare('SELECT 1 FROM session WHERE id = ? AND ended_at IS NULL').get(sessionId)) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (!w.alive) throw new RpcError(E.VALIDATION, 'that window is gone');
      if (w.pid !== p.pid || w.process_start !== p.process_start) throw new RpcError(E.VALIDATION, 'that window now belongs to another process; pick it again from the list');
      if (!this.workbench.size) throw new RpcError(E.VALIDATION, NO_WORKBENCH_EXE);
      if (!w.exe_path) throw new RpcError(E.VALIDATION, 'that window\'s executable could not be read, so it cannot be granted');
      if (this.refused(w)) throw new RpcError(E.VALIDATION, 'the MetaTrooper workbench cannot be granted');
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
    m.set('takeover.resume', { needsUi: true, handler: async (p) => { await this.resume(str(p, 'session_id')); return {}; } });
    m.set('takeover.request', { handler: async (p) => {
      const sessionId = await this.bind(p);
      const reason = Array.from((typeof p.reason === 'string' ? p.reason : '').replace(/\p{Default_Ignorable_Code_Point}|\p{Cc}/gu, '').trim()).slice(0, 200).join('');
      this.summaries.delete(sessionId);
      const requests = this.requests();
      requests[sessionId] = { at: nowIso(), reason };
      this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('takeover_requests', ?)").run(JSON.stringify(requests));
      return { requested: true, paused: this.paused(sessionId) };
    } });
    m.set('takeover.status', { handler: async (p) => {
      const sessionId = await this.bind(p);
      const changes = this.summaries.get(sessionId);
      this.summaries.delete(sessionId);
      return { requested: Boolean(this.requests()[sessionId]), paused: this.paused(sessionId), ...(changes ? { changes } : {}) };
    } });

    m.set('desktop.windows', { handler: async (p) => {
      const sessionId = await this.bind(p);
      this.on();
      const grants = liveGrants(this.db, sessionId);
      if (!grants.length) return { windows: [] };
      const { windows } = await this.helper.request<{ windows: WindowInfo[] }>('list');
      this.on();
      const out: Array<Record<string, unknown>> = [];
      for (const g of grants) {
        if (!this.granted(sessionId, g.id)) continue;
        const own = windows.find((w) => sameWindow(g, w));
        if (!own) { endGrant(this.db, g.id); continue; }
        if (this.refused(own)) continue;
        out.push({ window: g.hwnd, title: own.title, exe: g.exe, grant_id: g.id, owner: 0 });
        for (const w of windows) if (w.hwnd !== g.hwnd && covers(g, w) && !this.refused(w)) out.push({ window: w.hwnd, title: w.title, exe: w.exe, grant_id: g.id, owner: w.owner_chain[0] ?? g.hwnd });
      }
      return { windows: out };
    } });
    m.set('desktop.describe', { handler: async (p) => {
      const sessionId = await this.bind(p);
      const { pid, rid, ...d } = await this.describe(sessionId, hwndOf(p.window), typeof p.ref === 'string' && p.ref ? p.ref : undefined);
      return { ...d, token: tokenOf(rid, pid) };
    } });
    m.set('desktop.snapshot', { handler: async (p) => {
      const sessionId = await this.bind(p);
      const max = typeof p.max_nodes === 'number' && p.max_nodes > 0 ? Math.min(Math.floor(p.max_nodes), 2000) : 400;
      return this.read(sessionId, hwndOf(p.window), 'snapshot', { max_nodes: max });
    } });
    m.set('desktop.screenshot', { handler: async (p) => {
      const sessionId = await this.bind(p);
      return this.read(sessionId, hwndOf(p.window), 'screenshot');
    } });
    m.set('desktop.find', { handler: async (p) => {
      const sessionId = await this.bind(p);
      return this.read(sessionId, hwndOf(p.window), 'find_text', { text: str(p, 'text') });
    } });
    m.set('desktop.check', { handler: async (p) => {
      const sessionId = await this.bind(p);
      const hwnd = hwndOf(p.window);
      const checks = p.checks as Array<{ kind: string; ref?: string; op: string; expected: string }>;
      if (!Array.isArray(checks) || checks.length < 1 || checks.length > 8) throw new RpcError(E.INVALID_PARAMS, 'checks must be 1 to 8 items');
      for (const c of checks) {
        if (!c || typeof c !== 'object' || (c.kind !== 'title' && c.kind !== 'value')) throw new RpcError(E.INVALID_PARAMS, 'check kind must be title or value');
        if (c.op !== 'equals' && c.op !== 'contains' && c.op !== 'not_contains') throw new RpcError(E.INVALID_PARAMS, 'check op must be equals, contains or not_contains');
        if (typeof c.expected !== 'string' || c.expected.length > 2000) throw new RpcError(E.INVALID_PARAMS, 'check expected must be a string of at most 2000 characters');
        if (c.kind === 'value' && (typeof c.ref !== 'string' || !c.ref)) throw new RpcError(E.INVALID_PARAMS, 'value check needs a ref');
      }
      const title = checks.some((c) => c.kind === 'title') ? (await this.resolve(sessionId, hwnd)).info.title : null;
      const results: Array<{ passed: boolean; actual: string | null }> = [];
      for (const c of checks) {
        const read = c.kind === 'title' ? title : (await this.read<{ value?: unknown }>(sessionId, hwnd, 'value', { ref: c.ref })).value;
        const actual = typeof read === 'string' ? read : null;
        const passed = actual !== null && (c.op === 'equals' ? actual === c.expected : c.op === 'contains' ? actual.includes(c.expected) : !actual.includes(c.expected));
        results.push({ passed, actual: actual === null ? null : actual.slice(0, 200) });
      }
      return { passed: results.every((r) => r.passed), results };
    } });
    m.set('desktop.action.verify', { handler: async (p) => {
      const sessionId = await this.bind(p);
      const hash = str(p, 'action_hash');
      return this.serial(async () => {
        const row = this.db.prepare("SELECT target, window, verify_title_hash FROM desktop_action_outcome WHERE action_hash = ? AND session_id = ? AND status = 'unverifiable'").get(hash, sessionId) as { target: string; window: number; verify_title_hash: string | null } | undefined;
        if (!row) throw new RpcError(E.NOT_FOUND, 'held action not found');
        const { grant, info } = await this.resolve(sessionId, row.window);
        const confirmed = grant.id === row.target && row.verify_title_hash !== null && titleHash(info.title) === row.verify_title_hash;
        if (confirmed) this.db.prepare("UPDATE desktop_action_outcome SET status = 'confirmed', updated_at = ? WHERE action_hash = ? AND status = 'unverifiable'").run(nowIso(), hash);
        return { confirmed };
      });
    } });
    m.set('desktop.action.held', { needsUi: true, handler: (p) => ({ actions: this.db.prepare("SELECT action_hash, target, status, updated_at FROM desktop_action_outcome WHERE session_id = ? AND status IN ('pending', 'unverifiable') ORDER BY julianday(updated_at) DESC LIMIT 100").all(str(p, 'session_id')) }) });
    m.set('desktop.action.release', { needsUi: true, handler: (p) => releaseRiskyAction(this.db, str(p, 'session_id'), str(p, 'action_hash')) });
    m.set('desktop.act', { handler: async (p) => this.act(p, await this.bind(p)) });
  }
}
