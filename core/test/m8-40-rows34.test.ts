import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Desktop } from '../src/desktop/driver.ts';
import { treeChanges, type TreeNodes } from '../src/desktop/changes.ts';

const SEND = { name: 'Send', automation_id: 'send', role: 'button', rid: '42.7' };
const DELETE = { name: 'Delete', automation_id: 'del', role: 'button', rid: '42.8' };
const FIELD = { name: 'Subject', automation_id: 'sub', role: 'edit', rid: '42.9', value: 'hello world' };
const SECRET = { name: 'Password', automation_id: 'pwd', role: 'edit', rid: '42.10', password: true, value: 'topsecret' };
const LONG_FIELD = { name: 'Body', automation_id: 'body', role: 'edit', rid: '42.11', value: 'x'.repeat(300) };
const WINDOW = {
  hwnd: 100,
  pid: 4100,
  process_start: '2026-10-12T01:00:00.000Z',
  exe: 'fake.exe',
  title: 'Compose',
  controls: [SEND, DELETE, FIELD, SECRET, LONG_FIELD],
};
const expectOf = (c: typeof SEND) => ({
  name: c.name,
  automation_id: c.automation_id,
  role: c.role,
  password: Boolean((c as any).password),
  hidden: false,
  file_dialog: false,
  grant_id: 'gr_fixture',
});
const PARAMS = { session_id: 's1', pid: process.pid, window: 100 };
const rows = (file: string): any[] => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((s) => JSON.parse(s)) : [];

