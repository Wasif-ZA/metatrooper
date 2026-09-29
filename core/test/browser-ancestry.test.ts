import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LEVELS, ancestors } from '../src/browser/ancestry.ts';

test('M1-22 ancestors includes the pid and walks injected parents', () => {
  const table = new Map([
    [40, 30],
    [30, 20],
    [20, 10],
  ]);

  assert.deepEqual(ancestors(40, table), [40, 30, 20, 10]);
});

test('M1-22 ancestors stops at the maximum parent depth', () => {
  const table = new Map<number, number>();
  for (let pid = 20; pid > 1; pid--) table.set(pid, pid - 1);

  const chain = ancestors(20, table);
  assert.equal(chain.length, MAX_LEVELS + 1);
  assert.deepEqual(chain, [20, 19, 18, 17, 16, 15, 14, 13, 12]);
});

test('M1-22 ancestors stops on self parents and cycles', () => {
  assert.deepEqual(ancestors(7, new Map([[7, 7]])), [7]);
  assert.deepEqual(ancestors(7, new Map([[7, 6], [6, 5], [5, 6]])), [7, 6, 5]);
});
