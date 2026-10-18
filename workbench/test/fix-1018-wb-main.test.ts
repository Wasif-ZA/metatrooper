import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFix } from '../src/queries.ts';

test('h-sum-checkerror: an engine whose check threw gets a fix line', () => {
  assert.match(engineFix({ id: 'codex' }, 'check-error') ?? '', /codex/);
});
