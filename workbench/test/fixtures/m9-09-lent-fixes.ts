import test, { mock, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const home = mkdtempSync(join(tmpdir(), 'lent-fixes-'));
const previous = process.env.METATROOPER_HOME;
process.env.METATROOPER_HOME = home;
after(() => {
  rmSync(home, { recursive: true, force: true });
  if (previous === undefined) delete process.env.METATROOPER_HOME;
  else process.env.METATROOPER_HOME = previous;
});

const partitions = new Map<string, any>();
function fromPartition(name: string) {
  if (!partitions.has(name)) {
    partitions.set(
      name,
      Object.assign(new EventEmitter(), {
        installs: { request: 0, check: 0, permission: 0 },
        clears: 0,
        getUserAgent: () => 'Chrome/142.0.0.0 Electron/44.0.0',
        setUserAgent() {},
        webRequest: {
          onBeforeRequest(fn: any) {
            const s = partitions.get(name);
            s.installs.request++;
            s.before = fn;
          },
          onBeforeSendHeaders(fn: any) {
            const s = partitions.get(name);
            s.beforeSendHeaders = fn;
          },
          onHeadersReceived(fn: any) {
            const s = partitions.get(name);
            s.headersReceived = fn;
          },
        },
        setPermissionCheckHandler(fn: any) {
          this.installs.check++;
          this.check = fn;
        },
        setPermissionRequestHandler(fn: any) {
          this.installs.permission++;
          this.permission = fn;
        },
        async clearStorageData() {
          this.clears++;
        },
      }),
    );
  }
  return partitions.get(name);
}

mock.module('electron', {
  exports: {
    app: { getPath: () => join(home, 'downloads') },
    clipboard: {},
    Menu: {},
    nativeImage: {},
    session: { fromPartition },
    WebContentsView: class {},
  },
});

const { PaneManager } = await import('../../src/browser/panes.ts');
const { setSetting } = await import('../../../core/src/settings.ts');

function harness() {
  partitions.clear();
  setSetting('browser', 'lent', { A: ['https://lent.example'], B: [] });
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, path TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, pid INTEGER, project_id TEXT, ended_at TEXT);
    CREATE TABLE session_dev_server (session_id TEXT, port INTEGER, status TEXT);
    CREATE TABLE browser_pane (id TEXT PRIMARY KEY, project_id TEXT, session_id TEXT, url TEXT, open INTEGER, lent INTEGER);
    INSERT INTO project VALUES ('A','/synthetic/a'),('B','/synthetic/b');
    INSERT INTO session VALUES ('sA', 1, 'A', NULL), ('sB', 2, 'B', NULL);`);

  const events: any[] = [];
  const notes: Array<{ paneId: string; text: string }> = [];
  const pm = new PaneManager(
    { isDestroyed: () => false, contentView: { removeChildView() {} }, webContents: { focus() {} } } as never,
    {
      db: () => db,
      paneEvent(e: any) { events.push(e); },
      note(paneId: string, text: string) { notes.push({ paneId, text }); },
      urlChanged() {},
      openPane() {},
      probe() {},
    } as never,
  );
  const internal = pm as any;

  const make = (id: string, project: string, lent: number, session: string | null) => {
    const loaded: string[] = [];
    const commands: string[] = [];
    const commandCalls: Array<{ method: string; params?: any }> = [];
    const wc = Object.assign(new EventEmitter(), {
      id: id === 'bp_agent_lent' ? 42 : id === 'bp_user' ? 41 : 43,
      getURL: () => 'https://lent.example/',
      getTitle: () => 'synthetic',
      isDestroyed: () => false,
      isLoading: () => false,
      isLoadingMainFrame: () => false,
      getZoomFactor: () => 1,
      navigationHistory: { canGoBack: () => false, canGoForward: () => false },
      loadURL: async (url: string) => { loaded.push(url); },
      close() {},
      setWindowOpenHandler(fn: any) { this.openWindow = fn; },
      openWindow: null as any,
      session: null as any,
      stopFindInPage() {},
    });
    const pane = {
      row: { id, project_id: project, session_id: session, lent, open: 1 },
      view: { webContents: wc },
      overlay: { webContents: { isDestroyed: () => true } },
      dbg: {
        detach() {},
        sendCommand: async (method: string, params?: any) => {
          commands.push(method);
          commandCalls.push({ method, params });
          return {};
        },
      },
      refs: { byRef: new Map(), byKey: new Map() },
      lastSnapshot: new Map(),
      cursors: new Map(),
      worlds: new Map(),
      docs: new Map(),
      network: new Map<string, any>(),
      console: [] as any[],
      pickStack: [],
      popups: new Set(),
      typed: new Set(),
      navs: 0,
      reconnected: false,
      detachedAt: 0,
      handoff: null as string | null,
      errorFor: null,
      crashed: null,
      secretOnPage: false,
      scripted: false,
      handedBack: false,
      handBackNext: false,
      dialog: null as any,
      clickedAt: 0,
      ready: Promise.resolve(),
    };
    internal.panes.set(id, pane);
    internal.wireContents(pane);
    return { pane, wc, loaded, commands, commandCalls };
  };

  const user = make('bp_user', 'A', 0, null);
  const lent = make('bp_agent_lent', 'A', 1, 'sA');
  const ordinary = make('bp_agent_plain', 'A', 0, 'sA');
  const userB = make('bp_user_b', 'B', 0, null);

  db.prepare('INSERT INTO browser_pane VALUES (?, ?, ?, ?, 1, ?)').run(user.pane.row.id, 'A', null, 'https://example.com', 0);
  db.prepare('INSERT INTO browser_pane VALUES (?, ?, ?, ?, 1, ?)').run(lent.pane.row.id, 'A', 'sA', 'https://lent.example', 1);
  db.prepare('INSERT INTO browser_pane VALUES (?, ?, ?, ?, 1, ?)').run(userB.pane.row.id, 'B', null, 'https://example.com', 0);

  for (const h of [user, lent, ordinary, userB]) {
    h.wc.session = internal.guardPartition(h.pane.row);
  }

  const sendHeaders = (session: any, details: any) =>
    new Promise<any>((resolve) => session.beforeSendHeaders(details, resolve));
  const recvHeaders = (session: any, details: any) =>
    new Promise<any>((resolve) => session.headersReceived(details, resolve));
  const sendRequest = (session: any, details: any) =>
    new Promise<any>((resolve) => session.before(details, resolve));

  return {
    pm,
    internal,
    db,
    events,
    notes,
    user,
    lent,
    ordinary,
    userB,
    sendHeaders,
    recvHeaders,
    sendRequest,
    close() { db.close(); },
  };
}

function triggerGiveBack(internal: any, pane: any) {
  const proto = Object.getPrototypeOf(internal);
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (typeof internal[name] === 'function') {
      const src = internal[name].toString();
      if (src.includes('give-back')) {
        try {
          internal[name](pane, 'give-back');
          if (pane.console.length === 0) return;
        } catch {}
        try {
          internal[name](pane.row.id, 'give-back');
          if (pane.console.length === 0) return;
        } catch {}
      }
    }
  }
}

// Tests off-list request from a lent pane strips Cookie, cookie, and Authorization while keeping other headers.
test('off-list request from lent pane: Cookie, cookie and Authorization stripped, other headers kept', async () => {
  const h = harness();
  try {
    const res = await h.sendHeaders(h.lent.wc.session, {
      url: 'https://offlist.example/api',
      requestHeaders: {
        Cookie: 'session=1',
        cookie: 'lower=2',
        Authorization: 'Bearer token123',
        Accept: 'application/json',
        'X-Trace': 'trace-1',
      },
      webContents: h.lent.wc,
    });
    assert.deepEqual(res, {
      requestHeaders: {
        Accept: 'application/json',
        'X-Trace': 'trace-1',
      },
    });
  } finally {
    h.close();
  }
});

// Tests lent-origin request from a lent pane keeps Cookie and Authorization headers.
test('lent-origin request from lent pane: Cookie and Authorization kept', async () => {
  const h = harness();
  try {
    const res = await h.sendHeaders(h.lent.wc.session, {
      url: 'https://lent.example/api',
      requestHeaders: {
        Cookie: 'session=1',
        Authorization: 'Bearer token123',
        Accept: 'application/json',
      },
      webContents: h.lent.wc,
    });
    assert.deepEqual(res, {
      requestHeaders: {
        Cookie: 'session=1',
        Authorization: 'Bearer token123',
        Accept: 'application/json',
      },
    });
  } finally {
    h.close();
  }
});

// Tests wss requests map to https so lent host keeps cookies while off-list host loses cookies.
test('wss to lent host keeps cookies and wss to off-list host loses cookies', async () => {
  const h = harness();
  try {
    const lentWs = await h.sendHeaders(h.lent.wc.session, {
      url: 'wss://lent.example/socket',
      requestHeaders: {
        Cookie: 'sid=lent_token',
        'Sec-WebSocket-Key': 'key1',
      },
      webContents: h.lent.wc,
    });
    assert.deepEqual(lentWs, {
      requestHeaders: {
        Cookie: 'sid=lent_token',
        'Sec-WebSocket-Key': 'key1',
      },
    });

    const offWs = await h.sendHeaders(h.lent.wc.session, {
      url: 'wss://offlist.example/socket',
      requestHeaders: {
        Cookie: 'sid=off_token',
        'Sec-WebSocket-Key': 'key2',
      },
      webContents: h.lent.wc,
    });
    assert.deepEqual(offWs, {
      requestHeaders: {
        'Sec-WebSocket-Key': 'key2',
      },
    });
  } finally {
    h.close();
  }
});

// Tests off-list response drops Set-Cookie and Set-Cookie2 while lent-origin response keeps Set-Cookie.
test('off-list response drops Set-Cookie and Set-Cookie2 while lent-origin response keeps Set-Cookie', async () => {
  const h = harness();
  try {
    const offResp = await h.recvHeaders(h.lent.wc.session, {
      url: 'https://offlist.example/login',
      responseHeaders: {
        'Set-Cookie': ['token=bad; Path=/'],
        'Set-Cookie2': ['token2=bad; Path=/'],
        'Content-Type': ['text/html'],
      },
      webContents: h.lent.wc,
    });
    assert.deepEqual(offResp, {
      responseHeaders: {
        'Content-Type': ['text/html'],
      },
    });

    const lentResp = await h.recvHeaders(h.lent.wc.session, {
      url: 'https://lent.example/login',
      responseHeaders: {
        'Set-Cookie': ['token=good; Path=/'],
        'Content-Type': ['text/html'],
      },
      webContents: h.lent.wc,
    });
    assert.deepEqual(lentResp, {});
  } finally {
    h.close();
  }
});

// Tests user pane with no lent pane open in project keeps all headers untouched.
test('user pane with no lent pane open in project keeps all headers untouched', async () => {
  const h = harness();
  try {
    const userReq = await h.sendHeaders(h.userB.wc.session, {
      url: 'https://any.example/data',
      requestHeaders: {
        Cookie: 'user=active',
        Authorization: 'Basic auth',
        'X-Key': 'val',
      },
      webContents: h.userB.wc,
    });
    assert.deepEqual(userReq, {
      requestHeaders: {
        Cookie: 'user=active',
        Authorization: 'Basic auth',
        'X-Key': 'val',
      },
    });

    const userResp = await h.recvHeaders(h.userB.wc.session, {
      url: 'https://any.example/data',
      responseHeaders: {
        'Set-Cookie': ['user_session=123'],
      },
      webContents: h.userB.wc,
    });
    assert.deepEqual(userResp, {});
  } finally {
    h.close();
  }
});

// Tests request naming no pane while lent pane open in project is treated as held and stripped when off-list.
test('request naming no pane while lent pane open in project is treated as held and stripped when off-list', async () => {
  const h = harness();
  try {
    const unownedReq = await h.sendHeaders(h.lent.wc.session, {
      url: 'https://offlist.example/worker.js',
      requestHeaders: {
        Cookie: 'c=1',
        Authorization: 'Bearer auth',
        'X-Held': 'true',
      },
    });
    assert.deepEqual(unownedReq, {
      requestHeaders: {
        'X-Held': 'true',
      },
    });

    const unownedResp = await h.recvHeaders(h.lent.wc.session, {
      url: 'https://offlist.example/worker.js',
      responseHeaders: {
        'Set-Cookie': ['worker=token'],
        'Content-Type': ['application/javascript'],
      },
    });
    assert.deepEqual(unownedResp, {
      responseHeaders: {
        'Content-Type': ['application/javascript'],
      },
    });
  } finally {
    h.close();
  }
});

// Tests explicit handoff is refused with -32038 while scripted without emitting handoff event or setting handoff.
test('explicit handoff refused with -32038 while scripted; no handoff event; handoff still null', async () => {
  const h = harness();
  try {
    h.lent.pane.scripted = true;
    await assert.rejects(
      h.pm.tool('bp_agent_lent', 'handoff', { reason: 'need human review' }),
      (err: any) => {
        assert.equal(err.code, -32038);
        assert.equal(
          err.message,
          'evaluate ran on this page, so it cannot go to the user; navigate to load it again, then hand off',
        );
        return true;
      },
    );
    assert.equal(h.lent.pane.handoff, null);
    assert.equal(h.events.filter((e) => e.kind === 'handoff').length, 0);
  } finally {
    h.close();
  }
});

// Tests automatic human-check handoff on scripted page logs blocked line and notes hook without handing off, while fresh page hands off.
test('automatic human-check on scripted page emits no handoff; on fresh page it hands off', async () => {
  const h = harness();
  try {
    const challengeDoc = {
      url: 'https://challenges.cloudflare.com/turnstile',
      status: 403,
      headers: { 'cf-mitigated': 'challenge' },
      main: true,
    };

    h.lent.pane.scripted = true;
    h.internal.humanCheck(h.lent.pane, challengeDoc);
    assert.equal(h.lent.pane.handoff, null);
    assert.equal(h.events.filter((e) => e.kind === 'handoff').length, 0);
    const blockedLog = h.lent.pane.console.find((l: any) => l.level === 'blocked');
    assert.ok(blockedLog);
    assert.ok(blockedLog.text.includes('evaluate ran on this page'));
    assert.equal(h.notes.length, 1);
    assert.equal(h.notes[0].paneId, 'bp_agent_lent');
    assert.match(h.notes[0].text, /reload/i);

    h.lent.pane.scripted = false;
    h.internal.humanCheck(h.lent.pane, challengeDoc);
    assert.ok(h.lent.pane.handoff !== null);
    assert.ok(h.lent.pane.handoff.includes('the site is checking for a human'));
    const handoffEvents = h.events.filter((e) => e.kind === 'handoff');
    assert.equal(handoffEvents.length, 1);
    assert.equal(handoffEvents[0].pane_id, 'bp_agent_lent');
    assert.equal(handoffEvents[0].reason, h.lent.pane.handoff);
    assert.equal(h.notes.length, 1);

    const pmNoNote = new PaneManager(
      { isDestroyed: () => false, contentView: { removeChildView() {} }, webContents: { focus() {} } } as never,
      { db: () => h.db, paneEvent() {}, urlChanged() {}, openPane() {}, probe() {} } as never,
    );
    const internalNoNote = pmNoNote as any;
    const paneCopy = { ...h.lent.pane, scripted: true };
    assert.doesNotThrow(() => internalNoNote.humanCheck(paneCopy, challengeDoc));
  } finally {
    h.close();
  }
});

// Tests pane console history and network entries are emptied on give-back so tools return empty arrays.
test('console and network emptied after give-back', async () => {
  const h = harness();
  try {
    h.lent.pane.handoff = 'solve captcha';
    h.lent.pane.console.push(
      { at: Date.now(), level: 'log', text: 'user entered sensitive data' },
      { at: Date.now(), level: 'info', text: 'page loaded secrets' },
    );
    h.lent.pane.network.set('req-1', {
      at: Date.now(),
      url: 'https://secret.example/token',
      method: 'POST',
      status: 200,
    });
    assert.equal(h.lent.pane.console.length, 2);
    assert.equal(h.lent.pane.network.size, 1);

    triggerGiveBack(h.internal, h.lent.pane);
    assert.deepEqual(h.lent.pane.console, []);
    assert.equal(h.lent.pane.network.size, 0);

    const consoleRes = (await h.pm.tool('bp_agent_lent', 'console', {})) as any;
    assert.deepEqual(consoleRes, []);

    const netRes = (await h.pm.tool('bp_agent_lent', 'network', {})) as any;
    assert.deepEqual(netRes, []);
  } finally {
    h.close();
  }
});

// Tests revoked lent pane fails agent actions with -32030 and sends no Input commands, while non-lent pane is not blocked.
test('revoked lent pane fails agent action with -32030 and sends no Input command; non-lent pane with no row succeeds', async () => {
  const h = harness();
  try {
    h.db.prepare("UPDATE browser_pane SET open = 0 WHERE id = 'bp_agent_lent'").run();

    await assert.rejects(
      h.pm.tool('bp_agent_lent', 'dialog', { _session: 'sA', accept: true }),
      (err: any) => {
        assert.equal(err.code, -32030);
        assert.equal(err.message, 'this pane is closed or no longer yours; nothing was sent');
        return true;
      },
    );
    assert.equal(h.lent.commands.filter((c) => c.startsWith('Input.')).length, 0);

    h.db.prepare("UPDATE browser_pane SET open = 1, session_id = 'different_session' WHERE id = 'bp_agent_lent'").run();
    await assert.rejects(
      h.pm.tool('bp_agent_lent', 'dialog', { _session: 'sA', accept: true }),
      (err: any) => {
        assert.equal(err.code, -32030);
        return true;
      },
    );
    assert.equal(h.lent.commands.filter((c) => c.startsWith('Input.')).length, 0);

    h.ordinary.pane.dialog = { message: 'hello', type: 'alert' };
    const plainRes = (await h.pm.tool('bp_agent_plain', 'dialog', { _session: 'sA', accept: true })) as any;
    assert.equal(plainRes.ok, true);
  } finally {
    h.close();
  }
});

// Tests revoked lent pane cancels onBeforeRequest and fails Fetch.requestPaused with failRequest.
test('revoked lent pane cancels onBeforeRequest and fails Fetch.requestPaused with failRequest', async () => {
  const h = harness();
  try {
    h.db.prepare("UPDATE browser_pane SET open = 0 WHERE id = 'bp_agent_lent'").run();

    const reqRes = await h.sendRequest(h.lent.wc.session, {
      url: 'https://lent.example/resource',
      resourceType: 'mainFrame',
      webContents: h.lent.wc,
    });
    assert.deepEqual(reqRes, { cancel: true });

    h.lent.commandCalls.length = 0;
    await h.internal.onDebuggerEvent(h.lent.pane, 'Fetch.requestPaused', {
      requestId: 'paused-req-1',
      request: { url: 'https://lent.example/resource' },
    });

    const failCalls = h.lent.commandCalls.filter((c) => c.method === 'Fetch.failRequest');
    assert.equal(failCalls.length, 1);
    assert.deepEqual(failCalls[0].params, {
      requestId: 'paused-req-1',
      errorReason: 'BlockedByClient',
    });
    const contCalls = h.lent.commandCalls.filter((c) => c.method === 'Fetch.continueRequest');
    assert.equal(contCalls.length, 0);
  } finally {
    h.close();
  }
});
