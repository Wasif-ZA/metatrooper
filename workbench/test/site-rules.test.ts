import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';

await import(pathToFileURL(fileURLToPath(new URL('../renderer/layouts/rules.js', import.meta.url))));
const { pickLayout, opens, moment, ruleOf } = globalThis.layoutRules;
const run = { pipeline_id: 'website-build' };
const pipe = { layout: 'pipe' };
const steps = (statuses) => Object.entries(statuses).map(([id, status]) => ({ id, status }));

test('approve waiting opens preview-stage at approve', () => {
  const list = steps({ approve: 'waiting' });
  assert.equal(pickLayout(run, pipe, list), 'preview-stage');
  assert.equal(opens(run, list, null), true);
  assert.equal(moment(run, list, null), 'approve');
});

test('loop-max pause selects before-after at gaveup', () => {
  const pausedRun = { ...run, paused_why: 'loop-max' };
  const list = steps({ build: 'done' });
  assert.equal(pickLayout(pausedRun, pipe, list), 'before-after');
  assert.equal(moment(pausedRun, list, null), 'gaveup');
});

test('running build selects agent-split without opening', () => {
  const list = steps({ build: 'running' });
  assert.equal(pickLayout(run, pipe, list), 'agent-split');
  assert.equal(opens(run, list, null), false);
});

test('running critique selects before-after', () => {
  assert.equal(pickLayout(run, pipe, steps({ critique: 'running' })), 'before-after');
});

test('completed production selects pipe', () => {
  assert.equal(pickLayout(run, pipe, steps({ production: 'done' })), 'pipe');
});

test('failed preview selects run-log and opens', () => {
  const list = steps({ preview: 'failed' });
  assert.equal(pickLayout(run, pipe, list), 'run-log');
  assert.equal(opens(run, list, null), true);
});

test('website-build rule lists layouts in key order', () => {
  assert.deepEqual(ruleOf('website-build').five, ['preview-stage', 'before-after', 'pipe', 'agent-split', 'run-log']);
});
