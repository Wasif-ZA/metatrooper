import { mock } from 'node:test';
import { EventEmitter } from 'node:events';

mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: {}, WebContentsView: class {} } });
const { PaneManager, errorPage } = await import('../../src/browser/panes.ts');

const urlChanged: string[] = [];
const opened: string[] = [];
const picked: Array<{ depth: number; selector: string }> = [];
const events: Array<Record<string, unknown>> = [];
const win = { isDestroyed: () => false, contentView: { children: [] as unknown[], addChildView() {}, removeChildView() {} }, webContents: { focus() {} } };
const pm = new PaneManager(win as never, {
  db: () => null,
  probe() {},
  urlChanged: (_id: string, url: string) => urlChanged.push(url),
  commentPicked: (info: { depth: number; selector: string }) => picked.push({ depth: info.depth, selector: info.selector }),
  paneEvent: (ev: Record<string, unknown>) => events.push(ev),
  openPane: (_p: string, url: string) => opened.push(url),
} as never);
const internal = pm as unknown as { panes: Map<string, any>; wireContents(p: unknown): void; clickAt(p: unknown, x: number, y: number): Promise<void> };

const parents: Record<number, number | null> = { 10: 20, 20: 30, 30: null };
const sendCommand = async (method: string, p: Record<string, any> = {}) => {
  if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F' } } };
  if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 };
  if (method === 'DOM.resolveNode') return { object: { objectId: `o${p.backendNodeId}` } };
  if (method === 'Runtime.callFunctionOn') {
    const n = Number(String(p.objectId).slice(1));
    if (String(p.functionDeclaration).includes('documentElement')) return parents[n] ? { result: { objectId: `o${parents[n]}` } } : { result: { type: 'object', subtype: 'null', value: null } };
    return { result: { value: `sel${n}` } };
  }
  if (method === 'DOM.describeNode') return { node: { backendNodeId: Number(String(p.objectId).slice(1)) } };
  if (method === 'DOM.getOuterHTML') return { outerHTML: '<x></x>' };
  if (method === 'DOM.getBoxModel') return { model: { border: [0, 0, 10, 0, 10, 10, 0, 10] } };
  if (method === 'Page.captureScreenshot') return { data: 'AA' };
  return {};
};

const fakePane = (id: string) => {
  const wc = Object.assign(new EventEmitter(), {
    url: 'https://start.example/',
    loads: [] as string[],
    openHandler: null as null | ((d: { url: string; disposition: string }) => any),
    reloads: 0,
    isDestroyed: () => false,
    getURL() { return this.url; },
    getTitle: () => 't',
    isLoading: () => false,
    getZoomFactor: () => 1,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    setWindowOpenHandler(h: any) { this.openHandler = h; },
    loadURL(u: string) { this.loads.push(u); return Promise.resolve(); },
    reload() { this.reloads++; },
    close() {},
    session: { clearStorageData: async () => {} },
  });
  const pane = {
    row: { id, project_id: 'proj' }, view: { webContents: wc }, overlay: { webContents: { isDestroyed: () => true, send() {}, executeJavaScript: async () => null } },
    dbg: { sendCommand, detach() {} }, refs: { byRef: new Map(), byKey: new Map() }, lastSnapshot: new Map(), cursors: new Map(), navs: 0, crashed: null as string | null, console: [] as Array<{ text: string }>,
    picking: null, dialog: null, errorFor: null as string | null, clickedAt: 0, popups: new Set(), pickStack: [] as number[], ready: Promise.resolve(),
  };
  internal.panes.set(id, pane);
  internal.wireContents(pane);
  return { pane, wc };
};

const r: Record<string, boolean> = {};
const { pane, wc } = fakePane('bp_user');

r.noClickDenied = wc.openHandler!({ url: 'https://ad.example/', disposition: 'foreground-tab' }).action === 'deny' && opened.length === 0 && pane.console.some((c) => c.text.includes('without a click'));
wc.emit('input-event', {}, { type: 'mouseDown' });
r.clickOpensOnePane = wc.openHandler!({ url: 'https://docs.example/', disposition: 'foreground-tab' }).action === 'deny' && opened.join() === 'https://docs.example/';
r.secondOpenNeedsAnotherClick = wc.openHandler!({ url: 'https://ad.example/2', disposition: 'foreground-tab' }).action === 'deny' && opened.length === 1;

