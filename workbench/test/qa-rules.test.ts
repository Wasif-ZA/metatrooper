import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

await import(pathToFileURL(fileURLToPath(new URL('../renderer/layouts/rules.js', import.meta.url))));
const { pickLayout, opens, moment, ruleOf } = globalThis.layoutRules;
globalThis.runLayouts = {};
// Run the classic script in a context so its lexical findingStore is available to this test.
const timelineContext = vm.createContext({ runLayouts: globalThis.runLayouts, window: {} });
const timelineSource = readFileSync(fileURLToPath(new URL('../renderer/layouts/timeline.js', import.meta.url)), 'utf8');
vm.runInContext(`${timelineSource}\n;globalThis.__findingStore = findingStore;`, timelineContext);
const { normalise } = timelineContext.__findingStore;
const run = { pipeline_id: 'e2e-browser-qa' };
const pipe = { layout: 'pipe' };
const steps = (statuses) => Object.entries(statuses).map(([id, status]) => ({ id, status }));
const findings = (raw) => normalise(raw);

test('failed reverify selects run-log', () => {
  assert.equal(pickLayout(run, pipe, steps({ reverify: 'failed' }), null, findings([])), 'run-log');
});

test('critical unfixed finding selects timeline and opens mid-run at critical', () => {
  const data = findings([{ severity: 'CRITICAL', file: 'a.js' }]);
  const list = steps({ verify: 'running' });
  assert.equal(pickLayout(run, pipe, list, null, data), 'timeline');
  assert.equal(opens(run, list, data), true);
  assert.equal(moment(run, list, data), 'critical');
});

test('open findings across at least three files select coverage-map', () => {
  const data = findings([{ file: 'a.js' }, { file: 'b.js' }, { file: 'c.js' }]);
  assert.equal(pickLayout(run, pipe, [], null, data), 'coverage-map');
});

test('some fixed and some open findings select before-after', () => {
  const data = findings([{ file: 'a.js', fixed_by: 'patch' }, { file: 'b.js' }]);
  assert.equal(pickLayout(run, pipe, [], null, data), 'before-after');
});

test('open findings with none fixed select timeline', () => {
  const data = findings([{ file: 'a.js' }]);
  assert.equal(pickLayout(run, pipe, [], null, data), 'timeline');
});

test('all fixed findings select before-after and do not open', () => {
  const data = findings([{ file: 'a.js', fixed_by: 'patch' }]);
  assert.equal(pickLayout(run, pipe, [], null, data), 'before-after');
  assert.equal(opens(run, [], data), false);
});

test('completed report with open findings has open moment', () => {
  const data = findings([{ file: 'a.js' }]);
  assert.equal(moment(run, steps({ report: 'done' }), data), 'open');
});

test('missing QA data falls back to the pipe layout', () => {
  assert.equal(pickLayout(run, pipe, []), 'pipe');
});

test('finding normalise lowercases severity and derives fixed and counts from fixed_by', () => {
  const data = findings([
    { severity: 'CRITICAL', file: 'a.js' },
    { severity: 'High', file: 'b.js', fixed_by: 'patch' },
    { severity: 'medium', file: 'c.js' },
  ]);
  assert.equal(data.items[0].sev, 'critical');
  assert.equal(data.items[0].fixed, false);
  assert.equal(data.items[1].sev, 'high');
  assert.equal(data.items[1].fixed, true);
  assert.equal(data.critical, 1);
  assert.equal(data.fixed, 1);
  assert.equal(data.open, 2);
  assert.equal(data.files, 2);
});

test('finding normalise counts only unfixed critical findings', () => {
  const data = findings([{ severity: 'critical', fixed_by: 'patch' }, { severity: 'critical' }]);
  assert.equal(data.critical, 1);
});

test('finding normalise counts distinct files among open findings', () => {
  const data = findings([{ file: 'a.js' }, { file: 'a.js' }, { file: 'b.js', fixed_by: 'patch' }]);
  assert.equal(data.files, 1);
});

test('finding normalise returns null for non-array input', () => {
  assert.equal(normalise({}), null);
});

test('finding normalise counts missing filenames as one distinct file', () => {
  const data = findings([{}, { file: '' }]);
  assert.equal(data.files, 1);
});
