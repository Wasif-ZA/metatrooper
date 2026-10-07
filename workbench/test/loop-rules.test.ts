import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';

await import(pathToFileURL(fileURLToPath(new URL('../renderer/layouts/rules.js', import.meta.url))));
const { pickLayout, opens, moment, ruleOf } = globalThis.layoutRules;
const run = { pipeline_id: 'spec-build-review-handback' };
const pipe = { layout: 'hand-back' };

const steps = (statuses) => Object.entries(statuses).map(([id, status]) => ({ id, status }));

test('approve-spec waiting picks artifact-columns and opens at spec', () => {
  const current = steps({ 'approve-spec': 'waiting' });
  assert.equal(pickLayout(run, pipe, current), 'artifact-columns');
  assert.equal(opens(run, current), true);
  assert.equal(moment(run, current), 'spec');
});

test('running build picks agent-split without opening', () => {
  const current = steps({ build: 'running' });
  assert.equal(pickLayout(run, pipe, current), 'agent-split');
  assert.equal(opens(run, current), false);
});

test('failed verify or fix picks run-log and opens', () => {
  for (const id of ['verify', 'fix']) {
    const current = steps({ [id]: 'failed' });
    assert.equal(pickLayout(run, pipe, current), 'run-log');
    assert.equal(opens(run, current), true);
  }
});

test('completed steps pick hand-back and open at handback', () => {
  const current = steps({ handback: 'done' });
  assert.equal(pickLayout(run, pipe, current), 'hand-back');
  assert.equal(opens(run, current), true);
  assert.equal(moment(run, current), 'handback');
});

test('spec and handback moments reopen a bar independently', () => {
  const spec = steps({ 'approve-spec': 'waiting' });
  const handback = steps({ handback: 'done' });
  assert.notEqual(moment(run, spec), moment(run, handback));
  assert.equal(opens(run, spec, 'spec'), true);
  assert.equal(opens(run, handback, 'spec'), true);
});

test('loop rule lists layouts in key order', () => {
  assert.deepEqual(ruleOf('spec-build-review-handback').five, ['hand-back', 'artifact-columns', 'agent-split', 'agent-split', 'run-log']);
});

test('two-engine-review opens remains a plain boolean', () => {
  const reviewRun = { pipeline_id: 'two-engine-review' };
  assert.equal(typeof opens(reviewRun, [], { disagree: 1 }), 'boolean');
});
