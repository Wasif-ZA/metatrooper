import test, { mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { connect } from 'node:net';
import { randomUUID } from 'node:crypto';

const home = mkdtempSync(join(tmpdir(), 'lent-pane-'));
const previous = process.env.METATROOPER_HOME;
process.env.METATROOPER_HOME = home;
after(() => { rmSync(home, { recursive: true, force: true }); if (previous === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = previous; });
const partitions = new Map<string, any>();
function fromPartition(name: string) {
  if (!partitions.has(name)) partitions.set(name, Object.assign(new EventEmitter(), {
    installs: { request: 0, check: 0, permission: 0 }, clears: 0,
    getUserAgent: () => 'Chrome/142.0.0.0 Electron/44.0.0', setUserAgent() {},
    webRequest: { onBeforeRequest(fn: any) { const s = partitions.get(name); s.installs.request++; s.before = fn; } },
    setPermissionCheckHandler(fn: any) { this.installs.check++; this.check = fn; },
    setPermissionRequestHandler(fn: any) { this.installs.permission++; this.permission = fn; },
    async clearStorageData() { this.clears++; },
  }));
  return partitions.get(name);
}
mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: { fromPartition }, WebContentsView: class {} } });
const { PaneManager } = await import('../../src/browser/panes.ts');
const { startBrowserServer } = await import('../../src/browser/server.ts');
const { setSetting } = await import('../../../core/src/settings.ts');

function harness(first = 'user') {
  partitions.clear();
  setSetting('browser', 'lent', { A: ['https://93.184.216.34'], B: [] });
  const db = new DatabaseSync(':memory:');
  db.exec("CREATE TABLE project (id TEXT PRIMARY KEY, path TEXT); CREATE TABLE session (id TEXT PRIMARY KEY, pid INTEGER, project_id TEXT, ended_at TEXT); CREATE TABLE session_dev_server (session_id TEXT, port INTEGER, status TEXT); INSERT INTO project VALUES ('A','/synthetic/a'),('B','/synthetic/b');");
  const pm = new PaneManager({ isDestroyed: () => false, contentView: { removeChildView() {} }, webContents: { focus() {} } } as never, { db: () => db, paneEvent() {}, urlChanged() {}, openPane() {} } as never);
  const internal = pm as any;
  const make = (id: string, project: string, lent: number, session: string | null) => {
    const loaded: string[] = [], commands: string[] = [];
    const wc = Object.assign(new EventEmitter(), {
      id: id === 'bp_agent_lent' ? 42 : 43, getURL: () => 'https://93.184.216.34/', getTitle: () => 'synthetic', isDestroyed: () => false,
      isLoading: () => false, isLoadingMainFrame: () => false, getZoomFactor: () => 1,
      navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      loadURL: async (url: string) => { loaded.push(url); }, close() {},
      setWindowOpenHandler(fn: any) { this.openWindow = fn; }, openWindow: null as any, session: null as any,
    });
    const pane = {
      row: { id, project_id: project, session_id: session, lent, open: 1 }, view: { webContents: wc }, overlay: { webContents: { isDestroyed: () => true } },
      dbg: { detach() {}, sendCommand: async (method: string) => { commands.push(method); return {}; } },
      refs: { byRef: new Map(), byKey: new Map() }, lastSnapshot: new Map(), cursors: new Map(), worlds: new Map(), docs: new Map(), network: new Map(), console: [], pickStack: [], popups: new Set(), typed: new Set(),
      navs: 0, reconnected: false, detachedAt: 0, handoff: null, errorFor: null, crashed: null, secretOnPage: false, scripted: false, handedBack: false, handBackNext: false, dialog: null, clickedAt: 0, ready: Promise.resolve(),
    };
    internal.panes.set(id, pane);
    internal.wireContents(pane);
    return { pane, wc, loaded, commands };
  };
  const user = make('bp_user', 'A', 0, null);
  const lent = make('bp_agent_lent', 'A', 1, 'sA');
  const ordinary = make('bp_agent_plain', 'A', 0, 'sA');
  const other = make('bp_agent_other', 'B', 1, 'sB');
  const order = first === 'lent' ? [lent, user, ordinary, other] : [user, lent, ordinary, other];
  for (const h of order) h.wc.session = internal.guardPartition(h.pane.row);
  const request = (h: typeof lent, url: string, resourceType = 'mainFrame') => new Promise<any>(resolve => h.wc.session.before({ url, resourceType, webContents: h.wc }, resolve));
  return { pm, internal, db, user, lent, ordinary, other, request, close() { db.close(); } };
}

