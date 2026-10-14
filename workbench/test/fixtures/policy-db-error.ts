import { mock } from 'node:test';

let beforeRequest: (details: { url: string; webContents?: unknown }, cb: (r: { cancel?: boolean }) => void) => void = () => {};
const ses = { webRequest: { onBeforeRequest(h: typeof beforeRequest) { beforeRequest = h; } }, on() {}, setPermissionCheckHandler() {}, setPermissionRequestHandler() {} };
mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: { fromPartition: () => ses }, WebContentsView: class {} } });
const { PaneManager } = await import('../../src/browser/panes.ts');

const busy = { prepare() { throw new Error('database is locked'); } };
const loaded: string[] = [];
const wc = { isDestroyed: () => false, getURL: () => 'https://rebind.test/', loadURL: async (u: string) => { loaded.push(u); } };
const pm = new PaneManager({ isDestroyed: () => false } as never, { db: () => busy, probe() {}, paneEvent() {} } as never);
const row = { id: 'bp_user_1', project_id: 'proj', session_id: null, url: null };
const pane = { row, typed: new Set(), network: new Map(), console: [], view: { webContents: wc } };
const inner = pm as unknown as { panes: Map<string, unknown>; guardPartition(row: unknown): unknown; onDebuggerEvent(pane: unknown, method: string, params: unknown): Promise<void> };
inner.panes.set(row.id, pane);
inner.guardPartition(row);

await inner.onDebuggerEvent(pane, 'Network.responseReceived', { requestId: 'r1', response: { status: 200, url: 'https://rebind.test/', remoteIPAddress: '10.0.0.5' } }).catch(() => {});
const verdict = await new Promise<{ cancel?: boolean } | 'no answer'>((resolve) => {
  setTimeout(() => resolve('no answer'), 2000);
  try { beforeRequest({ url: 'http://10.0.0.5/', webContents: wc }, resolve); } catch { resolve('no answer'); }
});
console.log(JSON.stringify({ blanked: loaded.includes('about:blank'), request: verdict }));
process.exit(0);
