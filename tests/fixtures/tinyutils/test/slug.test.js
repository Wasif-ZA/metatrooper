import test from 'node:test';
import assert from 'node:assert/strict';
import { slug } from '../src/slug.js';

test('slug has no leading or trailing dashes', () => {
  assert.equal(slug('  Hello, World!  '), 'hello-world');
  assert.equal(slug('--a b--'), 'a-b');
});
