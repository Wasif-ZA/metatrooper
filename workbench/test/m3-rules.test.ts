import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

await import(pathToFileURL(fileURLToPath(new URL('../renderer/layouts/rules.js', import.meta.url))));
const { pickLayout, opens, ruleOf, flagsOf } = globalThis.layoutRules;
const steps = (statuses) => Object.entries(statuses).map(([id, status]) => ({ id, status }));
const pipe = (layout) => ({ layout });
const run = (pipeline_id, extra = {}) => ({ pipeline_id, ...extra });
const fixtureRun = (id) => {
  const context = vm.createContext({ window: {} });
  const source = readFileSync(new URL(`../../tests/fixtures/${id}/run.js`, import.meta.url), 'utf8');
  vm.runInContext(source, context);
  return context.window.RUN;
};
const fixtureSteps = (id) => fixtureRun(id).steps.map(({ id: stepId, status }) => ({ id: stepId, status }));

const cases = [
  { id: 'footage-to-edit', five: ['timeline', 'preview-stage', 'before-after', 'pipe', 'run-log'], opens: [ [[['approve-plan', 'waiting']], null, true], [[['approve-final', 'waiting']], null, true], [[], { flag: 'left for you' }, true], [[], null, false] ], branches: [ [[['edit', 'failed']], null, 'run-log'], [[['approve-plan', 'waiting']], null, 'timeline'], [[['approve-final', 'waiting']], null, 'preview-stage'], [[['edit', 'done']], { flag: 'left for you' }, 'before-after'] ], noMatch: null },
  { id: 'clips-to-scheduled-posts', five: ['variants-grid', 'preview-stage', 'timeline', 'pr-first', 'run-log'], opens: [ [[['pick', 'waiting']], null, true], [[['approve', 'waiting']], null, true], [[], null, false] ], branches: [ [[['cut', 'failed']], null, 'run-log'], [[['pick', 'waiting']], null, 'variants-grid'], [[['approve', 'waiting']], { flag: true }, 'preview-stage'], [[['approve', 'waiting']], null, 'pr-first'] ], noMatch: null },
  { id: 'seo-audit-fix', five: ['triage', 'coverage-map', 'before-after', 'pr-first', 'run-log'], opens: [ [[['approve', 'waiting']], null, true], [[['speed', 'done']], { loop_max: true }, true], [[['crawl', 'failed']], null, true], [[['audit', 'done']], null, false] ], branches: [ [[['crawl', 'failed']], null, 'run-log'], [[['speed', 'done']], { loop_max: true }, 'before-after'], [[['approve', 'waiting']], null, 'pr-first'], [[['crawl', 'running']], null, null] ], noMatch: null },
  { id: 'deep-research-cited', five: ['artifact-columns', 'run-log', 'coverage-map', 'pr-inline', 'preview-stage'], opens: [ [[['approve-plan', 'waiting']], null, true], [[['cite-check', 'failed']], { loop_max: true }, true], [[['draft', 'done']], null, false] ], branches: [ [[['sweep', 'failed']], null, 'run-log'], [[['cite-check', 'running']], { loop_max: true }, 'pr-inline'], [[['approve-plan', 'waiting']], null, 'artifact-columns'] ], noMatch: null },
  { id: 'prospect-list-to-drafts', five: ['coverage-map', 'triage', 'preview-stage', 'pr-first', 'run-log'], opens: [ [[['approve-spend', 'waiting']], null, true], [[['approve', 'waiting']], null, true], [[['sources', 'failed']], null, true], [[['write', 'done']], null, false] ], branches: [ [[['load', 'failed']], null, 'run-log'], [[['approve-spend', 'waiting']], null, 'coverage-map'], [[['approve', 'waiting']], { flag: true }, 'triage'], [[['approve', 'waiting']], null, 'pr-first'] ], noMatch: null },
  { id: 'inbox-triage-drafts', five: ['triage', 'buckets', 'preview-stage', 'pr-first', 'run-log'], opens: [ [[['approve', 'waiting']], null, true], [[['fetch', 'failed']], null, true], [[['classify', 'done']], null, false] ], branches: [ [[['fetch', 'failed']], null, 'run-log'], [[['approve', 'waiting']], { flag: true }, 'triage'], [[['approve', 'waiting']], null, 'pr-first'] ], noMatch: null },
  { id: 'data-to-dashboard', five: ['preview-stage', 'artifact-columns', 'coverage-map', 'before-after', 'run-log'], opens: [ [[['signoff', 'waiting']], null, true], [[['readback', 'running']], { loop_max: true, headline_wrong: true }, true], [[['load', 'failed']], null, true], [[['build', 'done']], null, false] ], branches: [ [[['load', 'failed']], null, 'run-log'], [[['readback', 'running']], { loop_max: true }, 'preview-stage'], [[['signoff', 'waiting']], null, 'preview-stage'] ], noMatch: null },
  { id: 'study-notes-to-pdf', five: ['preview-stage', 'before-after', 'artifact-columns', 'coverage-map', 'run-log'], opens: [ [[['signoff', 'waiting']], null, true], [[['fix', 'done']], { unsourced: true }, true], [[['proof', 'running']], { loop_max: true }, true], [[['notes', 'done']], null, false] ], branches: [ [[['proof', 'failed']], null, 'run-log'], [[['proof', 'running']], { loop_max: true }, 'run-log'], [[['fix', 'done']], { unsourced: true }, 'before-after'], [[['signoff', 'waiting']], null, 'preview-stage'] ], noMatch: null },
  { id: 'docs-and-release-notes', five: ['pr-first', 'run-log', 'before-after', 'preview-stage', 'artifact-columns'], opens: [ [[['approve', 'waiting']], null, true], [[['samples', 'failed']], null, true], [[['release', 'failed']], null, true], [[['map', 'done']], { breaking_no_doc: true }, true], [[['diff', 'done']], null, false] ], branches: [ [[['samples', 'failed']], null, 'run-log'], [[['release', 'running']], { breaking_no_doc: true }, 'pr-first'], [[['approve', 'waiting']], null, 'pr-first'], [[['release', 'done']], null, 'artifact-columns'] ], noMatch: null },
  { id: 'form-fill-batch', five: ['coverage-map', 'triage', 'preview-stage', 'pr-first', 'run-log'], opens: [ [[['captcha', 'waiting']], null, true], [[['approve', 'waiting']], null, true], [[['shot', 'running']], null, false], [[['map', 'done']], null, false] ], branches: [ [[['fill', 'failed']], null, 'run-log'], [[['captcha', 'waiting']], null, 'preview-stage'], [[['shot', 'running']], null, 'coverage-map'], [[['approve', 'waiting']], null, 'pr-first'] ], noMatch: 'coverage-map' },
  { id: 'security-review-and-upgrade', five: ['pr-first', 'triage', 'triage', 'before-after', 'run-log'], opens: [ [[['approve-upgrade', 'waiting']], null, true], [[['plan', 'done']], { high_reachable: true }, true], [[['check', 'running']], { loop_max: true }, true], [[['licences', 'done']], { licence_conflict: true }, true], [[['inventory', 'done']], null, false] ], branches: [ [[['check', 'failed']], { loop_max: true, licence_conflict: true, high_reachable: true }, 'run-log'], [[['check', 'running']], { loop_max: true }, 'run-log'], [[['notes', 'done']], { licence_conflict: true }, 'triage'], [[['plan', 'done']], { high_reachable: true }, 'triage'], [[['approve-upgrade', 'waiting']], null, 'pr-first'] ], noMatch: null },
];

