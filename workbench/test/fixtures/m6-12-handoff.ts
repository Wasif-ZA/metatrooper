// Drives the workbench browser server over its pipe with a mocked Electron pane: handoff, {{secret:NAME}} fills,
// output scrubbing and audit rows, then scans every table and file for the secret (as M1-05 does for typed text).
import { mock } from 'node:test';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: {}, WebContentsView: class {} } });
const core = (f: string) => pathToFileURL(path.resolve(import.meta.dirname, '../../../core/src', f)).href;
const home = process.env.METATROOPER_HOME!;
const marker = process.env.M612_MARKER!;

// The secret is saved by another process, so this one decrypts it from the store as the workbench does.
const saved = spawnSync(process.execPath, ['--input-type=module', '-e', `
  const { openCoreDb } = await import(${JSON.stringify(core('store/db.ts'))});
  const { setBrowserSecret } = await import(${JSON.stringify(core('secrets.ts'))});
  const db = openCoreDb();
  setBrowserSecret(db, 'BANK_PW', 'https://bank.test/login', process.env.M612_MARKER);
  db.close();
`], { encoding: 'utf8', env: process.env });
if (saved.status !== 0) throw new Error(saved.stderr);

const { openCoreDb } = await import(core('store/db.ts'));
const { browserPipe } = await import(core('paths.ts'));
const { createDecoder, encode } = await import(core('pipe/framing.ts'));
const { Approvals } = await import(core('approvals.ts'));
const { PaneManager } = await import('../../src/browser/panes.ts');
const { startBrowserServer } = await import('../../src/browser/server.ts');

const db = openCoreDb();
const at = new Date().toISOString();
db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', home, 'p', at, at);
db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, 1, ?)').run('e1', '{}', 'local-cli');
db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, pid) VALUES ('s1', 'p1', 'e1', 'pty', 'working', ?, ?, ?)").run(at, at, process.pid);
db.prepare("INSERT INTO browser_pane (id, project_id, session_id, url, open) VALUES ('bp_agent_1', 'p1', 's1', 'https://bank.test/login', 1)").run();

const events: Array<Record<string, unknown>> = [];
const pm = new PaneManager({ isDestroyed: () => false } as never, { db: () => db, probe() {}, paneEvent: (ev: Record<string, unknown>) => events.push(ev) } as never);
const internal = pm as unknown as Record<string, any>;

// What the page looks like: its URL and the field the ref points at
const page = { url: 'https://bank.test/login', password: true };
const inserted: string[] = [];
const wc = Object.assign(new EventEmitter(), {
  isDestroyed: () => false, getURL: () => page.url, getTitle: () => 'Bank', isLoading: () => false, getZoomFactor: () => 1,
  navigationHistory: { canGoBack: () => false, canGoForward: () => false },
});
const pane = {
  row: { id: 'bp_agent_1', project_id: 'p1', session_id: 's1' }, view: { webContents: wc }, refs: { byRef: new Map(), byKey: new Map() },
  lastSnapshot: new Map(), cursors: new Map(), navs: 0, crashed: null, console: [] as Array<{ at: number; level: string; text: string }>, network: new Map(),
  dialog: null, errorFor: null, clickedAt: 0, popups: new Set(), pickStack: [], ready: Promise.resolve(), handoff: null, secretOnPage: false, scripted: false,
};
internal.panes.set('bp_agent_1', pane);
internal.describeControl = async () => ({ origin: new URL(page.url).origin, control: { automation_id: 'pw', name: 'Password', role: 'textbox' }, password: page.password, hidden: false });
internal.target = async () => ({ node: { backendNodeId: 5 }, x: 1, y: 1 });
internal.clickAt = async (_p: unknown, _x: number, _y: number, recheck: () => Promise<void>) => recheck();
internal.answer = async (_p: unknown, _s: string, work: () => Promise<Record<string, unknown>>) => ({ ...(await work()), url: page.url, title: 'Bank' });
// The element a real describe resolves to (see the child-frame section)
let field: Record<string, unknown> = {};
let axName = 'Password';
// What has focus in the main frame: the real focused-element walk runs against this document, as CDP would run it.
// Each element carries the DOM.describeNode answer for it; the target stub's field is backendNodeId 5.
const focusDoc: Record<string, any> = { body: {} };
const element = (tag: string, node: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ tagName: tag, ownerDocument: focusDoc, node: { nodeName: tag, ...node }, ...extra });
focusDoc.activeElement = element('INPUT', { backendNodeId: 5 });
let focusedEl: Record<string, any> | null = null;
let childOrigin = 'https://evil.test';
internal.cmd = async (_p: unknown, method: string, params: Record<string, any>) => {
  if (method === 'Runtime.callFunctionOn' && params.objectId === 'field') return { result: { value: new Function(`return (${params.functionDeclaration})`)().call(field) } };
  if (method === 'Runtime.evaluate' && String(params.expression).includes('activeElement')) {
    const v = new Function('document', `return ${params.expression}`)(focusDoc);
    if (v && typeof v === 'object') { focusedEl = v; return { result: { objectId: 'focused' } }; }
    return { result: { value: v } };
  }
  if (method === 'DOM.describeNode' && params.objectId === 'focused') return { node: focusedEl!.node };
  if (method === 'Accessibility.getPartialAXTree') return { nodes: [{ backendDOMNodeId: 7, name: { value: axName }, role: { value: 'textbox' } }] };
  if (method === 'Input.insertText') {
    inserted.push(params.text);
    // a page that logs what was typed into it
    pane.console.push({ at: Date.now(), level: 'log', text: `typed ${params.text}` });
  }
  if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F', securityOrigin: new URL(page.url).origin }, childFrames: [{ frame: { id: 'child', securityOrigin: childOrigin } }] } };
  if (method === 'Page.createIsolatedWorld') return { executionContextId: 1 };
  if (method === 'Runtime.evaluate') return { result: { value: marker } };
  return {};
};

