import { mock } from 'node:test';

const ses = { webRequest: { onBeforeRequest() {} }, on() {}, setPermissionCheckHandler() {}, setPermissionRequestHandler() {}, clearStorageData: async () => {} };
let made = 0;
class WebContentsView {
  webContents = {
    session: ses, on() {}, once() {}, setWindowOpenHandler() {}, isDestroyed: () => false, close() {}, loadURL: async () => {}, loadFile: async () => {},
    debugger: { on() {}, attach() {}, detach() {}, sendCommand: async () => { throw new Error('target closed'); } },
  };
  constructor() { made++; }
  setBounds() {}
  setBackgroundColor() {}
}
mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: { fromPartition: () => ses }, WebContentsView } });
const { PaneManager } = await import('../../src/browser/panes.ts');

const win = { isDestroyed: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }), contentView: { addChildView() {}, removeChildView() {}, children: [] } };
const pm = new PaneManager(win as never, { db: () => null, probe() {}, paneEvent() {} } as never);
const row = { id: 'bp_user_1', project_id: 'proj', run_id: null, variant: null, session_id: null, url: null, dev_port: null, open: 1 };
pm.sync([row]);
for (let i = 0; i < 50 && pm.has(row.id); i++) await new Promise((r) => setTimeout(r, 20));
const afterFail = pm.has(row.id);
pm.sync([row]);
console.log(JSON.stringify({ afterFail, retried: made === 4 }));
process.exit(0);
