import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Approvals } from '../src/approvals.ts';
import { Desktop } from '../src/desktop/driver.ts';
import { migrate } from '../src/store/db.ts';
import { cleanScreenText, screenResult } from '../src/hook/screen-data.ts';

const SEND = { name: 'Send', automation_id: 'send', role: 'button', rid: '42.7' };
const DELETE = { name: 'Delete', automation_id: 'del', role: 'button', rid: '42.8' };
const WINDOW = { hwnd: 100, pid: 4100, process_start: '2026-10-12T01:00:00.000Z', exe: 'fake.exe', title: 'Compose', controls: [SEND, DELETE] };
const expectOf = (c: typeof SEND) => ({ name: c.name, automation_id: c.automation_id, role: c.role, password: false, hidden: false, file_dialog: false, grant_id: 'gr_fixture' });
const PARAMS = { session_id: 's1', pid: process.pid, window: 100 };
const rows = (file: string): any[] => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];

function fixture(t: any, options: Record<string, unknown> = {}, home = mkdtempSync(join(tmpdir(), 'm8-40-'))) {
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
  const check = (p: object = {}) => new Approvals(db, 5000, () => [], { granted: () => true }).check({ session_id: 's1', surface: 'desktop', target: 'gr_fixture', action: 'click', args: { window: 100, ref: 'e1' }, control: expectOf(SEND), ...p } as any);
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
  return { home, db, call, act, check, update, methods, inputs: () => rows(logPath), stop: async () => { stopped = true; await stop(); } };
}

const unverifiable = { input_status: 'unverifiable' };
const HASH = /^[a-f0-9]{64}$/;
const held = (e: any) => { assert.equal(e.code, -32030); assert.match(e.message, /unresolved outcome/); return true; };

test('M8-40a: an unverifiable click returns its action_hash and the identical retry is refused with nothing sent', async t => {
  const f = fixture(t, unverifiable);
  const first = await f.act();
  assert.equal(first.status, 'unverifiable');
  assert.match(first.action_hash, HASH);
  await assert.rejects(f.act(), held);
  assert.equal(f.inputs().length, 1);
});

test('M8-40a: a confirmed risky click is not held, and a retry goes through', async t => {
  const f = fixture(t);
  const first = await f.act();
  assert.equal(first.status, 'confirmed');
  assert.deepEqual(await f.act(), { status: 'confirmed', action_hash: first.action_hash });
  assert.equal(f.inputs().length, 2);
});

test('M8-40a: approval.check also denies the held action, even where a session approval would cover it', async t => {
  const f = fixture(t, unverifiable);
  await f.act();
  const r: any = await f.check();
  assert.equal(r.decision, 'deny');
  assert.match(r.reason, /unresolved outcome/);
});

test('M8-40a: a different action_hash is not held', async t => {
  const f = fixture(t, unverifiable);
  await f.act();
  const other = await f.act({ ref: 'e2', expect: expectOf(DELETE) });
  assert.equal(other.status, 'unverifiable');
  assert.equal(f.inputs().length, 2);
});

test('M8-40a: a non-risky action is neither held nor given an action_hash', async t => {
  const f = fixture(t, unverifiable);
  const r = await f.act({ action: 'key', keys: 'Tab' });
  assert.equal(r.status, 'unverifiable');
  assert.equal(r.action_hash, undefined);
  assert.deepEqual((await f.act({ action: 'key', keys: 'Tab' })).status, 'unverifiable');
  assert.equal(f.inputs().length, 2);
});

test('M8-40a: changing verify_title does not make a held action look new', async t => {
  const f = fixture(t, unverifiable);
  await f.act({ verify_title: 'Sent' });
  await assert.rejects(f.act({ verify_title: 'Sent items' }), held);
  await assert.rejects(f.act(), held);
  assert.equal(f.inputs().length, 1);
});

test('M8-40a: the user releasing the hash lets the retry through, once', async t => {
  const f = fixture(t, unverifiable);
  const { action_hash } = await f.act();
  assert.equal(f.methods.get('desktop.action.release').needsUi, true);
  assert.equal(f.methods.get('desktop.action.held').needsUi, true);
  assert.equal(f.methods.has('desktop.action.verify'), true);
  assert.equal(f.methods.get('desktop.action.verify').needsUi, undefined);
  const list: any = await f.call('desktop.action.held', { session_id: 's1' });
  assert.deepEqual(list.actions.map((a: any) => [a.action_hash, a.status]), [[action_hash, 'unverifiable']]);
  assert.deepEqual(await f.call('desktop.action.release', { session_id: 's1', action_hash }), { status: 'released' });
  assert.deepEqual((await f.call('desktop.action.held', { session_id: 's1' }) as any).actions, []);
  assert.equal((await f.act()).status, 'unverifiable');
  assert.equal(f.inputs().length, 2);
  await assert.rejects(f.act(), held);
});

