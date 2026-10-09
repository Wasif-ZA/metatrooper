import test from 'node:test';
import assert from 'node:assert/strict';
import { lastPage } from '../src/paginate.js';

test('lastPage rounds up', () => {
  assert.equal(lastPage(10, 3), 4);
});

test('lastPage is at least one', () => {
  assert.equal(lastPage(0, 3), 1);
});
