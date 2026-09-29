import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bs } from './helpers.ts';
import { canonicalPath, projectId, isAcuPath } from '../src/project.ts';
import { redactToolInput, buildPayload } from '../src/redact.ts';
import { nextState } from '../src/events/state.ts';
import { encode, createDecoder } from '../src/pipe/framing.ts';

test('canonicalPath normalizes separators, drive case, and trailing slash', () => {
  const windows = `C:${bs}Proj${bs}`;
  assert.equal(canonicalPath(windows), 'c:/Proj');
  assert.equal(canonicalPath('c:/Proj/'), 'c:/Proj');
  assert.equal(canonicalPath(`D:${bs}Users${bs}A${bs}file`), 'd:/Users/A/file');
  assert.equal(canonicalPath('c:/Proj'), canonicalPath(windows));
  assert.equal(projectId(canonicalPath(windows)), createHash('sha1').update('c:/Proj').digest('hex'));
});

test('isAcuPath detects either separator and any case', () => {
  for (const path of ['C:/work/ACU/repo', `C:${bs}WORK${bs}acu${bs}repo`, 'work/acu']) assert.equal(isAcuPath(path), true, path);
  for (const path of ['C:/work/other/repo', 'C:/work/ACUish/repo', 'C:/workspace/acu/repo']) assert.equal(isAcuPath(path), false, path);
});

test('redaction retains only the first command word and length for shells', () => {
  for (const tool of ['Bash', 'PowerShell']) {
    const command = 'echo PRIVATE_MARKER and arguments';
    const output = redactToolInput(tool, { command, extra: 'PRIVATE_MARKER' });
    assert.equal(JSON.stringify(output).includes('PRIVATE_MARKER'), false);
    assert.deepEqual(Object.values(output).sort(), ['echo', command.length].sort());
  }
});

test('redaction retains only file_path for file tools', () => {
  for (const tool of ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
    assert.deepEqual(redactToolInput(tool, { file_path: '/safe/file', content: 'PRIVATE_MARKER', old_string: 'PRIVATE_MARKER' }), { file_path: '/safe/file' });
  }
});

test('redaction retains only path for search tools', () => {
  for (const tool of ['Grep', 'Glob']) assert.deepEqual(redactToolInput(tool, { path: '/safe', pattern: 'PRIVATE_MARKER' }), { path: '/safe' });
});

test('WebFetch stores the URL host only', () => {
  const output = redactToolInput('WebFetch', { url: 'https://example.test/private/PRIVATE_MARKER?q=secret', prompt: 'PRIVATE_MARKER' });
  assert.deepEqual(Object.values(output), ['example.test']);
});

test('unknown and MCP tools store key names and value lengths only', () => {
  for (const tool of ['UnknownTool', 'mcp__server__run']) {
    const output = redactToolInput(tool, { query: 'PRIVATE_MARKER', count: '1234' });
    assert.deepEqual(output, { query: 14, count: 4 });
  }
});

test('buildPayload drops unknown fields for every specified event kind', () => {
  const cases = [
    ['launch', { session_id: 's', pid: 42, cwd: '/p', engine: 'fake', started_at: 'now' }, ['session_id', 'pid', 'cwd', 'engine', 'started_at']],
    ['claude.PreToolUse', { session_id: 'native', transcript_path: '/t', cwd: '/p', tool_name: 'Read', tool_use_id: 'u', tool_input: { file_path: '/safe', content: 'PRIVATE_MARKER' } }, ['session_id', 'transcript_path', 'cwd', 'tool_name', 'tool_use_id', 'tool_input']],
    ['claude.PostToolUse', { session_id: 'native', transcript_path: '/t', cwd: '/p', tool_name: 'Read', tool_use_id: 'u', tool_input: { file_path: '/safe' }, tool_response: 'PRIVATE_MARKER', response_length: 14 }, ['session_id', 'transcript_path', 'cwd', 'tool_name', 'tool_use_id', 'tool_input', 'response_length']],
    ['claude.UserPromptSubmit', { session_id: 'native', cwd: '/p', prompt: 'PRIVATE_MARKER', prompt_length: 14 }, ['session_id', 'cwd', 'prompt_length']],
    ['claude.Notification', { session_id: 'native', cwd: '/p', class: 'permission', message: 'PRIVATE_MARKER', message_length: 14 }, ['session_id', 'cwd', 'class', 'message_length']],
    ['claude.Stop', { session_id: 'native', cwd: '/p', stop_hook_active: false }, ['session_id', 'cwd', 'stop_hook_active']],
    ['claude.SessionEnd', { session_id: 'native', cwd: '/p', reason: 'logout' }, ['session_id', 'cwd', 'reason']],
    ['codex.turn', { type: 'agent-turn-complete', 'thread-id': 't', 'turn-id': 'u', cwd: '/p', input_length: 2, reply_length: 3 }, ['type', 'thread-id', 'turn-id', 'cwd', 'input_length', 'reply_length']],
    ['herdr.state', { pane: 'w1:p2', state: 'blocked', agent: 'a' }, ['pane', 'state', 'agent']],
    ['core.activity', { state: 'working' }, ['state']],
    ['core.process-gone', { pid: 42 }, ['pid']],
    ['core.seen', {}, []]
  ];
  for (const [kind, fields, allowed] of cases) {
    const result = buildPayload(kind, { ...fields, future_field: 'PRIVATE_MARKER', terminal_output: 'PRIVATE_MARKER' });
    assert.deepEqual(Object.keys(result).sort(), allowed.sort(), kind);
    assert.equal(JSON.stringify(result).includes('PRIVATE_MARKER'), false, kind);
  }
});

