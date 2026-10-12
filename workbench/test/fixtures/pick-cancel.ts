import { mock } from 'node:test';

mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: {}, WebContentsView: class {} } });
const { PaneManager } = await import('../../src/browser/panes.ts');

const gone = { isDestroyed: () => true };
const pm = new PaneManager({ isDestroyed: () => true } as never, {} as never);
const fake = () => ({ row: { id: 'p' }, picking: null, view: { webContents: gone }, overlay: { webContents: gone }, dbg: { sendCommand: async () => ({}), detach() {} } });
const panes = (pm as unknown as { panes: Map<string, unknown> }).panes;

const settles = (p: Promise<unknown>) => Promise.race([p.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), 200))]);
const tick = () => new Promise((r) => setTimeout(r, 10));

panes.set('p', fake());
const first = pm.pick('p');
await tick();
const second = pm.pick('p');
const results = { secondPickEndsFirst: await settles(first) };
await tick();
pm.cancelPick('p');
results.cancelEndsPick = await settles(second);
const third = pm.pick('p');
await tick();
pm.closeAll();
results.closeEndsPick = await settles(third);
console.log(JSON.stringify(results));
process.exit(0);
