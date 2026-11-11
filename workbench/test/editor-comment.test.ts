import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { namedPaths } from '../src/gitpane.ts';
import { MAX, formatComment, sendComment } from '../ui/src/comment.js';

const CTRL = /[\x00-\x1f\x7f-\x9f]/;

test('formatComment names the file, line range and side', () => {
  assert.equal(formatComment({ path: 'src/a.ts', line: 12, side: 'new', excerpt: 'let x = 1;', text: 'use const' }),
    'use const / File: src/a.ts:12 (new side) / Line: let x = 1;');
  assert.equal(formatComment({ path: 'a.ts', line: 3, endLine: 7, side: 'old', excerpt: '', text: 'why?' }), 'why? / File: a.ts:3-7 (old side)');
  assert.match(formatComment({ path: 'a.ts', line: 3, endLine: 3, text: 'x' }), /File: a\.ts:3 \(new side\)$/);
});

test('formatComment strips control characters and turns line breaks into " / "', () => {
  const s = formatComment({ path: 'a.ts', line: 1, excerpt: 'a\r\n  b\tc\x1b[0m\n', text: 'one\n\ntwo\x00\n' });
  assert.ok(!CTRL.test(s), s);
  assert.equal(s, 'one / two  / File: a.ts:1 (new side) / Line: a / b c [0m');
});

test('formatComment stays within the core 4000 character cap and keeps the file line', () => {
  const s = formatComment({ path: 'a.ts', line: 1, excerpt: 'x'.repeat(5000), text: 'y'.repeat(5000) });
  assert.equal(s.length, MAX);
  assert.ok(!CTRL.test(s));
  assert.ok(s.endsWith(' / File: a.ts:1 (new side) / Line: ' + 'x'.repeat(500)));
});

test('sendComment uses dedicated comment IPC and passes the refusal through', async () => {
  const calls: any[] = [];
  const fake = async (p: any) => { calls.push(p); return { ok: true }; };
  assert.deepEqual(await sendComment('s1', { path: 'a.ts', line: 1, text: 'hi' }, fake), { ok: true });
  assert.deepEqual(calls, [{ session_id: 's1', path: 'a.ts', line: 1, text: 'hi' }]);
  assert.deepEqual(await sendComment('s1', { path: 'a.ts', line: 1, text: ' \n ' }, fake), { ok: false, error: 'Write a comment first.' });
  assert.equal(calls.length, 1);
  const msg = 'the session is waiting on a person; only the user can answer it';
  assert.deepEqual(await sendComment('s1', { path: 'a.ts', line: 1, text: 'hi' }, async () => ({ ok: false, error: msg })), { ok: false, error: msg });
});

function commentHarness() {
  let handler: Function = () => {};
  const d = new DatabaseSync(':memory:');
  d.exec("CREATE TABLE session (id TEXT, project_id TEXT, host TEXT); INSERT INTO session VALUES ('s1', 'p1', 'local'), ('s2', 'p2', 'local'), ('s3', 'p1', 'external')");
  const calls: any[] = [];
  const c: any = vm.createContext({ on: (_name: string, fn: Function) => { handler = fn; }, db: () => d, view: { projectId: 'p1' }, namedPaths,
    formatComment, schedulePush() {}, result: { kind: 'reply', reply: { result: { sent: true } } },
    call: async (...args: any[]) => { calls.push(args); return c.result; } });
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const code = source.match(/  on\('comment', async[^]*?\n  \}\);/);
  assert.ok(code);
  vm.runInContext(stripTypeScriptTypes(code[0]), c);
  return { send: (p: any) => handler(p), calls, c, close: () => d.close() };
}

test('comment IPC refuses missing, other-project and external sessions', async () => {
  const h = commentHarness();
  try {
    for (const session_id of ['missing', 's2', 's3']) {
      const out = await h.send({ projectId: 'p1', session_id, path: 'a.ts', line: 1, text: 'hi' });
      assert.equal(out.ok, false, session_id);
      assert.equal(typeof out.error, 'string');
      assert.equal((await h.send({ session_id, path: 'a.ts', line: 1, text: 'hi' })).ok, false);
    }
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});

test('comment IPC ignores a renderer-supplied project and refuses a session outside the open one', async () => {
  const h = commentHarness();
  try {
    assert.equal((await h.send({ projectId: 'p2', session_id: 's2', path: 'a.ts', line: 1, text: 'hi' })).ok, false);
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});

test('formatComment stays fast on huge whitespace runs', () => {
  const t = Date.now();
  const s = formatComment({ path: 'a.ts', line: 1, excerpt: ' '.repeat(1_000_000), text: 'a' + ' '.repeat(1_000_000) + 'b' });
  assert.ok(Date.now() - t < 200, `took ${Date.now() - t} ms`);
  assert.ok(s.length <= MAX);
});

test('preload exposes comment IPC', async () => {
  let api: any;
  const calls: any[] = [];
  vm.runInNewContext(readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8'), {
    require: () => ({ contextBridge: { exposeInMainWorld: (name: string, value: any) => { if (name === 'troop') api = value; } },
      ipcRenderer: { on() {}, invoke: (...args: any[]) => { calls.push(args); return { ok: true }; } }, webUtils: {} }),
  });
  const args = { projectId: 'p1', path: 'a.ts', line: 1, text: 'hi' };
  assert.deepEqual(await sendComment('s1', args, api.comment), { ok: true });
  assert.deepEqual(calls, [['comment', { ...args, session_id: 's1' }]]);
});

test('comment IPC formats in main and preserves core refusal and offline errors', async () => {
  const h = commentHarness();
  try {
    const args = { session_id: 's1', path: 'a.ts', line: 1, text: 'hi\nthere' };
    assert.equal((await h.send(args)).ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls)), [['session.send', { session_id: 's1', text: 'hi / there / File: a.ts:1 (new side)' }, { ui: true }]]);
    const message = 'the session is waiting on a person; only the user can answer it';
    h.c.result = { kind: 'reply', reply: { error: { code: -32602, message } } };
    assert.equal((await h.send({ ...args, projectId: 'p1' })).error, message);
    h.c.result = { kind: 'offline' };
    assert.equal((await h.send(args)).error, 'The core is offline.');
  } finally { h.close(); }
});

test('comment IPC refuses malformed locations and empty text', async () => {
  const h = commentHarness();
  try {
    const args = { projectId: 'p1', session_id: 's1', path: 'a.ts', line: 1, text: 'hi' };
    for (const bad of [{ line: 0 }, { line: '1' }, { endLine: 0 }, { side: 'other' }, { path: '../a.ts' }, { excerpt: 3 }, { text: ' \n ' }]) {
      assert.equal((await h.send({ ...args, ...bad })).ok, false);
    }
    assert.equal(h.calls.length, 0);
  } finally { h.close(); }
});
