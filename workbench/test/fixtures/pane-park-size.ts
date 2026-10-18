import { mock } from 'node:test';

mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: {}, WebContentsView: class {} } });
const { PaneManager } = await import('../../src/browser/panes.ts');

const log: string[] = [];
const sendCommand = async (method: string, p: { width?: number; height?: number }) => { log.push(method.startsWith('Emulation.set') ? `override ${p.width}x${p.height}` : method); return {}; };
const view = { setBounds: (b: { width: number; height: number }) => log.push(`bounds ${b.width}x${b.height}`) };
const win = { isDestroyed: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 1600, height: 900 }) };
const pm = new PaneManager(win as never, {} as never);
(pm as unknown as { panes: Map<string, unknown> }).panes.set('p', { row: { id: 'p' }, parked: false, dbg: { sendCommand }, view, overlay: { setBounds() {} } });
pm.show('p', { x: 633, y: 64, width: 959, height: 776 });
await new Promise((r) => setTimeout(r, 20));
log.length = 0;
pm.show(null, null);
await new Promise((r) => setTimeout(r, 20));
console.log(JSON.stringify(log));
process.exit(0);
