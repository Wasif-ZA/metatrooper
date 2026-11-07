import test from 'node:test';
import assert from 'node:assert/strict';
import { BATCH_MAX, checkBatch } from '../src/browser/batch.ts';

const tools = (...names: string[]) => names.map((tool) => ({ tool, args: {} }));

// protects=a batch of 0 steps is refused before any step runs
// fails_when=an empty batch passes the check, or its code is not -32602
// no_claim=what a batch with steps does (the MCP shim and the workbench run them)
test('M7-01c a batch with 0 steps fails -32602', () => {
  assert.equal(checkBatch([], 'act')?.code, -32602);
});

// protects=the 20-step limit is the cap, so a batch of 21 is refused and a batch of 20 is not
// fails_when=21 steps pass the check, or 20 steps are refused
// no_claim=the MCP schema's maxItems, which is generated from the same constant (not read here)
test('M7-01c a batch of 21 steps fails -32602 and 20 steps pass', () => {
  assert.equal(BATCH_MAX, 20);
  assert.equal(checkBatch(tools(...Array(21).fill('type')), 'act')?.code, -32602);
  assert.equal(checkBatch(tools(...Array(20).fill('type')), 'act'), null);
});

// protects=evaluate is never a batch step, even with no grant or the debug grant, so a batch cannot run script
// fails_when=a step tool of evaluate passes the check under null or debug
// no_claim=whether a single evaluate call is allowed under debug (the grant tests cover single calls)
test('M7-01c a batch step with tool evaluate fails -32602 under no grant and under debug', () => {
  assert.equal(checkBatch(tools('evaluate'), null)?.code, -32602);
  assert.equal(checkBatch(tools('evaluate'), 'debug')?.code, -32602);
});

// protects=snapshot is never a batch step, since a batch takes no snapshot of its own
// fails_when=a step tool of snapshot passes the check under no grant
// no_claim=how refs from an earlier snapshot resolve (the e2e test checks that)
test('M7-01c a batch step with tool snapshot fails -32602', () => {
  assert.equal(checkBatch(tools('snapshot'), null)?.code, -32602);
});

// protects=a batch holding click on a look session is refused as a whole, and the refusal names act (the smallest preset holding click, and batch)
// fails_when=a look batch holding click passes, or the message does not say needs grant act, or it names debug
// no_claim=that nothing ran (the e2e test counts the audit rows)
test('M7-01c a look batch holding click fails -32039 naming act', () => {
  const bad = checkBatch(tools('click'), 'look');
  assert.equal(bad?.code, -32039, JSON.stringify(bad));
  assert.match(bad.message, /needs grant act/);
  assert.doesNotMatch(bad.message, /\bdebug\b/);
});

// protects=an act session may run a batch of type, type, click, wait_for, the steps act holds
// fails_when=that batch is refused under act
// no_claim=whether each step then succeeds on the page (the e2e test checks that)
test('M7-01c an act batch of type, type, click, wait_for passes', () => {
  const batch = [
    { tool: 'type', args: { ref: 'e1', text: 'alice' } },
    { tool: 'type', args: { ref: 'e2', text: 'secret' } },
    { tool: 'click', args: { ref: 'e3' } },
    { tool: 'wait_for', args: { url_includes: '/done' } },
  ];
  assert.equal(checkBatch(batch, 'act'), null);
});

// protects=a session with no grant has no limit on batch steps beyond the shape rules
// fails_when=a null grant refuses a valid batch
// no_claim=the shape rules themselves (the other tests cover them)
test('M7-01c a null grant lets a valid batch through', () => {
  assert.equal(checkBatch(tools('click', 'navigate', 'type'), null), null);
});