test('nextState follows every event row in the state mapping', () => {
  const cases = [
    ['launch', {}, 'starting'],
    ['claude.UserPromptSubmit', {}, 'working'],
    ['claude.PreToolUse', {}, 'working'],
    ['claude.PostToolUse', {}, 'working'],
    ['claude.Notification', { class: 'permission' }, 'waiting_for_you'],
    ['claude.Notification', { class: 'input' }, 'waiting_for_you'],
    ['claude.Notification', { class: 'other' }, null],
    ['claude.Stop', {}, 'done'],
    ['claude.SessionEnd', {}, 'exited'],
    ['codex.turn', {}, 'done'],
    ['core.activity', { state: 'working' }, 'working'],
    ['core.process-gone', { pid: 42 }, 'exited'],
    ['herdr.state', { state: 'blocked' }, 'waiting_for_you'],
    ...['working', 'done', 'idle', 'unknown'].map(state => ['herdr.state', { state }, state])
  ];
  for (const [kind, payload, expected] of cases) assert.equal(nextState('idle', { kind, payload }), expected, kind);
  assert.equal(nextState('working', { kind: 'claude.Notification', payload: { class: 'other' } }), null);
  for (const current of ['starting', 'working', 'waiting_for_you', 'done', 'idle', 'unknown']) {
    assert.equal(nextState(current, { kind: 'core.activity', payload: { state: 'working' } }), 'working', current);
    assert.equal(nextState(current, { kind: 'core.process-gone', payload: { pid: 42 } }), 'exited', current);
  }
  assert.equal(nextState('working', { kind: 'core.activity', payload: { state: 'quiet' } }), 'done');
  for (const current of ['starting', 'waiting_for_you', 'done', 'idle', 'unknown']) {
    assert.equal(nextState(current, { kind: 'core.activity', payload: { state: 'quiet' } }), null, current);
  }
  for (const current of ['starting', 'working', 'waiting_for_you', 'idle', 'unknown']) {
    assert.equal(nextState(current, { kind: 'core.seen', payload: {} }), null, current);
  }
  assert.equal(nextState('done', { kind: 'core.seen', payload: {} }), 'idle');
  for (const kind of ['core.checkpoint', 'core.recovered', 'core.missed-schedule']) {
    for (const current of ['starting', 'working', 'waiting_for_you', 'done', 'idle', 'unknown']) {
      assert.equal(nextState(current, { kind, payload: {} }), null, `${kind} from ${current}`);
    }
  }
  for (const [kind, payload] of [...cases, ['core.activity', { state: 'quiet' }], ['core.seen', {}], ['core.checkpoint', {}], ['core.recovered', {}], ['core.missed-schedule', {}]]) {
    assert.equal(nextState('exited', { kind, payload }), null, kind);
  }
});

test('framing round trips chunked and multiple lines and rejects over 1 MiB', () => {
  const messages = [];
  const decode = createDecoder(message => messages.push(message));
  const first = { jsonrpc: '2.0', id: 'one', result: { text: 'x\ny' } };
  const second = { jsonrpc: '2.0', id: 'two', result: {} };
  const wire = encode(first) + encode(second);
  assert.equal(wire, JSON.stringify(first) + '\n' + JSON.stringify(second) + '\n');
  decode(wire.slice(0, 7));
  decode(Buffer.from(wire.slice(7)));
  assert.deepEqual(messages, [first, second]);
  const oversized = createDecoder(() => assert.fail('oversized line was decoded'));
  assert.throws(() => oversized('x'.repeat(1024 * 1024 + 1) + '\n'), { name: 'LineTooLong' });
});