test('M8-40a: release refuses an unknown hash, a malformed hash, and another session\'s hash', async t => {
  const f = fixture(t, unverifiable);
  const { action_hash } = await f.act();
  await assert.rejects(f.call('desktop.action.release', { session_id: 's1', action_hash: 'a'.repeat(64) }), /no completed held action/);
  await assert.rejects(f.call('desktop.action.release', { session_id: 's1', action_hash: 'nope' }), /sha256 hex/);
  await assert.rejects(f.call('desktop.action.release', { session_id: 's2', action_hash }), /no completed held action/);
  await assert.rejects(f.act(), held);
});

test('M8-40a: release does not approve the retry; the approval gate still applies', async t => {
  const f = fixture(t, unverifiable);
  const { action_hash } = await f.act();
  await f.call('desktop.action.release', { session_id: 's1', action_hash });
  const r: any = await f.check({ session_id: 's1' });
  assert.doesNotMatch(String(r.reason ?? ''), /unresolved outcome/);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM approval WHERE status='approved'").get()!.n, 0);
});

test('M8-40a: a proving read (title moved to the declared verify_title) clears the hold', async t => {
  const f = fixture(t, unverifiable);
  const { action_hash } = await f.act({ verify_title: 'Sent' });
  assert.deepEqual(await f.call('desktop.action.verify', { ...PARAMS, action_hash }), { confirmed: false });
  await assert.rejects(f.act({ verify_title: 'Sent' }), held);
  f.update({ windows: [{ ...WINDOW, title: 'Sent' }] });
  assert.deepEqual(await f.call('desktop.action.verify', { ...PARAMS, action_hash }), { confirmed: true });
  assert.equal((await f.act()).status, 'unverifiable');
  assert.equal(f.inputs().length, 2);
});

test('M8-40a: a snapshot or find read alone does not clear the hold', async t => {
  const f = fixture(t, unverifiable);
  await f.act({ verify_title: 'Sent' });
  f.update({ windows: [{ ...WINDOW, title: 'Sent' }] });
  await f.call('desktop.snapshot', { ...PARAMS, max_nodes: 50 });
  await f.call('desktop.find', { ...PARAMS, text: 'Send' });
  await assert.rejects(f.act(), held);
});

test('M8-40a: verify cannot clear a hold that had no verify_title declared, or one that was never held', async t => {
  const f = fixture(t, unverifiable);
  const { action_hash } = await f.act();
  f.update({ windows: [{ ...WINDOW, title: 'Sent' }] });
  assert.deepEqual(await f.call('desktop.action.verify', { ...PARAMS, action_hash }), { confirmed: false });
  await assert.rejects(f.act(), held);
  await assert.rejects(f.call('desktop.action.verify', { ...PARAMS, action_hash: 'b'.repeat(64) }), /held action not found/);
});

test('M8-40a: verify_title equal to the current title is refused before anything is sent', async t => {
  const f = fixture(t, unverifiable);
  await assert.rejects(f.act({ verify_title: 'Compose' }), (e: any) => { assert.equal(e.code, -32602); return true; });
  await assert.rejects(f.act({ verify_title: '' }), (e: any) => { assert.equal(e.code, -32602); return true; });
  assert.deepEqual(f.inputs(), []);
});

