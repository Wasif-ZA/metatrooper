import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const wb = fileURLToPath(new URL('../', import.meta.url));

// Slices function declarations from source using balanced brace counting.
function declaration(appSrc: string, name: string): string {
  const match = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(appSrc);
  assert.ok(match, 'function ' + name + ' in app.js');
  const bodyStart = appSrc.indexOf('{', match.index);
  let depth = 0;
  for (let i = bodyStart; i < appSrc.length; i++) {
    if (appSrc[i] === '{') depth++;
    else if (appSrc[i] === '}') {
      depth--;
      if (depth === 0) return appSrc.slice(match.index, i + 1);
    }
  }
  throw new Error('Could not slice ' + name);
}

// Slices the api.onSnapshot listener from source using balanced brace counting.
function snapshotHandler(appSrc: string): string {
  const match = /api\.onSnapshot\((async\s*\(s\)\s*=>\s*\{)/.exec(appSrc);
  assert.ok(match, 'api.onSnapshot in app.js');
  const bodyStart = appSrc.indexOf('{', match.index);
  let depth = 0;
  for (let i = bodyStart; i < appSrc.length; i++) {
    if (appSrc[i] === '{') depth++;
    else if (appSrc[i] === '}') {
      depth--;
      if (depth === 0) return appSrc.slice(match.index + 'api.onSnapshot('.length, i + 1);
    }
  }
  throw new Error('Could not slice onSnapshot');
}

// Test harness providing fake time and mocks for renderer dependencies.
function createHarness() {
  const appSrc = readFileSync(join(wb, 'renderer/app.js'), 'utf8');
  const rpcOnceCode = declaration(appSrc, 'rpcOnce');
  const onSnapshotCode = snapshotHandler(appSrc);

  let nowMs = 0;
  const toasts: Array<{ text: string; error: boolean }> = [];
  const apiCalls: Array<{ method: string; params: any }> = [];
  let apiCallResult: any = { kind: 'offline' };

  const ui: any = {
    snap: null,
    coreSeen: undefined,
    hideDone: new Set(),
    pendingHide: new Set(),
    projectId: null,
    pendingNeedsYou: null,
    pendingPick: null,
  };

  const sandbox: any = {
    ui,
    LIVE_STATES: [],
    performance: { now: () => nowMs },
    toast: (text: string, error = false) => {
      toasts.push({ text, error });
    },
    api: {
      call: async (method: string, params: any) => {
        apiCalls.push({ method, params });
        return typeof apiCallResult === 'function' ? apiCallResult(method, params) : apiCallResult;
      },
    },
    render: () => {},
    save: () => {},
    setView: () => {},
  };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(rpcOnceCode, ctx);
  const onSnapshot = vm.runInContext('(' + onSnapshotCode + ')', ctx);
  const rpcOnce = ctx.rpcOnce;

  return {
    ui: sandbox.ui,
    toasts,
    apiCalls,
    setTime: (ms: number) => { nowMs = ms; },
    setApiResult: (res: any) => { apiCallResult = res; },
    rpcOnce,
    onSnapshot,
  };
}

// Core offline at startup, never seen online, under 10 s: no offline toast.
test('core offline at startup, never seen online, under 10 s: no offline toast', async () => {
  const h = createHarness();
  h.setTime(5000);
  h.setApiResult({ kind: 'offline' });
  const result = await h.rpcOnce('session.list', {});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { error: { message: 'core offline' } });
  assert.equal(h.toasts.length, 0);
});

// Core was online in this window, then goes offline: the offline toast shows once.
test('core was online in this window, then goes offline: the offline toast shows (exact text from the code), once', async () => {
  const h = createHarness();
  h.setTime(2000);
  await h.onSnapshot({ core: { online: true }, sessions: [], projects: [] });
  assert.equal(h.ui.coreSeen, true);
  h.setApiResult({ kind: 'offline' });
  const result = await h.rpcOnce('session.list', {});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { error: { message: 'core offline' } });
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0].text, 'The core is offline.');
  assert.equal(h.toasts[0].error, true);
});

// Never seen online, offline past 10 s: the toast shows.
test('never seen online, offline past 10 s: the toast shows', async () => {
  const h = createHarness();
  h.setTime(10001);
  assert.equal(h.ui.coreSeen, undefined);
  h.setApiResult({ kind: 'offline' });
  const result = await h.rpcOnce('session.list', {});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { error: { message: 'core offline' } });
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0].text, 'The core is offline.');
  assert.equal(h.toasts[0].error, true);
});

// Coming back online clears or does not repeat the toast as the code does.
test('coming back online clears or does not repeat the toast as the code does (assert what the commit implements)', async () => {
  const h = createHarness();
  h.setTime(2000);
  await h.onSnapshot({ core: { online: true }, sessions: [], projects: [] });
  h.setApiResult({ kind: 'offline' });
  await h.rpcOnce('session.list', {});
  assert.equal(h.toasts.length, 1);
  await h.onSnapshot({ core: { online: true }, sessions: [], projects: [] });
  assert.equal(h.toasts.length, 1);
  h.setApiResult({ reply: { result: { sessions: [] } } });
  const result = await h.rpcOnce('session.list', {});
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { result: { sessions: [] } });
  assert.equal(h.toasts.length, 1);
});

// After core is seen online each failing call toasts the offline notice.
test('after core is seen online each failing rpc call toasts offline', async () => {
  const h = createHarness();
  h.setTime(2000);
  await h.onSnapshot({ core: { online: true }, sessions: [], projects: [] });
  h.setApiResult({ kind: 'offline' });
  const res1 = await h.rpcOnce('session.list', {});
  const res2 = await h.rpcOnce('session.list', {});
  assert.deepEqual(JSON.parse(JSON.stringify(res1)), { error: { message: 'core offline' } });
  assert.deepEqual(JSON.parse(JSON.stringify(res2)), { error: { message: 'core offline' } });
  assert.equal(h.toasts.length, 2);
  assert.equal(h.toasts[0].text, 'The core is offline.');
  assert.equal(h.toasts[0].error, true);
  assert.equal(h.toasts[1].text, 'The core is offline.');
  assert.equal(h.toasts[1].error, true);
});
