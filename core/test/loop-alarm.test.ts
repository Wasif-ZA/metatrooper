import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoopAlarm, NUDGE_OPTIONS } from '../src/loop-alarm.ts';

const call = (tool = 'read', input = 'a', output = 'x', polling?: boolean) => ({ tool, input, output, polling });

test('nudge options are the four choices', () => {
  assert.deepEqual([...NUDGE_OPTIONS], ['pause', 'rewind', 'try-another-way', 'not-a-loop']);
});

test('five identical calls give ok, ok, nudge, nudge, stop', () => {
  const alarm = createLoopAlarm();
  const verdicts = [1, 2, 3, 4, 5].map(() => alarm.observe(call()));
  assert.deepEqual(verdicts, ['ok', 'ok', 'nudge', 'nudge', 'stop']);
  assert.equal(alarm.nudges, 2);
  assert.equal(alarm.streak, 5);
});

test('a new output resets the streak', () => {
  const alarm = createLoopAlarm();
  alarm.observe(call());
  alarm.observe(call());
  assert.equal(alarm.observe(call('read', 'a', 'y')), 'ok');
  assert.equal(alarm.streak, 1);
});

test('a different input resets the streak', () => {
  const alarm = createLoopAlarm();
  alarm.observe(call());
  alarm.observe(call());
  alarm.observe(call('read', 'b'));
  assert.equal(alarm.streak, 1);
});

test('a different tool with the same input resets the streak', () => {
  const alarm = createLoopAlarm();
  alarm.observe(call());
  alarm.observe(call());
  alarm.observe(call('write'));
  assert.equal(alarm.streak, 1);
});

test('polling calls are ok and transparent to the streak', () => {
  const alarm = createLoopAlarm();
  alarm.observe(call());
  assert.equal(alarm.observe(call('poll', 'z', 'q', true)), 'ok');
  assert.equal(alarm.streak, 1);
  alarm.observe(call());
  assert.equal(alarm.streak, 2);
  assert.equal(alarm.observe(call()), 'nudge');
});

test('not-a-loop counts a false alarm and resets the streak', () => {
  const alarm = createLoopAlarm();
  for (let i = 0; i < 3; i++) alarm.observe(call());
  alarm.choose('not-a-loop');
  assert.equal(alarm.falseAlarms, 1);
  assert.equal(alarm.streak, 0);
  assert.equal(alarm.observe(call()), 'ok');
  assert.equal(alarm.streak, 1);
});

test('other choices change nothing', () => {
  const alarm = createLoopAlarm();
  for (let i = 0; i < 3; i++) alarm.observe(call());
  for (const choice of ['pause', 'rewind', 'try-another-way'] as const) alarm.choose(choice);
  assert.equal(alarm.streak, 3);
  assert.equal(alarm.falseAlarms, 0);
  assert.equal(alarm.nudges, 1);
});

test('custom nudgeAt and stopAt are honoured', () => {
  const alarm = createLoopAlarm({ nudgeAt: 2, stopAt: 3 });
  const verdicts = [1, 2, 3].map(() => alarm.observe(call()));
  assert.deepEqual(verdicts, ['ok', 'nudge', 'stop']);
});

test('tool ab with input c differs from tool a with input bc', () => {
  const alarm = createLoopAlarm();
  alarm.observe(call('ab', 'c'));
  alarm.observe(call('a', 'bc'));
  assert.equal(alarm.streak, 1);
});
