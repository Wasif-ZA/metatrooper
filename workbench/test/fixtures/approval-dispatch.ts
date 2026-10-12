import { mock } from 'node:test';

mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: {}, WebContentsView: class {} } });
const { PaneManager } = await import('../../src/browser/panes.ts');

const pm = new PaneManager({} as never, { db: () => null, probe() {} } as never);
const internal = pm as unknown as Record<string, any>;
const pane = {};
const r: Record<string, unknown> = {};

// What the page looks like at dispatch time
let now = { origin: 'http://a.test', control: { automation_id: 'pw', name: 'Secret', role: 'textbox' }, password: false, hidden: false };
internal.describe = async () => now;
const expect = { origin: 'http://a.test', automation_id: 'pw', name: 'Secret', hidden: false, password: false };
const rechecked = () => internal.recheck(pane, 'type', { ref: 'e1', expect }).then(() => 'sent', (e: Error) => e.message);

r.sameControlSends = await rechecked();
now = { ...now, password: true };
r.becamePasswordAsksAgain = await rechecked();

console.log(JSON.stringify(r));
