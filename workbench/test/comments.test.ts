import test from 'node:test';
import assert from 'node:assert/strict';
import * as comments from '../src/comments.ts';

test('a comment counts as copied only when the core replied with a clipboard time', () => {
  const copied = (comments as Record<string, any>).copied;
  assert.equal(typeof copied, 'function');
  assert.equal(copied({ kind: 'reply', reply: { id: '1', result: { clipboard_at: '2026-10-11T10:00:00Z', typed: false } } }), true);
  assert.equal(copied({ kind: 'reply', reply: { id: '1', result: { clipboard_at: null, typed: false } } }), false);
  assert.equal(copied({ kind: 'reply', reply: { id: '1', error: { code: -32002, message: 'comment not found' } } }), false);
  assert.equal(copied({ kind: 'offline' }), false);
});