for (const first of ['user', 'lent']) test('kept partition handlers install once with ' + first + ' created first', async () => {
  const h = harness(first);
  try {
    h.internal.guardPartition(h.lent.pane.row);
    assert.deepEqual([...partitions.keys()].sort(), ['persist:troop-A', 'persist:troop-B', 'troop-A-bp_agent_plain']);
    assert.equal(h.user.wc.session, h.lent.wc.session);
    assert.deepEqual(h.lent.wc.session.installs, { request: 1, check: 1, permission: 1 });
    assert.equal(h.lent.wc.session.listenerCount('will-download'), 1);
    assert.deepEqual(await h.request(h.user, 'https://1.1.1.1/unlent'), { cancel: false });
    assert.deepEqual(await h.request(h.lent, 'https://1.1.1.1/unlent'), { cancel: true });
  } finally { h.close(); }
});

test('lent frame redirects and subframes are fenced by project, scheme and live revocation', async () => {
  const h = harness();
  try {
    assert.deepEqual(await h.request(h.lent, 'https://93.184.216.34/start'), { cancel: false });
    assert.deepEqual(await h.request(h.lent, 'https://1.1.1.1/redirect'), { cancel: true });
    assert.deepEqual(await h.request(h.lent, 'https://1.1.1.1/frame', 'subFrame'), { cancel: true });
    assert.deepEqual(await h.request(h.lent, 'https://93.184.216.34/frame', 'subFrame'), { cancel: false });
    assert.deepEqual(await h.request(h.lent, 'http://93.184.216.34/'), { cancel: true });
    assert.deepEqual(await h.request(h.other, 'https://93.184.216.34/'), { cancel: true });
    setSetting('browser', 'lent', {});
    assert.deepEqual(await h.request(h.lent, 'https://93.184.216.34/next'), { cancel: true });
    assert.deepEqual(await h.request(h.user, 'https://93.184.216.34/next'), { cancel: false });
  } finally { h.close(); }
});

test('lent public subresources pass the normal address policy while private addresses remain blocked', async () => {
  const h = harness();
  try {
    for (const type of ['script', 'image', 'xhr']) assert.deepEqual(await h.request(h.lent, 'https://1.1.1.1/resource', type), { cancel: false });
    setSetting('browser', 'lent', { A: ['http://192.168.1.2'] });
    assert.deepEqual(await h.request(h.lent, 'http://192.168.1.2/', 'mainFrame'), { cancel: true });
    assert.deepEqual(await h.request(h.lent, 'http://192.168.1.2/x', 'image'), { cancel: true });
  } finally { h.close(); }
});

test('agent navigate to an unlent origin fails before loading and evaluate runs no code', async () => {
  const h = harness();
  try {
    h.internal.answer = async (_pane: any, _session: any, action: any) => action();
    await assert.rejects(h.pm.tool('bp_agent_lent', 'navigate', { url: 'https://1.1.1.1/' }), (e: any) => e.code === -32031);
    assert.deepEqual(h.lent.loaded, []);
    await h.pm.tool('bp_agent_lent', 'navigate', { url: 'https://93.184.216.34/path' });
    assert.deepEqual(h.lent.loaded, ['https://93.184.216.34/path']);
    await assert.rejects(h.pm.tool('bp_agent_lent', 'evaluate', { expression: 'document.cookie' }), (e: any) => e.code === -32038);
    assert.deepEqual(h.lent.commands, []);
    assert.equal(h.lent.pane.scripted, false);
  } finally { h.close(); }
});

