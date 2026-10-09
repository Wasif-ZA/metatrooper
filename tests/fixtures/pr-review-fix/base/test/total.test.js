import test from 'node:test';
import assert from 'node:assert/strict';
import { total } from '../src/total.js';

test('multiplies price by quantity', () => {
  assert.equal(total([{ price: 2, qty: 3 }, { price: 1, qty: 1 }]), 7);
});

test('an empty cart totals zero', () => {
  assert.equal(total([]), 0);
});
