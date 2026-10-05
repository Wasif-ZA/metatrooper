import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';

await import(pathToFileURL(fileURLToPath(new URL('../renderer/layouts/rules.js', import.meta.url))));
const { pickLayout, due } = globalThis.layoutRules;
const run = { pipeline_id: 'spec-to-pr' };
const pipe = { layout: 'pr-first' };
const steps = [
  ['spec', 'artifact-columns'], ['approve-spec', 'artifact-columns'], ['build', 'agent-split'],
  ['verify', 'run-log'], ['approve-pr', 'pr-first'], ['open-pr', 'pr-first'],
];

test('spec-to-pr step hints select the expected layout for each active step', () => {
  for (const [id, layout] of steps) {
    assert.equal(pickLayout(run, pipe, [{ id, status: id.startsWith('approve') ? 'waiting' : 'running', def: { layout } }], null), layout, id);
  }
});

test('a failed step selects run-log ahead of its layout hint', () => {
  assert.equal(pickLayout(run, pipe, [{ id: 'build', status: 'failed', def: { layout: 'agent-split' } }], null), 'run-log');
});

test('manual layout holds until 0 releases it back to automatic selection', () => {
  assert.equal(pickLayout(run, pipe, [{ id: 'spec', status: 'running', def: { layout: 'artifact-columns' } }], 'pipe'), 'pipe');
  assert.equal(pickLayout(run, pipe, [{ id: 'spec', status: 'running', def: { layout: 'artifact-columns' } }], null), 'artifact-columns');
});

test('a running step becomes eligible at 5 seconds, but not before', () => {
  const active = [{ id: 'build', status: 'running', def: { layout: 'agent-split' } }];
  assert.deepEqual(due('artifact-columns', 'agent-split', active, 4999, 0, -1e12), { move: false, retryIn: 1 });
  assert.deepEqual(due('artifact-columns', 'agent-split', active, 5000, 0, -1e12), { move: true });
});

test('automatic moves wait until 2 seconds after the last touch', () => {
  const waiting = [{ id: 'approve-pr', status: 'waiting', def: { layout: 'pr-first' } }];
  assert.deepEqual(due('artifact-columns', 'pr-first', waiting, 2999, 1000, 1000), { move: false, retryIn: 1 });
  assert.deepEqual(due('artifact-columns', 'pr-first', waiting, 3000, 1000, 1000), { move: true });
});
