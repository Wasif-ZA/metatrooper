import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Stub the Electron import so panes.ts loads without a browser process.
async function load() {
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'electron' ? { url: 'test:electron', shortCircuit: true } : nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      return url === 'test:electron'
        ? { format: 'module', source: 'export const app = {}, clipboard = {}, Menu = {}, nativeImage = {}, session = {}, WebContentsView = {};', shortCircuit: true }
        : nextLoad(url, context);
    },
  });
  try {
    return await import('../src/browser/panes.ts');
  } finally {
    hook.deregister();
  }
}

const { idleFor } = await load();

// protects=a request that has started but not finished (no done_at) makes the pane busy, so idle is 0 whatever else is in the ring.
// fails_when=an open request reads as idle, or a finished request elsewhere in the ring hides the open one.
// no_claim=does not check the value of idle for an empty ring, and does not test requests that failed (loadingFailed) since they share the done_at path.
test('M7-01d idleFor is 0 while a request is open', () => {
  assert.equal(idleFor([{ at: 100 }], 500), 0);
  assert.equal(idleFor([{ at: 100, done_at: 200 }, { at: 300 }], 1000), 0);
});

// protects=once every request has finished, idle counts from the latest done_at to now, so idle_ms measures time since the last request finished.
// fails_when=idle counts from the request start (at) instead of its finish, or uses a done_at other than the latest.
// no_claim=does not check the 200 ms poll, the wait_for loop, or the browser-side clock; this is a pure function over the ring.
test('M7-01d idleFor counts from the last done_at to now', () => {
  assert.equal(idleFor([{ at: 100, done_at: 200 }, { at: 300, done_at: 400 }], 1000), 600);
  assert.equal(idleFor([{ at: 100, done_at: 250 }], 1000), 750);
});

// protects=an empty ring does not read as zero idle, so a pane with no requests at all cannot be mistaken for one that just finished one.
// fails_when=an empty ring returns 0, which would make an idle_ms wait hold on a pane with no traffic.
// no_claim=does not fix the exact value for an empty ring; the spec only requires that it is not 0.
test('M7-01d idleFor on an empty ring is not 0', () => {
  assert.notEqual(idleFor([], 1000), 0);
});
