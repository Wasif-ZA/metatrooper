import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';

const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const refreshThumbs = appSource.match(/^async function refreshThumbs\([^]*?\n}\r?\n/m)?.[0];
assert.ok(refreshThumbs, 'refreshThumbs source exists');
// The optional declaration also lets the pre-fix interval run through the behavioral assertions.
const intervalSource = appSource.match(/^(?:let thumbsBusy[^\r\n]*\r?\n)?setInterval\([^\r\n]*refreshThumbs[^\r\n]*/m)?.[0];
assert.ok(intervalSource, 'thumbnail polling interval source exists');

function makePoller() {
  let tick!: () => void;
  const pending: Array<{ resolve: (value: object) => void; reject: (error: Error) => void }> = [];
  const api = {
    desktopThumbs: () => new Promise<object>((resolve, reject) => pending.push({ resolve, reject })),
  };
  const setInterval = (callback: () => void, delay: number) => {
    assert.equal(delay, 500);
    tick = callback;
  };
  new Function('ui', 'api', 'document', 'setInterval', `${refreshThumbs}\n${intervalSource}`)(
    { watch: true, snap: { grants: [{ id: 'grant-1' }] } },
    api,
    { querySelectorAll: () => [] },
    setInterval,
  );
  assert.equal(typeof tick, 'function');
  return { tick, pending };
}

test('thumbnail polling skips overlapping ticks and resumes after fulfillment', async () => {
  // protects=FIX-W8 only one desktopThumbs request runs until the pending request fulfills
  const { tick, pending } = makePoller();
  tick();
  tick();
  tick();
  assert.equal(pending.length, 1);

  pending[0].resolve({ shots: {}, dots: {} });
  await setImmediate();
  tick();
  assert.equal(pending.length, 2);
  pending[1].resolve({ shots: {}, dots: {} });
  await setImmediate();
});

test('thumbnail polling releases its guard after rejection', async () => {
  // protects=FIX-W8 a rejected desktopThumbs request releases the guard for the next tick
  const { tick, pending } = makePoller();
  tick();
  tick();
  tick();
  assert.equal(pending.length, 1);

  pending[0].reject(new Error('thumbnail capture failed'));
  await setImmediate();
  tick();
  assert.equal(pending.length, 2);
  tick();
  assert.equal(pending.length, 2);
  pending[1].resolve({ shots: {}, dots: {} });
  await setImmediate();
});
