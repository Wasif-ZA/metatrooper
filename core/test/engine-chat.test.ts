import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEngineChat } from '../src/sessions/chat.ts';

const j = (x: unknown) => JSON.stringify(x);

test('codex rollout: the last agent reply is the last item, and a pending call waits', () => {
  const lines = [
    j({ type: 'session_meta', payload: { cwd: 'C:/p' } }),
    j({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix the bug' }] } }),
    j({ type: 'response_item', payload: { type: 'message', role: 'developer', content: [{ type: 'input_text', text: 'rules' }] } }),
    j({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Should I also update the docs?' }] } }),
  ];
  const done = parseEngineChat(lines, 'waiting_for_you');
  assert.deepEqual(done.items.map((i) => i.kind), ['user', 'text']);
  assert.equal(done.items.at(-1)?.kind === 'text' && done.items.at(-1)?.text, 'Should I also update the docs?');
  assert.equal(done.waiting, false);

  const pending = parseEngineChat([...lines, j({ type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c1' } })], 'waiting_for_you');
  assert.equal(pending.waiting, true);
  const answered = parseEngineChat([...lines, j({ type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c1' } }), j({ type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1' } })], 'waiting_for_you');
  assert.equal(answered.waiting, false);
});

test('agy transcript: request text, a reply, then a tool call waiting for approval', () => {
  const lines = [
    j({ type: 'USER_INPUT', content: '<USER_REQUEST>tidy the readme</USER_REQUEST><ADDITIONAL_METADATA>x</ADDITIONAL_METADATA>', step_index: 0 }),
    j({ type: 'PLANNER_RESPONSE', content: 'I will read it first.', step_index: 1 }),
    j({ type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'read_file', args: {} }], step_index: 2 }),
    j({ type: 'PLANNER_RESPONSE', tool_calls: [{ name: 'edit_file', args: {} }], step_index: 3 }),
  ];
  const r = parseEngineChat(lines, 'waiting_for_you');
  assert.equal(r.items[0].kind === 'user' && r.items[0].text, 'tidy the readme');
  assert.deepEqual(r.items.filter((i) => i.kind === 'tool').map((i) => i.kind === 'tool' && i.status), ['ok', 'waiting']);
  assert.equal(r.items.at(-1)?.kind === 'tool' && r.items.at(-1)?.label, 'Wants to use edit_file');
  assert.equal(r.waiting, true);
  assert.equal(parseEngineChat(lines, 'working').waiting, false);
});
