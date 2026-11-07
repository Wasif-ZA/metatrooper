import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Desktop, changeSummary } from '../src/desktop/driver.ts';
import { screenResult } from '../src/hook/screen-data.ts';

const SEND = { name: 'Send', automation_id: 'send', role: 'button', rid: '42.7' };
const DELETE = { name: 'Delete', automation_id: 'del', role: 'button', rid: '42.8' };
const ARCHIVE = { name: 'Zebra Quokka Archive', automation_id: 'arc', role: 'button', rid: '42.9' };
const WINDOW = { hwnd: 100, pid: 4100, process_start: '2026-10-12T01:00:00.000Z', exe: 'fake.exe', title: 'Compose', controls: [SEND, DELETE] };
const CHANGED = { ...WINDOW, title: 'New', controls: [{ ...SEND, name: 'Send now' }, DELETE, ARCHIVE] };
const expectOf = (c: typeof SEND) => ({ name: c.name, automation_id: c.automation_id, role: c.role, password: false, hidden: false, file_dialog: false, grant_id: 'gr_fixture' });
const PARAMS = { session_id: 's1', pid: process.pid, window: 100 };
const ME = { session_id: 's1', pid: process.pid };
const TAG_A = String.fromCodePoint(0xe0041);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function fixture(t: any, options: Record<string, unknown> = {}, home = mkdtempSync(join(tmpdir(), 'm8-40-takeover-'))) {
  const statePath = join(home, 'state.json');
  const logPath = join(home, 'input.jsonl');
  let state: any = { windows: [WINDOW], ...options };
  const update = (changes: object) => { state = { ...state, ...changes }; writeFileSync(statePath, JSON.stringify(state)); };
  if (!existsSync(statePath)) update({}); else state = JSON.parse(readFileSync(statePath, 'utf8'));
  const env = { METATROOPER_UIA_HELPER: join(import.meta.dirname, 'fake-uia-helper.js'), FAKE_UIA_STATE: statePath, FAKE_UIA_LOG: logPath, FAKE_UIA_DELAY_MS: '0' };
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  const dbPath = join(home, 'synthetic.sqlite');
  const fresh = !existsSync(dbPath);
  const db = new DatabaseSync(dbPath);
  if (fresh) {
    db.exec(readFileSync(new URL('../../contracts/schema.sql', import.meta.url), 'utf8'));
    db.exec("PRAGMA foreign_keys=OFF; INSERT INTO project (id,path,name,opened_at,last_opened) VALUES ('p1','/fixture','Fixture','t','t'); INSERT INTO session (id,project_id,engine_id,host,state,state_at,started_at,pid) VALUES ('s1','p1','fake','pty','working','t','t',1); INSERT INTO plugin (id,enabled,manifest,path,source,permissions,version,installed_at) VALUES ('desktop',1,'{}','','builtin','[]','1','t'); INSERT INTO grant (id,session_id,hwnd,pid,process_start,exe,title,created_at) VALUES ('gr_fixture','s1',100,4100,'2026-10-12T01:00:00.000Z','fake.exe','Compose','t')");
  }
  const desktop = new Desktop(db);
  const methods = new Map<string, any>();
  desktop.methods(methods);
  (desktop as any).bound.add('s1 ' + process.pid);
  Object.assign(desktop as any, { uiPid: process.pid, uiStart: `start-of-${process.pid}`, noTakeover: null });
  db.prepare("UPDATE session SET pid=? WHERE id='s1'").run(process.pid);
  const call = (method: string, p: object = PARAMS) => Promise.resolve().then(() => methods.get(method).handler(p));
  const act = (p: object = {}) => call('desktop.act', { ...PARAMS, action: 'click', ref: 'e1', expect: expectOf(SEND), ...p });
  const stop = async () => {
    const child = (desktop.helper as any).child;
    desktop.helper.stop();
    if (child && child.exitCode === null) await new Promise(r => child.once('exit', r));
    db.close();
  };
  let stopped = false;
  t.after(async () => {
    if (!stopped) await stop();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (fresh) rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { home, db, call, act, update, methods, inputs: () => (existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean) : []).map(s => JSON.parse(s)), stop: async () => { stopped = true; await stop(); } };
}

/** Pauses after a request, lets the before-read settle, and changes the window to CHANGED. */
async function pauseAndChange(f: ReturnType<typeof fixture>) {
  await f.call('takeover.pause', {});
  await sleep(200);
  f.update({ windows: [CHANGED] });
}

const metaRequests = (f: ReturnType<typeof fixture>): Record<string, any> => {
  const row = f.db.prepare("SELECT value FROM meta WHERE key = 'takeover_requests'").get() as { value: string } | undefined;
  return row ? JSON.parse(row.value) : {};
};

test('takeover: a request only asks; the agent can still act and the reason is held in meta', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.call('takeover.request', { ...ME, reason: 'Need your login' }), { requested: true, paused: false });
  const r: any = await f.act();
  assert.equal(r.status, 'confirmed');
  assert.equal(f.inputs().length, 1);
  assert.deepEqual(await f.call('takeover.status', ME), { requested: true, paused: false });
  assert.equal(metaRequests(f).s1.reason, 'Need your login');
});