const agent = fakePane('bp_agent_1');
await internal.clickAt(agent.pane, 1, 1);
const agentOpen = agent.wc.openHandler!({ url: 'https://ad.example/3', disposition: 'foreground-tab' });
r.agentClickCounts = agentOpen.action === 'deny' && agent.pane.clickedAt === 0 && !agent.pane.console.some((c) => c.text.includes('without a click'));

wc.emit('input-event', {}, { type: 'mouseUp' });
const popup = wc.openHandler!({ url: 'https://login.example/oauth', disposition: 'new-window' });
r.popupKeepsOpener = popup.action === 'allow' && popup.overrideBrowserWindowOptions.parent === win && popup.overrideBrowserWindowOptions.webPreferences.sandbox === true && popup.overrideBrowserWindowOptions.webPreferences.nodeIntegration === false;
const childWc = Object.assign(new EventEmitter(), { openHandler: null as any, setWindowOpenHandler(h: any) { this.openHandler = h; }, getURL: () => 'https://login.example/oauth' });
let childClosed = false;
const child = Object.assign(new EventEmitter(), { webContents: childWc, isDestroyed: () => childClosed, close() { childClosed = true; this.emit('closed'); } });
wc.emit('did-create-window', child);
let fileNav = false;
childWc.emit('will-navigate', { preventDefault() { fileNav = true; } }, 'file:///C:/secret.txt');
let webNav = false;
childWc.emit('will-navigate', { preventDefault() { webNav = true; } }, 'https://login.example/callback');
r.popupGuarded = fileNav && !webNav && childWc.openHandler({ url: 'https://x.example/' }).action === 'deny' && pane.popups.has(child);

wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://nowhere.invalid/', true);
const page = decodeURIComponent(wc.loads.at(-1)!);
r.loadErrorPage = wc.loads.at(-1)!.startsWith('data:text/html') && page.includes('This page did not load') && page.includes('https://nowhere.invalid/') && page.includes('ERR_NAME_NOT_RESOLVED');
const before = urlChanged.length;
wc.url = wc.loads.at(-1)!;
wc.emit('did-navigate', {}, wc.url, 200);
events.length = 0;
wc.emit('did-stop-loading');
r.errorPageKeepsUrl = urlChanged.length === before && pane.errorFor === 'https://nowhere.invalid/' && events.at(-1)?.url === 'https://nowhere.invalid/';

wc.emit('did-fail-load', {}, -202, 'ERR_CERT_AUTHORITY_INVALID', 'https://self-signed.example/', true);
r.certificatePage = decodeURIComponent(wc.loads.at(-1)!).includes('This page is not secure');
wc.emit('did-fail-load', {}, -20, 'ERR_BLOCKED_BY_CLIENT', 'http://10.0.0.5/', true);
r.blockedPage = decodeURIComponent(wc.loads.at(-1)!).includes('MetaTrooper blocked this page');
const n = wc.loads.length;
wc.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://a.example/', true);
wc.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://frame.invalid/', false);
r.abortAndSubframeIgnored = wc.loads.length === n;

wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
r.crashPage = pane.crashed !== null && decodeURIComponent(wc.loads.at(-1)!).includes('This page crashed');

pane.crashed = null;
pane.errorFor = 'https://93.184.216.34/';
const loadsBefore = wc.loads.length;
pm.act('bp_user', 'reload');
await new Promise((res) => setTimeout(res, 50));
r.reloadRetriesFailedUrl = wc.reloads === 0 && wc.loads.slice(loadsBefore).includes('https://93.184.216.34/');

const evil = errorPage('load', 'https://x.example/"><script>alert(1)</script>', '<img src=x onerror=alert(1)>');
r.errorPageEscapes = !evil.includes('<script>alert') && !evil.includes('<img src=x');

pane.pickStack = [10];
r.walkUp = (await pm.walkPick('bp_user', 'up')) && pane.pickStack.join() === '10,20' && picked.at(-1)?.depth === 1 && picked.at(-1)?.selector === 'sel20';
await pm.walkPick('bp_user', 'up');
r.walkStopsBelowHtml = !(await pm.walkPick('bp_user', 'up')) && pane.pickStack.join() === '10,20,30';
r.walkDown = (await pm.walkPick('bp_user', 'down')) && pane.pickStack.join() === '10,20' && picked.at(-1)?.selector === 'sel20';
await pm.walkPick('bp_user', 'down');
r.walkDownAtClickedIsNoop = !(await pm.walkPick('bp_user', 'down')) && pane.pickStack.join() === '10';

pm.closeAll();
r.popupClosesWithPane = childClosed && pane.popups.size === 0;

console.log(JSON.stringify(r));
process.exit(0);
