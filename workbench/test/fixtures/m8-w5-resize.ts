import { mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

const partitions = new Map<string, any>();
function fromPartition(name: string) {
  if (!partitions.has(name)) partitions.set(name, Object.assign(new EventEmitter(), {
    webRequest: { onBeforeRequest() {} },
    setPermissionCheckHandler() {}, setPermissionRequestHandler() {},
  }));
  return partitions.get(name);
}
mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: { fromPartition }, WebContentsView: class {} } });
const { PaneManager } = await import('../../src/browser/panes.ts');
const flush = () => new Promise((r) => setImmediate(r));
const win = {
  width: 800, height: 600,
  getContentBounds() { return { x: 71, y: 93, width: this.width, height: this.height }; },
  getBounds: () => ({ x: 50, y: 60, width: 840, height: 680 }),
  isDestroyed: () => false,
  contentView: { children: [], addChildView() {}, removeChildView() {} },
  webContents: { focus() {} },
};
const manager = new PaneManager(win as never, {
  db: () => null, probe() {}, urlChanged() {}, commentPicked() {}, paneEvent() {}, openPane() {},
} as never);
function view() {
  let bounds = { x: 0, y: 0, width: 30, height: 40 };
  return {
    webContents: Object.assign(new EventEmitter(), { isDestroyed: () => false }),
    setBounds(next: typeof bounds) { bounds = { ...next }; },
    getBounds: () => ({ ...bounds }),
  };
}
function pane(id: string) {
  const p = {
    row: { id, project_id: 'synthetic-project', session_id: 'synthetic-session' },
    view: view(), overlay: view(), parked: false,
    dbg: { sendCommand: async () => ({}) },
  };
  (manager as any).panes.set(id, p);
  return p;
}
const visible = pane('synthetic-visible');
const hiddenA = pane('synthetic-hidden-a');
const hiddenB = pane('synthetic-hidden-b');
assert.equal(typeof manager.layout, 'function');
manager.show('synthetic-visible', { x: 20, y: 40, width: 640, height: 480 });
await flush();
for (const hidden of [hiddenA, hiddenB]) {
  assert.deepEqual(hidden.view.getBounds(), { x: 799, y: 599, width: 1, height: 1 });
  assert.deepEqual(hidden.overlay.getBounds(), { x: 799, y: 599, width: 1, height: 1 });
}
assert.deepEqual(visible.view.getBounds(), { x: 20, y: 40, width: 640, height: 480 });
assert.deepEqual(visible.overlay.getBounds(), { x: 20, y: 40, width: 640, height: 480 });
win.width = 1200;
win.height = 900;
manager.layout();
await flush();
for (const hidden of [hiddenA, hiddenB]) {
  assert.deepEqual(hidden.view.getBounds(), { x: 1199, y: 899, width: 1, height: 1 });
  assert.deepEqual(hidden.overlay.getBounds(), { x: 1199, y: 899, width: 1, height: 1 });
}
assert.deepEqual(visible.view.getBounds(), { x: 20, y: 40, width: 640, height: 480 });
assert.deepEqual(visible.overlay.getBounds(), { x: 20, y: 40, width: 640, height: 480 });
manager.show(null, null);
await flush();
for (const p of [visible, hiddenA, hiddenB]) {
  assert.deepEqual(p.view.getBounds(), { x: 1199, y: 899, width: 1, height: 1 });
  assert.deepEqual(p.overlay.getBounds(), { x: 1199, y: 899, width: 1, height: 1 });
}
console.log('resize fixture assertions completed');