test('lent new-window loads inside the pane and never permits a popup', async () => {
  const h = harness();
  try {
    h.lent.pane.clickedAt = Date.now();
    assert.deepEqual(h.lent.wc.openWindow({ url: 'https://93.184.216.34/popup', disposition: 'new-window' }), { action: 'deny' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.lent.loaded, ['https://93.184.216.34/popup']);
    h.lent.pane.clickedAt = Date.now();
    assert.deepEqual(h.lent.wc.openWindow({ url: 'https://1.1.1.1/popup', disposition: 'new-window' }), { action: 'deny' });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(h.lent.loaded, ['https://93.184.216.34/popup']);
  } finally { h.close(); }
});

test('closing lent and user panes preserves kept storage and closing ordinary agents clears storage', async () => {
  const h = harness();
  try {
    h.internal.destroy('bp_agent_lent'); h.internal.destroy('bp_user'); h.internal.destroy('bp_agent_plain');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.lent.wc.session.clears, 0);
    assert.equal(h.ordinary.wc.session.clears, 1);
  } finally { h.close(); }
});

test('lent and ordinary agent panes refuse downloads and permission requests', () => {
  const h = harness();
  try {
    for (const pane of [h.lent, h.ordinary]) {
      let prevented = 0;
      pane.wc.session.emit('will-download', { preventDefault() { prevented++; } }, {}, pane.wc);
      assert.equal(prevented, 1);
      for (const permission of ['media', 'geolocation', 'notifications', 'clipboard-read']) {
        assert.equal(pane.wc.session.check(pane.wc, permission, 'https://93.184.216.34'), false);
        let decision: unknown;
        pane.wc.session.permission(pane.wc, permission, (v: boolean) => { decision = v; }, { requestingUrl: 'https://93.184.216.34/' });
        assert.equal(decision, false);
      }
    }
  } finally { h.close(); }
});

async function serverHarness(project: string | null = 'A') {
  setSetting('browser', 'lent', { A: ['https://93.184.216.34'] });
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE session (id TEXT PRIMARY KEY,pid INTEGER,project_id TEXT,ended_at TEXT); CREATE TABLE browser_pane (id TEXT PRIMARY KEY,project_id TEXT,session_id TEXT,url TEXT,dev_port INTEGER,open INTEGER,lent INTEGER);');
  db.prepare('INSERT INTO session VALUES (?, ?, ?, NULL)').run('sA', process.pid, project);
  const opened: any[] = [], asked: any[] = [], tools: any[] = [];
  const path = process.platform === 'win32' ? '\\\\.\\pipe\\lent-' + randomUUID() : join(tmpdir(), 'lent-' + randomUUID() + '.sock');
  const server = await startBrowserServer(path, {
    db: () => db, uiKey: () => null, refreshPanes() {},
    panes: { has: () => true, origin: () => 'https://93.184.216.34', tool: async (...args: any[]) => { tools.push(args); return { ok: true }; } } as never,
    askLend: async (...args: any[]) => { asked.push(args); },
    openPane: async (...args: any[]) => {
      opened.push(args);
      db.prepare('INSERT INTO browser_pane VALUES (?, ?, ?, ?, NULL, 1, ?)').run('bp_agent_new', args[0], args[1], args[2] ?? null, args.length === 3 ? 1 : 0);
      return 'bp_agent_new';
    },
  });
  const socket = connect(path);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  let buffer = '';
  const pending = new Map<string, (r: any) => void>();
  socket.setEncoding('utf8');
  socket.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { const r = JSON.parse(buffer.slice(0, i)); buffer = buffer.slice(i + 1); pending.get(r.id)?.(r); pending.delete(r.id); } });
  const call = (method: string, params: object) => new Promise<any>((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('RPC timeout')); }, 5000);
    pending.set(id, r => { clearTimeout(timer); resolve(r); });
    socket.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  assert.equal((await call('browser.hello', { session_id: 'sA', pid: process.pid })).result.bound, 'session');
  return { db, opened, asked, tools, call, async close() { socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); } };
}

test('signed_in asks once per rejected navigate and names the normalised origin without opening', async () => {
  const h = await serverHarness();
  try {
    const result = await h.call('browser.navigate', { url: 'https://1.1.1.1/path', signed_in: true });
    assert.equal(result.error.code, -32031);
    assert.match(result.error.message, /https:\/\/1\.1\.1\.1/);
    assert.deepEqual(h.asked, [['sA', 'https://1.1.1.1']]);
    assert.deepEqual(h.opened, []); assert.deepEqual(h.tools, []);
  } finally { await h.close(); }
});