await startBrowserServer(browserPipe(), { db: () => db, uiKey: () => null, panes: pm, refreshPanes() {}, openPane: async () => 'x' });
const sock = net.connect(browserPipe());
await new Promise((r) => sock.once('connect', r));
const waiting = new Map<string, (m: any) => void>();
sock.on('data', createDecoder((m: any) => waiting.get(m.id)?.(m)));
let n = 0;
const transcript: string[] = [];
const call = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve) => {
  const id = `t${++n}`;
  waiting.set(id, (m) => { transcript.push(JSON.stringify(m)); resolve(m); });
  sock.write(encode({ jsonrpc: '2.0', id, method, params }));
});
const outcome = (m: any) => (m.error ? m.error.message : 'ok');
const secret = { pane_id: 'bp_agent_1', ref: 'e5', text: '{{secret:BANK_PW}}' };

const r: Record<string, unknown> = {};
r.hello = outcome(await call('browser.hello', { session_id: 's1', pid: process.pid }));

// M6-12b: the password field on the saved origin is filled with the stored value, which the result never carries
r.passwordFieldOnSavedOrigin = outcome(await call('browser.type', secret));
r.filledWithStoredValue = inserted.length === 1 && inserted[0] === marker;
const logged = await call('browser.console', { pane_id: 'bp_agent_1' });
r.consoleScrubbed = JSON.stringify(logged.result).includes('typed [secret]');
r.evaluateAfterFill = outcome(await call('browser.evaluate', { pane_id: 'bp_agent_1', expression: 'document.querySelector("input").value' }));
page.url = 'https://evil.test/login';
r.otherOrigin = outcome(await call('browser.type', secret));
page.url = 'https://bank.test/login';
page.password = false;
r.plainField = outcome(await call('browser.type', secret));
r.unknownSecret = outcome(await call('browser.type', { ...secret, text: '{{secret:NOPE}}' }));
r.insertedOnlyOnce = inserted.length === 1;

