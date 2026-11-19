import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const ses = { webRequest: { onBeforeRequest() {} }, on() {}, setPermissionCheckHandler() {}, setPermissionRequestHandler() {}, clearStorageData: async () => {} };
class WebContentsView {
  webContents = {
    session: ses, on() {}, once() {}, setWindowOpenHandler() {}, isDestroyed: () => false, close() {}, loadURL: async () => {}, loadFile: async () => {},
    debugger: { on() {}, attach() {}, detach() {}, sendCommand: async () => { throw new Error('target closed'); } },
  };
  setBounds() {}
  setBackgroundColor() {}
}
Object.assign(globalThis, { __electronStub: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: { fromPartition: () => ses }, WebContentsView } });

async function load() {
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'electron' ? { url: 'test:electron', shortCircuit: true } : nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      return url === 'test:electron'
        ? { format: 'module', source: 'const s = globalThis.__electronStub; export const { app, clipboard, Menu, nativeImage, session, WebContentsView } = s;', shortCircuit: true }
        : nextLoad(url, context);
    },
  });
  try {
    return await import('../src/browser/panes.ts');
  } finally {
    hook.deregister();
  }
}

test('FIX-W2 a user pane is granted only loopback ports typed in the URL box, never the port of its stored url', async () => {
  const { PaneManager } = await load();
  const win = { isDestroyed: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }), contentView: { addChildView() {}, removeChildView() {}, children: [] } };
  const pm = new PaneManager(win as never, { db: () => null, probe() {}, paneEvent() {} } as never) as any;
  const row = { id: 'bp_user_1', project_id: 'proj', run_id: null, variant: null, session_id: null, url: 'http://127.0.0.1:8080/page', dev_port: null, open: 1 };
  pm.sync([row]);
  const pane = pm.panes.get(row.id);
  assert.deepEqual([...pane.typed], [], 'stored url grants nothing');
  await pm.userNavigate(row.id, 'http://127.0.0.1:9090/').catch(() => {});
  assert.deepEqual([...pane.typed], [9090], 'typed url grants its port');
});
