import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { registerHooks } from 'node:module';
import { Approvals } from '../src/approvals.ts';
import { Desktop, Helper } from '../src/desktop/driver.ts';
import { until } from './helpers.ts';
import { FOLLOW_MS, judge } from '../src/watch/watcher.ts';

const WINDOW = { hwnd: 100, pid: 4100, process_start: '2026-10-12T01:00:00.000Z', exe: 'fake.exe', title: 'Fixture', controls: [{ name: 'Editor', automation_id: 'editor', role: 'edit', rid: '42.7' }] };
const EXPECT = { name: 'Editor', automation_id: 'editor', role: 'edit', password: false, hidden: false, file_dialog: false, grant_id: 'gr_fixture' };
const PARAMS = { session_id: 's1', pid: process.pid, window: 100, ref: 'e1' };
const GRANT = { session_id: 's1', hwnd: 100, pid: WINDOW.pid, process_start: WINDOW.process_start };
const rows = (file: string): any[] => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(s => JSON.parse(s)) : [];

function fixture(t: any, options: Record<string, unknown> = {}) {
  const home = mkdtempSync(join(tmpdir(), 'm6-15-hardening-'));
  const statePath = join(home, 'state.json');
  const logPath = join(home, 'input.jsonl');
  const requestPath = join(home, 'requests.jsonl');
  let state: any = { windows: [WINDOW], request_log: requestPath, ...options };
  const update = (changes: object) => { state = { ...state, ...changes }; writeFileSync(statePath, JSON.stringify(state)); };
  update({});
  const env = { METATROOPER_UIA_HELPER: join(import.meta.dirname, 'fake-uia-helper.js'), FAKE_UIA_STATE: statePath, FAKE_UIA_LOG: logPath, FAKE_UIA_DELAY_MS: '0' };
  const saved = Object.fromEntries(Object.keys(env).map(k => [k, process.env[k]]));
  Object.assign(process.env, env);
  const db = new DatabaseSync(join(home, 'synthetic.sqlite'));
  db.exec(readFileSync(new URL('../../contracts/schema.sql', import.meta.url), 'utf8'));
  db.exec("PRAGMA foreign_keys=OFF; INSERT INTO project (id,path,name,opened_at,last_opened) VALUES ('p1','/fixture','Fixture','t','t'); INSERT INTO session (id,project_id,engine_id,host,state,state_at,started_at,pid) VALUES ('s1','p1','fake','pty','working','t','t',1); INSERT INTO plugin (id,enabled,manifest,path,source,permissions,version,installed_at) VALUES ('desktop',1,'{}','','builtin','[]','1','t'); INSERT INTO grant (id,session_id,hwnd,pid,process_start,exe,title,created_at) VALUES ('gr_fixture','s1',100,4100,'2026-10-12T01:00:00.000Z','fake.exe','Fixture','t')");
  const desktop = new Desktop(db);
  const methods = new Map<string, any>();
  desktop.methods(methods);
  (desktop as any).bound.add('s1 ' + process.pid);
  Object.assign(desktop as any, { uiPid: process.pid, noTakeover: null });
  db.prepare("UPDATE session SET pid=? WHERE id='s1'").run(process.pid);
  const call = (method: string, p: object = PARAMS) => Promise.resolve(methods.get(method).handler(p));
  const act = (p: object = {}) => call('desktop.act', { ...PARAMS, action: 'key', keys: 'Tab', expect: EXPECT, ...p });
  const revoke = () => db.exec("UPDATE grant SET ended_at='revoked' WHERE id='gr_fixture'");
  const disable = () => db.exec("UPDATE plugin SET enabled=0 WHERE id='desktop'");
  t.after(async () => {
    const child = (desktop.helper as any).child;
    desktop.helper.stop();
    if (child && child.exitCode === null) await new Promise(r => child.once('exit', r));
    db.close();
    for (const [k,v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { db, desktop, call, act, revoke, disable, update, inputs: () => rows(logPath), requests: () => rows(requestPath) };
}

const refused = (code: number, message: RegExp) => (e: any) => { assert.equal(e.code, code); assert.match(e.message, message); return true; };

// Place a slow independent read before the next helper request.
function queueBehind(f: ReturnType<typeof fixture>, after: string, target: string) {
  const helper: any = f.desktop.helper;
  const original = helper.request.bind(helper);
  let blocker: Promise<unknown> | undefined;
  let queued = false;
  helper.request = (...args: any[]) => {
    if (args[0] === target && blocker) queued = true;
    return original(...args).then((result: unknown) => {
      if (args[0] === after && !blocker) blocker = original('process_id');
      return result;
    });
  };
  return async () => { await until(() => queued && f.requests().some(r => r.op === 'process_id'), 10000); };
}

for (const keys of ['Space\u0085', 'Enter\t', '\u00a0Enter', 'Tab\n', 'Tab\u007f']) {
  test('M6-15 hardening: non-printable key is rejected before writing ' + JSON.stringify(keys), async t => {
    const f = fixture(t);
    await assert.rejects(f.act({ keys }), refused(-32602, /keys must be printable/));
    assert.deepEqual(f.inputs(), []);
    assert.equal(f.requests().filter(r => r.op === 'key').length, 0);
    assert.deepEqual(await f.act({ keys: 'Alt+F' }), { status: 'confirmed' });
    assert.equal(f.inputs()[0].keys, 'Alt+F');
  });
}

for (const keys of ['Control+S', 'ctrl+s', 'Shift+Tab', ' Control +Alt+S', 'Alt+Shift+F']) test('M6-15 hardening: ' + JSON.stringify(keys) + ' is refused with -32602 before any approval or input', async t => {
  const f = fixture(t);
  await assert.rejects(f.act({ keys }), refused(-32602, /Control and Shift cannot be sent/));
  await assert.rejects(new Approvals(f.db, 5000, () => [], { granted: () => true }).check({ session_id: 's1', surface: 'desktop', target: 'gr_fixture', action: 'key', args: { window: 100, keys }, control: EXPECT, hidden: true }), refused(-32602, /Control and Shift cannot be sent/));
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM approval').get() as any).n, 0);
  assert.deepEqual(f.inputs(), []);
  assert.equal(f.requests().filter(r => r.op === 'key').length, 0);
});

for (const change of ['revoke', 'pause', 'disable', 'live'] as const) {
  test('M6-15 hardening: acting helper queue gate ' + change, async t => {
    const f = fixture(t, { delay_op: 'process_id', delay_ms: 600 });
    const queued = queueBehind(f, 'describe', 'key');
    const result = f.act().then(value => ({ value }), error => ({ error }));
    await queued();
    let ack: Promise<unknown> | undefined;
    if (change === 'revoke') f.revoke();
    if (change === 'disable') f.disable();
    if (change === 'pause') ack = f.desktop.pause();
    const r: any = await result;
    await ack;
    if (change === 'live') { assert.deepEqual(r.value, { status: 'confirmed' }); assert.equal(f.inputs().length, 1); }
    else { refused(-32030, change === 'pause' ? /paused by the user/ : /window not granted/)(r.error); assert.deepEqual(f.inputs(), []); assert.equal(f.requests().filter(r => r.op === 'key').length, 0); }
    if (change !== 'live') assert.equal((f.desktop as any).postedAt, 0);
  });
}

for (const [method, op] of [['desktop.describe','describe'],['desktop.snapshot','snapshot'],['desktop.screenshot','screenshot'],['desktop.find','find_text']]) {
  for (const revoke of [false, true]) test('M6-15 hardening: queued read ' + method + (revoke ? ' revoked' : ' live'), async t => {
    const f = fixture(t, { delay_op: 'process_id', delay_ms: 600 });
    const queued = queueBehind(f, 'info', op);
    const pending = f.call(method, { ...PARAMS, text: 'Editor' }).then(value => ({ value }), error => ({ error }));
    await queued();
    if (revoke) f.revoke();
    const r: any = await pending;
    if (revoke) { refused(-32030, /window not granted/)(r.error); assert.equal(f.requests().filter(r => r.op === op).length, 0); }
    else { assert.ok(r.value); assert.equal(f.requests().filter(r => r.op === op).length, 1); }
  });
}

test('M6-15 hardening: a dialog the granted process opens just after a click is the agent\'s, one from another process is not', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.act({ action: 'click' }), { status: 'confirmed' });
  const after = Date.now() + 1000;
  const opened = (pid: number) => ({ kind: 'opened' as const, t: after, idle_ms: 10_000, hwnd: 101, title: 'Save as', pid });
  assert.ok(1000 < FOLLOW_MS);
  assert.equal(judge(opened(WINDOW.pid)), null);
  assert.equal(judge(opened(4200)), 'away');
});

for (const reused of [{ pid: 5100 }, { process_start: '2026-10-12T02:00:00.000Z' }]) test('M6-15 hardening: grant.window refuses a handle reused since the list was shown ' + JSON.stringify(reused), async t => {
  const f = fixture(t);
  f.db.exec('DELETE FROM grant');
  await f.call('desktop.ui-window', { pid: process.pid, takeover_key: 'Control+Alt+Q', takeover_error: null });
  const listed = (await f.call('grant.candidates', {}) as any).windows[0];
  assert.deepEqual(listed, { hwnd: 100, title: 'Fixture', exe: 'fake.exe', pid: WINDOW.pid, process_start: WINDOW.process_start });
  f.update({ windows: [{ ...WINDOW, ...reused }] });
  await assert.rejects(f.call('grant.window', { session_id: 's1', ...listed }), refused(-32003, /that window now belongs to another process/));
  await assert.rejects(f.call('grant.window', { session_id: 's1', hwnd: 100 }), refused(-32602, /pid and process_start are required/));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grant').get()!.n, 0);
  f.update({ windows: [WINDOW] });
  assert.match((await f.call('grant.window', { session_id: 's1', ...listed }) as any).grant_id, /^gr_/);
});

test('M6-15 hardening: no input is sent once the workbench that registered the take-over key has exited, and its grants end (F10)', async t => {
  const f = fixture(t);
  const gone = spawn(process.execPath, ['-e', '0']);
  await once(gone, 'exit');
  await f.call('desktop.ui-window', { pid: gone.pid, takeover_key: 'Control+Alt+Q', takeover_error: null });
  await assert.rejects(f.act(), refused(-32030, /^not sent: the workbench is not running, so the agent could not be paused$/));
  await assert.rejects(f.act({ action: 'type', text: 'abc' }), refused(-32030, /the workbench is not running, so the agent could not be paused; 0 of 3 characters were typed/));
  assert.equal(f.requests().filter(r => ['key', 'set_text'].includes(r.op)).length, 0);
  assert.deepEqual(f.inputs(), []);
  await f.desktop.tick();
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grant WHERE ended_at IS NULL').get()!.n, 0);
  await assert.rejects(f.call('grant.window', GRANT), refused(-32003, /the workbench that registered the take-over key has closed/));
  await f.call('desktop.ui-window', { pid: process.pid, takeover_key: 'Control+Alt+Q', takeover_error: null });
  assert.match((await f.call('grant.window', GRANT) as any).grant_id, /^gr_/);
});

test('M6-15 hardening: no input is sent before the workbench reports a registered take-over key (F10)', async t => {
  const f = fixture(t);
  Object.assign(f.desktop as any, { noTakeover: 'the workbench has not reported its take-over key' });
  await assert.rejects(f.act(), refused(-32030, /^not sent: the workbench has not reported its take-over key, so the agent could not be paused$/));
  assert.equal(f.requests().filter(r => r.op === 'key').length, 0);
});

test('M6-15 hardening: describe exposes exactly the public fields', async t => {
  const f = fixture(t);
  const { token, ...fields } = await f.call('desktop.describe') as any;
  assert.equal(typeof token, 'string');
  assert.ok(token.length > 0);
  assert.deepEqual(fields, { grant_id: 'gr_fixture', control: { name: 'Editor', automation_id: 'editor', role: 'edit' }, password: false, hidden: false, file_dialog: false, rect: [10,10,50,20] });
  f.revoke();
  await assert.rejects(f.call('desktop.describe'), refused(-32030, /window not granted/));
});

for (const action of ['click','key','scroll','type']) {
  test('M6-15 hardening: helper identity on every ' + action + ' request', async t => {
    const f = fixture(t);
    assert.deepEqual(await f.act({ action, text: 'abcdefghijklmnopq', dy: 40 }), { status: 'confirmed' });
    const sent = f.inputs();
    assert.equal(sent.length, action === 'type' ? 3 : 1);
    for (const r of sent) assert.deepEqual({ check:r.check,name:r.name,automation_id:r.automation_id,role:r.role,password:r.password,hidden:r.hidden,file_dialog:r.file_dialog,rid:r.rid,pid:r.pid }, { check:1,name:'Editor',automation_id:'editor',role:'edit',password:0,hidden:0,file_dialog:0,rid:'42.7',pid:4100 });
    if (action === 'type') assert.deepEqual(sent.map(r=>r.value), ['abcdefgh','abcdefghijklmnop','abcdefghijklmnopq']);
  });
  for (const at of action === 'type' ? [1,2] : [1]) test('M6-15 hardening: control changed during ' + action + ' request ' + at, async t => {
    const op = action === 'type' ? 'set_text' : action;
    const f = fixture(t, { error_op: op, error_at: at });
    await assert.rejects(f.act({ action, text:'abcdefghijklmnopq' }), refused(-32035, action === 'type' ? (at === 1 ? /nothing was sent; 0 of 17 characters were typed/ : /nothing was sent; 8 of 17 characters were typed/) : /nothing was sent/));
    assert.equal(f.inputs().length, at - 1);
    assert.equal(f.requests().filter(r=>r.op===op).length, at);
  });
}

test('M6-15 hardening: true password hidden and file-dialog identity flags reach the helper', async t => {
  const f = fixture(t, { windows:[{ ...WINDOW, file_dialog:true, controls:[{ ...WINDOW.controls[0], password:true, hidden:true }] }] });
  await f.act({ expect:{ ...EXPECT,password:true,hidden:true,file_dialog:true }, action:'click' });
  const r=f.inputs()[0];
  assert.deepEqual([r.password,r.hidden,r.file_dialog], [1,1,1]);
});

for (const action of ['key','click','scroll','type']) test('M6-15 hardening: pause waits for in-flight ' + action, async t => {
  const op=action==='type'?'set_text':action;
  const f=fixture(t,{ delay_op:op,delay_ms:600 });
  let finished=false;
  const pending=f.act({ action,text:'hello' }).then(r=>{finished=true;return r;});
  await until(()=>f.requests().some(r=>r.op===op),10000);
  const ack=await f.desktop.pause();
  assert.ok(ack.paused_at);
  assert.equal(f.inputs().filter(r=>r.op===op).length,1);
  await pending;
  assert.equal(finished,true);
  if (action==='key'||action==='click') assert.ok(Date.now()-f.inputs()[0].at>=200);
});

for (const action of ['key','click','scroll','type']) test('M6-15 hardening: settle boundary for ' + action + ' is exactly 250 ms only for posted input', async t => {
  const f=fixture(t);
  t.mock.timers.enable({apis:['Date','setTimeout'],now:10000});
  await f.act({action,text:'hello'});
  let done=false;
  const ack=f.desktop.pause().then(()=>{done=true;});
  await Promise.resolve();
  if(action==='key'||action==='click') { assert.equal(done,false); t.mock.timers.tick(249); await Promise.resolve(); assert.equal(done,false); t.mock.timers.tick(1); await ack; assert.equal(done,true); }
  else { await ack; assert.equal(done,true); }
  t.mock.timers.reset();
});

for (const change of ['revoke','dialog-close'] as const) for (const nth of [1,3]) test('M6-15 hardening: 2000-character typing stops at info ' + nth + ' after ' + change, async t => {
  const dialog={ ...WINDOW,hwnd:101,owner:100,title:'Owned dialog' };
  const f=fixture(t,{ windows:change==='dialog-close'?[WINDOW,dialog]:[WINDOW],delay_op:'info',delay_at:change==='dialog-close'? (nth===1?1:5):nth,delay_ms:600 });
  const pending=f.act({action:'type',window:change==='dialog-close'?101:100,text:'a'.repeat(2000)}).then(value=>({value}),error=>({error}));
  const count=change==='dialog-close'?(nth===1?1:5):nth;
  await until(()=>f.requests().some(r=>r.op==='info'&&r.count===count),10000);
  if(change==='revoke')f.revoke(); else f.update({windows:[WINDOW]});
  const r:any=await pending;
  refused(-32030,/window not granted/)(r.error);
  const landed=f.inputs().filter(r=>r.op==='set_text');
  assert.equal(landed.length,nth===1?0:2);
  if(nth>1)assert.match(r.error.message,/16 of 2000 characters were typed/);
  assert.deepEqual(landed.map(r=>r.value),nth===1?[]:['aaaaaaaa','aaaaaaaaaaaaaaaa']);
});

test('M6-15 hardening: a complete 2000-character type lands in 250 chunks',async t=>{
  const f=fixture(t);
  assert.deepEqual(await f.act({action:'type',text:'a'.repeat(2000)}),{status:'confirmed'});
  const sent=f.inputs();
  assert.equal(sent.length,250);
  for(let i=0;i<250;i++)assert.equal(sent[i].value,'a'.repeat((i+1)*8));
});

for(const change of ['end','disable','live'] as const)test('M6-15 hardening: grant.window rechecks after info '+change,async t=>{
  const f=fixture(t,{delay_op:'info',delay_ms:600});
  f.db.exec("DELETE FROM grant");
  await f.call('desktop.ui-window',{pid:process.pid,takeover_key:'Control+Alt+Q',takeover_error:null});
  const pending=f.call('grant.window',GRANT).then(value=>({value}),error=>({error}));
  await until(()=>f.requests().some(r=>r.op==='info'),10000);
  if(change==='end')f.db.exec("UPDATE session SET ended_at='ended' WHERE id='s1'");
  if(change==='disable')f.disable();
  const r:any=await pending;
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grant').get()!.n,change==='live'?1:0);
  if(change==='live')assert.match(r.value.grant_id,/^gr_/);
  else refused(change==='end'?-32002:-32003,change==='end'?/session not found/:/computer use is off: the desktop plugin is disabled/)(r.error);
});

for(const revoke of [false,true])test('M6-15 hardening: desktop.windows filters grants revoked during list '+revoke,async t=>{
  const f=fixture(t,{delay_op:'list',delay_ms:600});
  const pending=f.call('desktop.windows');
  await until(()=>f.requests().some(r=>r.op==='list'),10000);
  if(revoke)f.revoke();
  assert.deepEqual(await pending,{windows:revoke?[]:[{window:100,title:'Fixture',exe:'fake.exe',grant_id:'gr_fixture',owner:0}]});
});


function approvalFixture() {
  const home = mkdtempSync(join(tmpdir(), 'm6-15-approval-'));
  const db = new DatabaseSync(join(home, 'synthetic.sqlite'));
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, path TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT, ended_at TEXT);
    CREATE TABLE approval (id TEXT PRIMARY KEY, session_id TEXT, surface TEXT, target TEXT, control TEXT, action TEXT, action_hash TEXT, summary TEXT, reason TEXT, status TEXT, scope TEXT, created_at TEXT, decided_at TEXT);
    CREATE TABLE needs_you (id TEXT PRIMARY KEY, at TEXT, kind TEXT, ref TEXT, text TEXT, resolved_at TEXT);
    CREATE TABLE grant (id TEXT PRIMARY KEY, title TEXT);
    INSERT INTO session (id) VALUES ('s1');
    INSERT INTO grant (id, title) VALUES ('gr_fixture', 'Fixture');
    INSERT INTO approval (id, session_id, surface, target, reason, status, scope) VALUES ('ap_origin', 's1', 'browser', 'https://fixture.invalid', 'new origin', 'approved', 'session');
  `);
  return { db, approvals: new Approvals(db, 5000, () => [], { granted: (session, target) => session === 's1' && target === 'gr_fixture' }), close: () => { db.close(); rmSync(home, { recursive: true, force: true }); } };
}

for (const surface of ['desktop', 'browser']) {
  for (const keys of ['Space+', 'Enter+', 'Alt+Space+', '+Alt++Space++']) {
    test('M6-15 hardening: ' + surface + ' ' + keys + ' asks on Delete', async () => {
      const { db, approvals, close } = approvalFixture();
      try {
        const checked = approvals.check({ session_id: 's1', surface, target: surface === 'desktop' ? 'gr_fixture' : 'https://fixture.invalid', action: 'key', args: { keys }, control: { name: 'Delete', automation_id: 'remove', role: 'button' } });
        const row = db.prepare("SELECT id, reason, status FROM approval WHERE status = 'waiting'").get() as any;
        assert.ok(row);
        assert.equal(row.reason, 'risky control: Delete');
        assert.equal(row.status, 'waiting');
        approvals.resolve({ approval_id: row.id, decision: 'reject' });
        assert.deepEqual(await checked, { decision: 'rejected', approval_id: row.id });
      } finally { close(); }
    });
  }
  test('M6-15 hardening: ' + surface + ' Tab on Delete is allowed', async () => {
    const { db, approvals, close } = approvalFixture();
    try {
      assert.deepEqual(await approvals.check({ session_id: 's1', surface, target: surface === 'desktop' ? 'gr_fixture' : 'https://fixture.invalid', action: 'key', args: { keys: 'Tab' }, control: { name: 'Delete', automation_id: 'remove', role: 'button' } }), { decision: 'allow' });
      assert.equal((db.prepare("SELECT count(*) AS n FROM approval WHERE status = 'waiting'").get() as any).n, 0);
    } finally { close(); }
  });
}

async function helperFixture(fn: (helper: Helper) => Promise<void>) {
  const home = mkdtempSync(join(tmpdir(), 'm6-15-helper-'));
  const saved = { METATROOPER_UIA_HELPER: process.env.METATROOPER_UIA_HELPER, FAKE_UIA_STATE: process.env.FAKE_UIA_STATE, FAKE_UIA_LOG: process.env.FAKE_UIA_LOG, FAKE_UIA_DELAY_MS: process.env.FAKE_UIA_DELAY_MS };
  writeFileSync(join(home, 'state.json'), JSON.stringify({ windows: [] }));
  process.env.METATROOPER_UIA_HELPER = join(import.meta.dirname, 'fake-uia-helper.js');
  process.env.FAKE_UIA_STATE = join(home, 'state.json');
  process.env.FAKE_UIA_LOG = join(home, 'input.jsonl');
  process.env.FAKE_UIA_DELAY_MS = '0';
  const helper = new Helper();
  try { await fn(helper); } finally {
    const child = (helper as any).child;
    const exit = child && child.exitCode === null ? once(child, 'exit') : Promise.resolve();
    helper.stop();
    await exit;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(home, { recursive: true, force: true });
  }
}

test('M6-15 hardening: helper timeout rejects after the process exits and a later request succeeds', async () => {
  await helperFixture(async (helper) => {
    assert.ok((await helper.request('process_id')).pid > 0);
    const old = (helper as any).child;
    let exited = false;
    old.once('exit', () => { exited = true; });
    await assert.rejects(helper.request('never_answer', {}, 300), (error: any) => {
      assert.equal(exited, true);
      assert.notEqual(old.exitCode === null && old.signalCode === null, true);
      assert.equal(error.message, 'desktop helper never_answer timed out');
      return true;
    });
    const replacement = await helper.request('process_id');
    assert.ok(replacement.pid > 0);
    assert.notEqual(replacement.pid, old.pid);
  });
});

test('M6-15 hardening: old helper exit does not reject a replacement request already sent', async () => {
  await helperFixture(async (helper) => {
    await helper.request('process_id');
    const old = (helper as any).child;
    const kill = old.kill.bind(old);
    let beginKill!: () => void;
    const killing = new Promise<void>((resolve) => { beginKill = resolve; });
    // Delay the old process exit while its replacement receives a request.
    old.kill = () => { setTimeout(() => kill(), 400); beginKill(); return true; };
    const timedOut = helper.request('never_answer', {}, 300).then(() => { throw new Error('timeout unexpectedly succeeded'); }, (error) => error);
    await killing;
    process.env.FAKE_UIA_DELAY_MS = '1200';
    let replacementSettled = false;
    const replacement = (helper as any).send('process_id', {}, 5000).then((result: any) => { replacementSettled = true; return result; }, (error: Error) => { replacementSettled = true; throw error; });
    const newChild = (helper as any).child;
    assert.notEqual(newChild.pid, old.pid);
    await once(old, 'exit');
    assert.equal(replacementSettled, false);
    assert.equal((await timedOut).message, 'desktop helper never_answer timed out');
    assert.deepEqual(await replacement, { pid: newChild.pid });
  });
});

for (const change of ['revoke', 'pause', 'live'] as const) test('M6-15 hardening: first type chunk queued behind helper ' + change, async t => {
  const f = fixture(t, { delay_op: 'process_id', delay_ms: 600 });
  const queued = queueBehind(f, 'describe', 'set_text');
  const pending = f.act({ action: 'type', text: 'a'.repeat(2000) }).then(value => ({ value }), error => ({ error }));
  await queued();
  let ack: Promise<unknown> | undefined;
  if (change === 'revoke') f.revoke();
  if (change === 'pause') ack = f.desktop.pause();
  const r: any = await pending;
  await ack;
  if (change === 'live') { assert.deepEqual(r.value, { status: 'confirmed' }); assert.equal(f.inputs().length, 250); }
  else {
    refused(-32030, change === 'pause' ? /paused by the user; 0 of 2000 characters were typed/ : /window not granted.*; 0 of 2000 characters were typed/)(r.error);
    assert.deepEqual(f.inputs(), []);
    assert.equal(f.requests().filter(r => r.op === 'set_text').length, 0);
  }
});

test('M6-15 hardening: an open owned dialog accepts all 250 type chunks', async t => {
  const f = fixture(t, { windows: [WINDOW, { ...WINDOW, hwnd: 101, owner: 100, title: 'Owned dialog' }] });
  assert.deepEqual(await f.act({ action: 'type', window: 101, text: 'a'.repeat(2000) }), { status: 'confirmed' });
  const sent = f.inputs();
  assert.equal(sent.length, 250);
  assert.equal(sent[0].hwnd, 101);
  assert.equal(sent[0].value, 'aaaaaaaa');
  assert.equal(sent[249].value, 'a'.repeat(2000));
});


for (const action of ['key', 'click']) test('M6-15 hardening: helper-refused ' + action + ' does not add posted-input settle time', async t => {
  const f = fixture(t, { error_op: action });
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 10000 });
  let ack: Promise<void> | undefined;
  try {
    await assert.rejects(f.act({ action }), refused(-32035, /nothing was sent/));
    assert.deepEqual(f.inputs(), []);
    let settled = false;
    ack = f.desktop.pause().then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(settled, true);
  } finally {
    t.mock.timers.tick(250);
    await ack;
    t.mock.timers.reset();
  }
});


test('M6-15 hardening: printable ASCII endpoints reach the helper', async t => {
  const f = fixture(t);
  assert.deepEqual(await f.act({ keys: ' ' }), { status: 'confirmed' });
  assert.deepEqual(await f.act({ keys: '~' }), { status: 'confirmed' });
  assert.deepEqual(f.inputs().map(r => r.keys), [' ', '~']);
});

for (const report of [
  { takeover_key: '', takeover_error: null, reason: /has not reported its take-over key/ },
  { takeover_key: 'Control+Alt+Q', takeover_error: 'held by another program', reason: /the take-over key Control\+Alt\+Q did not register \(held by another program\)/ },
]) test('M6-15 hardening: grant refuses an unregistered takeover key ' + report.takeover_key, async t => {
  const f = fixture(t);
  f.db.exec('DELETE FROM grant');
  await f.call('desktop.ui-window', { pid: process.pid, takeover_key: report.takeover_key, takeover_error: report.takeover_error });
  await assert.rejects(f.call('grant.window', GRANT), (error: any) => {
    refused(-32003, /no window can be given/)(error);
    assert.match(error.message, report.reason);
    return true;
  });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grant').get()!.n, 0);
  assert.deepEqual(f.requests(), []);
  await f.call('desktop.ui-window', { pid: process.pid, takeover_key: 'Control+Alt+Q', takeover_error: null });
  const result: any = await f.call('grant.window', GRANT);
  assert.match(result.grant_id, /^gr_/);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grant WHERE ended_at IS NULL').get()!.n, 1);
});

test('M6-15 hardening: takeover registration failure ends every live grant across sessions', async t => {
  const f = fixture(t);
  f.db.exec("INSERT INTO grant (id,session_id,hwnd,pid,process_start,exe,title,created_at) VALUES ('gr_second','s2',200,4200,'t','other.exe','Other','t')");
  await f.call('desktop.ui-window', { pid: process.pid, takeover_key: 'Control+Alt+Q', takeover_error: null });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grant WHERE ended_at IS NULL').get()!.n, 2);
  await f.call('desktop.ui-window', { pid: process.pid, takeover_key: 'Control+Alt+Q', takeover_error: 'held by another program' });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grant WHERE ended_at IS NULL').get()!.n, 0);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grant WHERE ended_at IS NOT NULL').get()!.n, 2);
  await assert.rejects(f.act(), refused(-32030, /window not granted/));
  assert.deepEqual(f.inputs(), []);
});

for (const failure of [false, true]) test('M6-15 hardening: grant rechecks takeover registration after slow info ' + failure, async t => {
  const f = fixture(t, { delay_op: 'info', delay_ms: 1000 });
  f.db.exec('DELETE FROM grant');
  await f.call('desktop.ui-window', { pid: process.pid, takeover_key: 'Control+Alt+Q', takeover_error: null });
  const pending = f.call('grant.window', GRANT).then(value => ({ value }), error => ({ error }));
  await until(() => f.requests().some(r => r.op === 'info'), 10000);
  if (failure) await f.call('desktop.ui-window', { pid: process.pid, takeover_key: 'Control+Alt+Q', takeover_error: 'held by another program' });
  const result: any = await pending;
  if (failure) {
    refused(-32003, /no window can be given.*the take-over key Control\+Alt\+Q did not register \(held by another program\)/)(result.error);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grant').get()!.n, 0);
  } else {
    assert.match(result.value.grant_id, /^gr_/);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grant WHERE ended_at IS NULL').get()!.n, 1);
  }
});

test('M6-15 hardening: describe token is stable and matching or omitted tokens act', async t => {
  const f = fixture(t);
  const first: any = await f.call('desktop.describe');
  const second: any = await f.call('desktop.describe');
  assert.equal(typeof first.token, 'string');
  assert.ok(first.token.length > 0);
  assert.equal(second.token, first.token);
  assert.deepEqual(await f.act({ expect: { ...EXPECT, token: first.token } }), { status: 'confirmed' });
  assert.deepEqual(await f.act(), { status: 'confirmed' });
  assert.deepEqual(f.inputs().map(r => r.op), ['key', 'key']);
});

for (const change of ['wrong-token', 'replacement-element'] as const) test('M6-15 hardening: token refuses ' + change + ' without acting', async t => {
  const f = fixture(t);
  const before: any = await f.call('desktop.describe');
  if (change === 'replacement-element') f.update({ windows: [{ ...WINDOW, controls: [{ ...WINDOW.controls[0], rid: '42.8' }] }] });
  await assert.rejects(f.act({ expect: { ...EXPECT, token: change === 'wrong-token' ? 'synthetic-wrong-token' : before.token } }), refused(-32035, /nothing was sent/));
  assert.deepEqual(f.inputs(), []);
  assert.equal(f.requests().filter(r => ['key', 'click', 'scroll', 'set_text'].includes(r.op)).length, 0);
  const current: any = await f.call('desktop.describe');
  if (change === 'replacement-element') assert.notEqual(current.token, before.token);
  assert.deepEqual(await f.act({ expect: { ...EXPECT, token: current.token } }), { status: 'confirmed' });
  assert.deepEqual(f.inputs().map(r => r.op), ['key']);
});

for (const [surface, text, asks] of [
  ['desktop', 'abc AKIA1234567890123456suffix', true],
  ['browser', 'abc AKIA1234567890123456suffix', false],
  ['desktop', 'hello world'.repeat(100), false],
  ['desktop', 'AKIA1234567890123456', true],
  ['browser', 'AKIA1234567890123456', true],
  ['desktop', 'x'.repeat(100) + ' AKIA1234567890123456suffix', true],
] as const) test('M6-15 hardening: credential text approval ' + surface + ' ' + JSON.stringify(text.slice(0, 40)), async () => {
  const { db, approvals, close } = approvalFixture();
  try {
    const pending = approvals.check({ session_id: 's1', surface, target: surface === 'desktop' ? 'gr_fixture' : 'https://fixture.invalid', action: 'type', args: { text }, control: { name: 'Notes', automation_id: 'notes', role: 'edit' } });
    const waiting = db.prepare("SELECT id, reason FROM approval WHERE status = 'waiting'").get() as any;
    if (asks) {
      assert.ok(waiting);
      assert.equal(waiting.reason, 'credential text');
      approvals.resolve({ approval_id: waiting.id, decision: 'reject' });
      assert.deepEqual(await pending, { decision: 'rejected', approval_id: waiting.id });
    } else {
      assert.equal(waiting, undefined);
      assert.deepEqual(await pending, { decision: 'allow' });
    }
  } finally { close(); }
});

for (const keys of ['é', 'Alt+é', 'ü', 'Alt+ß', 'Alt+ é ']) test('M6-15 hardening: a printable non-ASCII key token acts ' + JSON.stringify(keys), async t => {
  const f = fixture(t);
  assert.deepEqual(await f.act({ keys }), { status: 'confirmed' });
  assert.deepEqual(f.inputs().map(r => r.keys), [keys]);
});

for (const keys of ['aé', '\u200b', '\u00a0Enter', 'Space\u0085', 'e\u0301', '\u0301', '😀', '\ufeffEnter', '\u2028']) test('M6-15 hardening: invalid non-ASCII key token never reaches helper ' + JSON.stringify(keys), async t => {
  const f = fixture(t);
  await assert.rejects(f.act({ keys }), refused(-32602, /keys must be printable/));
  assert.deepEqual(f.inputs(), []);
  assert.equal(f.requests().filter(r => r.op === 'key').length, 0);
  assert.deepEqual(await f.act({ keys: 'Alt+é' }), { status: 'confirmed' });
  assert.deepEqual(f.inputs().map(r => r.keys), ['Alt+é']);
});

test('M6-15 hardening: a takeover report must explicitly confirm registration with null error', async t => {
  const f = fixture(t);
  f.db.exec('DELETE FROM grant');
  await f.call('desktop.ui-window', { pid: process.pid, takeover_key: 'Control+Alt+Q' });
  await assert.rejects(f.call('grant.window', GRANT), refused(-32003, /no window can be given/));
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM grant').get()!.n, 0);
  await f.call('desktop.ui-window', { pid: process.pid, takeover_key: 'Control+Alt+Q', takeover_error: null });
  const result: any = await f.call('grant.window', GRANT);
  assert.match(result.grant_id, /^gr_/);
});

// Run the MCP tool callback with synthetic pipe transports and the real desktop driver.
async function hookTool(t: any, f: ReturnType<typeof fixture>) {
  const bridge: any = { approvals: [], acts: [], errors: [] };
  bridge.call = async (method: string, params: any) => {
    if (method === 'approval.check') {
      return new Promise(resolve => bridge.approvals.push({ params, resolve }));
    }
    if (method === 'desktop.act') bridge.acts.push(params);
    try { return { kind: 'reply', reply: { result: await f.call(method, params) } }; }
    catch (e: any) {
      bridge.errors.push({ code: e.code, message: e.message });
      return { kind: 'reply', reply: { error: { code: e.code, message: e.message } } };
    }
  };
  (globalThis as any).__desktopHookTest = bridge;
  const suffix = bridgeId++;
  const sources: Record<string, string> = {
    '../pipe/client.ts': 'export const call = (...args) => globalThis.__desktopHookTest.call(...args);',
    './workbench-pipe.ts': "export const findSession = () => 's1'; export class WorkbenchPipe { sessionId = 's1'; async available() { return true; } async call() { return { result: { arrived: true } }; } }",
    './mcp-stdio.ts': 'export const serveMcp = (_name, _tools, callback) => { globalThis.__desktopHookTest.tool = callback; };',
  };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.includes('/hook/desktop-mcp.ts') && sources[specifier]) return { url: 'test:desktop-hook-' + suffix + '/' + specifier, shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      const key = Object.keys(sources).find(k => url === 'test:desktop-hook-' + suffix + '/' + k);
      return key ? { format: 'module', shortCircuit: true, source: sources[key] } : next(url, context);
    },
  });
  try { await import('../src/hook/desktop-mcp.ts?test=' + suffix); }
  finally { hooks.deregister(); }
  t.after(() => { delete (globalThis as any).__desktopHookTest; });
  return bridge;
}
let bridgeId = 0;

test('M6-15 hardening: the MCP key tool refuses Control+S before describe or approval', { timeout: 30000 }, async t => {
  const f = fixture(t);
  const hook = await hookTool(t, f);
  const result = await hook.tool('key', { window: 100, keys: 'Control+S' });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /Control and Shift cannot be sent/);
  assert.equal(hook.approvals.length, 0);
  assert.equal(f.requests().length, 0);
  assert.deepEqual(f.inputs(), []);
});

for (const changed of [false, true]) test('M6-15 hardening: MCP approval ' + (changed ? 'asks again after an identical control gets a new runtime id' : 'acts on the unchanged approved element'), { timeout: 30000 }, async t => {
  const f = fixture(t);
  const hook = await hookTool(t, f);
  const pending = hook.tool('click', { window: 100, ref: 'e1' });
  const first = await until(() => hook.approvals[0], 10000);
  assert.deepEqual(first.params.control, { name: 'Editor', automation_id: 'editor', role: 'edit' });
  assert.deepEqual(f.inputs(), []);
  if (changed) f.update({ windows: [{ ...WINDOW, controls: [{ name: 'Editor', automation_id: 'editor', role: 'edit', rid: '42.8' }] }] });
  first.resolve({ kind: 'reply', reply: { result: { decision: 'approved' } } });
  if (changed) {
    const next = await until(() => hook.approvals[1] || f.inputs().length, 10000);
    assert.equal(typeof next, 'object', 'replacement must ask for another approval before acting');
    assert.equal(hook.errors[0].code, -32035);
    assert.deepEqual(f.inputs(), []);
    assert.deepEqual(hook.approvals[1].params.control, { name: 'Editor', automation_id: 'editor', role: 'edit' });
    assert.equal(f.requests().filter(r => r.op === 'describe').at(-1).ref, 'e1');
    hook.approvals[1].resolve({ kind: 'reply', reply: { result: { decision: 'approved' } } });
  }
  const result = await pending;
  assert.equal(result.isError, undefined);
  assert.deepEqual(JSON.parse(result.content[0].text), { status: 'confirmed' });
  assert.equal(hook.approvals.length, changed ? 2 : 1);
  assert.deepEqual(f.inputs().map(r => [r.op, r.rid]), changed ? [['click', '42.8']] : [['click', '42.7']]);
});