test('signed_in opens with its URL then reuses the sessions open lent pane', async () => {
  const h = await serverHarness();
  try {
    h.db.exec("INSERT INTO browser_pane VALUES ('bp_agent_plain','A','sA',NULL,NULL,1,0),('bp_agent_closed','A','sA',NULL,NULL,0,1),('bp_agent_foreign','A','sB',NULL,NULL,1,1)");
    assert.deepEqual((await h.call('browser.navigate', { url: 'https://93.184.216.34/start', signed_in: true })).result, { ok: true });
    assert.deepEqual(h.opened, [['A', 'sA', 'https://93.184.216.34/start']]);
    assert.deepEqual((await h.call('browser.navigate', { url: 'https://93.184.216.34/next', signed_in: true })).result, { ok: true });
    assert.equal(h.opened.length, 1);
    assert.deepEqual(h.tools.map(t => t[0]), ['bp_agent_new', 'bp_agent_new']);
    assert.deepEqual(h.asked, []);
  } finally { await h.close(); }
});

test('signed_in validates protocol and project and isolates projects', async () => {
  for (const project of ['A', 'B', null]) {
    const h = await serverHarness(project);
    try {
      for (const url of ['file:///tmp/x', 'data:text/html,x', 'ftp://93.184.216.34', 'broken']) assert.equal((await h.call('browser.navigate', { url, signed_in: true })).error.code, -32602);
      const r = await h.call('browser.navigate', { url: 'https://93.184.216.34/', signed_in: true });
      if (project === null) assert.equal(r.error.code, -32602);
      else if (project === 'B') { assert.equal(r.error.code, -32031); assert.deepEqual(h.asked, [['sA', 'https://93.184.216.34']]); }
      else assert.deepEqual(r.result, { ok: true });
      if (project !== 'A') assert.deepEqual(h.opened, []);
    } finally { await h.close(); }
  }
});

test('ordinary navigate opens with two arguments and explicit pane_id keeps its ordinary routing', async () => {
  const h = await serverHarness();
  try {
    assert.deepEqual((await h.call('browser.navigate', { url: 'https://1.1.1.1/' })).result, { ok: true });
    assert.deepEqual(h.opened, [['A', 'sA']]);
    assert.deepEqual((await h.call('browser.navigate', { pane_id: 'bp_agent_new', url: 'https://1.1.1.1/', signed_in: true })).result, { ok: true });
    assert.equal(h.opened.length, 1); assert.deepEqual(h.asked, []);
  } finally { await h.close(); }
});


test('lent frame requests without a WebContents fail closed', async () => {
  const h = harness();
  try {
    const result = await new Promise<any>(resolve => h.lent.wc.session.before({ url: 'https://1.1.1.1/unlent', resourceType: 'mainFrame', webContentsId: 42 }, resolve));
    assert.deepEqual(result, { cancel: true });
  } finally { h.close(); }
});

test('lent subframes cannot bypass the origin fence with data URLs', async () => {
  const h = harness();
  try {
    assert.deepEqual(await h.request(h.lent, 'data:text/html,<script>1</script>', 'subFrame'), { cancel: true });
  } finally { h.close(); }
});


for (const first of ['user', 'lent']) test('user popup frames escape the lent fence with ' + first + ' created first', async () => {
  const h = harness(first);
  try {
    const popupContents = { id: 9001 };
    const popup = { isDestroyed: () => false, webContents: popupContents };
    h.user.pane.popups.add(popup);
    assert.equal([...h.internal.panes.values()].some((p: any) => p.view.webContents === popupContents), false);
    assert.equal(h.internal.byContents(popupContents), undefined);
    for (const resourceType of ['mainFrame', 'subFrame']) {
      const result = await new Promise<any>(resolve => h.user.wc.session.before({
        url: 'https://1.1.1.1/unlent', resourceType, webContents: popupContents,
      }, resolve));
      assert.deepEqual(result, { cancel: false });
    }
    assert.deepEqual(await h.request(h.lent, 'https://1.1.1.1/unlent'), { cancel: true });
  } finally { h.close(); }
});

test('frame requests with unknown WebContents and no popup owner fail closed', async () => {
  const h = harness();
  try {
    for (const resourceType of ['mainFrame', 'subFrame']) {
      const result = await new Promise<any>(resolve => h.lent.wc.session.before({
        url: 'https://1.1.1.1/unlent', resourceType, webContents: { id: 9002 },
      }, resolve));
      assert.deepEqual(result, { cancel: true });
    }
  } finally { h.close(); }
});
