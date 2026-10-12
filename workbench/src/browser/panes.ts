import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, clipboard, Menu, nativeImage, session as electronSession, WebContentsView, type BrowserWindow, type Debugger, type MenuItemConstructorOptions, type WebContents } from 'electron';
import type { DatabaseSync } from 'node:sqlite';
import dns from 'node:dns';
import { homeDir } from '../../../core/src/paths.ts';
import { checkUrl, connectedVerdict, type PolicyContext } from '../../../core/src/browser/policy.ts';
import { diffLines, dropFrame, fit, interactiveOnly, newRefs, render, resolveRef, type AXNode, type Frame, type Refs, type Target } from '../../../core/src/browser/snapshot.ts';
import { MAX_LINE } from '../../../core/src/pipe/framing.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY = path.join(here, '..', '..', 'renderer', 'overlay.html');
export const EASE_MS = 150;
const MAX_CAPTURE_PX = 16_384;
const EVAL_CAP = 20 * 1024;
const URL_KEEP = 2000;
const IMAGE_BUDGET = MAX_LINE - 64 * 1024;
const LOG_KEEP = 200;
const PARKED_VIEWPORT = { width: 1280, height: 800 };
const AGENT_PANE = 'bp_agent_';
const ASKABLE = new Set(['clipboard-read', 'notifications', 'media', 'geolocation']);
const GRANTED = new Set(['clipboard-sanitized-write', 'fullscreen', 'mediaKeySystem']);
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const MAX_IMAGE_SIDE = 1568;
const SNAPSHOT_TOKENS = 4000;
const ACTION_TOKENS = 1000;
const SETTLE_MS = 1000;
const CURSORS_KEPT = 8;
/** The focused element through open shadow roots and same-origin frames; 'hidden' when focus is in a frame this world cannot read. */
const FOCUSED = `(() => {
  let e = document.activeElement;
  for (;;) {
    if (!e || e === e.ownerDocument.body) return null;
    if (e.shadowRoot && e.shadowRoot.activeElement) { e = e.shadowRoot.activeElement; continue; }
    if (e.tagName === 'IFRAME' || e.tagName === 'FRAME') {
      let d = null;
      try { d = e.contentDocument; } catch {}
      if (!d) return 'hidden';
      e = d.activeElement;
      continue;
    }
    return e;
  }
})()`;
const GESTURE_MS = 5000;
const PICK_RAW = 64 * 1024;
const POPUP_PREFS = { sandbox: true, contextIsolation: true, nodeIntegration: false, devTools: false, spellcheck: false };

export class ToolError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export interface PaneRow {
  id: string;
  project_id: string;
  run_id: string | null;
  variant: number | null;
  session_id: string | null;
  url: string | null;
  dev_port: number | null;
  open: number;
}

interface Pane {
  row: PaneRow;
  view: WebContentsView;
  overlay: WebContentsView;
  dbg: Debugger;
  refs: Refs;
  lastSnapshot: Map<string, string[]>;
  cursors: Map<string, string[]>;
  cursorN: number;
  navs: number;
  crashed: string | null;
  console: Array<{ at: number; level: string; text: string }>;
  network: Map<string, { at: number; method: string; url: string; status: number | null; bytes: number; error?: string }>;
  status: number | null;
  overlayShownUntil: number;
  picking: ((node: number | null) => void) | null;
  parked: boolean;
  ready: Promise<void>;
  dialog: Dialog | null;
  onDialog: ((d: Dialog) => void) | null;
  /** The URL whose load error or crash the pane is showing, or null. */
  errorFor: string | null;
  /** When the user or the agent last clicked or pressed a key in the pane. */
  clickedAt: number;
  popups: Set<BrowserWindow>;
  /** The picked element first, then each parent walked up to. */
  pickStack: number[];
}

interface Dialog {
  type: string;
  message: string;
}

export interface Hooks {
  db: () => DatabaseSync | null;
  probe: (entry: Record<string, unknown>) => void;
  urlChanged: (paneId: string, url: string) => void;
  commentPicked: (info: { pane_id: string; url: string; depth: number; selector: string; html: string; crop: string }) => void;
  /** Sends a `pane-event` to the workbench UI: state, found, key, download, permission. */
  paneEvent: (ev: Record<string, unknown>) => void;
  /** Opens a user pane in the project at this URL. */
  openPane: (projectId: string, url: string) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const dnsCache = new Map<string, { at: number; addrs: string[] }>();

async function cachedLookup(host: string): Promise<string[]> {
  const hit = dnsCache.get(host);
  if (hit && Date.now() - hit.at < 5000) return hit.addrs;
  const found = await dns.promises.lookup(host, { all: true, verbatim: true });
  const addrs = found.map((a) => a.address);
  dnsCache.set(host, { at: Date.now(), addrs });
  return addrs;
}

export class PaneManager {
  private win: BrowserWindow;
  private hooks: Hooks;
  private panes = new Map<string, Pane>();
  private shown: string | null = null;
  private bounds: { x: number; y: number; width: number; height: number } | null = null;
  private policyCache = new Map<string, { at: number; ctx: PolicyContext }>();
  private guarded = new Set<string>();
  private allowed = new Map<string, boolean>();
  private asking = new Map<string, { key: string; pane: string; cb: (ok: boolean) => void }>();

  constructor(win: BrowserWindow, hooks: Hooks) {
    this.win = win;
    this.hooks = hooks;
  }

  has(id: string): boolean {
    return this.panes.has(id);
  }

  row(id: string): PaneRow | null {
    return this.panes.get(id)?.row ?? null;
  }

  private policy(projectId: string): PolicyContext {
    const hit = this.policyCache.get(projectId);
    if (hit && Date.now() - hit.at < 2000) return hit.ctx;
    const db = this.hooks.db();
    const owned = new Set<number>();
    const allow = new Set<string>();
    if (db) {
      const project = db.prepare('SELECT path FROM project WHERE id = ?').get(projectId) as { path: string } | undefined;
      if (project) {
        try {
          const cfg = JSON.parse(fs.readFileSync(path.join(project.path, '.troop', 'config.json'), 'utf8')) as { allow_hosts?: unknown };
          if (Array.isArray(cfg.allow_hosts)) for (const h of cfg.allow_hosts) if (typeof h === 'string') allow.add(h.toLowerCase());
        } catch {}
      }
    }
    const ctx: PolicyContext = { ownedPorts: owned, allowHosts: allow, lookup: cachedLookup };
    this.policyCache.set(projectId, { at: Date.now(), ctx });
    return ctx;
  }

  private byContents(wc: WebContents | null | undefined): Pane | undefined {
    if (!wc) return undefined;
    for (const pane of this.panes.values()) if (pane.view.webContents === wc) return pane;
    return undefined;
  }

  private isUserPane(pane: Pane | undefined): pane is Pane {
    return !!pane && !pane.row.id.startsWith(AGENT_PANE);
  }

