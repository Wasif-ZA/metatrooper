import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { root } from './helpers.ts';

const { failingTests } = await import(pathToFileURL(`${root}/plugins/repo/bin/repo.js`).href);
const { compareFailures, summaryLine } = await import(pathToFileURL(`${root}/pipelines/spec-to-pr/compare-tests.mjs`).href);

test('failingTests parses TAP failures and ignores TODO not-ok lines', () => {
  assert.deepEqual(failingTests('TAP version 13\nnot ok 1 - broken case\n  ---\n  ...\nnot ok 2 - expected todo # TODO later\nok 3 - good\n'), ['broken case']);
});

test('failingTests parses vitest output', () => {
  assert.deepEqual(failingTests(' FAIL  src/a.test.ts > suite > rejects input\n Test Files  1 failed | 2 passed (3)\n'), ['src/a.test.ts > suite > rejects input']);
});

test('failingTests parses jest output', () => {
  assert.deepEqual(failingTests('  ✕ rejects input (12 ms)\nTests:       1 failed, 2 passed, 3 total\n'), ['rejects input']);
});

test('failingTests parses pytest output', () => {
  assert.deepEqual(failingTests('============================= test session starts ==============================\nFAILED tests/test_math.py::test_add - AssertionError\n'), ['tests/test_math.py::test_add']);
});

test('failingTests marks unrecognised runner output unknown', () => {
  assert.equal(failingTests('go test: some failure'), 'unknown');
});

test('failingTests returns an empty array for clean TAP', () => {
  assert.deepEqual(failingTests('TAP version 13\nok 1 - works\n1..1\n'), []);
});

test('compareFailures separates new and old failures and summarizes them', () => {
  const result = compareFailures(['old-a', 'old-b'], ['old-b', 'new-c']);
  assert.deepEqual(result, { new_failures: ['new-c'], old_failures: ['old-b'] });
  assert.equal(summaryLine(result), '1 new failures (1 old)');
});

test('compareFailures and summaryLine preserve unknown output', () => {
  const result = compareFailures('unknown', ['new-c']);
  assert.deepEqual(result, { new_failures: 'unknown', old_failures: 'unknown' });
  assert.equal(summaryLine(result), 'new failures: unknown (test output not parsed)');
});
