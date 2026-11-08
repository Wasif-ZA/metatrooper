import test from 'node:test';
import assert from 'node:assert/strict';
import * as runHealth from '../src/run-health.ts';
import {
  budgetFooter,
  budgetStep,
  countHealed,
  healKind,
  healLine,
  healedLabel,
  replayPlan,
} from '../src/run-health.ts';

// protects=a 529 retry line increments healed count and formats with attempt detail
// fails_when=countHealed misses the retry line or healLine omits attempt text or arrow prefix
// no_claim=how the UI renders the status bar or the visual icon
test('M8-23a 529 retry raises countHealed and healLine formats detail', () => {
  const line = 'API error 529 overloaded, retrying (attempt 1 of 5)';
  assert.equal(healKind(line), 'retry');
  assert.equal(countHealed([line]), 1);
  const formatted = healLine('retry', 'attempt 1 of 5');
  assert.ok(formatted.startsWith('\u21bb'));
  assert.match(formatted, /attempt 1 of 5/);
  assert.equal(healedLabel(3), '3 healed');
  assert.equal(healedLabel(0), '');
});

// protects=test failure and re-run lines are never counted as healed infra recoveries
// fails_when=countHealed returns greater than zero for test failure and re-run lines
// no_claim=how test runner output is logged or displayed elsewhere
test('M8-23b test failures and re-runs give countHealed 0', () => {
  const lines = ['3 tests failed', 'fixed the assertion', 're-run: all tests pass'];
  assert.equal(countHealed(lines), 0);
  assert.equal(healKind('3 tests failed'), null);
  assert.equal(healKind('fixed the assertion'), null);
  assert.equal(healKind('re-run: all tests pass'), null);
});

// protects=replay plan flags deploy and send steps as requiring confirmation while preserving order
// fails_when=deploy or send has ask false, edit has ask true, or step order shifts
// no_claim=how execution proceeds once confirmation is granted or refused
test('M8-23d deploy and send always have ask true, edit has ask false, and order is kept', () => {
  const steps = [
    { id: 'step-1', kind: 'edit', summary: 'edit src/index.ts' },
    { id: 'step-2', kind: 'send', summary: 'send email to user' },
    { id: 'step-3', kind: 'deploy', summary: 'deploy web app' },
    { id: 'step-4', kind: 'exec', summary: 'git push origin main' },
    { id: 'step-5', kind: 'exec', summary: 'npm publish' },
  ];
  const plan = replayPlan(steps);
  assert.equal(plan.length, 5);
  assert.deepEqual(plan.map((s) => s.id), ['step-1', 'step-2', 'step-3', 'step-4', 'step-5']);
  assert.equal(plan[0].ask, false);
  assert.equal(plan[1].ask, true);
  assert.equal(plan[2].ask, true);
  assert.equal(plan[3].ask, true);
  assert.equal(plan[4].ask, true);
});

// protects=budgetStep classifies usage against cap and budgetFooter formats token text
// fails_when=budgetStep misclassifies 80% or 100% or cap <= 0, or budgetFooter output differs
// no_claim=whether gate aborts the session or prompts for budget increase
test('M8-23e budgetStep classifies thresholds and budgetFooter formats token text', () => {
  assert.equal(budgetStep(100, 200), 'ok');
  assert.equal(budgetStep(160, 200), 'log');
  assert.equal(budgetStep(200, 200), 'gate');
  assert.equal(budgetStep(250, 200), 'gate');
  assert.equal(budgetStep(50, 0), 'ok');
  assert.equal(budgetStep(50, -10), 'ok');
  assert.equal(budgetFooter(164000, 200000), '164k of 200k tokens');
});

// protects=module exports do not expose any compaction functions or constants
// fails_when=an export name in run-health matches compact case-insensitively
// no_claim=internal compaction mechanisms in other modules
test('M8-23f no export name matches /compact/i', () => {
  const exportNames = Object.keys(runHealth);
  const compactExports = exportNames.filter((name) => /compact/i.test(name));
  assert.deepEqual(compactExports, []);
});
