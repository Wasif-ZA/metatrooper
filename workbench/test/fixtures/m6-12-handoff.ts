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
  dialog: null, errorFor: null, clickedAt: 0, popups: new Set(), pickStack: [], ready: Promise.resolve(), handoff: null, secretOnPage: false,
};
internal.panes.set('bp_agent_1', pane);
internal.describe = async () => ({ origin: new URL(page.url).origin, control: { automation_id: 'pw', name: 'Password', role: 'textbox' }, password: page.password, hidden: false });
internal.target = async () => ({ node: { backendNodeId: 5 }, x: 1, y: 1 });
internal.clickAt = async (_p: unknown, _x: number, _y: number, recheck: () => Promise<void>) => recheck();
internal.answer = async (_p: unknown, _s: string, work: () => Promise<Record<string, unknown>>) => ({ ...(await work()), url: page.url, title: 'Bank' });
// The element a real describe resolves to (see the child-frame section)
let field: Record<string, unknown> = {};
internal.cmd = async (_p: unknown, method: string, params: Record<string, any>) => {
  if (method === 'Runtime.callFunctionOn' && params.objectId === 'field') return { result: { value: new Function(`return (${params.functionDeclaration})`)().call(field) } };
  if (method === 'Accessibility.getPartialAXTree') return { nodes: [{ backendDOMNodeId: 7, name: { value: 'Password' }, role: { value: 'textbox' } }] };
  if (method === 'Input.insertText') {
    inserted.push(params.text);
    // a page that logs what was typed into it
    pane.console.push({ at: Date.now(), level: 'log', text: `typed ${params.text}` });
  }
  if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'F' } } };
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
const stubDescribe = internal.describe;
delete internal.describe;
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
internal.describe = stubDescribe;

// The approval the MCP server asks for carries only the placeholder
const approvals = new Approvals(db, 60_000);
const asked = approvals.check({ session_id: 's1', surface: 'browser', target: 'https://bank.test', action: 'type', args: secret, control: { automation_id: 'pw', name: 'Password', role: 'textbox' }, password: true });
await new Promise((res) => setTimeout(res, 50));
const row = db.prepare("SELECT id, reason FROM approval WHERE status = 'waiting'").get() as { id: string; reason: string };
approvals.resolve({ approval_id: row.id, decision: 'approve' });
r.approval = `${(await asked).decision}: ${row.reason}`;

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

// One audit row per tool call, with no typed text
const audit = db.prepare("SELECT session_id, payload FROM event WHERE kind = 'browser.tool' ORDER BY seq").all() as Array<{ session_id: string; payload: string }>;
r.audit = audit.map((a) => { const p = JSON.parse(a.payload); return `${a.session_id} ${p.tool} ${p.pane} ${p.origin} ${p.status}`; });
r.auditKeys = [...new Set(audit.flatMap((a) => Object.keys(JSON.parse(a.payload))))].sort();
r.describeIsTheCheckOne = String(PaneManager.prototype['describe' as never]).includes('automation_id') && typeof (PaneManager.prototype as any).describePick === 'function';

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
