import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChat } from '../src/sessions/chat.ts';

const line = (uuid: string | undefined, type: string, content: unknown) => JSON.stringify({ ...(uuid ? { uuid } : {}), type, message: { content } });

test('user and text items carry a stable id from the transcript line uuid and block position', () => {
  const lines = [
    line('u1', 'user', 'write a haiku'),
    line('a1', 'assistant', [{ type: 'text', text: 'First.' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } }, { type: 'text', text: 'Second.' }]),
    line('u2', 'user', [{ type: 'text', text: 'more' }]),
  ];
  const { items } = parseChat(lines, 'working');
  const ids = items.map((i: any) => i.id);
  assert.deepEqual(ids, ['u1', 'a1:0', 't1', 'a1:2', 'u2:0']);
});

test('ids survive the window sliding: dropping the oldest line does not renumber the rest', () => {
  const lines = [line('u1', 'user', 'one'), line('a1', 'assistant', [{ type: 'text', text: 'A' }]), line('a2', 'assistant', [{ type: 'text', text: 'B' }])];
  const full = parseChat(lines, 'working').items.map((i: any) => i.id);
  const slid = parseChat(lines.slice(1), 'working').items.map((i: any) => i.id);
  assert.ok(full.every(Boolean), 'every item has an id');
  assert.deepEqual(slid, full.slice(1));
});

test('a line without a uuid gives items without an id, as before', () => {
  const { items } = parseChat([line(undefined, 'user', 'hi'), line(undefined, 'assistant', [{ type: 'text', text: 'Hello.' }])], 'working');
  assert.deepEqual(items, [{ kind: 'user', text: 'hi' }, { kind: 'text', text: 'Hello.' }]);
});
