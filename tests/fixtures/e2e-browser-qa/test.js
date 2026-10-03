import assert from 'node:assert/strict';
import { addItem, countLabel } from './logic.js';

assert.deepEqual(addItem([], ' milk '), ['milk']);
assert.deepEqual(addItem(['milk'], '  '), ['milk']);
assert.equal(countLabel(1), '1 item');
assert.equal(countLabel(2), '2 items');
console.log('ok');