// The real describe on a password field inside a child frame: the frame's own origin is checked, not the pane's
const stubDescribe = internal.describeControl;
delete internal.describeControl;
internal.node = () => ({ backendNodeId: 7, frameId: 'child' });
internal.resolve = async () => 'field';
const topWin: Record<string, unknown> = { origin: 'https://bank.test' };
topWin.top = topWin;
const frameWin: Record<string, unknown> = { top: topWin, origin: 'https://bank.test' };
field = { nodeType: 1, id: 'pw', tagName: 'INPUT', type: 'password', ownerDocument: { defaultView: frameWin } };
r.childFrameSameOrigin = outcome(await call('browser.type', secret));
frameWin.origin = 'https://evil.test';
r.childFrameOtherOrigin = outcome(await call('browser.type', secret));
frameWin.origin = 'null';
r.childFrameOpaque = outcome(await call('browser.type', secret));
field = { ...field, ownerDocument: { defaultView: null } };
r.childFrameDetached = outcome(await call('browser.type', secret));
r.childFrameInserted = inserted.length;
// a page that copies the filled value into the field's name and id: describe never hands it to the MCP server
frameWin.origin = 'https://bank.test';
axName = `Password ${marker}`;
field = { ...field, id: `pw-${marker}`, ownerDocument: { defaultView: frameWin } };
r.describeScrubbed = (await call('browser.describe', { pane_id: 'bp_agent_1', ref: 'e5', tool: 'type' })).result?.control;
internal.describeControl = stubDescribe;

// The approval the MCP server asks for carries only the placeholder
const approvals = new Approvals(db, 60_000);
const asked = approvals.check({ session_id: 's1', surface: 'browser', target: 'https://bank.test', action: 'type', args: secret, control: { automation_id: 'pw', name: 'Password', role: 'textbox' }, password: true });
await new Promise((res) => setTimeout(res, 50));
const row = db.prepare("SELECT id, reason FROM approval WHERE status = 'waiting'").get() as { id: string; reason: string };
approvals.resolve({ approval_id: row.id, decision: 'approve' });
r.approval = `${(await asked).decision}: ${row.reason}`;

// M6-12a: an input already past the entry check when handoff lands sends nothing
let release!: () => void;
const glide = new Promise<void>((res) => { release = res; });
const plainClickAt = internal.clickAt;
internal.clickAt = async (...args: unknown[]) => { await glide; return plainClickAt(...args); };
const sentBefore = inserted.length;
const typing = call('browser.type', { pane_id: 'bp_agent_1', ref: 'e5', text: 'late' });
await new Promise((res) => setTimeout(res, 50));
r.handoffMidAction = outcome(await call('browser.handoff', { pane_id: 'bp_agent_1', reason: 'Sign in with your security key' }));
release();
r.inputAfterHandoff = outcome(await typing);
r.nothingSentAfterHandoff = inserted.length === sentBefore;
internal.clickAt = plainClickAt;
// the real cmd refuses input on a handed-off pane, so input between the recheck and the dispatch is not sent either
const dispatched: string[] = [];
const realCmd = (method: string) => (PaneManager.prototype as any).cmd.call(pm, { handoff: pane.handoff, dbg: { sendCommand: async (m: string) => { dispatched.push(m); return {}; } } }, method, {});
r.realCmdWhileHanded = { input: await realCmd('Input.insertText').then(() => 'sent', (e: Error) => e.message), other: await realCmd('DOM.focus').then(() => 'sent', (e: Error) => e.message), dispatched };
pm.act('bp_agent_1', 'give-back');

// M6-12a: after handoff every other tool fails until Give back
page.password = true;
r.handoff = outcome(await call('browser.handoff', { pane_id: 'bp_agent_1', reason: 'Sign in with your security key' }));
r.handoffEvent = events.some((e) => e.kind === 'handoff' && e.reason === 'Sign in with your security key');
r.stateCarriesReason = events.some((e) => e.kind === 'state' && e.handoff === 'Sign in with your security key');
r.whileHanded = {} as Record<string, string>;
for (const [tool, args] of [['snapshot', {}], ['click', { ref: 'e5' }], ['type', { ref: 'e5', text: 'x' }], ['navigate', { url: 'https://bank.test/' }], ['console', {}], ['screenshot', {}], ['describe', { ref: 'e5', tool: 'click' }], ['handoff', { reason: 'again' }]] as const) {
  (r.whileHanded as Record<string, string>)[tool] = outcome(await call(`browser.${tool}`, { pane_id: 'bp_agent_1', ...args }));
}
pm.act('bp_agent_1', 'give-back');
r.afterGiveBack = outcome(await call('browser.console', { pane_id: 'bp_agent_1' }));

// A checked call the MCP server stopped before dispatch (denied, rejected, expired, core offline) reports its outcome for the audit
r.outcome = outcome(await call('browser.outcome', { pane_id: 'bp_agent_1', tool: 'type', status: 'error -32030' }));
r.outcomeBadStatus = outcome(await call('browser.outcome', { pane_id: 'bp_agent_1', tool: 'type', status: `error ${marker}` }));
r.outcomeBadTool = outcome(await call('browser.outcome', { pane_id: 'bp_agent_1', tool: 'evaluate', status: 'error -32030' }));

