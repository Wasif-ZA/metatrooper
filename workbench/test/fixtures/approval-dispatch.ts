import { mock } from 'node:test';

mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: {}, WebContentsView: class {} } });
const { PaneManager } = await import('../../src/browser/panes.ts');

const pm = new PaneManager({} as never, { db: () => null, probe() {} } as never);
const internal = pm as unknown as Record<string, any>;
const pane = {};
const r: Record<string, unknown> = {};

// What the page looks like at dispatch time
let now = { origin: 'http://a.test', control: { automation_id: 'pw', name: 'Secret', role: 'textbox' }, password: false, hidden: false };
internal.describeControl = async () => now;
const expect = { origin: 'http://a.test', automation_id: 'pw', name: 'Secret', hidden: false, password: false };
const rechecked = () => internal.recheck(pane, 'type', { ref: 'e1', expect }).then(() => 'sent', (e: Error) => e.message);

r.sameControlSends = await rechecked();
now = { ...now, password: true };
r.becamePasswordAsksAgain = await rechecked();

// What each key combination dispatches: the keyDown's key, code and text
const sent: Array<Record<string, any>> = [];
internal.cmd = async (_p: unknown, method: string, params: Record<string, any>) => { if (method === 'Input.dispatchKeyEvent') sent.push(params); return {}; };
const press = async (keys: string) => {
  sent.length = 0;
  await internal.pressKeys(pane, keys);
  const down = sent[0];
  return `${down.type} ${down.key} ${down.code} ${down.text === undefined ? '-' : JSON.stringify(down.text)} up:${sent[1].key}`;
};
r.plain = await press('a');
r.shiftLetter = await press('Shift+a');
r.shiftDigit = await press('Shift+1');
r.shiftPunctuation = await press('Shift+/');
r.ctrlLetter = await press('Ctrl+a');
r.shiftEnter = await press('Shift+Enter');

console.log(JSON.stringify(r));
