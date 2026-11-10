import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

const rawUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) @metatrooper/workbench/0.1.0 Chrome/142.0.7444.59 Electron/44.4.5 Safari/537.36';
const cleanUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.59 Safari/537.36';
const partitions = new Map<string, any>();
function fromPartition(name: string) {
  if (!partitions.has(name)) partitions.set(name, Object.assign(new EventEmitter(), {
    userAgents: [] as string[],
    getUserAgent: () => rawUA,
    setUserAgent(ua: string) { this.userAgents.push(ua); },
    webRequest: { onBeforeRequest() {} },
    setPermissionCheckHandler() {}, setPermissionRequestHandler() {},
  }));
  return partitions.get(name);
}
mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: { fromPartition }, WebContentsView: class {} } });
const { PaneManager } = await import('../../src/browser/panes.ts');

function harness(sessionId: string | null = 'session-1') {
  const events: Array<Record<string, any>> = [];
  const commands: string[] = [];
  const win = { isDestroyed: () => false, contentView: { children: [], addChildView() {}, removeChildView() {} }, webContents: { focus() {} } };
  const pm = new PaneManager(win as never, {
    db: () => null, probe() {}, urlChanged() {}, commentPicked() {},
    paneEvent: (event: Record<string, any>) => events.push(event), openPane() {},
  } as never);
  const internal = pm as any;
  let currentURL = 'https://before.example/';
  const wc = Object.assign(new EventEmitter(), {
    getURL: () => currentURL, getTitle: () => 'synthetic', isDestroyed: () => false,
    isLoading: () => false, isLoadingMainFrame: () => false, getZoomFactor: () => 1,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    setWindowOpenHandler() {},
  });
  const pane = {
    row: { id: sessionId ? 'bp_agent_test' : 'bp_user', project_id: 'project-1', session_id: sessionId },
    view: { webContents: wc }, overlay: { webContents: { isDestroyed: () => true } },
    dbg: { sendCommand: async (method: string) => { commands.push(method); return {}; } },
    refs: { byRef: new Map(), byKey: new Map() }, lastSnapshot: new Map(), cursors: new Map(), worlds: new Map(),
    docs: new Map(), network: new Map(), console: [], pickStack: [], popups: new Set(),
    navs: 0, reconnected: false, handoff: null as string | null, errorFor: null, crashed: null,
    secretOnPage: false, scripted: false, handedBack: false, handBackNext: false, dialog: null,
    ready: Promise.resolve(),
  };
  internal.panes.set(pane.row.id, pane);
  internal.wireContents(pane);
  const cdp = (method: string, params: Record<string, unknown>) => internal.onDebuggerEvent(pane, method, params);
  const response = (url: string, status: number, headers: Record<string, string>, type = 'Document') => cdp('Network.responseReceived', { requestId: 'synthetic', type, response: { url, status, headers } });
  const commit = (url = 'https://shop.example/', status = 403) => {
    currentURL = url;
    return wc.emit('did-navigate', {}, url, status);
  };
  const frame = (url: string, urlFragment = '') => cdp('Page.frameNavigated', { frame: { id: 'child', parentId: 'main', url, urlFragment } });
  return { pm, internal, pane, events, commands, response, commit, frame };
}

function assertHandoff(h: ReturnType<typeof harness>, vendor: string) {
  assert.equal(typeof h.pane.handoff, 'string');
  assert.ok(h.pane.handoff!.includes(vendor));
  assert.ok(h.pane.handoff!.includes('checking for a human'));
  const handoffs = h.events.filter((event) => event.kind === 'handoff');
  assert.equal(handoffs.length, 1);
  assert.equal(handoffs[0].pane_id, 'bp_agent_test');
  assert.equal(typeof handoffs[0].reason, 'string');
  assert.ok(handoffs[0].reason.includes(vendor));
  assert.ok(handoffs[0].reason.includes('checking for a human'));
}

function assertNoHandoff(h: ReturnType<typeof harness>) {
  assert.equal(h.pane.handoff, null);
  assert.deepEqual(h.events.filter((event) => event.kind === 'handoff'), []);
}

