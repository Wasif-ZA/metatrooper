import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';

await import(pathToFileURL(fileURLToPath(new URL('../renderer/layouts/rules.js', import.meta.url))));
const { pickLayout, opens, moment, ruleOf } = globalThis.layoutRules;
const run = { pipeline_id: 'design-variants' };
const pipe = { layout: 'artifact-columns' };
const steps = (statuses) => Object.entries(statuses).map(([id, status]) => ({ id, status }));

test('approve-directions waiting selects artifact-columns at directions', () => {
  const list = steps({ 'approve-directions': 'waiting' });
  assert.equal(pickLayout(run, pipe, list), 'artifact-columns');
  assert.equal(moment(run, list, null), 'directions');
});

test('pick waiting selects variants-grid at pick', () => {
  const list = steps({ pick: 'waiting' });
  assert.equal(pickLayout(run, pipe, list), 'variants-grid');
  assert.equal(moment(run, list, null), 'pick');
});

test('failed variants selects agent-split and opens', () => {
  const list = steps({ variants: 'failed' });
  assert.equal(pickLayout(run, pipe, list), 'agent-split');
  assert.equal(opens(run, list, null), true);
});

test('running variants selects variants-grid without opening', () => {
  const list = steps({ variants: 'running' });
  assert.equal(pickLayout(run, pipe, list), 'variants-grid');
  assert.equal(opens(run, list, null), false);
});

test('polish running or done selects preview-stage', () => {
  for (const status of ['running', 'done']) assert.equal(pickLayout(run, pipe, steps({ polish: status })), 'preview-stage');
});

test('running board selects artifact-columns', () => {
  assert.equal(pickLayout(run, pipe, steps({ board: 'running' })), 'artifact-columns');
});

test('design-variants rule lists layouts in key order', () => {
  assert.deepEqual(ruleOf('design-variants').five, ['variants-grid', 'artifact-columns', 'preview-stage', 'agent-split', 'artifact-columns']);
});
