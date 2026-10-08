import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, clipboard, Menu, session as electronSession, WebContentsView, type BrowserWindow, type Debugger, type MenuItemConstructorOptions, type WebContents } from 'electron';
import type { DatabaseSync } from 'node:sqlite';
import dns from 'node:dns';
import { homeDir } from '../../../core/src/paths.ts';
import { checkUrl, connectedVerdict, type PolicyContext } from '../../../core/src/browser/policy.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY = path.join(here, '..', '..', 'renderer', 'overlay.html');
export const EASE_MS = 150;
const MAX_CAPTURE_PX = 16_384;
const EVAL_CAP = 20 * 1024;
const LOG_KEEP = 200;
const PARKED_VIEWPORT = { width: 1280, height: 800 };
const BOARD_PANE = 'board-';
const AGENT_PANE = 'bp_agent_';
const ASKABLE = new Set(['clipboard-read', 'notifications', 'media', 'geolocation']);
const GRANTED = new Set(['clipboard-sanitized-write', 'fullscreen', 'mediaKeySystem']);
const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
const BOARD_SETTLE_MS = 1500;
const BOARD_LOAD_MS = 20_000;
const ACTIONABLE = new Set(['button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'option', 'slider', 'switch', 'listbox', 'spinbutton', 'treeitem']);

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
  refs: Map<string, number>;
  lastSnapshot: Map<string, Set<string>>;
  console: Array<{ at: number; level: string; text: string }>;
  network: Map<string, { at: number; method: string; url: string; status: number | null; bytes: number; error?: string }>;
  status: number | null;
  overlayShownUntil: number;
  picking: ((node: number) => void) | null;
  parked: boolean;
  ready: Promise<void>;
  dialog: Dialog | null;
  onDialog: ((d: Dialog) => void) | null;
}

interface Dialog {
  type: string;
  message: string;
}

export interface Hooks {
  db: () => DatabaseSync | null;
  probe: (entry: Record<string, unknown>) => void;
  urlChanged: (paneId: string, url: string) => void;
  commentPicked: (info: { pane_id: string; url: string; selector: string; html: string; crop: string }) => void;
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
  private asking = new Map<string, { key: string; cb: (ok: boolean) => void }>();

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
      const rows = db.prepare(
        `SELECT dev_port AS port FROM browser_pane WHERE project_id = ? AND dev_port IS NOT NULL
         UNION SELECT v.dev_port FROM variant v JOIN run r ON r.id = v.run_id WHERE r.project_id = ? AND v.dev_port > 0 AND v.status != 'discarded'`,
      ).all(projectId, projectId) as Array<{ port: number }>;
      for (const r of rows) owned.add(Number(r.port));
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
    return !!pane && !pane.row.id.startsWith(AGENT_PANE) && !pane.row.id.startsWith(BOARD_PANE);
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
      this.asking.set(id, { key, cb });
      const kinds = (details as { mediaTypes?: string[] }).mediaTypes;
      this.hooks.paneEvent({ kind: 'permission', pane_id: pane.row.id, id, origin, permission: perm === 'media' && kinds?.length ? kinds.join(' and ') : perm });
    });
    return ses;
  }

  /** Creates views for open pane rows it has not seen and closes views whose rows closed. */
  sync(rows: PaneRow[]): void {
    const open = new Map(rows.filter((r) => r.open).map((r) => [r.id, r]));
    for (const [id, pane] of this.panes) {
      if (id.startsWith(BOARD_PANE)) continue;
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
    const pane: Pane = { row, view, overlay, dbg: view.webContents.debugger, refs: new Map(), lastSnapshot: new Map(), console: [], network: new Map(), status: null, overlayShownUntil: 0, picking: null, parked: false, ready: Promise.resolve(), dialog: null, onDialog: null };
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
    try {
      pane.dbg.attach('1.3');
    } catch {}
    pane.dbg.on('message', (_e, method, params) => { this.onDebuggerEvent(pane, method, params).catch(() => {}); });
    await this.cmd(pane, 'Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    await this.cmd(pane, 'Network.enable', {});
    await this.cmd(pane, 'Runtime.enable', {});
    await this.cmd(pane, 'Page.enable', {});
    await this.cmd(pane, 'DOM.enable', {});
    this.layout();
    if (row.url) await this.load(pane, row.url).catch(() => {});
    this.layout();
  }

  private wireContents(pane: Pane): void {
    const wc = pane.view.webContents;
    const stop = (e: Electron.Event, url: string) => {
      if (!/^https?:/.test(url) && url !== 'about:blank') e.preventDefault();
    };
    wc.on('will-navigate', stop);
    wc.on('will-redirect', stop);
    wc.on('will-frame-navigate', (e) => stop(e as unknown as Electron.Event, e.url));
    wc.setWindowOpenHandler(({ url }) => {
      if (!/^https?:/.test(url)) return { action: 'deny' };
      if (this.isUserPane(pane)) this.hooks.openPane(pane.row.project_id, url);
      else void this.load(pane, url).catch(() => {});
      return { action: 'deny' };
    });
    wc.on('did-navigate', (_e, url, code) => {
      pane.status = code;
      pane.refs.clear();
      pane.lastSnapshot.clear();
      if (url !== 'about:blank') this.hooks.urlChanged(pane.row.id, url);
    });
    wc.on('did-navigate-in-page', (_e, url) => this.hooks.urlChanged(pane.row.id, url));
    const state = () => this.emitState(pane);
    for (const ev of ['did-start-loading', 'did-stop-loading', 'page-title-updated', 'did-navigate', 'did-navigate-in-page'] as const) wc.on(ev as 'did-start-loading', state);
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

  private emitState(pane: Pane): void {
    const wc = pane.view.webContents;
    if (wc.isDestroyed()) return;
    this.hooks.paneEvent({
      kind: 'state', pane_id: pane.row.id, url: wc.getURL(), title: wc.getTitle(), loading: wc.isLoading(),
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
      case 'reload': wc.reload(); break;
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
      pane.network.set(params.requestId, { at: Date.now(), method: params.request.method, url: params.request.url, status: null, bytes: 0 });
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
    try { pane.dbg.detach(); } catch {}
    this.win.contentView.removeChildView(pane.view);
    try { this.win.contentView.removeChildView(pane.overlay); } catch {}
    const ses = pane.view.webContents.session;
    pane.view.webContents.close();
    pane.overlay.webContents.close();
    if (id.startsWith(AGENT_PANE)) void ses.clearStorageData().catch(() => {});
    if (this.shown === id) this.shown = null;
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

  private node(pane: Pane, ref: unknown): number {
    const id = typeof ref === 'string' ? pane.refs.get(ref) : undefined;
    if (!id) throw new ToolError(-32602, `unknown ref ${String(ref)}; call snapshot first`);
    return id;
  }

  private async centre(pane: Pane, backendNodeId: number, ref?: unknown): Promise<{ x: number; y: number }> {
    const gone = new ToolError(-32602, `ref ${String(ref)} is no longer on the page; call snapshot again`);
    const { object } = await this.cmd(pane, 'DOM.resolveNode', { backendNodeId, executionContextId: await this.isolated(pane) }).catch(() => { throw gone; });
    const live = await this.cmd(pane, 'Runtime.callFunctionOn', { objectId: object.objectId, returnByValue: true, functionDeclaration: 'function () { return this.isConnected; }' });
    if (live.result?.value !== true) throw gone;
    await this.cmd(pane, 'DOM.scrollIntoViewIfNeeded', { backendNodeId }).catch(() => {});
    const box = await this.cmd(pane, 'DOM.getBoxModel', { backendNodeId }).catch(() => {
      throw new ToolError(-32602, `ref ${String(ref)} is not visible (it has no layout box)`);
    });
    const q: number[] = box.model.content;
    return { x: (q[0] + q[2] + q[4] + q[6]) / 4, y: (q[1] + q[3] + q[5] + q[7]) / 4 };
  }

  /** The point to click for a ref, after checking the element is enabled and is what a click there hits. */
  private async target(pane: Pane, ref: unknown): Promise<{ node: number; x: number; y: number }> {
    const node = this.node(pane, ref);
    const p = await this.centre(pane, node, ref);
    const { object } = await this.cmd(pane, 'DOM.resolveNode', { backendNodeId: node, executionContextId: await this.isolated(pane) });
    const r = await this.cmd(pane, 'Runtime.callFunctionOn', {
      objectId: object.objectId,
      returnByValue: true,
      arguments: [{ value: p.x }, { value: p.y }],
      functionDeclaration: `function (x, y) {
        const el = this.nodeType === 1 ? this : this.parentElement;
        if (!el) return null;
        if (el.disabled || el.closest('[aria-disabled="true"], fieldset:disabled')) return 'is disabled';
        const hits = (h) => !!h && (h === el || el.contains(h) || h.closest('label')?.control === el);
        const hit = document.elementFromPoint(x, y);
        if (hits(hit)) return null;
        for (const label of el.labels || []) {
          const b = label.getBoundingClientRect();
          const lx = b.left + b.width / 2, ly = b.top + b.height / 2;
          if (b.width && b.height && hits(document.elementFromPoint(lx, ly))) return { x: lx, y: ly };
        }
        if (!hit) return 'is outside the viewport';
        return 'is covered by <' + hit.tagName.toLowerCase() + (hit.id ? '#' + hit.id : '') + '>';
      }`,
    });
    const v = r.result?.value;
    if (typeof v === 'string') throw new ToolError(-32033, `ref ${String(ref)} ${v}; nothing was clicked`);
    return v && typeof v.x === 'number' ? { node, x: v.x, y: v.y } : { node, ...p };
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

  private async clickAt(pane: Pane, x: number, y: number): Promise<void> {
    await this.pointAt(pane, x, y);
    this.hooks.probe({ kind: 'click', pane: pane.row.id, x, y });
    await this.cmd(pane, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await this.cmd(pane, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await this.cmd(pane, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }

  private async isolated(pane: Pane): Promise<number> {
    const tree = await this.cmd(pane, 'Page.getFrameTree');
    const world = await this.cmd(pane, 'Page.createIsolatedWorld', { frameId: tree.frameTree.frame.id, worldName: 'metatrooper', grantUniveralAccess: false });
    return world.executionContextId;
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

  /** Accessibility tree lines; with `interactive`, only nodes carrying a ref plus the ancestors above them. */
  async snapshotLines(pane: Pane, maxNodes: number, interactive: boolean): Promise<string[]> {
    const { nodes } = await this.cmd(pane, 'Accessibility.getFullAXTree');
    const byId = new Map<string, any>(nodes.map((n: any) => [n.nodeId, n]));
    const root = nodes.find((n: any) => !n.parentId) ?? nodes[0];
    pane.refs.clear();
    const lines: string[] = [];
    let refN = 0;
    const walk = (n: any, depth: number) => {
      if (!n || lines.length >= maxNodes) return;
      const role = n.role?.value ?? '';
      const name = String(n.name?.value ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      const skip = n.ignored || role === 'none' || role === 'generic' || (role === 'StaticText' && !name) || role === 'InlineTextBox';
      let next = depth;
      if (!skip) {
        let line = `${'  '.repeat(depth)}${role}${name ? ` "${name}"` : ''}`;
        if (ACTIONABLE.has(role) && n.backendDOMNodeId) {
          const ref = `e${++refN}`;
          pane.refs.set(ref, n.backendDOMNodeId);
          line += ` [ref=${ref}]`;
          const value = n.value?.value;
          if (value !== undefined && value !== '') line += ` value="${String(value).slice(0, 80)}"`;
        }
        lines.push(line);
        next = depth + 1;
      }
      for (const c of n.childIds ?? []) walk(byId.get(c), next);
    };
    walk(root, 0);
    const stopped = lines.length >= maxNodes;
    let out = lines;
    if (interactive) {
      out = [];
      const stack: Array<{ depth: number; line: string; shown: boolean }> = [];
      for (const line of lines) {
        const depth = (line.length - line.trimStart().length) / 2;
        while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
        const entry = { depth, line, shown: false };
        if (line.includes(' [ref=e')) {
          for (const s of stack) if (!s.shown) { out.push(s.line); s.shown = true; }
          out.push(line);
          entry.shown = true;
        }
        stack.push(entry);
      }
    }
    if (stopped) out.push(`(stopped at ${maxNodes} nodes)`);
    return out;
  }

  /** Runs one metatrooper-browser tool on a pane. */
  async tool(id: string, name: string, a: Record<string, any>): Promise<unknown> {
    const pane = this.pane(id);
    await pane.ready;
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

  private async run(pane: Pane, name: string, a: Record<string, any>): Promise<unknown> {
    switch (name) {
      case 'navigate': {
        if (typeof a.url !== 'string') throw new ToolError(-32602, 'url is required');
        await this.load(pane, a.url);
        return { url: pane.view.webContents.getURL(), title: pane.view.webContents.getTitle(), status: pane.status };
      }
      case 'back': {
        const wc = pane.view.webContents;
        if (wc.navigationHistory.canGoBack()) {
          const stopped = new Promise<void>((resolve) => { wc.once('did-stop-loading', () => resolve()); wc.once('did-navigate-in-page', () => resolve()); setTimeout(resolve, 10_000); });
          wc.navigationHistory.goBack();
          await stopped;
        }
        return { url: wc.getURL() };
      }
      case 'snapshot': {
        const lines = await this.snapshotLines(pane, Math.max(10, Math.min(Number(a.max_nodes) || 400, 5000)), a.interactive === true);
        const key = `${String(a._session ?? '')}|${a.interactive === true ? 'i' : 'f'}`;
        const bare = (l: string) => l.replace(/ \[ref=e\d+\]/, '');
        const prev = pane.lastSnapshot.get(key);
        pane.lastSnapshot.set(key, new Set(lines.map(bare)));
        return { text: (a.since_last === true && prev ? lines.filter((l) => !prev.has(bare(l))) : lines).join('\n') };
      }
      case 'click': {
        const p = await this.target(pane, a.ref);
        await this.clickAt(pane, p.x, p.y);
        return { ok: true };
      }
      case 'type': {
        if (typeof a.text !== 'string') throw new ToolError(-32602, 'text is required');
        const { node, x, y } = await this.target(pane, a.ref);
        await this.clickAt(pane, x, y);
        await this.cmd(pane, 'DOM.focus', { backendNodeId: node }).catch(() => {});
        for (const type of ['keyDown', 'keyUp']) {
          await this.cmd(pane, 'Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65, ...(type === 'keyDown' ? { commands: ['selectAll'] } : {}) });
        }
        if (a.text) await this.cmd(pane, 'Input.insertText', { text: a.text });
        else {
          for (const type of ['keyDown', 'keyUp']) await this.cmd(pane, 'Input.dispatchKeyEvent', { type, key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 });
        }
        if (a.submit) {
          for (const type of ['keyDown', 'keyUp']) {
            await this.cmd(pane, 'Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
          }
        }
        return { ok: true };
      }
      case 'select': {
        const node = this.node(pane, a.ref);
        const p = await this.centre(pane, node, a.ref);
        await this.pointAt(pane, p.x, p.y);
        const { object } = await this.cmd(pane, 'DOM.resolveNode', { backendNodeId: node, executionContextId: await this.isolated(pane) });
        await this.cmd(pane, 'Runtime.callFunctionOn', {
          objectId: object.objectId,
          functionDeclaration: 'function (v) { this.value = v; this.dispatchEvent(new Event("input", { bubbles: true })); this.dispatchEvent(new Event("change", { bubbles: true })); }',
          arguments: [{ value: String(a.value ?? '') }],
        });
        return { ok: true };
      }
      case 'scroll': {
        if (a.ref) await this.cmd(pane, 'DOM.scrollIntoViewIfNeeded', { backendNodeId: this.node(pane, a.ref) });
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
          if (typeof a.ref === 'string' && pane.refs.has(a.ref)) {
            const ok = await this.cmd(pane, 'DOM.describeNode', { backendNodeId: pane.refs.get(a.ref) }).then(() => true, () => false);
            if (ok) return { found: true };
          }
          await sleep(200);
        }
        return { found: false };
      }
      case 'screenshot': {
        if (a.full_page) {
          const r = await this.fullPage(pane);
          return { png_base64: r.png.toString('base64'), truncated: r.truncated };
        }
        const shot = await this.cmd(pane, 'Page.captureScreenshot', { format: 'png' });
        return { png_base64: shot.data, truncated: false };
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
    for (const width of [390, 1280]) {
      await this.cmd(pane, 'Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 });
      await sleep(400);
      const shot = await this.fullPage(pane);
      const file = path.join(dir, `${stamp}-${label}-${width}.png`);
      fs.writeFileSync(file, shot.png);
      out[width] = file.split(String.fromCharCode(92)).join('/');
    }
    if (pane.parked) await this.cmd(pane, 'Emulation.setDeviceMetricsOverride', { ...PARKED_VIEWPORT, deviceScaleFactor: 1, mobile: false });
    else await this.cmd(pane, 'Emulation.clearDeviceMetricsOverride');
    return { url: pane.view.webContents.getURL(), w390_path: out[390], w1280_path: out[1280] };
  }

  /** Inspiration board: loads a URL in a parked pane with no database row, captures its first 1280 by 800 screen to outFile, then closes the pane. */
  async boardCapture(projectId: string, url: string, outFile: string): Promise<{ url: string; status: number | null }> {
    const id = `${BOARD_PANE}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    await this.create({ id, project_id: projectId, run_id: null, variant: null, session_id: null, url: null, dev_port: null, open: 1 });
    try {
      const pane = this.pane(id);
      await this.applyViewport(pane, true);
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_r, reject) => { timer = setTimeout(() => reject(new ToolError(-32099, `load timed out: ${url}`)), BOARD_LOAD_MS); });
      try {
        await Promise.race([this.load(pane, url), timeout]);
      } finally {
        clearTimeout(timer);
      }
      await sleep(BOARD_SETTLE_MS);
      const shot = await this.cmd(pane, 'Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, ...PARKED_VIEWPORT, scale: 1 } });
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, Buffer.from(shot.data, 'base64'));
      return { url: pane.view.webContents.getURL(), status: pane.status };
    } finally {
      this.destroy(id);
    }
  }

  /** Point-to-comment: the next element the user clicks in the pane is described and cropped. */
  async pick(id: string): Promise<void> {
    const pane = this.pane(id);
    await this.cmd(pane, 'Overlay.enable');
    await this.cmd(pane, 'Overlay.setInspectMode', {
      mode: 'searchForNode',
      highlightConfig: { showInfo: true, contentColor: { r: 47, g: 111, b: 228, a: 0.25 }, borderColor: { r: 47, g: 111, b: 228, a: 0.9 } },
    });
    const node = await new Promise<number>((resolve) => { pane.picking = resolve; });
    await this.cmd(pane, 'Overlay.setInspectMode', { mode: 'none', highlightConfig: {} });
    const html = String((await this.cmd(pane, 'DOM.getOuterHTML', { backendNodeId: node })).outerHTML ?? '').slice(0, 2000);
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
    this.hooks.commentPicked({ pane_id: id, url: pane.view.webContents.getURL(), selector: String(sel.result?.value ?? ''), html, crop: crop.data });
  }

  cancelPick(id: string): void {
    const pane = this.panes.get(id);
    if (!pane || !pane.picking) return;
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
