import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('M6-02 dispatch: the recheck right before input compares what the approval was given for, an unreadable control fails closed, and keys carry their shifted text', () => {
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/approval-dispatch.ts', import.meta.url))], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), {
    sameControlSends: 'sent',
    becamePasswordAsksAgain: 'the control changed since it was checked; nothing was sent',
    plain: 'keyDown a KeyA "a" up:a',
    shiftLetter: 'keyDown A KeyA "A" up:A',
    shiftDigit: 'keyDown ! Digit1 "!" up:!',
    shiftPunctuation: 'keyDown ? Slash "?" up:?',
    ctrlLetter: 'rawKeyDown a KeyA - up:a',
    shiftEnter: 'keyDown Enter Enter "\\r" up:Enter',
    unreadableClickAsks: 'hidden control',
    unreadableAtDispatchAsksAgain: 'the control changed since it was checked; nothing was sent',
  });
});