test('takeover: the request reason has invisible, bidi and control characters removed, is trimmed, and is cut to 200 characters', async t => {
  const f = fixture(t);
  await f.call('takeover.request', { ...ME, reason: `  Log​in\u0007 now\n${TAG_A}  ` });
  assert.equal(metaRequests(f).s1.reason, 'Login now');
  await f.call('takeover.request', { ...ME, reason: `‮⁦​${TAG_A}` });
  assert.equal(metaRequests(f).s1.reason, '');
  await f.call('takeover.request', { ...ME, reason: 'a'.repeat(250) });
  assert.equal(metaRequests(f).s1.reason.length, 200);
  await f.call('takeover.request', { ...ME });
  assert.equal(metaRequests(f).s1.reason, '');
});

test('takeover: a request from a caller not bound to the session, or for an unknown session, is refused and records nothing', async t => {
  const f = fixture(t);
  const stranger = new Desktop(f.db);
  const methods = new Map<string, any>();
  stranger.methods(methods);
  await assert.rejects(Promise.resolve().then(() => methods.get('takeover.request').handler({ session_id: 's1', pid: 4, reason: 'x' })));
  await assert.rejects(f.call('takeover.request', { session_id: 'nope', pid: process.pid, reason: 'x' }));
  assert.equal(metaRequests(f).s1, undefined);
});

test('takeover: full flow, request, pause, change, resume hands the capped change summary to status exactly once', async t => {
  const f = fixture(t);
  await f.call('takeover.request', { ...ME, reason: 'Need your login' });
  await f.call('takeover.pause', {});
  await sleep(200);
  f.update({ windows: [CHANGED] });
  await f.call('takeover.resume', { session_id: 's1' });
  const first: any = await f.call('takeover.status', ME);
  assert.equal(first.requested, false);
  assert.equal(first.paused, false);
  assert.equal(typeof first.changes.resumed_at, 'string');
  assert.deepEqual(first.changes.windows, [{
    window: 100,
    title_before: 'Compose',
    title: 'New',
    added: ['button "Send now"', 'button "Zebra Quokka Archive"'],
    removed: ['button "Send"'],
    more: 0,
  }]);
  assert.deepEqual(await f.call('takeover.status', ME), { requested: false, paused: false });
});

test('takeover: a take-over with no request yields no summary', async t => {
  const f = fixture(t);
  await pauseAndChange(f);
  await f.call('takeover.resume', { session_id: 's1' });
  const s: any = await f.call('takeover.status', ME);
  assert.equal('changes' in s, false);
  assert.deepEqual(s, { requested: false, paused: false });
});

test('takeover: during resume the flag stays set until the summary exists; both are set by the time resume returns', async t => {
  const f = fixture(t);
  await f.call('takeover.request', { ...ME, reason: 'x' });
  await f.call('takeover.pause', {});
  await sleep(200);
  f.update({ windows: [CHANGED], delay_op: 'snapshot', delay_ms: 400 });
  const resuming = f.call('takeover.resume', { session_id: 's1' });
  await sleep(100);
  assert.deepEqual(await f.call('takeover.status', ME), { requested: true, paused: true });
  await resuming;
  const after: any = await f.call('takeover.status', ME);
  assert.equal(after.paused, false);
  assert.equal(after.requested, false);
  assert.equal(after.changes.windows.length, 1);
  assert.equal(after.changes.windows[0].title, 'New');
});

