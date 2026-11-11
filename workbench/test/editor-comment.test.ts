import test from 'node:test';
import assert from 'node:assert/strict';
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

test('sendComment calls session.send and passes the core refusal through', async () => {
  const calls: any[] = [];
  const fake = async (m: string, p: any) => { calls.push([m, p]); return { kind: 'reply', reply: { result: { sent: true } } }; };
  assert.deepEqual(await sendComment('s1', { path: 'a.ts', line: 1, text: 'hi' }, fake), { ok: true });
  assert.deepEqual(calls, [['session.send', { session_id: 's1', text: 'hi / File: a.ts:1 (new side)' }]]);
  assert.deepEqual(await sendComment('s1', { path: 'a.ts', line: 1, text: ' \n ' }, fake), { ok: false, error: 'Write a comment first.' });
  assert.equal(calls.length, 1);
  const msg = 'the session is waiting on a person; only the user can answer it';
  assert.deepEqual(await sendComment('s1', { path: 'a.ts', line: 1, text: 'hi' }, async () => ({ kind: 'reply', reply: { error: { code: -32602, message: msg } } })), { ok: false, error: msg });
  assert.deepEqual(await sendComment('s1', { path: 'a.ts', line: 1, text: 'hi' }, async () => ({ kind: 'offline' })), { ok: false, error: 'The core is offline.' });
});