for (const [status, headers, vendor] of [
  [403, { Server: 'AkamaiGHost' }, 'Akamai'],
  [200, { 'cf-mitigated': 'challenge' }, 'Cloudflare'],
  [403, { 'x-datadome': '1' }, 'DataDome'],
] as const) {
  test('main navigation hands off ' + vendor + ' in both event orders with the same reason', async () => {
    const responseFirst = harness();
    await responseFirst.response('https://shop.example/', status, headers);
    assertNoHandoff(responseFirst);
    responseFirst.commit('https://shop.example/', status);
    assertHandoff(responseFirst, vendor);

    const commitFirst = harness();
    commitFirst.commit('https://shop.example/', status);
    assertNoHandoff(commitFirst);
    await commitFirst.response('https://shop.example/', status, headers);
    assertHandoff(commitFirst, vendor);
    assert.equal(commitFirst.pane.handoff, responseFirst.pane.handoff);
    assert.equal(commitFirst.events.find((event) => event.kind === 'handoff')!.reason,
      responseFirst.events.find((event) => event.kind === 'handoff')!.reason);

    responseFirst.commit('https://shop.example/', status);
    await commitFirst.response('https://shop.example/', status, headers);
    assertHandoff(responseFirst, vendor);
    assertHandoff(commitFirst, vendor);
  });

  for (const order of ['response first', 'commit first']) {
    test('user pane ignores ' + vendor + ' with ' + order, async () => {
      const h = harness(null);
      if (order === 'response first') {
        await h.response('https://shop.example/', status, headers);
        assertNoHandoff(h);
        h.commit('https://shop.example/', status);
      } else {
        h.commit('https://shop.example/', status);
        assertNoHandoff(h);
        await h.response('https://shop.example/', status, headers);
      }
      assertNoHandoff(h);
    });
  }

  test('late ' + vendor + ' subframe Document response does not hand off', async () => {
    const h = harness();
    h.commit('https://shop.example/', status);
    assertNoHandoff(h);
    await h.response('https://child.example/', status, headers);
    assertNoHandoff(h);
  });

  test('late ' + vendor + ' response for a page navigated away from does not hand off', async () => {
    const h = harness();
    h.commit('https://shop.example/', status);
    assertNoHandoff(h);
    h.commit('https://away.example/', 200);
    assertNoHandoff(h);
    await h.response('https://shop.example/', status, headers);
    assertNoHandoff(h);
  });

  test('late ' + vendor + ' non-Document response does not hand off', async () => {
    const h = harness();
    h.commit('https://shop.example/', status);
    await h.response('https://shop.example/', status, headers, 'XHR');
    assertNoHandoff(h);
  });
}

for (const [url, fragment, vendor] of [
  ['https://geo.captcha-delivery.com/check', '', 'DataDome'],
  ['https://client.arkoselabs.com/check', '', 'Arkose'],
  ['https://newassets.hcaptcha.com/check', '#frame=challenge', 'hCaptcha'],
  ['https://captcha.px-cdn.net/check', '', 'PerimeterX'],
] as const) {
  test('subframe navigation hands off ' + vendor, async () => {
    const h = harness();
    await h.frame(url, fragment);
    assertHandoff(h, vendor);
  });
}

test('main headers match URL and Document type', async () => {
  const h = harness();
  await h.response('https://different.example/', 403, { 'cf-mitigated': 'challenge' });
  await h.response('https://shop.example/', 403, { 'cf-mitigated': 'challenge' }, 'XHR');
  h.commit();
  assert.equal(h.pane.handoff, null);
  await h.response('https://shop.example/', 403, { Server: 'AkamaiGHost' });
  h.commit();
  assertHandoff(h, 'Akamai');
});