function fixture(t: any, options: Record<string, unknown> = {}, home = mkdtempSync(join(tmpdir(), 'm8-40-rows34-'))) {
  const statePath = join(home, 'state.json');
  const logPath = join(home, 'input.jsonl');
  let state: any = { windows: [WINDOW], ...options };
  const update = (changes: object) => { state = { ...state, ...changes }; writeFileSync(statePath, JSON.stringify(state)); };
  if (!existsSync(statePath)) update({}); else state = JSON.parse(readFileSync(statePath, 'utf8'));
  const env = { METATROOPER_UIA_HELPER: join(import.meta.dirname, 'fake-uia-helper.js'), FAKE_UIA_STATE: statePath, FAKE_UIA_LOG: logPath, FAKE_UIA_DELAY_MS: '0' };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
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
  const check = (checks: any[], extra: object = {}) => call('desktop.check', { ...PARAMS, checks, ...extra });
  const stop = async () => {
    const child = (desktop.helper as any).child;
    desktop.helper.stop();
    if (child && child.exitCode === null) await new Promise((r) => child.once('exit', r));
    db.close();
  };
  let stopped = false;
  t.after(async () => {
    if (!stopped) await stop();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    if (fresh) rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { home, db, call, act, check, update, inputs: () => rows(logPath), stop: async () => { stopped = true; await stop(); } };
}

test('desktop.check: title equals passes and title mismatch fails with actual title', async (t) => {
  // Verifies title check passes on match and fails on mismatch reporting actual title.
  const f = fixture(t);
  const pass = await f.check([{ kind: 'title', op: 'equals', expected: 'Compose' }]);
  assert.equal(pass.passed, true);
  assert.deepEqual(pass.results, [{ passed: true, actual: 'Compose' }]);
  const fail = await f.check([{ kind: 'title', op: 'equals', expected: 'Other' }]);
  assert.equal(fail.passed, false);
  assert.deepEqual(fail.results, [{ passed: false, actual: 'Compose' }]);
});

test('desktop.check: value contains passes and not_contains fails with real value', async (t) => {
  // Verifies value contains passes on substring and not_contains fails reporting full actual value.
  const f = fixture(t);
  const pass = await f.check([{ kind: 'value', ref: 'e3', op: 'contains', expected: 'world' }]);
  assert.equal(pass.passed, true);
  assert.deepEqual(pass.results, [{ passed: true, actual: 'hello world' }]);
  const fail = await f.check([{ kind: 'value', ref: 'e3', op: 'not_contains', expected: 'world' }]);
  assert.equal(fail.passed, false);
  assert.deepEqual(fail.results, [{ passed: false, actual: 'hello world' }]);
});

test('desktop.check: password control reads actual null and fails every op including not_contains', async (t) => {
  // Asserts password control yields actual null and fails equals, contains and not_contains ops.
  const f = fixture(t);
  const res = await f.check([
    { kind: 'value', ref: 'e4', op: 'equals', expected: 'topsecret' },
    { kind: 'value', ref: 'e4', op: 'contains', expected: 'secret' },
    { kind: 'value', ref: 'e4', op: 'not_contains', expected: 'other' },
  ]);
  assert.equal(res.passed, false);
  assert.deepEqual(res.results, [
    { passed: false, actual: null },
    { passed: false, actual: null },
    { passed: false, actual: null },
  ]);
});

test('desktop.check: passed is false when any check fails and results preserve order', async (t) => {
  // Asserts overall passed is false when one check fails while retaining original order of results.
  const f = fixture(t);
  const res = await f.check([
    { kind: 'title', op: 'equals', expected: 'Compose' },
    { kind: 'value', ref: 'e3', op: 'equals', expected: 'wrong' },
    { kind: 'value', ref: 'e3', op: 'contains', expected: 'hello' },
  ]);
  assert.equal(res.passed, false);
  assert.deepEqual(res.results, [
    { passed: true, actual: 'Compose' },
    { passed: false, actual: 'hello world' },
    { passed: true, actual: 'hello world' },
  ]);
});

test('desktop.check: actual longer than 200 characters is cut to 200 while comparison uses full value', async (t) => {
  // Asserts string equality compares full 300 characters while returned actual is capped at 200 characters.
  const f = fixture(t);
  const expected = 'x'.repeat(300);
  const res = await f.check([{ kind: 'value', ref: 'e5', op: 'equals', expected }]);
  assert.equal(res.passed, true);
  assert.equal(res.results[0].passed, true);
  assert.equal(res.results[0].actual, 'x'.repeat(200));
  assert.equal(res.results[0].actual?.length, 200);
  const mismatch200 = await f.check([{ kind: 'value', ref: 'e5', op: 'equals', expected: 'x'.repeat(200) }]);
  assert.equal(mismatch200.passed, false);
});

test('desktop.check: validation rejects with -32602 for each malformed check list', async (t) => {
  // Asserts -32602 is returned for invalid check counts, bad kinds, missing refs, and bad expected types.
  const f = fixture(t);
  const bad = async (checks: any) => {
    await assert.rejects(f.call('desktop.check', { ...PARAMS, checks }), (e: any) => {
      assert.equal(e.code, -32602);
      return true;
    });
  };
  await bad('not an array');
  await bad([]);
  await bad(Array.from({ length: 9 }, () => ({ kind: 'title', op: 'equals', expected: 'Compose' })));
  await bad([{ kind: 'unknown', op: 'equals', expected: 'Compose' }]);
  await bad([{ kind: 'title', op: 'unknown', expected: 'Compose' }]);
  await bad([{ kind: 'title', op: 'equals', expected: 123 }]);
  await bad([{ kind: 'title', op: 'equals', expected: 'x'.repeat(2001) }]);
  await bad([{ kind: 'value', op: 'equals', expected: 'val' }]);
});

test('desktop.check: unknown ref returns helper unknown ref error', async (t) => {
  // Passes through unknown ref error from helper when inspecting non-existent control.
  const f = fixture(t);
  await assert.rejects(
    f.check([{ kind: 'value', ref: 'e99', op: 'equals', expected: 'foo' }]),
    /unknown ref e99; take a new snapshot/,
  );
});

test('desktop.check: session without grant for window is refused', async (t) => {
  // Refuses check request when session has no grant for targeted window handle.
  const f = fixture(t);
  await assert.rejects(
    f.call('desktop.check', { session_id: 's1', pid: process.pid, window: 999, checks: [{ kind: 'title', op: 'equals', expected: 'Compose' }] }),
    (e: any) => {
      assert.equal(e.code, -32030);
      assert.match(e.message, /window not granted/);
      return true;
    },
  );
});

test('desktop.check: passing check never alters desktop_action_outcome or clears hold', async (t) => {
  // Verifies running a passing check does not release an unverifiable held action outcome.
  const f = fixture(t, { input_status: 'unverifiable' });
  const first = await f.act();
  assert.equal(first.status, 'unverifiable');
  assert.match(String(first.action_hash), /^[a-f0-9]{64}$/);
  const pass = await f.check([{ kind: 'title', op: 'equals', expected: 'Compose' }]);
  assert.equal(pass.passed, true);
  const row = f.db.prepare('SELECT status FROM desktop_action_outcome WHERE action_hash = ?').get(first.action_hash) as { status: string };
  assert.equal(row.status, 'unverifiable');
  await assert.rejects(f.act(), (e: any) => {
    assert.equal(e.code, -32030);
    assert.match(e.message, /unresolved outcome/);
    return true;
  });
});

test('desktop.check: no model called and helper receives only info and value ops', async (t) => {
  // Asserts check executes only helper info and value ops with no extra calls.
  const f = fixture(t);
  const requestLog = join(f.home, 'check_requests.jsonl');
  f.update({ request_log: requestLog });
  const res = await f.check([
    { kind: 'title', op: 'equals', expected: 'Compose' },
    { kind: 'value', ref: 'e3', op: 'equals', expected: 'hello world' },
  ]);
  assert.equal(res.passed, true);
  const reqs = rows(requestLog);
  const ops = reqs.map((r: any) => r.op);
  assert.ok(ops.includes('info'));
  assert.ok(ops.includes('value'));
  assert.ok(ops.every((op: string) => op === 'info' || op === 'value'));
});

test('treeChanges: diffs added, removed and changed nodes by rid', () => {
  // Matches nodes by runtime id and identifies additions, removals and text modifications.
  const before: TreeNodes = [
    ['r1', 'Button "OK"'],
    ['r2', 'Text "Hello"'],
    ['r3', 'Button "Cancel"'],
  ];
  const after: TreeNodes = [
    ['r1', 'Button "OK"'],
    ['r2', 'Text "World"'],
    ['r4', 'Button "Apply"'],
  ];
  const diff = treeChanges(before, after);
  assert.deepEqual(diff, {
    added: ['Button "Apply"'],
    removed: ['Button "Cancel"'],
    changed: [{ from: 'Text "Hello"', to: 'Text "World"' }],
  });
  assert.equal('truncated' in diff, false);
});

test('treeChanges: keys nodes without rid by line and duplicate count', () => {
  // Counts duplicates for empty rids so removing one duplicate reports one removal.
  const before: TreeNodes = [
    ['', 'Item line'],
    ['', 'Item line'],
  ];
  const after: TreeNodes = [
    ['', 'Item line'],
  ];
  const diff = treeChanges(before, after);
  assert.deepEqual(diff, {
    added: [],
    removed: ['Item line'],
    changed: [],
  });
  assert.equal('truncated' in diff, false);
});

test('treeChanges: caps additions at 20 entries and marks truncated', () => {
  // Enforces 20 entry cap on additions and sets truncated flag to true.
  const after: TreeNodes = Array.from({ length: 25 }, (_, i) => [`r${i}`, `Item ${i}`]);
  const diff = treeChanges([], after);
  assert.equal(diff.added.length, 20);
  assert.equal(diff.truncated, true);
});

test('treeChanges: omits truncated key when no list exceeds cap', () => {
  // Leaves truncated key undefined when change counts are below cap.
  const diff = treeChanges([], [['r1', 'Item 1']]);
  assert.equal('truncated' in diff, false);
});

test('treeChanges: identical trees produce three empty change lists', () => {
  // Returns empty added, removed and changed lists for identical node trees.
  const tree: TreeNodes = [
    ['r1', 'Button "OK"'],
    ['', 'Status text'],
  ];
  const diff = treeChanges(tree, tree);
  assert.deepEqual(diff, { added: [], removed: [], changed: [] });
  assert.equal('truncated' in diff, false);
});

test('desktop.act: click with tree_before and tree_after returns changes without raw trees', async (t) => {
  // Returns diff changes for click and removes tree_before and tree_after while retaining status and hash.
  const before: TreeNodes = [['r1', 'Button "Old"'], ['r2', 'Label']];
  const after: TreeNodes = [['r1', 'Button "New"'], ['r2', 'Label']];
  const f = fixture(t, {
    windows: [{ ...WINDOW, tree_before: before, tree_after: after }],
  });
  const r = await f.act();
  assert.equal(r.status, 'confirmed');
  assert.match(String(r.action_hash), /^[a-f0-9]{64}$/);
  assert.deepEqual(r.changes, {
    added: [],
    removed: [],
    changed: [{ from: 'Button "Old"', to: 'Button "New"' }],
  });
  assert.equal(r.tree_before, undefined);
  assert.equal(r.tree_after, undefined);
  assert.equal('tree_before' in r, false);
  assert.equal('tree_after' in r, false);
});

test('desktop.act: click request to helper carries tree_before and tree_after flags', async (t) => {
  // Checks helper input log for click op confirms tree_before 1 and tree_after 1 flags.
  const f = fixture(t);
  await f.act();
  const clickInputs = f.inputs().filter((x: any) => x.op === 'click');
  assert.equal(clickInputs.length, 1);
  assert.equal(clickInputs[0].tree_before, 1);
  assert.equal(clickInputs[0].tree_after, 1);
});

test('desktop.act: multi-chunk type sets tree_before on first and tree_after on last chunk', async (t) => {
  // Checks chunked typing requests tree_before on initial chunk and tree_after on final chunk.
  const before: TreeNodes = [['r1', 'Original']];
  const after: TreeNodes = [['r1', 'Modified']];
  const f = fixture(t, {
    windows: [{ ...WINDOW, tree_before: before, tree_after: after }],
  });
  const r20 = await f.act({ action: 'type', ref: 'e1', text: '12345678901234567890' });
  assert.equal(r20.status, 'confirmed');
  assert.deepEqual(r20.changes, {
    added: [],
    removed: [],
    changed: [{ from: 'Original', to: 'Modified' }],
  });
  const inputs20 = f.inputs().filter((x: any) => x.op === 'set_text');
  assert.equal(inputs20.length, 3);
  assert.equal(inputs20[0].tree_before, 1);
  assert.equal(inputs20[0].tree_after, 0);
  assert.equal(inputs20[1].tree_before, 0);
  assert.equal(inputs20[1].tree_after, 0);
  assert.equal(inputs20[2].tree_before, 0);
  assert.equal(inputs20[2].tree_after, 1);

  const r5 = await f.act({ action: 'type', ref: 'e1', text: 'short' });
  assert.equal(r5.status, 'confirmed');
  assert.ok(r5.changes);
  const inputsAll = f.inputs().filter((x: any) => x.op === 'set_text');
  const lastInput = inputsAll[inputsAll.length - 1];
  assert.equal(lastInput.tree_before, 1);
  assert.equal(lastInput.tree_after, 1);
});

test('desktop.act: helper returning only tree_before omits changes key', async (t) => {
  // Verifies changes key is absent when helper returns tree_before without tree_after.
  const before: TreeNodes = [['r1', 'Static node']];
  const f = fixture(t, {
    windows: [{ ...WINDOW, tree_before: before }],
  });
  const r = await f.act();
  assert.equal(r.status, 'confirmed');
  assert.equal('changes' in r, false);
  assert.equal(r.changes, undefined);
});

test('desktop.act: malformed tree produces no changes and does not fail action', async (t) => {
  // Ignores malformed tree arrays and non-arrays without failing action or returning changes.
  const f1 = fixture(t, {
    windows: [{ ...WINDOW, tree_before: [['a']], tree_after: [['r1', 'Node']] }],
  });
  const r1 = await f1.act();
  assert.equal(r1.status, 'confirmed');
  assert.equal('changes' in r1, false);

  const f2 = fixture(t, {
    windows: [{ ...WINDOW, tree_before: 'malformed non-array', tree_after: [['r1', 'Node']] }],
  });
  const r2 = await f2.act();
  assert.equal(r2.status, 'confirmed');
  assert.equal('changes' in r2, false);
});