// One audit row per tool call, with no typed text
const audit = db.prepare("SELECT session_id, payload FROM event WHERE kind = 'browser.tool' ORDER BY seq").all() as Array<{ session_id: string; payload: string }>;
r.audit = audit.map((a) => { const p = JSON.parse(a.payload); return `${a.session_id} ${p.tool} ${p.pane} ${p.origin} ${p.status}`; });
r.auditKeys = [...new Set(audit.flatMap((a) => Object.keys(JSON.parse(a.payload))))].sort();
r.describeIsTheCheckOne = String(PaneManager.prototype['describeControl' as never]).includes('automation_id') && typeof (PaneManager.prototype as any).describePick === 'function';

// Round 2: the pane list goes through the same scrub as tool results, so an OAuth callback code in a pane URL is not shown
db.prepare("UPDATE browser_pane SET url = 'https://bank.test/cb?code=4/0Abc&access_token=zzz' WHERE id = 'bp_agent_1'").run();
r.panesScrubbed = (await call('browser.panes')).result;

// Round 2: a navigate waiting on its first snapshot, and an evaluate waiting on its isolated world, when handoff lands do nothing after it
const stubAnswer = internal.answer;
delete internal.answer;
const hold = () => { let release!: () => void; const held = new Promise<void>((res) => { release = res; }); return { held, release }; };
const snap = hold();
internal.lines = async () => { await snap.held; return []; };
const loaded: string[] = [];
internal.load = async (_p: unknown, url: string) => { loaded.push(url); };
const navigating = call('browser.navigate', { pane_id: 'bp_agent_1', url: 'https://bank.test/next' });
await new Promise((res) => setTimeout(res, 50));
r.handoffMidNavigate = outcome(await call('browser.handoff', { pane_id: 'bp_agent_1', reason: 'Sign in with your security key' }));
snap.release();
r.navigateAfterHandoff = outcome(await navigating);
r.loadedAfterHandoff = loaded;
pm.act('bp_agent_1', 'give-back');
internal.answer = stubAnswer;
pane.secretOnPage = false;
const world = hold();
internal.isolated = async () => { await world.held; return 1; };
const plainCmd = internal.cmd;
let evaluated = 0;
internal.cmd = async (p: unknown, method: string, params: Record<string, any>) => { if (method === 'Runtime.evaluate') evaluated++; return plainCmd(p, method, params); };
const evaluating = call('browser.evaluate', { pane_id: 'bp_agent_1', expression: '1' });
await new Promise((res) => setTimeout(res, 50));
r.handoffMidEvaluate = outcome(await call('browser.handoff', { pane_id: 'bp_agent_1', reason: 'Sign in with your security key' }));
world.release();
r.evaluateAfterHandoff = outcome(await evaluating);
r.evaluatedAfterHandoff = evaluated;
pm.act('bp_agent_1', 'give-back');
internal.cmd = plainCmd;
delete internal.isolated;

// Round 2: a secret is not filled while an evaluate is still running, since its script could wait for the fill and return the value encoded
pane.secretOnPage = false;
const script = hold();
internal.cmd = async (p: unknown, method: string, params: Record<string, any>) => { if (method === 'Runtime.evaluate' && String(params.expression).includes('btoa')) await script.held; return plainCmd(p, method, params); };
const running = call('browser.evaluate', { pane_id: 'bp_agent_1', expression: 'new Promise((r) => setTimeout(() => r(btoa(document.querySelector("input").value)), 5000))' });
await new Promise((res) => setTimeout(res, 50));
const filledBefore = inserted.length;
r.fillDuringEvaluate = outcome(await call('browser.type', secret));
r.nothingFilledDuringEvaluate = inserted.length === filledBefore;
script.release();
r.evaluateFinished = outcome(await running);
internal.cmd = plainCmd;

// Round 3: a finished evaluate can leave a listener on the page that copies what is typed, so no secret is filled until the main frame navigates
const listened = inserted.length;
r.fillAfterEvaluateFinished = outcome(await call('browser.type', secret));
r.nothingFilledAfterEvaluate = inserted.length === listened;
pane.scripted = false;

