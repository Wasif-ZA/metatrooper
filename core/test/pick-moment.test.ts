import test from 'node:test';
import assert from 'node:assert/strict';
import { pickMoment } from '../../plugins/media/bin/media.js';

const m = (id: string, status: string) => ({ id, status, src_start: 0, src_end: 1 });
const ids = (list: object[]) => [0, 1, 2, 3].map((i) => pickMoment(list, i)?.id ?? null);

test('pickMoment cuts only approved moments when any is approved, and never a dropped one', () => {
  assert.deepEqual(ids([m('a', 'pending'), m('b', 'approved'), m('c', 'dropped'), m('d', 'approved')]), ['b', 'd', null, null]);
  assert.deepEqual(ids([m('a', 'dropped'), m('b', 'dropped')]), [null, null, null, null]);
  assert.deepEqual(ids([m('a', 'pending'), m('b', 'dropped'), m('c', 'pending')]), ['a', 'c', null, null]);
});
