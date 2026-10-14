import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGateDate } from '../src/gate.ts';

test('parseGateDate refuses a day the month does not have instead of rolling into the next month', () => {
  assert.equal(parseGateDate('2026-02-30'), null);
  assert.equal(parseGateDate('2026-02-29T10:00'), null);
  assert.equal(parseGateDate('2026-04-31T10:00+11:00'), null);
  assert.equal(parseGateDate('2028-02-29')?.toISOString(), '2028-02-29T00:00:00.000Z');
  assert.equal(parseGateDate('2026-10-14T10:00+11:00')?.toISOString(), '2026-10-13T23:00:00.000Z');
});
