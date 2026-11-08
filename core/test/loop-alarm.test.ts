import test from 'node:test';
import assert from 'node:assert/strict';
import { createLoopAlarm, NUDGE_OPTIONS } from '../src/loop-alarm.ts';

const call = (tool = 'read', input = 'a', output = 'x') => ({ tool, input, output });

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

test('a poll with changing output stays ok', () => {
  const alarm = createLoopAlarm();
  for (let i = 0; i < 10; i++) {
    assert.equal(alarm.observe(call('poll', 'z', 'progress ' + i)), 'ok');
    assert.equal(alarm.streak, 1);
  }
  assert.equal(alarm.nudges, 0);
});

test('a poll whose output stops changing nudges at three and stops at five', () => {
  const alarm = createLoopAlarm();
  for (let i = 0; i < 3; i++) {
    assert.equal(alarm.observe(call('poll', 'z', 'progress ' + i)), 'ok');
  }
  const verdicts = [1, 2, 3, 4, 5].map(() => alarm.observe(call('poll', 'z', 'waiting')));
  assert.deepEqual(verdicts, ['ok', 'ok', 'nudge', 'nudge', 'stop']);
  assert.equal(alarm.streak, 5);
  assert.equal(alarm.nudges, 2);
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

test('identical calls keep returning stop after the fifth call', () => {
  const alarm = createLoopAlarm();
  for (let i = 0; i < 4; i++) alarm.observe(call());
  assert.equal(alarm.observe(call()), 'stop');
  assert.equal(alarm.observe(call()), 'stop');
  assert.equal(alarm.streak, 6);
});

test('stop verdicts do not increase nudges', () => {
  const alarm = createLoopAlarm();
  for (let i = 0; i < 4; i++) alarm.observe(call());
  assert.equal(alarm.nudges, 2);
  for (let i = 0; i < 3; i++) {
    assert.equal(alarm.observe(call()), 'stop');
    assert.equal(alarm.nudges, 2);
  }
});

test('not-a-loop during a stop streak starts a fresh streak', () => {
  const alarm = createLoopAlarm();
  for (let i = 0; i < 5; i++) alarm.observe(call());
  assert.equal(alarm.streak, 5);
  alarm.choose('not-a-loop');
  assert.equal(alarm.falseAlarms, 1);
  assert.equal(alarm.streak, 0);
  assert.equal(alarm.observe(call()), 'ok');
  assert.equal(alarm.observe(call()), 'ok');
  assert.equal(alarm.streak, 2);
  assert.equal(alarm.observe(call()), 'nudge');
  assert.equal(alarm.nudges, 3);
});

test('alarm properties and serialization do not expose raw input or output', () => {
  const alarm = createLoopAlarm();
  const input = 'private-input-7e9b2c';
  const output = 'private-output-4a8f1d';
  for (let i = 0; i < 5; i++) alarm.observe(call('read', input, output));
  const keys = Object.keys(alarm);
  const properties = keys.map(key => alarm[key as keyof typeof alarm]);
  for (const raw of [input, output]) {
    assert.equal(keys.includes(raw), false);
    assert.equal(properties.includes(raw), false);
    assert.equal(JSON.stringify(alarm).includes(raw), false);
  }
});

test('alarms keep streaks and counters independent', () => {
  const first = createLoopAlarm();
  const second = createLoopAlarm();
  for (let i = 0; i < 5; i++) first.observe(call());
  assert.equal(second.streak, 0);
  assert.equal(second.nudges, 0);
  assert.equal(second.falseAlarms, 0);
  assert.equal(second.observe(call()), 'ok');
  first.choose('not-a-loop');
  assert.equal(first.streak, 0);
  assert.equal(first.falseAlarms, 1);
  assert.equal(second.streak, 1);
  assert.equal(second.falseAlarms, 0);
  assert.equal(second.observe(call()), 'ok');
  assert.equal(second.observe(call()), 'nudge');
  assert.equal(second.nudges, 1);
  assert.equal(first.streak, 0);
  assert.equal(first.nudges, 2);
});

test('invalid thresholds throw RangeError and minimum valid thresholds are accepted', () => {
  for (const options of [
    { stopAt: 3 },
    { nudgeAt: 4, stopAt: 2 },
    { nudgeAt: NaN },
    { nudgeAt: 0 },
    { stopAt: 5.5 },
  ]) {
    assert.throws(() => createLoopAlarm(options), RangeError);
  }
  assert.doesNotThrow(() => createLoopAlarm({ nudgeAt: 1, stopAt: 2 }));
});