test('takeover: the change summary is kept in memory, and no snapshot text reaches any SQLite table', async t => {
  const f = fixture(t);
  await f.call('takeover.request', { ...ME, reason: 'Need your login' });
  await f.call('takeover.pause', {});
  await sleep(200);
  f.update({ windows: [CHANGED] });
  await f.call('takeover.resume', { session_id: 's1' });
  const s: any = await f.call('takeover.status', ME);
  assert.match(JSON.stringify(s.changes), /Zebra Quokka Archive/);
  const tables = (f.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(r => r.name);
  const dump = tables.flatMap(name => (f.db.prepare(`SELECT * FROM "${name}"`).all() as object[]).map(r => JSON.stringify(r))).join('\n');
  assert.ok(dump.includes('takeover_resumed'), 'the scan reads the meta table');
  assert.equal(dump.includes('Zebra Quokka'), false);
  assert.equal(dump.includes('Send now'), false);
});

test('takeover: requests and the take-over flag reset when a new Desktop starts over the same DB', async t => {
  const first = fixture(t);
  await first.call('takeover.request', { ...ME, reason: 'x' });
  await first.call('takeover.pause', {});
  await sleep(200);
  assert.deepEqual(await first.call('takeover.status', ME), { requested: true, paused: true });
  // A new core over the same DB: a second Desktop on first.db (fixture's cleanup closes the DB once, at the end).
  const restarted = new Desktop(first.db);
  const methods = new Map<string, any>();
  restarted.methods(methods);
  (restarted as any).bound.add('s1 ' + process.pid);
  assert.deepEqual(await methods.get('takeover.status').handler(ME), { requested: false, paused: false });
  assert.equal(metaRequests(first).s1, undefined);
});

test('changeSummary: 30 added lines keep 20 and count the other 10 in more', () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
  const s = changeSummary(new Map([['g', { hwnd: 1, title: 'T', text: 'old' }]]), new Map([['g', { hwnd: 1, title: 'T', text: lines }]]));
  const w: any = s.windows[0];
  assert.equal(w.added.length, 20);
  assert.equal(w.more, 10);
  assert.deepEqual(w.removed, ['old']);
});

test('changeSummary: a 500 character line is cut to 200', () => {
  const s = changeSummary(new Map([['g', { hwnd: 1, title: 'T', text: 'old' }]]), new Map([['g', { hwnd: 1, title: 'T', text: 'x'.repeat(500) }]]));
  const w: any = s.windows[0];
  assert.equal(w.added[0].length, 200);
  assert.equal(w.more, 0);
});

test('changeSummary: 10 windows are cut to 8', () => {
  const before = new Map<string, any>();
  const after = new Map<string, any>();
  for (let i = 0; i < 10; i++) {
    before.set(`g${i}`, { hwnd: i + 1, title: 'T', text: 'a' });
    after.set(`g${i}`, { hwnd: i + 1, title: 'T', text: 'b' });
  }
  assert.equal(changeSummary(before, after).windows.length, 8);
});

test('changeSummary: a window that cannot be read after resume is gone', () => {
  const s = changeSummary(new Map([['g', { hwnd: 7, title: 'T', text: 'x' }]]), new Map([['g', null]]));
  assert.deepEqual(s.windows, [{ window: 7, gone: true }]);
});

test('changeSummary: a window with no before-read is no_before and lists its current lines', () => {
  const s = changeSummary(new Map(), new Map([['g', { hwnd: 9, title: 'Win', text: 'button "A" [ref=e1]\nbutton "B" [ref=e2]' }]]));
  assert.deepEqual(s.windows, [{ window: 9, title: 'Win', added: [], removed: [], more: 0, no_before: true, now: ['button "A"', 'button "B"'] }]);
});

test('screenResult: a request_takeover style result has its tag removed and ends with the untrusted-data label', () => {
  const text = 'What the user changed: ' + JSON.stringify({ added: [`button "Pay${TAG_A}"`] });
  const r: any = screenResult({ content: [{ type: 'text', text }] });
  assert.equal(r.content.length, 2);
  assert.equal(r.content[0].text, 'What the user changed: ' + JSON.stringify({ added: ['button "Pay"'] }));
  assert.equal(r.content[0].text.includes(TAG_A), false);
  assert.equal(r.content[1].type, 'text');
  assert.match(r.content[1].text, /untrusted screen data/i);
});