test('M8-40a: the hold survives a core restart (migration 004 table on disk)', async t => {
  const first = fixture(t, unverifiable);
  const { action_hash } = await first.act();
  const { home } = first;
  await first.stop();
  const second = fixture(t, {}, home);
  await assert.rejects(second.act(), held);
  const r: any = await second.check();
  assert.equal(r.decision, 'deny');
  assert.equal(second.inputs().length, 1);
  await second.call('desktop.action.release', { session_id: 's1', action_hash });
  assert.equal((await second.act()).status, 'unverifiable');
  await second.stop();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('M8-40a: an action left pending by a crash is held after restart, and cannot be released while pending', async t => {
  const first = fixture(t);
  const hash = 'c'.repeat(64);
  first.db.prepare("INSERT INTO desktop_action_outcome (action_hash, session_id, target, status, updated_at, window) VALUES (?, 's1', 'gr_fixture', 'pending', 't', 100)").run(hash);
  await assert.rejects(first.call('desktop.action.release', { session_id: 's1', action_hash: hash }), /no completed held action/);
  const { home } = first;
  await first.stop();
  const second = fixture(t, {}, home);
  assert.equal((second.db.prepare('SELECT status FROM desktop_action_outcome WHERE action_hash = ?').get(hash) as any).status, 'unverifiable');
  assert.deepEqual((await second.call('desktop.action.release', { session_id: 's1', action_hash: hash })), { status: 'released' });
  await second.stop();
  rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test('M8-40a: migration 004 creates desktop_action_outcome with the four statuses only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm8-40-mig-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  try {
    migrate(db);
    const cols = (db.prepare('PRAGMA table_info(desktop_action_outcome)').all() as any[]).map(c => c.name);
    assert.deepEqual(cols, ['action_hash', 'session_id', 'target', 'status', 'updated_at', 'window', 'verify_title_hash']);
    db.exec('PRAGMA foreign_keys=OFF');
    const ins = (status: string) => db.prepare("INSERT INTO desktop_action_outcome (action_hash, session_id, target, status, updated_at, window) VALUES (?, 's', 't', ?, 'u', 1)").run(status + 'h', status);
    for (const s of ['pending', 'confirmed', 'unverifiable', 'released']) ins(s);
    assert.throws(() => ins('bogus'));
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('M8-40d: tag, zero-width and bidi characters are removed from screen text and the removal is logged without the text', () => {
  const tag = String.fromCodePoint(0xe0049, 0xe0067, 0xe006e);
  const dirty = `Inbox${tag}​ (3)‮ done⁦`;
  const writes: string[] = [];
  const orig = process.stderr.write;
  (process.stderr as any).write = (s: string) => { writes.push(String(s)); return true; };
  let out: string;
  try { out = cleanScreenText(dirty); } finally { process.stderr.write = orig; }
  assert.equal(out, 'Inbox (3) done');
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0]), { kind: 'screen-text-cleaned', removed: 6 });
  assert.equal(writes[0].includes('Inbox'), false);
});

test('M8-40d: clean text passes unchanged and logs nothing', () => {
  const writes: string[] = [];
  const orig = process.stderr.write;
  (process.stderr as any).write = (s: string) => { writes.push(String(s)); return true; };
  try { assert.equal(cleanScreenText('Café 日本 Send'), 'Café 日本 Send'); } finally { process.stderr.write = orig; }
  assert.deepEqual(writes, []);
});

test('M8-40d: a tool result keeps its blocks in place, drops invisible text, and ends with an untrusted-data label', () => {
  const tag = String.fromCodePoint(0xe0041);
  const image = { type: 'image', data: '/9j/', mimeType: 'image/jpeg' };
  const result: any = screenResult({ content: [{ type: 'text', text: `Title${tag}` }, image], isError: true });
  assert.equal(result.isError, true);
  assert.equal(result.content.length, 3);
  assert.equal(result.content[0].text, 'Title');
  assert.deepEqual(result.content[1], image);
  assert.equal(result.content[2].type, 'text');
  assert.match(result.content[2].text, /untrusted screen data/i);
  const bare = { ok: true };
  assert.equal(screenResult(bare), bare);
});

test('M8-40 probe 1 (Gemini HIGH, driver.ts desktop.action.verify): a different non-risky action reaching the verify_title must not clear a Send hold', { todo: 'verify clears on title match alone' }, async t => {
  const f = fixture(t, unverifiable);
  const { action_hash } = await f.act({ verify_title: 'Sent' });
  await f.act({ action: 'key', keys: 'Tab' });
  f.update({ windows: [{ ...WINDOW, title: 'Sent' }] });
  assert.deepEqual(await f.call('desktop.action.verify', { ...PARAMS, action_hash }), { confirmed: false });
});

for (const keys of ['enter', 'Return', 'Enter+', 'ENTER']) {
  test('M8-40 probe 2a (Gemini HIGH, approvals.ts hash): held Enter must also hold ' + JSON.stringify(keys), { todo: 'key aliases hash differently' }, async t => {
    const f = fixture(t, unverifiable);
    assert.match((await f.act({ action: 'key', keys: 'Enter' })).action_hash, HASH);
    await assert.rejects(f.act({ action: 'key', keys: 'Enter' }), held);
    await assert.rejects(f.act({ action: 'key', keys }), held);
  });
}

test('M8-40 probe 2b (Gemini HIGH, approvals.ts classifier): a literal space key on the Send button must be risky', { todo: 'space key classified safe' }, async t => {
  const f = fixture(t);
  const r = await f.act({ action: 'key', keys: ' ' });
  assert.match(r.action_hash, HASH);
});
