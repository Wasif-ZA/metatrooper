// Drives the workbench browser server and a mocked pane for the 2026-10-18 decisions D3, D4, D6 and D8; prints one JSON line.
import { mock } from 'node:test';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: {}, WebContentsView: class {} } });
const core = (f: string) => pathToFileURL(path.resolve(import.meta.dirname, '../../../core/src', f)).href;
const home = process.env.METATROOPER_HOME!;
const marker = process.env.M612_MARKER!;

// saved by another process and never filled, so this process has not decrypted it
const saved = spawnSync(process.execPath, ['--input-type=module', '-e', `
  const { openCoreDb } = await import(${JSON.stringify(core('store/db.ts'))});
  const { setBrowserSecret } = await import(${JSON.stringify(core('secrets.ts'))});
  const db = openCoreDb();
  setBrowserSecret(db, 'UNFILLED', 'https://bank.test/login', process.env.M612_MARKER);
  db.close();
`], { encoding: 'utf8', env: process.env });
if (saved.status !== 0) throw new Error(saved.stderr);

const { openCoreDb } = await import(core('store/db.ts'));
const { browserPipe, dbFile } = await import(core('paths.ts'));
const { createDecoder, encode } = await import(core('pipe/framing.ts'));
const { PaneManager } = await import('../../src/browser/panes.ts');
const { startBrowserServer } = await import('../../src/browser/server.ts');

const db = openCoreDb();
const at = new Date().toISOString();
db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', home, 'p', at, at);
db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, 1, ?)').run('e1', '{}', 'local-cli');
db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, pid) VALUES ('s1', 'p1', 'e1', 'pty', 'working', ?, ?, ?)").run(at, at, process.pid);
db.prepare("INSERT INTO browser_pane (id, project_id, session_id, url, open) VALUES ('bp_agent_1', 'p1', 's1', 'https://bank.test/login', 1)").run();

const pm = new PaneManager({ isDestroyed: () => false } as never, { db: () => db, probe() {}, paneEvent() {} } as never);
const internal = pm as unknown as Record<string, any>;
const wc = Object.assign(new EventEmitter(), {
  isDestroyed: () => false, getURL: () => 'https://bank.test/login', getTitle: () => 'Bank', isLoading: () => false, isLoadingMainFrame: () => false, getZoomFactor: () => 1,
  navigationHistory: { canGoBack: () => false, canGoForward: () => false },
});
const pane = {
  row: { id: 'bp_agent_1', project_id: 'p1', session_id: 's1' }, view: { webContents: wc }, refs: { byRef: new Map(), byKey: new Map() },
  lastSnapshot: new Map(), cursors: new Map(), navs: 0, crashed: null, console: [] as Array<{ at: number; level: string; text: string }>, network: new Map(),
  dialog: null, errorFor: null, clickedAt: 0, popups: new Set(), pickStack: [], ready: Promise.resolve(), handoff: null, secretOnPage: false, scripted: false,
};
internal.panes.set('bp_agent_1', pane);
// the page's text carries the secret; the old wait_for asked the page itself whether its text included the guess
internal.evalIsolated = async (_p: unknown, expression: string) => (expression.includes('.includes(') ? expression.includes(marker) : `Welcome ${marker} home`);

const r: Record<string, unknown> = {};

// D6: a guess at the secret is not found; plain page text is
r.waitGuess = await internal.run(pane, 'wait_for', { text: marker, timeout_ms: 300 });
r.waitPlain = await internal.run(pane, 'wait_for', { text: 'Welcome', timeout_ms: 300 });
// D4: evaluate scrubs a saved secret this process never decrypted
r.evaluate = await internal.run(pane, 'evaluate', { expression: 'document.body.innerText' });
pane.scripted = false;

await startBrowserServer(browserPipe(), { db: () => db, uiKey: () => null, panes: pm, refreshPanes() {}, openPane: async () => 'x' });

// D3: the browser pipe sends nothing until the client speaks
const sock = net.connect(browserPipe());
await new Promise((res) => sock.once('connect', res));
let unasked = 0;
const waiting = new Map<string, (m: any) => void>();
sock.on('data', (chunk) => { if (!waiting.size) unasked += chunk.length; });
sock.on('data', createDecoder((m: any) => { const w = waiting.get(m.id); waiting.delete(m.id); w?.(m); }));
await new Promise((res) => setTimeout(res, 300));
r.unaskedBytes = unasked;
let n = 0;
const call = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve) => {
  const id = `t${++n}`;
  waiting.set(id, resolve);
  sock.write(encode({ jsonrpc: '2.0', id, method, params }));
});
r.hello = (await call('browser.hello', { session_id: 's1', pid: process.pid })).result?.bound;

// D4: a console line that reached the log unscrubbed is scrubbed on the way out
pane.console.push({ at: Date.now(), level: 'log', text: `typed ${marker}` });
r.console = (await call('browser.console', { pane_id: 'bp_agent_1' })).result;

// D8: a busy database delays the audit row instead of dropping it; one busy past every try is logged
const rows = () => (db.prepare("SELECT COUNT(*) AS n FROM event WHERE kind = 'browser.tool'").get() as { n: number }).n;
const holdWhile = async (ms: number, work: () => Promise<unknown>) => {
  const locker = new DatabaseSync(dbFile());
  locker.exec('BEGIN IMMEDIATE');
  setTimeout(() => { locker.exec('COMMIT'); locker.close(); }, ms);
  await work();
  await new Promise((res) => setTimeout(res, ms + 900));
};
const before = rows();
await holdWhile(300, () => call('browser.console', { pane_id: 'bp_agent_1' }));
r.auditAfterBusy = rows() - before;
const mid = rows();
await holdWhile(1600, () => call('browser.console', { pane_id: 'bp_agent_1' }));
r.auditAfterLongBusy = rows() - mid;

sock.destroy();
console.log(JSON.stringify(r));
process.exit(0);