// Round 2: Input.insertText types into whatever has focus, so a secret is typed only when focus is still on the checked field
const theField = focusDoc.activeElement;
const moveFocusOnSelectAll = (to: Record<string, unknown>) => {
  internal.cmd = async (p: unknown, method: string, params: Record<string, any>) => {
    if (method === 'Input.dispatchKeyEvent' && params.commands?.includes('selectAll')) focusDoc.activeElement = to;
    return plainCmd(p, method, params);
  };
};
const typedBefore = inserted.length;
moveFocusOnSelectAll(element('INPUT', { backendNodeId: 9 }));
r.focusMovedToPlainField = outcome(await call('browser.type', secret));
focusDoc.activeElement = theField;
moveFocusOnSelectAll(element('IFRAME', { backendNodeId: 11, frameId: 'child' }, { contentDocument: null }));
r.focusMovedIntoOtherFrame = outcome(await call('browser.type', secret));
r.nothingTypedAfterFocusMoved = inserted.length === typedBefore;
internal.cmd = plainCmd;
// a field inside a cross-origin child frame: focus is in that frame and, in the frame's own document, on the field
const plainTarget = internal.target;
internal.target = async () => ({ node: { backendNodeId: 7, frameId: 'child' }, x: 1, y: 1 });
focusDoc.activeElement = element('IFRAME', { backendNodeId: 11, frameId: 'child' }, { contentDocument: null });
field = { nodeType: 1, id: 'pw', tagName: 'INPUT', type: 'password' };
field.ownerDocument = { activeElement: field };
r.focusInChildFrameOnField = outcome(await call('browser.type', secret));
field.ownerDocument = { activeElement: { tagName: 'INPUT' } };
r.focusInChildFrameOffField = outcome(await call('browser.type', secret));
r.childFrameTyped = inserted.length - typedBefore;
internal.target = plainTarget;

// Round 3: a page handler for the focus or select-all can turn the field into a plain one or move it to another origin, so both are checked again after them
focusDoc.activeElement = theField;
const changeOnSelectAll = (change: () => void) => {
  internal.cmd = async (p: unknown, method: string, params: Record<string, any>) => {
    if (method === 'Input.dispatchKeyEvent' && params.commands?.includes('selectAll')) change();
    return plainCmd(p, method, params);
  };
};
const flippedBefore = inserted.length;
changeOnSelectAll(() => { page.password = false; });
r.fieldTurnedPlainOnSelectAll = outcome(await call('browser.type', secret));
page.password = true;
changeOnSelectAll(() => { page.url = 'https://evil.test/login'; });
r.fieldChangedOriginOnSelectAll = outcome(await call('browser.type', secret));
page.url = 'https://bank.test/login';
r.nothingTypedAfterFieldChanged = inserted.length === flippedBefore;
internal.cmd = plainCmd;

// Round 2: a key with focus inside a frame this world cannot read is checked against that frame's origin
delete internal.describeControl;
focusDoc.activeElement = element('IFRAME', { backendNodeId: 11, frameId: 'child' }, { contentDocument: null });
const keyDescribe = async () => { const d = (await call('browser.describe', { pane_id: 'bp_agent_1', tool: 'key' })); return d.error ? d.error.message : { origin: d.result.origin, hidden: d.result.hidden, control: d.result.control }; };
r.keyFocusInChildFrame = await keyDescribe();
childOrigin = 'null';
r.keyFocusInOpaqueFrame = await keyDescribe();
childOrigin = 'https://evil.test';
focusDoc.activeElement = theField;
internal.describeControl = stubDescribe;

