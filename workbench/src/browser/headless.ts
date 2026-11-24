// M8-42 row 3: chrome-headless-shell as a second engine for agent panes. One browser process over
// --remote-debugging-pipe (no port), one in-memory browser context per pane. Each pane gets an object shaped like
// Electron's webContents.debugger, so panes.ts drives it with the same CDP calls. The guards Electron gives a pane
// through its session are set here over CDP (orch1124/b3/headless/ENFORCEMENT.md); any guard that cannot be set
// kills the tab, so nothing runs unfiltered.
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';

type Msg = { id?: number; method?: string; params?: any; result?: any; error?: { message: string }; sessionId?: string };
/** Decides one request URL for a pane: allow, or a reason to block it. */
export type UrlCheck = (url: string) => Promise<{ allow: boolean; reason?: string }>;

const CMD_MS = 30_000;

/** The browser process and its pipe. */
export class HeadlessBrowser extends EventEmitter {
  private proc: ChildProcess;
  private out: Writable;
  private next = 0;
  private waiting = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private buf = '';
  private profile: string;
  closed: string | null = null;

  constructor(exe: string) {
    super();
    if (!path.isAbsolute(exe) || !fs.existsSync(exe)) throw new Error(`the headless browser is not at ${exe}`);
    this.profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-headless-'));
    this.proc = spawn(exe, ['--remote-debugging-pipe', `--user-data-dir=${this.profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-sync', '--disable-background-networking', '--mute-audio', '--block-new-web-contents'], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], windowsHide: true });
    this.out = this.proc.stdio[3] as Writable;
    const input = this.proc.stdio[4] as Readable;
    input.on('data', (d: Buffer) => this.onData(d));
    const end = (why: string) => this.shut(why);
    this.proc.on('exit', (code) => end(`the headless browser exited (${code})`));
    this.proc.on('error', (e) => end(`the headless browser failed: ${e.message}`));
    this.out.on('error', () => end('the pipe to the headless browser broke'));
  }

  private onData(d: Buffer): void {
    this.buf += d.toString('utf8');
    for (let i = this.buf.indexOf('\0'); i >= 0; i = this.buf.indexOf('\0')) {
      const raw = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 1);
      let m: Msg;
      try { m = JSON.parse(raw); } catch { continue; }
      const w = m.id !== undefined ? this.waiting.get(m.id) : undefined;
      if (w) {
        this.waiting.delete(m.id!);
        clearTimeout(w.timer);
        if (m.error) w.reject(new Error(m.error.message));
        else w.resolve(m.result ?? {});
      } else if (m.method) this.emit('event', m);
    }
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    if (this.closed) return Promise.reject(new Error(this.closed));
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.waiting.delete(id); reject(new Error(`${method} timed out`)); }, CMD_MS);
      this.waiting.set(id, { resolve, reject, timer });
      this.out.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
    });
  }

  private shut(why: string): void {
    if (this.closed) return;
    this.closed = why;
    for (const [, w] of this.waiting) { clearTimeout(w.timer); w.reject(new Error(why)); }
    this.waiting.clear();
    this.emit('closed', why);
    fs.rm(this.profile, { recursive: true, force: true }, () => {});
  }

  close(): void {
    try { this.proc.kill(); } catch {}
    this.shut('the headless browser was closed');
  }
}

/** One agent pane: its own browser context and page, and a debugger with Electron's shape. */
export class HeadlessTab extends EventEmitter {
  /** Electron's webContents.debugger shape: sendCommand, attach, detach, and 'message' and 'detach' events. */
  readonly dbg: EventEmitter & { attach(v?: string): void; detach(): void; isAttached(): boolean; sendCommand(method: string, params?: Record<string, unknown>): Promise<any> };
  dead: string | null = null;
  /** When this pane last sent a click; a popup within the gesture window loads in the pane, any other popup is closed. */
  clickedAt = 0;
  private children = new Set<string>();

  private browser: HeadlessBrowser;
  readonly contextId: string;
  readonly targetId: string;
  readonly sessionId: string;
  private check: UrlCheck;
  private onBlocked: (url: string, reason: string) => void;
  private onPopup: (url: string) => void;

  private constructor(browser: HeadlessBrowser, contextId: string, targetId: string, sessionId: string, check: UrlCheck, onBlocked: (url: string, reason: string) => void, onPopup: (url: string) => void) {
    super();
    this.browser = browser;
    this.contextId = contextId;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.check = check;
    this.onBlocked = onBlocked;
    this.onPopup = onPopup;
    const tab = this;
    this.dbg = Object.assign(new EventEmitter(), {
      attach() {},
      detach() {},
      isAttached: () => !tab.dead,
      sendCommand(method: string, params: Record<string, unknown> = {}) {
        if (tab.dead) return Promise.reject(new Error(tab.dead));
        if (method === 'Input.dispatchMouseEvent' && params.type === 'mousePressed') tab.clickedAt = Date.now();
        return browser.send(method, params, sessionId);
      },
    });
    browser.on('event', this.onEvent);
    browser.once('closed', (why: string) => this.kill(why));
  }

  /** Opens a pane's context and page and switches on every guard; a guard that fails disposes the context and throws. */
  static async open(browser: HeadlessBrowser, userAgent: string, check: UrlCheck, onBlocked: (url: string, reason: string) => void, onPopup: (url: string) => void): Promise<HeadlessTab> {
    const { browserContextId } = await browser.send('Target.createBrowserContext', { disposeOnDetach: true });
    try {
      await browser.send('Browser.setDownloadBehavior', { behavior: 'deny', browserContextId });
      await browser.send('Browser.resetPermissions', { browserContextId });
      await browser.send('Target.setDiscoverTargets', { discover: true });
      const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
      const tab = new HeadlessTab(browser, browserContextId, targetId, sessionId, check, onBlocked, onPopup);
      await browser.send('Emulation.setUserAgentOverride', { userAgent }, sessionId);
      // frames in other processes and workers attach paused, get the same request check, then run
      await browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
      await browser.send('Inspector.enable', {}, sessionId).catch(() => {});
      return tab;
    } catch (e) {
      await browser.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
      throw e;
    }
  }

  private onEvent = (m: Msg): void => {
    if (this.dead) return;
    const p = m.params ?? {};
    if (m.sessionId === this.sessionId) {
      if (m.method === 'Target.attachedToTarget') { void this.guardChild(p.sessionId, p.targetInfo?.type ?? ''); return; }
      if (m.method === 'Inspector.targetCrashed') { this.kill('the page crashed'); return; }
      // no window is ever created (--block-new-web-contents): a clicked one loads in this pane through its checks
      if (m.method === 'Page.windowOpen') {
        const url = String(p.url ?? '');
        if ((p.userGesture === true || Date.now() - this.clickedAt < 5000) && /^https?:/.test(url)) { this.clickedAt = 0; this.onPopup(url); }
        else this.onBlocked(url || 'a new window', 'a window the page opened without a click');
      }
      // belt and braces: a frame that lands on anything but the web or an inert page ends the tab
      if (m.method === 'Page.frameNavigated' && !/^(https?:|about:blank|data:|blob:)/.test(String(p.frame?.url ?? ''))) { this.kill(`a frame reached ${String(p.frame?.url).slice(0, 80)}`); return; }
      this.dbg.emit('message', {}, m.method, p);
      return;
    }
    if (m.sessionId && this.children.has(m.sessionId)) {
      if (m.method === 'Fetch.requestPaused') void this.decide(m.sessionId, p);
      if (m.method === 'Target.attachedToTarget') void this.guardChild(p.sessionId, p.targetInfo?.type ?? '', m.sessionId);
      return;
    }
    if (!m.sessionId && m.method === 'Target.targetCreated' && p.targetInfo?.type === 'page' && p.targetInfo.browserContextId === this.contextId && p.targetInfo.targetId !== this.targetId) {
      const url = String(p.targetInfo.url ?? '');
      void this.browser.send('Target.closeTarget', { targetId: p.targetInfo.targetId }).catch(() => {});
      this.onBlocked(url || 'a new window', 'a new window appeared despite the block, so it was closed');
    }
  };

  /** A child target (frame in another process, worker): request interception first, then it may run. Any failure ends the tab. */
  private async guardChild(child: string, type: string, parent = this.sessionId): Promise<void> {
    this.children.add(child);
    try {
      if (type !== 'service_worker' && type !== 'shared_worker' && type !== 'worker' && type !== 'iframe') throw new Error(`an unexpected ${type} target`);
      // a dedicated worker's requests pause on its page's Fetch (probed on 158.0.8127.36), and its target has no Fetch domain
      if (type !== 'worker') await this.browser.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] }, child);
      if (type === 'iframe') await this.browser.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, child);
      await this.browser.send('Runtime.runIfWaitingForDebugger', {}, child);
    } catch (e) {
      this.kill(`a ${type || 'child'} could not be guarded: ${(e as Error).message}`);
      void this.browser.send('Target.detachFromTarget', { sessionId: child }, parent).catch(() => {});
    }
  }

  private async decide(child: string, p: any): Promise<void> {
    const url = String(p.request?.url ?? '');
    const v = await this.check(url).catch((e: Error) => ({ allow: false, reason: `the check failed: ${e.message}` }));
    if (v.allow) await this.browser.send('Fetch.continueRequest', { requestId: p.requestId }, child).catch(() => {});
    else {
      await this.browser.send('Fetch.failRequest', { requestId: p.requestId, errorReason: 'BlockedByClient' }, child).catch(() => {});
      this.onBlocked(url, v.reason ?? 'blocked');
    }
  }

  /** Ends the tab: the debugger reports a detach, every later command fails. */
  kill(why: string): void {
    if (this.dead) return;
    this.dead = why;
    this.browser.off('event', this.onEvent);
    this.dbg.emit('detach', {}, why);
    this.emit('dead', why);
  }

  async close(): Promise<void> {
    this.kill('closed');
    await this.browser.send('Target.disposeBrowserContext', { browserContextId: this.contextId }).catch(() => {});
  }
}

/** The parts of Electron's webContents an agent pane uses, over the tab's CDP session. User-pane features (find, zoom, devtools, context menu) are inert. */
export class HeadlessContents extends EventEmitter {
  private url = 'about:blank';
  private title = '';
  private loading = false;
  private status = 0;
  private closed = false;
  readonly debugger: HeadlessTab['dbg'];
  readonly navigationHistory = {
    canGoBack: () => this.entry(-1) !== null,
    canGoForward: () => this.entry(1) !== null,
    goBack: () => { void this.go(-1); },
    goForward: () => { void this.go(1); },
  };
  private history: { currentIndex: number; entries: Array<{ id: number; url: string }> } = { currentIndex: 0, entries: [] };

  readonly tab: HeadlessTab;

  constructor(tab: HeadlessTab) {
    super();
    this.tab = tab;
    this.debugger = tab.dbg;
    tab.dbg.on('message', (_e: unknown, method: string, p: any) => this.onMessage(method, p));
    tab.on('dead', (why: string) => { this.loading = false; this.emit('render-process-gone', {}, { reason: why === 'closed' ? 'clean-exit' : 'crashed' }); });
  }

  private onMessage(method: string, p: any): void {
    if (method === 'Network.responseReceived' && p.type === 'Document' && !p.frameId?.includes('.')) this.status = Number(p.response?.status ?? 0);
    else if (method === 'Page.frameStartedLoading' && p.frameId === this.tab.targetId) { this.loading = true; this.emit('did-start-loading', {}); }
    else if (method === 'Page.frameStoppedLoading' && p.frameId === this.tab.targetId) { this.loading = false; void this.refresh(); this.emit('did-stop-loading', {}); }
    else if (method === 'Page.frameNavigated' && !p.frame?.parentId) {
      this.url = String(p.frame?.url ?? '') + String(p.frame?.urlFragment ?? '');
      void this.refresh();
      this.emit('did-navigate', {}, this.url, this.status || 200, '');
    } else if (method === 'Page.navigatedWithinDocument' && p.frameId === this.tab.targetId) {
      this.url = String(p.url ?? this.url);
      this.emit('did-navigate-in-page', {}, this.url, true);
    }
  }

  /** Title and history, read after each navigation. */
  private async refresh(): Promise<void> {
    try {
      this.history = await this.tab.dbg.sendCommand('Page.getNavigationHistory');
      const r = await this.tab.dbg.sendCommand('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
      const t = String(r.result?.value ?? '');
      if (t !== this.title) { this.title = t; this.emit('page-title-updated', {}, t); }
    } catch {}
  }

  private entry(step: number): { id: number; url: string } | null {
    return this.history.entries[this.history.currentIndex + step] ?? null;
  }

  private async go(step: number): Promise<void> {
    const e = this.entry(step);
    if (e) await this.tab.dbg.sendCommand('Page.navigateToHistoryEntry', { entryId: e.id }).catch(() => {});
  }

  /** Navigates and resolves when the page has loaded, or rejects with Chromium's error text, as Electron's loadURL does. */
  async loadURL(url: string): Promise<void> {
    if (this.tab.dead) throw new Error(this.tab.dead);
    this.status = 0;
    const done = url === 'about:blank' ? Promise.resolve() : new Promise<void>((resolve) => {
      const timer = setTimeout(stop, 30_000);
      const on = (_e: unknown, method: string) => { if (method === 'Page.loadEventFired' || method === 'Page.frameStoppedLoading') stop(); };
      function stop() { clearTimeout(timer); self.tab.dbg.off('message', on); resolve(); }
      const self = this;
      this.tab.dbg.on('message', on);
    });
    const r = await this.tab.dbg.sendCommand('Page.navigate', { url });
    if (r.errorText) {
      const code = /BLOCKED_BY_CLIENT/.test(r.errorText) ? -20 : /ABORTED/.test(r.errorText) ? -3 : -2;
      this.emit('did-fail-load', {}, code, r.errorText, url, true);
      throw new Error(r.errorText);
    }
    if (url === 'about:blank') this.url = url;
    await done;
  }

  getURL(): string { return this.url; }
  getTitle(): string { return this.title; }
  isLoading(): boolean { return this.loading; }
  isLoadingMainFrame(): boolean { return this.loading; }
  isDestroyed(): boolean { return this.closed; }
  stop(): void { void this.tab.dbg.sendCommand('Page.stopLoading').catch(() => {}); }
  reload(): void { void this.tab.dbg.sendCommand('Page.reload').catch(() => {}); }
  close(): void { if (!this.closed) { this.closed = true; void this.tab.close(); } }
  setWindowOpenHandler(): void {}
  getZoomFactor(): number { return 1; }
  setZoomFactor(): void {}
  findInPage(): void {}
  stopFindInPage(): void {}
  send(): void {}
  focus(): void {}
  openDevTools(): void {}
  closeDevTools(): void {}
  isDevToolsOpened(): boolean { return false; }
  inspectElement(): void {}
  /** clearStorageData has nothing to clear: the context is disposed on close. */
  readonly session = { clearStorageData: () => Promise.resolve() };
}

/** A view with no window: a headless pane is never drawn in the workbench. */
export function headlessView(contents: HeadlessContents) {
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  return { webContents: contents, setBounds: (b: typeof bounds) => { bounds = b; }, getBounds: () => bounds };
}

/** The overlay a headless pane has instead of a cursor layer. */
export const NO_OVERLAY = { webContents: { isDestroyed: () => true, close() {}, send() {} }, setBounds() {}, getBounds: () => ({ x: 0, y: 0, width: 0, height: 0 }) };
