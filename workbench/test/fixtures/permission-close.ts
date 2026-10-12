import { mock } from 'node:test';

let request: (wc: unknown, perm: string, cb: (ok: boolean) => void, details: object) => void = () => {};
const ses = { webRequest: { onBeforeRequest() {} }, on() {}, setPermissionCheckHandler() {}, setPermissionRequestHandler(h: typeof request) { request = h; } };
mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: { fromPartition: () => ses }, WebContentsView: class {} } });
const { PaneManager } = await import('../../src/browser/panes.ts');

const gone = { isDestroyed: () => true };
const wc = { isDestroyed: () => true, getURL: () => 'https://a.test/' };
const pm = new PaneManager(gone as never, { paneEvent() {} } as never);
const pane = { row: { id: 'bp_user_1', project_id: 'proj' }, picking: null, view: { webContents: wc }, overlay: { webContents: gone }, dbg: { detach() {} } };
const inner = pm as unknown as { panes: Map<string, unknown>; asking: Map<string, unknown>; guardPartition(row: unknown): unknown };
inner.panes.set(pane.row.id, pane);
inner.guardPartition(pane.row);

const answers: boolean[] = [];
request(wc, 'notifications', (ok) => answers.push(ok), { requestingUrl: 'https://a.test/' });
const asked = inner.asking.size;
pm.closeAll();
console.log(JSON.stringify({ asked, answers, left: inner.asking.size }));
process.exit(0);