  /** The pane's partition: every request (frames, workers, WebSockets) passes the address policy, downloads and permissions follow the pane kind. Agent-opened panes get an in-memory partition of their own. */
  private guardPartition(row: PaneRow): Electron.Session {
    const agent = row.id.startsWith(AGENT_PANE);
    const partition = agent ? `troop-${row.project_id}-${row.id}` : `persist:troop-${row.project_id}`;
    const ses = electronSession.fromPartition(partition);
    if (this.guarded.has(partition)) return ses;
    this.guarded.add(partition);
    ses.webRequest.onBeforeRequest((details, cb) => {
      if (/^(data|blob|devtools):/.test(details.url) || details.url === 'about:blank') return cb({});
      if (!/^(https?|wss?):/.test(details.url)) return cb({ cancel: true });
      checkUrl(details.url, this.policy(row.project_id)).then((v) => cb({ cancel: !v.allow }), () => cb({ cancel: true }));
    });
    ses.on('will-download', (e, item, wc) => {
      const pane = this.byContents(wc);
      if (agent || !this.isUserPane(pane)) return e.preventDefault();
      const dir = app.getPath('downloads');
      const ext = path.extname(item.getFilename());
      const base = path.basename(item.getFilename(), ext) || 'download';
      let file = path.join(dir, base + ext);
      for (let n = 1; fs.existsSync(file); n++) file = path.join(dir, `${base} (${n})${ext}`);
      item.setSavePath(file);
      item.once('done', (_e, state) => this.hooks.paneEvent({ kind: 'download', pane_id: pane.row.id, file, state }));
    });
    ses.setPermissionCheckHandler((wc, perm, origin) => GRANTED.has(perm) || (!agent && this.isUserPane(this.byContents(wc)) && this.allowed.get(`${origin} ${perm}`) === true));
    ses.setPermissionRequestHandler((wc, perm, cb, details) => {
      const pane = this.byContents(wc);
      if (GRANTED.has(perm)) return cb(true);
      if (agent || !this.isUserPane(pane) || !ASKABLE.has(perm)) return cb(false);
      let origin = '';
      try { origin = new URL(details.requestingUrl ?? wc.getURL()).origin; } catch { return cb(false); }
      const key = `${origin} ${perm}`;
      const known = this.allowed.get(key);
      if (known !== undefined) return cb(known);
      const id = `perm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      this.asking.set(id, { key, pane: pane.row.id, cb });
      const kinds = (details as { mediaTypes?: string[] }).mediaTypes;
      this.hooks.paneEvent({ kind: 'permission', pane_id: pane.row.id, id, origin, permission: perm === 'media' && kinds?.length ? kinds.join(' and ') : perm });
    });
    return ses;
  }

  /** Creates views for open pane rows it has not seen and closes views whose rows closed. */
  sync(rows: PaneRow[]): void {
    const open = new Map(rows.filter((r) => r.open).map((r) => [r.id, r]));
    for (const [id, pane] of this.panes) {
      if (!open.has(id)) this.destroy(id);
      else pane.row = open.get(id) as PaneRow;
    }
    for (const row of open.values()) if (!this.panes.has(row.id)) this.create(row).catch(() => {});
  }

  private async create(row: PaneRow): Promise<void> {
    const ses = this.guardPartition(row);
    const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false } });
    const overlay = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, preload: path.join(here, 'overlay-preload.cjs') } });
    overlay.setBackgroundColor('#00000000');
    void overlay.webContents.loadFile(OVERLAY);
    const pane: Pane = { row, view, overlay, dbg: view.webContents.debugger, refs: newRefs(), lastSnapshot: new Map(), cursors: new Map(), cursorN: 0, navs: 0, crashed: null, console: [], network: new Map(), status: null, overlayShownUntil: 0, picking: null, parked: false, ready: Promise.resolve(), dialog: null, onDialog: null, errorFor: null, clickedAt: 0, popups: new Set(), pickStack: [] };
    this.panes.set(row.id, pane);
    this.win.contentView.addChildView(view);
    this.wireContents(pane);
    pane.ready = this.setUp(pane);
    await pane.ready;
  }

  private async setUp(pane: Pane): Promise<void> {
    const { row, view } = pane;
    // A view with no navigation has no renderer yet; CDP commands would hang forever (seen under Linux/xvfb).
    await view.webContents.loadURL('about:blank').catch(() => {});
    pane.dbg.on('message', (_e, method, params) => { this.onDebuggerEvent(pane, method, params).catch(() => {}); });
    await this.attach(pane);
    this.layout();
    if (row.url) await this.load(pane, row.url).catch(() => {});
    this.layout();
  }

  /** Attaches the pane's debugger and turns on request interception and the domains the tools read. */
  private async attach(pane: Pane): Promise<void> {
    try {
      pane.dbg.attach('1.3');
    } catch {}
    await this.cmd(pane, 'Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await this.cmd(pane, 'Network.enable', {});
    await this.cmd(pane, 'Runtime.enable', {});
    await this.cmd(pane, 'Page.enable', {});
    await this.cmd(pane, 'DOM.enable', {});
  }

  private wireContents(pane: Pane): void {
    const wc = pane.view.webContents;
    wc.on('will-navigate', (e, url) => {
      if (stop(e, url) || !pane.crashed?.startsWith('the page crashed')) return;
      e.preventDefault();
      void this.retry(pane, url).catch(() => {});
    });
    wc.on('will-redirect', (e, url) => { stop(e, url); });
    wc.on('will-frame-navigate', (e) => stop(e as unknown as Electron.Event, e.url));
    wc.on('input-event', (_e, input) => {
      if (/^(mouseDown|mouseUp|rawKeyDown|keyDown)$/.test(input.type)) pane.clickedAt = Date.now();
    });
    wc.setWindowOpenHandler(({ url, disposition }) => {
      if (!/^https?:/.test(url)) return { action: 'deny' };
      if (Date.now() - pane.clickedAt > GESTURE_MS) {
        this.log(pane, 'blocked', `MetaTrooper blocked a window the page opened without a click: ${url}`);
        return { action: 'deny' };
      }
      pane.clickedAt = 0;
      if (disposition === 'new-window') return { action: 'allow', overrideBrowserWindowOptions: { parent: this.win, width: 520, height: 680, autoHideMenuBar: true, webPreferences: POPUP_PREFS } };
      if (this.isUserPane(pane)) this.hooks.openPane(pane.row.project_id, url);
      else void this.load(pane, url).catch(() => {});
      return { action: 'deny' };
    });
    wc.on('did-create-window', (child) => this.guardPopup(pane, child));
    wc.on('did-navigate', (_e, url, code) => {
      pane.refs.byRef.clear();
      pane.refs.byKey.clear();
      pane.lastSnapshot.clear();
      pane.cursors.clear();
      pane.pickStack = [];
      pane.navs++;
      if (url.startsWith('data:')) return;
      pane.status = code;
      pane.errorFor = null;
      if (url !== 'about:blank') this.hooks.urlChanged(pane.row.id, url);
    });
    wc.on('did-navigate-in-page', (_e, url) => this.hooks.urlChanged(pane.row.id, url));
    const state = () => this.emitState(pane);
    for (const ev of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page'] as const) wc.on(ev as 'did-start-loading', state);
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (!isMain || code === -3 || url.startsWith('data:')) return;
      const kind = code === -20 ? 'blocked' : code <= -200 && code > -300 ? 'certificate' : 'load';
      this.showError(pane, url, kind, `${desc} (${code})`);
    });
    wc.on('render-process-gone', (_e, d) => {
      pane.crashed = 'the page crashed; call navigate to load it again';
      if (d.reason !== 'clean-exit') this.showError(pane, pane.errorFor ?? wc.getURL(), 'crash', d.reason);
    });
    wc.on('unresponsive', () => { pane.crashed ??= 'the page is not responding'; });
    wc.on('responsive', () => { if (pane.crashed === 'the page is not responding') pane.crashed = null; });
    wc.on('found-in-page', (_e, r) => this.hooks.paneEvent({ kind: 'found', pane_id: pane.row.id, active: r.activeMatchOrdinal, matches: r.matches }));
    if (!this.isUserPane(pane)) return;
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const action = shortcut(input);
      if (!action) return;
      e.preventDefault();
      if (action === 'focus-url' || action === 'find') {
        this.win.webContents.focus();
        this.hooks.paneEvent({ kind: 'key', pane_id: pane.row.id, action });
      }
      else this.act(pane.row.id, action);
    });
    wc.on('context-menu', (_e, p) => {
      const items: MenuItemConstructorOptions[] = [];
      if (p.linkURL && /^https?:/.test(p.linkURL)) {
        items.push({ label: 'Open link in new pane', click: () => this.hooks.openPane(pane.row.project_id, p.linkURL) });
        items.push({ label: 'Copy link', click: () => clipboard.writeText(p.linkURL) });
        items.push({ type: 'separator' });
      }
      if (p.isEditable) items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy }, { role: 'paste', enabled: p.editFlags.canPaste }, { role: 'selectAll' });
      else if (p.selectionText) items.push({ role: 'copy' });
      else {
        items.push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => this.act(pane.row.id, 'back') });
        items.push({ label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => this.act(pane.row.id, 'forward') });
        items.push({ label: 'Reload', click: () => this.act(pane.row.id, 'reload') });
      }
      items.push({ type: 'separator' }, { label: 'Inspect', click: () => { wc.inspectElement(p.x, p.y); } });
      Menu.buildFromTemplate(items).popup({ window: this.win });
    });
  }

  /** Loads the pane's own page for a failed load or a crash; the pane's URL stays the failed one. */
  private showError(pane: Pane, url: string, kind: string, detail: string): void {
    const wc = pane.view.webContents;
    if (wc.isDestroyed()) return;
    pane.errorFor = url;
    this.log(pane, 'error', `${ERROR_TEXT[kind]?.[0] ?? 'This page did not load'}: ${url} ${detail}`);
    void wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(errorPage(kind, url, detail))}`).catch(() => {});
  }

  /** Loads a URL again after an error page, re-attaching the debugger first when the renderer crashed. */
  private async retry(pane: Pane, url: string): Promise<void> {
    if (pane.crashed?.startsWith('the page crashed')) {
      await this.attach(pane);
      pane.crashed = null;
    }
    await this.load(pane, url);
  }

  /** A popup keeps its opener; it may not navigate off the web or open windows of its own, and it closes with its pane. */
  private guardPopup(pane: Pane, child: BrowserWindow): void {
    pane.popups.add(child);
    child.on('closed', () => pane.popups.delete(child));
    const cwc = child.webContents;
    cwc.on('will-navigate', (e, url) => { stop(e, url); });
    cwc.on('will-redirect', (e, url) => { stop(e, url); });
    cwc.on('will-frame-navigate', (e) => { stop(e as unknown as Electron.Event, e.url); });
    cwc.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.hooks.probe({ kind: 'popup', pane: pane.row.id, url: cwc.getURL() });
  }

  /** The URL a pane stands for: the failed one while it shows an error page. */
  private pageUrl(pane: Pane): string {
    return pane.errorFor ?? pane.view.webContents.getURL();
  }

  private emitState(pane: Pane): void {
    const wc = pane.view.webContents;
    if (wc.isDestroyed()) return;
    this.hooks.paneEvent({
      kind: 'state', pane_id: pane.row.id, url: this.pageUrl(pane), title: wc.getTitle(), loading: wc.isLoading(),
      can_back: wc.navigationHistory.canGoBack(), can_forward: wc.navigationHistory.canGoForward(), zoom: wc.getZoomFactor(),
    });
  }

  /** The user's own browser actions from the toolbar, shortcuts and context menu. */
  act(id: string, action: string, arg?: unknown): void {
    if (action === 'permission') {
      const a = arg as { id?: unknown; allow?: unknown } | undefined;
      const ask = typeof a?.id === 'string' ? this.asking.get(a.id) : undefined;
      if (!ask) return;
      this.asking.delete(a!.id as string);
      this.allowed.set(ask.key, a!.allow === true);
      ask.cb(a!.allow === true);
      return;
    }
    const pane = this.panes.get(id);
    if (!pane || pane.view.webContents.isDestroyed()) return;
    const wc = pane.view.webContents;
    const zoom = (dir: number) => {
      const i = ZOOM_STEPS.findIndex((z) => z >= wc.getZoomFactor() - 0.001);
      wc.setZoomFactor(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (i < 0 ? 4 : i) + dir))]);
    };
    switch (action) {
      case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
      case 'forward': if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
      case 'reload': if (pane.errorFor) void this.retry(pane, pane.errorFor).catch(() => {}); else wc.reload(); break;
      case 'stop': wc.stop(); break;
      case 'zoom-in': zoom(1); break;
      case 'zoom-out': zoom(-1); break;
      case 'zoom-reset': wc.setZoomFactor(1); break;
      case 'devtools': if (wc.isDevToolsOpened()) wc.closeDevTools(); else wc.openDevTools({ mode: 'detach' }); break;
      case 'find': {
        const f = arg as { text?: unknown; forward?: unknown; next?: unknown } | undefined;
        if (typeof f?.text === 'string' && f.text) wc.findInPage(f.text, { forward: f.forward !== false, findNext: f.next === true });
        else wc.stopFindInPage('clearSelection');
        break;
      }
      case 'find-stop': wc.stopFindInPage('keepSelection'); break;
      default: return;
    }
    this.emitState(pane);
  }

  private async onDebuggerEvent(pane: Pane, method: string, params: Record<string, any>): Promise<void> {
    if (method === 'Fetch.requestPaused') {
      const verdict = await checkUrl(params.request.url, this.policy(pane.row.project_id)).catch((e: Error) => ({ allow: false as const, reason: `the check failed: ${e.message}` }));
      if (verdict.allow) await this.cmd(pane, 'Fetch.continueRequest', { requestId: params.requestId }).catch(() => {});
      else {
        await this.cmd(pane, 'Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
        this.hooks.probe({ kind: 'blocked', pane: pane.row.id, url: params.request.url, reason: verdict.reason });
        this.log(pane, 'blocked', `MetaTrooper blocked ${params.request.url}: ${verdict.reason}`);
      }
      return;
    }
    if (method === 'Page.frameNavigated' && params.frame?.parentId) {
      dropFrame(pane.refs, params.frame.id);
      return;
    }
    if (method === 'Page.frameDetached') {
      dropFrame(pane.refs, params.frameId);
      return;
    }
    if (method === 'Page.javascriptDialogOpening') {
      pane.dialog = { type: params.type, message: String(params.message ?? '').slice(0, 2000) };
      this.log(pane, 'dialog', `${params.type} dialog: ${pane.dialog.message}`);
      pane.onDialog?.(pane.dialog);
      return;
    }
    if (method === 'Page.javascriptDialogClosed') {
      pane.dialog = null;
      return;
    }
    if (method === 'Runtime.exceptionThrown') {
      const d = params.exceptionDetails ?? {};
      this.log(pane, 'error', String(d.exception?.description ?? d.text ?? 'uncaught exception'));
      return;
    }
    if (method === 'Network.loadingFailed') {
      const r = pane.network.get(params.requestId);
      if (r) r.error = params.blockedReason ? `${params.errorText} (${params.blockedReason})` : params.errorText;
      return;
    }
    if (method === 'Runtime.consoleAPICalled') {
      const text = (params.args ?? []).map((a: any) => (a.value !== undefined ? String(a.value) : a.description ?? a.type)).join(' ');
      this.log(pane, params.type, text);
      return;
    }
    if (method === 'Network.requestWillBeSent') {
      pane.network.set(params.requestId, { at: Date.now(), method: params.request.method, url: logUrl(String(params.request.url)), status: null, bytes: 0 });
      if (pane.network.size > LOG_KEEP) pane.network.delete(pane.network.keys().next().value as string);
      return;
    }
    if (method === 'Network.responseReceived') {
      const r = pane.network.get(params.requestId);
      if (r) r.status = params.response.status;
      const ip = params.response.remoteIPAddress;
      if (ip) {
        const verdict = await connectedVerdict(params.response.url, ip, this.policy(pane.row.project_id));
        if (!verdict.allow) {
          const reason = verdict.reason;
          this.hooks.probe({ kind: 'blocked', pane: pane.row.id, url: params.response.url, reason });
          this.log(pane, 'blocked', `MetaTrooper blocked ${params.response.url}: ${reason}`);
          await pane.view.webContents.loadURL('about:blank').catch(() => {});
        }
      }
      return;
    }
    if (method === 'Network.loadingFinished') {
      const r = pane.network.get(params.requestId);
      if (r) r.bytes = params.encodedDataLength ?? 0;
      return;
    }
    if (method === 'Overlay.inspectNodeRequested' && pane.picking) {
      const done = pane.picking;
      pane.picking = null;
      done(params.backendNodeId);
    }
  }

  private log(pane: Pane, level: string, text: string): void {
    pane.console.push({ at: Date.now(), level, text: text.slice(0, 2000) });
    if (pane.console.length > LOG_KEEP) pane.console.splice(0, pane.console.length - LOG_KEEP);
  }

  private cmd(pane: Pane, method: string, params: Record<string, unknown> = {}): Promise<any> {
    return pane.dbg.sendCommand(method, params).catch((e: Error) => {
      throw new ToolError(-32099, `${method} failed: ${e.message}`);
    });
  }

  private destroy(id: string): void {
    const pane = this.panes.get(id);
    if (!pane) return;
    this.panes.delete(id);
    if (this.shown === id) this.shown = null;
    pane.picking?.(null);
    for (const w of pane.popups) if (!w.isDestroyed()) w.close();
    for (const [k, a] of this.asking) if (a.pane === id) { this.asking.delete(k); a.cb(false); }
    try { pane.dbg.detach(); } catch {}
    if (!this.win.isDestroyed()) {
      this.win.contentView.removeChildView(pane.view);
      try { this.win.contentView.removeChildView(pane.overlay); } catch {}
    }
    if (!pane.overlay.webContents.isDestroyed()) pane.overlay.webContents.close();
    if (pane.view.webContents.isDestroyed()) return;
    const ses = pane.view.webContents.session;
    pane.view.webContents.close();
    if (id.startsWith(AGENT_PANE)) void ses.clearStorageData().catch(() => {});
  }

  /** Shows one pane in the given window area; null bounds hide every pane. */
  show(id: string | null, bounds: { x: number; y: number; width: number; height: number } | null): void {
    this.shown = id;
    this.bounds = bounds;
    this.layout();
  }

  /** A pane not on screen stays attached as a 1 px view in the window corner with an emulated viewport, so it still lays out, takes input and renders captures. */
  private layout(): void {
    const win = this.win.getContentBounds();
    for (const [id, pane] of this.panes) {
      const visible = id === this.shown && this.bounds !== null && this.bounds.width > 0;
      const b = visible ? (this.bounds as { x: number; y: number; width: number; height: number }) : { x: win.width - 1, y: win.height - 1, width: 1, height: 1 };
      pane.view.setBounds(b);
      pane.overlay.setBounds(b);
      void this.applyViewport(pane, !visible);
    }
  }

  private async applyViewport(pane: Pane, parked: boolean): Promise<void> {
    if (parked === pane.parked) return;
    pane.parked = parked;
    try {
      if (parked) await this.cmd(pane, 'Emulation.setDeviceMetricsOverride', { ...PARKED_VIEWPORT, deviceScaleFactor: 1, mobile: false });
      else await this.cmd(pane, 'Emulation.clearDeviceMetricsOverride');
    } catch {
      pane.parked = !parked; // the next layout() retries
    }
  }

  private async load(pane: Pane, url: string): Promise<void> {
    const verdict = await checkUrl(url, this.policy(pane.row.project_id));
    if (!verdict.allow) throw new ToolError(-32031, `navigation blocked: ${verdict.reason}`);
    await pane.view.webContents.loadURL(url).catch((e: Error) => {
      if (!/ERR_ABORTED/.test(e.message)) throw new ToolError(-32099, `could not load ${url}: ${e.message}`);
    });
  }

  private pane(id: string): Pane {
    const p = this.panes.get(id);
    if (!p) throw new ToolError(-32002, 'pane is not open in the workbench');
    return p;
  }

  private node(pane: Pane, ref: unknown): Target {
    const t = resolveRef(pane.refs, ref);
    if (t === 'gone') throw new ToolError(-32602, `ref ${String(ref)} is no longer on the page; call snapshot again`);
    if (t === 'unknown') throw new ToolError(-32602, `unknown ref ${String(ref)}; call snapshot first`);
    return t;
  }

  /** A remote object for the ref's element in the isolated world of its frame. */
  private async resolve(pane: Pane, t: Target, ref: unknown): Promise<string> {
    const gone = new ToolError(-32602, `ref ${String(ref)} is no longer on the page; call snapshot again`);
    const { object } = await this.cmd(pane, 'DOM.resolveNode', { backendNodeId: t.backendNodeId, executionContextId: await this.isolated(pane, t.frameId) }).catch(() => { throw gone; });
    const live = await this.cmd(pane, 'Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true, functionDeclaration: 'function () { return this.isConnected; }' });
    if (live.result?.value !== true) throw gone;
    return object.objectId;
  }

  /** The border box of a ref's element in the pane's viewport, after scrolling it into view. */
  private async box(pane: Pane, t: Target, ref: unknown): Promise<{ objectId: string; x: number; y: number; left: number; top: number; right: number; bottom: number }> {
    const objectId = await this.resolve(pane, t, ref);
    await this.cmd(pane, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: t.backendNodeId }).catch(() => {});
    const box = await this.cmd(pane, 'DOM.getBoxModel', { backendNodeId: t.backendNodeId }).catch(() => {
      throw new ToolError(-32602, `ref ${String(ref)} is not visible (it has no layout box)`);
    });
    const q: number[] = box.model.border;
    const xs = [q[0], q[2], q[4], q[6]];
    const ys = [q[1], q[3], q[5], q[7]];
    return { objectId, x: (xs[0] + xs[1] + xs[2] + xs[3]) / 4, y: (ys[0] + ys[1] + ys[2] + ys[3]) / 4, left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
  }

  /** The point to click for a ref, after checking the element is enabled and is what a click there hits; the hit test runs in the element's own frame. */
  private async target(pane: Pane, ref: unknown): Promise<{ node: Target; x: number; y: number }> {
    const node = this.node(pane, ref);
    const p = await this.box(pane, node, ref);
    const r = await this.cmd(pane, 'Runtime.callFunctionOn', {
      objectId: p.objectId,
      returnByValue: true,
      functionDeclaration: `function () {
        const el = this.nodeType === 1 ? this : this.parentElement;
        if (!el) return null;
        if (el.disabled || el.closest('[aria-disabled="true"], fieldset:disabled')) return 'is disabled';
        const root = el.getRootNode();
        const at = (x, y) => (root.elementFromPoint ? root.elementFromPoint(x, y) : document.elementFromPoint(x, y));
        const hits = (h) => !!h && (h === el || el.contains(h) || h.closest('label')?.control === el);
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const hit = at(cx, cy);
        if (hits(hit)) return null;
        for (const label of el.labels || []) {
          const b = label.getBoundingClientRect();
          const lx = b.left + b.width / 2, ly = b.top + b.height / 2;
          if (b.width && b.height && hits(at(lx, ly))) return { dx: lx - cx, dy: ly - cy };
        }
        if (!hit) return 'is outside the viewport';
        return 'is covered by <' + hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') + '>';
      }`,
    });
    const v = r.result?.value;
    if (typeof v === 'string') throw new ToolError(-32033, `ref ${String(ref)} ${v}; nothing was clicked`);
    return v && typeof v.dx === 'number' ? { node, x: p.x + v.dx, y: p.y + v.dy } : { node, x: p.x, y: p.y };
  }

  /** Runs a tool action, returning early with the dialog if one opens while it runs. */
  private async race<T>(pane: Pane, work: Promise<T>): Promise<T | { ok: true; dialog: Dialog }> {
    work.catch(() => {});
    const opened = new Promise<{ ok: true; dialog: Dialog }>((resolve) => { pane.onDialog = (dialog) => resolve({ ok: true, dialog }); });
    try {
      return await Promise.race([work, opened]);
    } finally {
      pane.onDialog = null;
    }
  }

  /** Moves the overlay cursor to a CSS-pixel point of the pane and waits for its ease to finish. */
  private async pointAt(pane: Pane, x: number, y: number): Promise<void> {
    const zoom = pane.view.webContents.getZoomFactor();
    if (!this.win.contentView.children.includes(pane.overlay)) this.win.contentView.addChildView(pane.overlay);
    pane.overlayShownUntil = Date.now() + 1500;
    pane.overlay.webContents.send('cursor', { x: x * zoom, y: y * zoom, ease: EASE_MS });
    await sleep(EASE_MS + 30);
    const at = await pane.overlay.webContents.executeJavaScript('window.cursorAt ? window.cursorAt() : null').catch(() => null);
    this.hooks.probe({ kind: 'cursor', pane: pane.row.id, target: { x: x * zoom, y: y * zoom }, at });
    setTimeout(() => {
      if (Date.now() >= pane.overlayShownUntil) {
        try { this.win.contentView.removeChildView(pane.overlay); } catch {}
      }
    }, 1600);
  }

  /** `recheck` runs after the cursor glide, right before the mouse events. */
  private async clickAt(pane: Pane, x: number, y: number, recheck: () => Promise<void>): Promise<void> {
    await this.pointAt(pane, x, y);
    await recheck();
    this.hooks.probe({ kind: 'click', pane: pane.row.id, x, y });
    pane.clickedAt = Date.now();
    await this.cmd(pane, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.cmd(pane, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.cmd(pane, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  private async isolated(pane: Pane, frameId?: string): Promise<number> {
    const id = frameId ?? (await this.cmd(pane, 'Page.getFrameTree')).frameTree.frame.id;
    const world = await this.cmd(pane, 'Page.createIsolatedWorld', { frameId: id, worldName: 'metatrooper', grantUniveralAccess: false });
    return world.executionContextId;
  }

  /** Each frame's accessibility tree, the main frame first; a frame that cannot be read (cross-origin) has no nodes. */
  private async frames(pane: Pane): Promise<Frame[]> {
    const { frameTree } = await this.cmd(pane, 'Page.getFrameTree');
    const out: Frame[] = [];
    const visit = async (t: any, parent?: string): Promise<void> => {
      const id = t.frame.id as string;
      const nodes = (await this.cmd(pane, 'Accessibility.getFullAXTree', { frameId: id }).then((r) => r.nodes as AXNode[], () => []));
      const owner = parent ? await this.cmd(pane, 'DOM.getFrameOwner', { frameId: id }).then((r) => r.backendNodeId as number, () => undefined) : undefined;
      out.push({ id, nodes, parent, owner });
      for (const c of t.childFrames ?? []) await visit(c, id);
    };
    await visit(frameTree);
    return out;
  }

  /** Snapshot lines of the whole pane or of the subtree under `scopeRef`. */
  private async lines(pane: Pane, scopeRef: unknown, interactive: boolean): Promise<string[]> {
    const scope = scopeRef === undefined || scopeRef === null || scopeRef === '' ? undefined : this.node(pane, scopeRef);
    const lines = render(await this.frames(pane), pane.refs, scope);
    if (!lines) throw new ToolError(-32602, `ref ${String(scopeRef)} is no longer on the page; call snapshot again`);
    return interactive ? interactiveOnly(lines) : lines;
  }

  /** The lines that fit in `maxTokens`; the rest is kept under a `continue` cursor named in the last line. */
  private page(pane: Pane, tool: string, lines: string[], maxTokens: number): { text: string; continue?: string } {
    const id = `c${++pane.cursorN}`;
    const trailer = `(cut at ${maxTokens} tokens; call ${tool} with continue="${id}" for the rest)`;
    const { head, rest } = fit(lines, maxTokens, trailer);
    if (!rest.length) return { text: head.join('\n') };
    pane.cursors.set(id, rest);
    if (pane.cursors.size > CURSORS_KEPT) pane.cursors.delete(pane.cursors.keys().next().value as string);
    return { text: [...head, trailer].join('\n'), continue: id };
  }

  /** Waits up to 1 s for the page to stop loading. */
  private async settle(pane: Pane): Promise<void> {
    const wc = pane.view.webContents;
    const end = Date.now() + SETTLE_MS;
    await sleep(100);
    while (Date.now() < end && !wc.isDestroyed() && wc.isLoading()) await sleep(50);
  }

  /** Runs an action, then returns its result with the URL, title, new console errors and the interactive snapshot diff. */
  private async answer(pane: Pane, session: string, work: () => Promise<Record<string, unknown>>): Promise<Record<string, unknown>> {
    const key = `${session}|i|`;
    const navs = pane.navs;
    const before = pane.lastSnapshot.get(key) ?? (await this.lines(pane, undefined, true).catch(() => []));
    const from = Date.now();
    const r = await work();
    await this.settle(pane);
    const wc = pane.view.webContents;
    const out: Record<string, unknown> = { ...r, url: this.pageUrl(pane), title: wc.getTitle() };
    if (pane.dialog) out.dialog = pane.dialog;
    const errors = pane.console.filter((c) => c.at >= from && c.level === 'error').map((c) => c.text);
    if (errors.length) out.errors = errors.slice(-20);
    if (pane.errorFor && pane.navs !== navs) out.error = `the page did not load: ${pane.errorFor}`;
    if (pane.dialog) return out;
    const after = await this.lines(pane, undefined, true).catch(() => null);
    if (after) {
      pane.lastSnapshot.set(key, after);
      const p = this.page(pane, 'snapshot', diffLines(pane.navs === navs ? before : [], after), ACTION_TOKENS);
      out.changes = p.text;
      if (p.continue) out.continue = p.continue;
    }
    return out;
  }

  private async evalIsolated(pane: Pane, expression: string): Promise<unknown> {
    const contextId = await this.isolated(pane);
    const r = await this.cmd(pane, 'Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true, timeout: 10_000 });
    if (r.exceptionDetails) throw new ToolError(-32099, `evaluate threw: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  }

  private async fullPage(pane: Pane): Promise<{ png: Buffer; truncated: boolean; height: number }> {
    const m = await this.cmd(pane, 'Page.getLayoutMetrics');
    const size = m.cssContentSize ?? m.contentSize;
    const width = Math.ceil(size.width);
    const height = Math.ceil(size.height);
    const h = Math.min(height, MAX_CAPTURE_PX);
    const shot = await this.cmd(pane, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: h, scale: 1 } });
    return { png: Buffer.from(shot.data, 'base64'), truncated: height > MAX_CAPTURE_PX, height: h };
  }

  /** Runs one metatrooper-browser tool on a pane. */
  async tool(id: string, name: string, a: Record<string, any>): Promise<unknown> {
    const pane = this.pane(id);
    await pane.ready;
    if (pane.crashed && !(name === 'navigate' && pane.crashed.startsWith('the page crashed'))) throw new ToolError(-32034, pane.crashed);
    if (name === 'dialog') {
      if (!pane.dialog) throw new ToolError(-32002, 'no dialog is open');
      const d = pane.dialog;
      await this.cmd(pane, 'Page.handleJavaScriptDialog', { accept: a.accept === true, ...(typeof a.prompt_text === 'string' ? { promptText: a.prompt_text } : {}) });
      pane.dialog = null;
      return { ok: true, handled: d };
    }
    if (pane.dialog && name !== 'console' && name !== 'network') {
      throw new ToolError(-32032, `a ${pane.dialog.type} dialog is open ("${pane.dialog.message.slice(0, 200)}"); call dialog first`);
    }
    return this.race(pane, this.run(pane, name, a));
  }

  /** The pane's origin and the control an input tool would act on: the ref's node, or the focused element for `key`. `hidden`: focus is in a cross-origin frame or a closed shadow root, so the control cannot be named. */
  private async describe(pane: Pane, a: Record<string, any>): Promise<{ origin: string; control: { automation_id: string; name: string; role: string } | null; password: boolean; hidden: boolean }> {
    let origin = '';
    try { origin = new URL(pane.view.webContents.getURL()).origin; } catch {}
    let objectId: string | undefined;
    let backendNodeId: number | undefined;
    if (a.tool === 'key') {
      const r = await this.cmd(pane, 'Runtime.evaluate', { expression: FOCUSED, contextId: await this.isolated(pane) });
      if (r.result?.value === 'hidden') return { origin, control: null, password: false, hidden: true };
      objectId = r.result?.objectId;
      if (objectId) {
        const node = (await this.cmd(pane, 'DOM.describeNode', { objectId, pierce: true })).node;
        if (node?.shadowRoots?.some((s: any) => s.shadowRootType === 'closed')) return { origin, control: null, password: false, hidden: true };
        backendNodeId = node?.backendNodeId;
      }
    } else if (a.ref !== undefined) {
      const t = this.node(pane, a.ref);
      backendNodeId = t.backendNodeId;
      objectId = await this.resolve(pane, t, a.ref);
    }
    if (!objectId || !backendNodeId) return { origin, control: null, password: false, hidden: false };
    const el = await this.cmd(pane, 'Runtime.callFunctionOn', {
      objectId,
      returnByValue: true,
      functionDeclaration: 'function () { const e = this.nodeType === 1 ? this : this.parentElement; return { id: (e && e.id) || "", password: !!e && e.tagName === "INPUT" && e.type === "password" }; }',
    });
    const ax = await this.cmd(pane, 'Accessibility.getPartialAXTree', { backendNodeId, fetchRelatives: false }).catch(() => ({ nodes: [] }));
    const n = ax.nodes.find((x: any) => x.backendDOMNodeId === backendNodeId) ?? ax.nodes[0];
    const name = String(n?.name?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    return { origin, control: { automation_id: String(el.result?.value?.id ?? ''), name, role: String(n?.role?.value ?? '') }, password: el.result?.value?.password === true, hidden: false };
  }

  /** Fails when the pane's origin or the control's name or id differs from `expect`, what an approval was given for. */
  private async recheck(pane: Pane, tool: string, a: Record<string, any>): Promise<void> {
    if (!a.expect || typeof a.expect !== 'object') return;
    const d = await this.describe(pane, { ...a, tool });
    if (d.origin !== String(a.expect.origin ?? '')) throw new ToolError(-32035, 'the page changed origin since the control was checked; nothing was sent');
    const now = d.control;
    if (d.hidden !== (a.expect.hidden === true) || (now?.name ?? '') !== String(a.expect.name ?? '') || (now?.automation_id ?? '') !== String(a.expect.automation_id ?? '')) {
      throw new ToolError(-32035, 'the control changed since it was checked; nothing was sent');
    }
  }

  private async pressKeys(pane: Pane, keys: string): Promise<void> {
    const parts = keys.split('+').map((k) => k.trim()).filter(Boolean);
    const key = parts.pop() ?? '';
    const MODS: Record<string, number> = { alt: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, shift: 8 };
    let modifiers = 0;
    for (const m of parts) {
      const bit = MODS[m.toLowerCase()];
      if (!bit) throw new ToolError(-32602, `unknown modifier ${m}`);
      modifiers |= bit;
    }
    const NAMED: Record<string, [string, string, number, string?]> = {
      enter: ['Enter', 'Enter', 13, '\r'], return: ['Enter', 'Enter', 13, '\r'], tab: ['Tab', 'Tab', 9], escape: ['Escape', 'Escape', 27], esc: ['Escape', 'Escape', 27],
      backspace: ['Backspace', 'Backspace', 8], delete: ['Delete', 'Delete', 46], space: [' ', 'Space', 32, ' '], arrowup: ['ArrowUp', 'ArrowUp', 38],
      arrowdown: ['ArrowDown', 'ArrowDown', 40], arrowleft: ['ArrowLeft', 'ArrowLeft', 37], arrowright: ['ArrowRight', 'ArrowRight', 39],
      home: ['Home', 'Home', 36], end: ['End', 'End', 35], pageup: ['PageUp', 'PageUp', 33], pagedown: ['PageDown', 'PageDown', 34],
    };
    let def = NAMED[key.toLowerCase()];
    if (!def && key.length === 1) {
      const up = key.toUpperCase();
      def = [key, /[A-Z]/.test(up) ? `Key${up}` : /\d/.test(key) ? `Digit${key}` : '', up.charCodeAt(0), key];
    }
    if (!def) throw new ToolError(-32602, `unknown key ${key}`);
    const [k, code, vk, text] = def;
    const typed = text !== undefined && !(modifiers & 7) ? { text } : {};
    await this.cmd(pane, 'Input.dispatchKeyEvent', { type: typed.text !== undefined ? 'keyDown' : 'rawKeyDown', key: k, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...typed });
    await this.cmd(pane, 'Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  }

  private async run(pane: Pane, name: string, a: Record<string, any>): Promise<unknown> {
    const session = String(a._session ?? '');
    const budget = Math.max(200, Math.min(Number(a.max_tokens) || SNAPSHOT_TOKENS, 100_000));
    if ((name === 'snapshot' || name === 'read') && typeof a.continue === 'string') {
      const rest = pane.cursors.get(a.continue);
      if (!rest) throw new ToolError(-32602, `unknown continue cursor ${a.continue}; call ${name} again`);
      pane.cursors.delete(a.continue);
      return this.page(pane, name, rest, budget);
    }
    if (name === 'describe') return this.describe(pane, a);
    const recheck = () => this.recheck(pane, name, a);
    switch (name) {
      case 'key': {
        if (typeof a.keys !== 'string' || !a.keys) throw new ToolError(-32602, 'keys is required');
        await recheck();
        await this.pressKeys(pane, a.keys);
        return { ok: true };
      }
      case 'navigate': {
        if (typeof a.url !== 'string') throw new ToolError(-32602, 'url is required');
        if (pane.crashed) {
          await pane.view.webContents.loadURL('about:blank').catch(() => {});
          await this.attach(pane);
          pane.crashed = null;
        }
        pane.errorFor = null;
        const out = await this.answer(pane, session, async () => {
          await this.load(pane, a.url);
          return { status: pane.status };
        });
        if (pane.errorFor) throw new ToolError(-32099, `could not load ${pane.errorFor}; the pane shows the error`);
        return out;
      }
      case 'back': {
        const wc = pane.view.webContents;
        return this.answer(pane, session, async () => {
          if (wc.navigationHistory.canGoBack()) {
            const stopped = new Promise<void>((resolve) => { wc.once('did-stop-loading', () => resolve()); wc.once('did-navigate-in-page', () => resolve()); setTimeout(resolve, 10_000); });
            wc.navigationHistory.goBack();
            await stopped;
          }
          return {};
        });
      }
      case 'snapshot': {
        const interactive = a.interactive === true;
        const cur = await this.lines(pane, a.scope_ref, interactive);
        const key = `${session}|${interactive ? 'i' : 'f'}|${String(a.scope_ref ?? '')}`;
        const prev = pane.lastSnapshot.get(key);
        pane.lastSnapshot.set(key, cur);
        return this.page(pane, 'snapshot', a.since_last === true && prev ? diffLines(prev, cur) : cur, budget);
      }
      case 'read': {
        const text = String(await this.evalIsolated(pane, `(() => { const m = document.querySelector('main, [role=main], article') || document.body; return m ? m.innerText : ''; })()`) ?? '');
        let lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
        if (typeof a.search === 'string' && a.search) {
          const q = a.search.toLowerCase();
          lines = lines.filter((l) => l.toLowerCase().includes(q));
        }
        return this.page(pane, 'read', lines, budget);
      }
      case 'click':
        return this.answer(pane, session, async () => {
          const p = await this.target(pane, a.ref);
          await this.clickAt(pane, p.x, p.y, recheck);
          return { ok: true };
        });
      case 'type': {
        if (typeof a.text !== 'string') throw new ToolError(-32602, 'text is required');
        return this.answer(pane, session, async () => {
          const { node, x, y } = await this.target(pane, a.ref);
          await this.clickAt(pane, x, y, recheck);
          await this.cmd(pane, 'DOM.focus', { backendNodeId: node.backendNodeId }).catch(() => {});
          for (const type of ['keyDown', 'keyUp']) {
            await this.cmd(pane, 'Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65, ...(type === 'keyDown' ? { commands: ['selectAll'] } : {}) });
          }
          if (a.text) await this.cmd(pane, 'Input.insertText', { text: a.text });
          else {
            for (const type of ['keyDown', 'keyUp']) await this.cmd(pane, 'Input.dispatchKeyEvent', { type, key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
          }
          if (a.submit) {
            pane.clickedAt = Date.now();
            for (const type of ['keyDown', 'keyUp']) {
              await this.cmd(pane, 'Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
            }
          }
          return { ok: true };
        });
      }
      case 'select':
        return this.answer(pane, session, async () => {
          const node = this.node(pane, a.ref);
          const p = await this.box(pane, node, a.ref);
          await this.pointAt(pane, p.x, p.y);
          await recheck();
          await this.cmd(pane, 'Runtime.callFunctionOn', {
            objectId: p.objectId,
            functionDeclaration: 'function (v) { this.value = v; this.dispatchEvent(new Event("input", { bubbles: true })); this.dispatchEvent(new Event("change", { bubbles: true })); }',
            arguments: [{ value: String(a.value ?? '') }],
          });
          return { ok: true };
        });
      case 'scroll': {
        if (a.ref) await this.cmd(pane, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: this.node(pane, a.ref).backendNodeId });
        else {
          const [w, h] = pane.parked ? [PARKED_VIEWPORT.width, PARKED_VIEWPORT.height] : [pane.view.getBounds().width, pane.view.getBounds().height];
          await this.cmd(pane, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: w / 2, y: h / 2, deltaX: 0, deltaY: Number(a.dy) || 0 });
          await sleep(150);
        }
        return { scroll_y: await this.evalIsolated(pane, 'Math.round(window.scrollY)') };
      }
      case 'wait_for': {
        const end = Date.now() + Math.min(Number(a.timeout_ms) || 10_000, 30_000);
        while (Date.now() < end) {
          if (typeof a.text === 'string' && (await this.evalIsolated(pane, `document.body ? document.body.innerText.includes(${JSON.stringify(a.text)}) : false`))) return { found: true };
          const t = typeof a.ref === 'string' ? resolveRef(pane.refs, a.ref) : 'unknown';
          if (typeof t === 'object') {
            const ok = await this.cmd(pane, 'DOM.describeNode', { backendNodeId: t.backendNodeId }).then(() => true, () => false);
            if (ok) return { found: true };
          }
          await sleep(200);
        }
        return { found: false };
      }
      case 'screenshot': {
        let png: Buffer;
        let truncated = false;
        if (a.ref) {
          const b = await this.box(pane, this.node(pane, a.ref), a.ref);
          const m = await this.cmd(pane, 'Page.getLayoutMetrics');
          const vp = m.cssLayoutViewport ?? m.layoutViewport ?? { pageX: 0, pageY: 0 };
          const clip = { x: b.left + vp.pageX, y: b.top + vp.pageY, width: Math.max(1, b.right - b.left), height: Math.max(1, b.bottom - b.top), scale: 1 };
          png = Buffer.from((await this.cmd(pane, 'Page.captureScreenshot', { format: 'png', clip })).data, 'base64');
        } else if (a.full_page) {
          const r = await this.fullPage(pane);
          png = r.png;
          truncated = r.truncated;
        } else png = Buffer.from((await this.cmd(pane, 'Page.captureScreenshot', { format: 'png' })).data, 'base64');
        let img = nativeImage.createFromBuffer(png);
        const size = img.getSize();
        const k = MAX_IMAGE_SIDE / Math.max(size.width, size.height, 1);
        if (k < 1) img = img.resize({ width: Math.max(1, Math.floor(size.width * k)), height: Math.max(1, Math.floor(size.height * k)), quality: 'best' });
        const jpeg = a.format !== 'png';
        const first = (jpeg ? img.toJPEG(80) : img.toPNG()).toString('base64');
        if (first.length <= IMAGE_BUDGET) return { data_base64: first, mime: jpeg ? 'image/jpeg' : 'image/png', width: img.getSize().width, height: img.getSize().height, truncated };
        const full = img.getSize();
        for (const scale of [1, 0.75, 0.5, 0.35]) {
          const small = scale === 1 ? img : img.resize({ width: Math.max(1, Math.floor(full.width * scale)), height: Math.max(1, Math.floor(full.height * scale)), quality: 'best' });
          for (const q of [70, 50, 30]) {
            const data = small.toJPEG(q).toString('base64');
            if (data.length <= IMAGE_BUDGET) return { data_base64: data, mime: 'image/jpeg', width: small.getSize().width, height: small.getSize().height, truncated, reencoded: `JPEG q${q} at ${Math.round(scale * 100)}% to fit the 1 MiB limit` };
          }
        }
        throw new ToolError(-32099, 'the screenshot does not fit in 1 MiB even as a small JPEG; screenshot one ref instead');
      }
      case 'evaluate': {
        if (typeof a.expression !== 'string') throw new ToolError(-32602, 'expression is required');
        const value = await this.evalIsolated(pane, a.expression);
        const text = JSON.stringify(value ?? null);
        if (text.length > EVAL_CAP) return { value: text.slice(0, EVAL_CAP), truncated: true };
        return { value: value ?? null };
      }
      case 'console': {
        const since = Number(a.since_ms) || 0;
        return pane.console.filter((c) => c.at >= since).slice(-LOG_KEEP);
      }
      case 'network': {
        const since = Number(a.since_ms) || 0;
        return [...pane.network.values()].filter((r) => r.at >= since).slice(-LOG_KEEP);
      }
      default:
        throw new ToolError(-32601, `unknown tool ${name}`);
    }
  }

  /** Before/after capture: full page at 390 and 1280 px wide, saved under ~/.metatrooper/snapshots/<pane>/. */
  async capture(id: string, label: string): Promise<{ url: string; w390_path: string; w1280_path: string }> {
    const pane = this.pane(id);
    const dir = path.join(homeDir(), 'snapshots', id);
    fs.mkdirSync(dir, { recursive: true });
    const stamp = Date.now();
    const out: Record<number, string> = {};
    const failed: unknown[] = [];
    try {
      for (const width of [390, 1280]) {
        await this.cmd(pane, 'Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
        await sleep(400);
        const shot = await this.fullPage(pane);
        const file = path.join(dir, `${stamp}-${label}-${width}.png`);
        fs.writeFileSync(file, shot.png);
        out[width] = file.split(String.fromCharCode(92)).join('/');
      }
    } catch (e) {
      failed.push(e);
    } finally {
      try {
        if (pane.parked) await this.cmd(pane, 'Emulation.setDeviceMetricsOverride', { ...PARKED_VIEWPORT, deviceScaleFactor: 1, mobile: false });
        else await this.cmd(pane, 'Emulation.clearDeviceMetricsOverride');
      } catch (e) {
        failed.push(e);
      }
    }
    if (failed.length) throw failed[0];
    return { url: pane.view.webContents.getURL(), w390_path: out[390], w1280_path: out[1280] };
  }

  /** Point-to-comment: the next element the user clicks in the pane is described and cropped. */
  async pick(id: string): Promise<void> {
    const pane = this.pane(id);
    await this.cmd(pane, 'Overlay.enable');
    await this.cmd(pane, 'Overlay.setInspectMode', {
      mode: 'searchForNode',
      highlightConfig: { showInfo: true, contentColor: { r: 47, g: 111, b: 228, a: 0.25 }, borderColor: { r: 47, g: 111, b: 228, a: 0.9 } },
    });
    const node = await new Promise<number | null>((resolve) => { pane.picking?.(null); pane.picking = resolve; });
    if (node === null) return;
    await this.cmd(pane, 'Overlay.setInspectMode', { mode: 'none', highlightConfig: {} });
    pane.pickStack = [node];
    await this.describe(pane, node);
    if (!this.win.isDestroyed()) this.win.webContents.focus();
  }

  /** Arrow keys on a pick: up moves to the element's parent (stopping at body), down goes back to the child it came from. */
  async walkPick(id: string, dir: 'up' | 'down'): Promise<boolean> {
    const pane = this.pane(id);
    const stack = pane.pickStack;
    if (!stack.length) return false;
    if (dir === 'down') {
      if (stack.length < 2) return false;
      stack.pop();
    } else {
      const { object } = await this.cmd(pane, 'DOM.resolveNode', { backendNodeId: stack[stack.length - 1], executionContextId: await this.isolated(pane) });
      const up = await this.cmd(pane, 'Runtime.callFunctionOn', {
        objectId: object.objectId,
        functionDeclaration: 'function () { const p = this.parentElement; return p && p !== document.documentElement ? p : null; }',
      });
      if (!up.result?.objectId) return false;
      const { node } = await this.cmd(pane, 'DOM.describeNode', { objectId: up.result.objectId });
      stack.push(node.backendNodeId);
    }
    await this.describe(pane, stack[stack.length - 1]);
    return true;
  }

  /** Sends a picked element's URL, CSS path, raw outer HTML (sanitised and cut to 4 KB when saved) and crop to the workbench UI. */
  private async describe(pane: Pane, node: number): Promise<void> {
    const html = String((await this.cmd(pane, 'DOM.getOuterHTML', { backendNodeId: node })).outerHTML ?? '').slice(0, PICK_RAW);
    const { object } = await this.cmd(pane, 'DOM.resolveNode', { backendNodeId: node, executionContextId: await this.isolated(pane) });
    const sel = await this.cmd(pane, 'Runtime.callFunctionOn', {
      objectId: object.objectId,
      returnByValue: true,
      functionDeclaration: `function () {
        const parts = [];
        for (let el = this; el && el.nodeType === 1 && parts.length < 6; el = el.parentElement) {
          if (el.id) { parts.unshift('#' + CSS.escape(el.id)); break; }
          let p = el.tagName.toLowerCase();
          const sib = el.parentElement ? [...el.parentElement.children].filter((c) => c.tagName === el.tagName) : [];
          if (sib.length > 1) p += ':nth-of-type(' + (sib.indexOf(el) + 1) + ')';
          parts.unshift(p);
        }
        return parts.join(' > ');
      }`,
    });
    await this.cmd(pane, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: node }).catch(() => {});
    const box = await this.cmd(pane, 'DOM.getBoxModel', { backendNodeId: node });
    const q: number[] = box.model.border;
    const x = Math.max(0, Math.min(q[0], q[6]) - 8);
    const y = Math.max(0, Math.min(q[1], q[3]) - 8);
    const w = Math.max(q[2], q[4]) - x + 8;
    const h = Math.max(q[5], q[7]) - y + 8;
    const crop = await this.cmd(pane, 'Page.captureScreenshot', { format: 'png', clip: { x, y, width: Math.max(1, w), height: Math.max(1, h), scale: 1 } });
    this.hooks.commentPicked({ pane_id: pane.row.id, url: this.pageUrl(pane), depth: pane.pickStack.length - 1, selector: String(sel.result?.value ?? ''), html, crop: crop.data });
  }

  cancelPick(id: string): void {
    const pane = this.panes.get(id);
    if (!pane || !pane.picking) return;
    pane.picking(null);
    pane.picking = null;
    void this.cmd(pane, 'Overlay.setInspectMode', { mode: 'none', highlightConfig: {} }).catch(() => {});
  }

  /** The user's own navigation from the URL bar, under the same allowlist as agents. */
  async userNavigate(id: string, url: string): Promise<void> {
    await this.load(this.pane(id), url);
  }

  closeAll(): void {
    for (const id of [...this.panes.keys()]) this.destroy(id);
  }

  contentsOf(id: string): WebContents | null {
    return this.panes.get(id)?.view.webContents ?? null;
  }
}

/** Cancels a navigation to anything but http, https or about:blank; true when it did. */
function stop(e: Electron.Event, url: string): boolean {
  if (/^https?:/.test(url) || url === 'about:blank') return false;
  e.preventDefault();
  return true;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const ERROR_TEXT: Record<string, [string, string]> = {
  load: ['This page did not load', 'The address could not be reached.'],
  certificate: ['This page is not secure', 'The site sent a certificate this browser does not trust, so the page was not loaded.'],
  blocked: ['MetaTrooper blocked this page', 'The address is not on the browser pane allowlist.'],
  crash: ['This page crashed', 'The page stopped working.'],
};

/** The page a pane shows for a load error, certificate error, blocked address or renderer crash. */
export function errorPage(kind: string, url: string, detail: string): string {
  const [title, text] = ERROR_TEXT[kind] ?? ERROR_TEXT.load;
  const retry = /^https?:/.test(url) ? `<p><a href="${escapeHtml(url)}">Try again</a></p>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>`
    + `<style>body{font:14px system-ui,sans-serif;margin:48px;color:#222;background:#fafafa}code{word-break:break-all}@media (prefers-color-scheme:dark){body{color:#ddd;background:#1b1b1b}a{color:#8ab4f8}}</style></head>`
    + `<body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p><p><code>${escapeHtml(url.slice(0, 2000))}</code></p><p>${escapeHtml(detail.slice(0, 500))}</p>${retry}</body></html>`;
}

/** A request URL as the network log keeps it: data: URLs as their type and length, others cut at URL_KEEP chars. */
function logUrl(url: string): string {
  if (url.startsWith('data:')) return `data:${url.slice(5, url.indexOf(',') > 0 ? url.indexOf(',') : 5).slice(0, 100)}… (${url.length} chars)`;
  return url.length > URL_KEEP ? `${url.slice(0, URL_KEEP)}… (${url.length} chars)` : url;
}

/** The browser action a key press in a user pane stands for, or null. */
function shortcut(i: Electron.Input): string | null {
  const mod = i.control || i.meta;
  const key = i.key.toLowerCase();
  if (mod && key === 'l') return 'focus-url';
  if (mod && key === 'f') return 'find';
  if ((mod && key === 'r') || key === 'f5') return 'reload';
  if (i.alt && key === 'arrowleft') return 'back';
  if (i.alt && key === 'arrowright') return 'forward';
  if (mod && (key === '=' || key === '+')) return 'zoom-in';
  if (mod && key === '-') return 'zoom-out';
  if (mod && key === '0') return 'zoom-reset';
  if (key === 'f12' || (mod && i.shift && key === 'i')) return 'devtools';
  return null;
}