// Round 4: data_base64 is left unscrubbed only in a screenshot's result, not under that key in what an evaluate returns
pane.secretOnPage = false;
const evalReturns = (value: unknown) => {
  internal.cmd = async (p: unknown, method: string, params: Record<string, any>) => (method === 'Runtime.evaluate' && params.expression === 'x' ? { result: { value } } : plainCmd(p, method, params));
};
evalReturns({ data_base64: marker, nested: { data_base64: marker } });
r.evaluateImageKeyScrubbed = (await call('browser.evaluate', { pane_id: 'bp_agent_1', expression: 'x' })).result;
// Round 4: text is scrubbed whole before any cut, so a cut through a secret leaves no prefix of it
const cutAt = marker.slice(0, 9);
evalReturns(`${'a'.repeat(20 * 1024 - 10)}${marker}`);
r.evaluateCutScrubbed = !JSON.stringify((await call('browser.evaluate', { pane_id: 'bp_agent_1', expression: 'x' })).result).includes(cutAt);
pane.scripted = false;
let readText = '';
internal.cmd = async (p: unknown, method: string, params: Record<string, any>) => {
  if (method === 'Runtime.evaluate' && String(params.expression).includes('innerText')) return { result: { value: readText } };
  if (method === 'Accessibility.getFullAXTree') return { nodes: params.frameId === 'F' ? [{ nodeId: '1', role: { value: 'heading' }, name: { value: `${'a'.repeat(110)}${marker}` } }] : [] };
  return plainCmd(p, method, params);
};
readText = 'a'.repeat(5000);
const cut = String((await call('browser.read', { pane_id: 'bp_agent_1', max_tokens: 200 })).result.text).split('\n')[0].length;
const cutReads: string[] = [];
for (const k of [cut - 12, cut - 9, cut - 6]) {
  readText = `${'a '.repeat(k).slice(0, k)}${marker} ${'b '.repeat(100)}`;
  cutReads.push(JSON.stringify((await call('browser.read', { pane_id: 'bp_agent_1', max_tokens: 200 })).result));
}
r.readCutScrubbed = !cutReads.some((t) => t.includes(cutAt));
delete internal.lines;
r.snapshotNameCutScrubbed = !JSON.stringify((await call('browser.snapshot', { pane_id: 'bp_agent_1' })).result).includes(cutAt);
internal.log(pane, 'log', `${'a'.repeat(1991)}${marker}`);
await internal.onDebuggerEvent(pane, 'Network.requestWillBeSent', { requestId: 'q1', request: { method: 'GET', url: `https://bank.test/${'a/'.repeat(1000).slice(0, 2000 - 18 - 9)}${marker}` } });
r.consoleCutScrubbed = !JSON.stringify((await call('browser.console', { pane_id: 'bp_agent_1' })).result).includes(cutAt);
r.networkCutScrubbed = !JSON.stringify((await call('browser.network', { pane_id: 'bp_agent_1' })).result).includes(cutAt);
await internal.onDebuggerEvent(pane, 'Page.javascriptDialogOpening', { type: 'alert', message: `${'a'.repeat(191)}${marker}` });
r.dialogCutScrubbed = !String((await call('browser.read', { pane_id: 'bp_agent_1' })).error?.message).includes(cutAt);
pane.dialog = null;
internal.cmd = plainCmd;

// Round 4: a navigate whose URL check is still resolving the host when handoff lands does not load the page
delete internal.load;
const dnsHeld = hold();
internal.paneCtx = () => ({ ownedPorts: new Set(), allowHosts: new Set(), lookup: async () => { await dnsHeld.held; return ['93.184.216.34']; } });
const paneLoads: string[] = [];
Object.assign(wc, { loadURL: async (u: string) => { paneLoads.push(u); } });
const resolving = call('browser.navigate', { pane_id: 'bp_agent_1', url: 'https://bank.test/next' });
await new Promise((res) => setTimeout(res, 50));
r.handoffMidUrlCheck = outcome(await call('browser.handoff', { pane_id: 'bp_agent_1', reason: 'Sign in with your security key' }));
dnsHeld.release();
r.navigateAfterUrlCheck = outcome(await resolving);
r.loadedAfterUrlCheck = paneLoads;
pm.act('bp_agent_1', 'give-back');
delete internal.paneCtx;

// M1-05 style scan: the value is in no table, file, tool result or event
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
const hits = tables.filter(({ name }) => JSON.stringify(db.prepare(`SELECT * FROM "${name}"`).all()).includes(marker)).map(({ name }) => `table ${name}`);
db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
for (const f of fs.readdirSync(home, { recursive: true }).map((x) => path.join(home, String(x))).filter((x) => fs.statSync(x).isFile())) if (fs.readFileSync(f).includes(marker)) hits.push(`file ${path.relative(home, f)}`);
if (transcript.some((t) => t.includes(marker))) hits.push('tool result');
if (events.some((e) => JSON.stringify(e).includes(marker))) hits.push('pane event');
r.markerFound = hits;

sock.destroy();
db.close();
console.log(JSON.stringify(r));
process.exit(0);
