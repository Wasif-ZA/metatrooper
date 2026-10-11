import { mock } from 'node:test';

const fakeImage = (width: number, height: number): any => ({
  getSize: () => ({ width, height }),
  resize: (o: { width: number; height: number }) => fakeImage(o.width, o.height),
  toPNG: () => Buffer.alloc(1_200_000),
  toJPEG: (q: number) => Buffer.alloc(Math.floor((width * height * q) / 100 * 0.8)),
});
mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: { createFromBuffer: () => fakeImage(1568, 1000) }, session: {}, WebContentsView: class {} } });
const { PaneManager } = await import('../../src/browser/panes.ts');
const { encode } = await import('../../../core/src/pipe/framing.ts');

const pm = new PaneManager({ isDestroyed: () => false } as never, {} as never) as any;
const pane = { row: { id: 'p', project_id: 'proj' }, network: new Map(), console: [], cursors: new Map(), parked: true, dbg: { sendCommand: async () => ({ data: 'AAAA' }) } };
const fits = (result: unknown) => { try { encode({ jsonrpc: '2.0', id: 'x', result }); return true; } catch { return false; } };

await pm.onDebuggerEvent(pane, 'Network.requestWillBeSent', { requestId: 'r1', request: { method: 'GET', url: `data:image/png;base64,${'A'.repeat(2_000_000)}` } });
await pm.onDebuggerEvent(pane, 'Network.requestWillBeSent', { requestId: 'r2', request: { method: 'GET', url: `https://a.test/?q=${'b'.repeat(5000)}` } });
const network = await pm.run(pane, 'network', {});
const shot = await pm.run(pane, 'screenshot', { format: 'png' });
console.log(JSON.stringify({
  networkFits: fits(network),
  dataUrl: network[0].url,
  longUrlLength: network[1].url.length,
  shotFits: fits(shot),
  shotMime: shot.mime,
  shotWidth: shot.width,
}));
process.exit(0);
