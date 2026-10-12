import { mock } from 'node:test';

mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: {}, WebContentsView: class {} } });
const { PaneManager } = await import('../../src/browser/panes.ts');
const { riskReason } = await import('../../../core/src/approvals.ts');

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

// The real describe, with the page's accessibility tree read (a name) or failing (null)
delete internal.describeControl;
let axName: string | null = '';
const page = { view: { webContents: { getURL: () => 'http://a.test/x' } } };
internal.node = () => ({ backendNodeId: 7 });
internal.resolve = async () => 'obj7';
internal.cmd = async (_p: unknown, method: string) => {
  if (method === 'Runtime.callFunctionOn') return { result: { value: { id: '', password: false, child: false, origin: 'http://a.test' } } };
  if (method === 'Accessibility.getPartialAXTree') {
    if (axName === null) throw new Error('No node with given id found');
    return { nodes: [{ backendDOMNodeId: 7, name: { value: axName }, role: { value: 'button' } }] };
  }
  throw new Error(`unexpected ${method}`);
};
const check = async (action: string) => {
  const d = await internal.describeControl(page, { ref: 'e1', tool: action });
  return riskReason({ session_id: 's', surface: 'browser', target: d.origin, action, args: {}, control: d.control, password: d.password, hidden: d.hidden }) ?? 'allow';
};
const dispatch = (exp: Record<string, unknown>) => internal.recheck(page, 'click', { ref: 'e1', expect: exp }).then(() => 'sent', (e: Error) => e.message);

axName = null;
r.unreadableClickAsks = await check('click');
// approved as a readable icon button with no name; at dispatch the tree cannot be read
axName = '';
const nameless = await internal.describeControl(page, { ref: 'e1', tool: 'click' });
axName = null;
r.unreadableAtDispatchAsksAgain = await dispatch({ ...nameless.control, origin: nameless.origin, hidden: nameless.hidden, password: nameless.password });

const filler = 'x '.repeat(110);
axName = `${filler}Send`;
r.sendPast200Asks = await check('click');
axName = `${filler}Archive`;
const archive = await internal.describeControl(page, { ref: 'e1', tool: 'click' });
r.archiveNameKeptWhole = archive.control.name.length;
axName = `${filler}Send`;
r.suffixChangedAsksAgain = await dispatch({ ...archive.control, origin: archive.origin, hidden: archive.hidden, password: archive.password });

console.log(JSON.stringify(r));
