import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPayload } from '../src/redact.ts';

const notify = (raw: object) => buildPayload('claude.Notification', { session_id: 's', cwd: 'c', ...raw });

test('idle reminder classifies as idle, not input', () => {
  assert.equal(notify({ message: 'Claude is waiting for your input', notification_type: 'idle_prompt' }).class, 'idle');
  assert.equal(notify({ message: 'Claude is waiting for your input' }).class, 'idle');
});

test('permission prompt still classifies as permission', () => {
  assert.equal(notify({ message: 'Claude needs your permission', notification_type: 'permission_prompt' }).class, 'permission');
  assert.equal(notify({ message: 'Claude needs your permission to use Bash' }).class, 'permission');
});

test('a question from Claude classifies as input', () => {
  assert.equal(notify({ message: 'Claude has a question', notification_type: 'elicitation_dialog' }).class, 'input');
});

test('notification_type is kept and the message text is not', () => {
  const p = notify({ message: 'Claude is waiting for your input', title: 'Claude Code', notification_type: 'idle_prompt' });
  assert.equal(p.notification_type, 'idle_prompt');
  assert.equal(p.message, undefined);
  assert.equal(p.title, undefined);
});