const toSteps = (entries) => (entries || []).map(([id, status]) => ({ id, status }));
const runFor = (id, data) => run(id, data?.loop_max ? { paused_why: 'loop-max' } : {});

for (const item of cases) {
  test(`${item.id} lists layouts in key order`, () => {
    assert.deepEqual(ruleOf(item.id).five, item.five);
  });
  test(`${item.id} picks first matching rule in order`, () => {
    for (const [entries, data, expected] of item.branches) {
      const actual = pickLayout(runFor(item.id, data), pipe(item.five[0]), toSteps(entries), null, data);
      assert.equal(actual, expected ?? item.five[0], JSON.stringify({ entries, data, expected }));
    }
  });
  test(`${item.id} opens on and away from specified moments`, () => {
    for (const [entries, data, expected] of item.opens) {
      assert.equal(opens(runFor(item.id, data), toSteps(entries), data), expected, JSON.stringify({ entries, data, expected }));
    }
  });
  test(`${item.id} falls back when no rule matches`, () => {
    assert.equal(pickLayout(run(item.id), pipe(item.five[0]), [], null, null), item.noMatch === 'coverage-map' ? 'coverage-map' : item.five[0]);
  });
  test(`${item.id} fixture picks its current gate or loop pause`, () => {
    const fixture = fixtureRun(item.id);
    assert.equal(fixture.pipeline.id, item.id);
    const fixtureFlags = fixture.flags || [];
    const detail = { outputs: { check: { flags: fixtureFlags } } };
    const data = flagsOf(detail);
    const waiting = fixture.steps.find((step) => step.status === 'waiting');
    const currentRun = run(item.id, fixture.unbound?.paused_why ? { paused_why: fixture.unbound.paused_why } : {});
    const fixtureList = fixtureSteps(item.id);
    const expected = fixture.unbound?.paused_why === 'loop-max' ? 'pr-inline' : waiting?.id === 'approve' && data?.flag ? item.id === 'clips-to-scheduled-posts' ? 'preview-stage' : 'triage' : item.branches.find(([entries]) => entries?.some(([id]) => id === waiting?.id))?.[2] ?? item.five[0];
    assert.equal(pickLayout(currentRun, pipe(item.five[0]), fixtureList, null, data), expected);
  });
}

test('flagsOf returns null without detail outputs or selected flags', () => {
  assert.equal(flagsOf(null), null);
  assert.equal(flagsOf({}), null);
  assert.equal(flagsOf({ outputs: {} }), null);
  assert.equal(flagsOf({ outputs: { check: { flag: 'false' } } }), null);
});

test('flagsOf combines truthy flags from every step output', () => {
  assert.deepEqual(flagsOf({ outputs: {
    check: { flag: 'left for you', breaking_no_doc: false, flags: ['one'] },
    licences: { licence_conflict: true },
    review: { high_reachable: 1, unsourced: true, flags_left: 2 },
  } }), { flag: true, licence_conflict: true, high_reachable: true, unsourced: true });
});

test('flagsOf treats false string flags as false and list counts as flags', () => {
  assert.deepEqual(flagsOf({ outputs: { a: { flag: 'false', flags: ['x'] }, b: { flags_left: 1 } } }), { flag: true });
  assert.equal(flagsOf({ outputs: { a: { flags: [], flags_left: 0 } } }), null);
});

test('security licence conflict from flagsOf selects triage', () => {
  assert.equal(pickLayout(run('security-review-and-upgrade'), pipe('pr-first'), [], null, flagsOf({ outputs: { licences: { licence_conflict: true } } })), 'triage');
});