for (const headers of [{ Server: 'AkamaiGHost' }, { 'x-datadome': 'synthetic' }, { 'set-cookie': 'datadome=synthetic' }, {}]) {
  test('successful vendor response and bare rejection do not hand off ' + JSON.stringify(headers), async () => {
    const h = harness();
    await h.response('https://shop.example/', 200, headers);
    h.commit('https://shop.example/', 200);
    assert.equal(h.pane.handoff, null);
    await h.response('https://shop.example/', 403, {});
    h.commit();
    assert.equal(h.pane.handoff, null);
    assert.deepEqual(h.events.filter((event) => event.kind === 'handoff'), []);
  });
}

test('user pane never hands off on main or subframe challenges', async () => {
  const h = harness(null);
  await h.response('https://shop.example/', 403, { 'cf-mitigated': 'challenge' });
  h.commit();
  await h.frame('https://client.arkoselabs.com/check');
  assert.equal(h.pane.handoff, null);
  assert.deepEqual(h.events.filter((event) => event.kind === 'handoff'), []);
});

test('an agent-style pane ID without session_id is never handed off', async () => {
  const h = harness(null);
  h.pane.row.id = 'bp_agent_orphan';
  await h.response('https://shop.example/', 403, { 'cf-mitigated': 'challenge' });
  h.commit();
  await h.frame('https://client.arkoselabs.com/check');
  assert.equal(h.pane.handoff, null);
  assert.deepEqual(h.events.filter((event) => event.kind === 'handoff'), []);
});

test('unrecognized subframes and top-level CDP frame do not hand off', async () => {
  const h = harness();
  await h.frame('http://geo.captcha-delivery.com/check');
  await h.frame('https://geo.captcha-delivery.com.evil.example/check');
  await h.frame('https://newassets.hcaptcha.com/check');
  await h.internal.onDebuggerEvent(h.pane, 'Page.frameNavigated', { frame: { id: 'main', url: 'https://client.arkoselabs.com/check' } });
  assert.equal(h.pane.handoff, null);
});

test('second challenge preserves the first reason and emits no extra handoff', async () => {
  const h = harness();
  await h.frame('https://client.arkoselabs.com/check');
  const first = h.pane.handoff;
  await h.response('https://shop.example/', 403, { 'cf-mitigated': 'challenge' });
  h.commit();
  await h.frame('https://geo.captcha-delivery.com/check');
  assert.equal(h.pane.handoff, first);
  assertHandoff(h, 'Arkose');
});

test('tools refuse a handed-off pane until give-back', async () => {
  const h = harness();
  await h.frame('https://client.arkoselabs.com/check');
  for (const tool of ['snapshot', 'navigate', 'click', 'type', 'evaluate', 'console', 'network', 'handoff']) {
    await assert.rejects(h.pm.tool(h.pane.row.id, tool, {}), (error: any) => {
      assert.equal(error.code, -32036);
      assert.match(error.message, /the user has the pane/);
      return true;
    });
  }
  assert.deepEqual(h.commands, []);
  h.pm.act(h.pane.row.id, 'give-back');
  assert.equal(h.pane.handoff, null);
  assert.equal(h.events.at(-1)?.handoff, null);
  await assert.doesNotReject(h.pm.tool(h.pane.row.id, 'console', {}));
});

test('guardPartition sets the literal Chromium UA once per partition', () => {
  partitions.clear();
  const h = harness();
  const row = { id: 'bp_user_1', project_id: 'project-1', session_id: null };
  h.internal.guardPartition(row);
  h.internal.guardPartition(row);
  h.internal.guardPartition({ ...row, id: 'bp_user_2' });
  h.internal.guardPartition({ ...row, id: 'bp_agent_1', session_id: 'session-1' });
  h.internal.guardPartition({ ...row, id: 'bp_agent_1', session_id: 'session-1' });
  h.internal.guardPartition({ ...row, id: 'bp_agent_2', session_id: 'session-2' });
  assert.deepEqual([...partitions.keys()], ['persist:troop-project-1', 'troop-project-1-bp_agent_1', 'troop-project-1-bp_agent_2']);
  for (const session of partitions.values()) assert.deepEqual(session.userAgents, [cleanUA]);
});
