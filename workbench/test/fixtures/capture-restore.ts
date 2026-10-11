import { mock } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.METATROOPER_HOME = mkdtempSync(join(tmpdir(), 'capture-restore-'));
mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: {}, WebContentsView: class {} } });
const { PaneManager } = await import('../../src/browser/panes.ts');

const run = async (failRestore: boolean) => {
  const sent: string[] = [];
  const sendCommand = async (method: string) => {
    sent.push(method);
    if (method === 'Page.getLayoutMetrics') throw new Error('capture broke');
    if (method === 'Emulation.clearDeviceMetricsOverride' && failRestore) throw new Error('restore broke');
    return {};
  };
  const pm = new PaneManager({ isDestroyed: () => false } as never, {} as never);
  (pm as unknown as { panes: Map<string, unknown> }).panes.set('p', { row: { id: 'p' }, parked: false, dbg: { sendCommand } });
  const error = await pm.capture('p', 'before').then(() => '', (e: Error) => e.message);
  return { error, last: sent.at(-1) };
};

console.log(JSON.stringify({ plain: await run(false), restoreAlsoFails: await run(true) }));
process.exit(0);
