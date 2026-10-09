import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDiscount } from '../src/discount.js';

test('zero percent keeps the price', () => {
  assert.equal(applyDiscount(100, 0), 100);
});
