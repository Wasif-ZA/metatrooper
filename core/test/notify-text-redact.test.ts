import test from 'node:test';
import assert from 'node:assert/strict';
import { notifyText } from '../src/redact.ts';

test('notifyText removes credentials shorter than its 24-character run rule', () => {
  const key = 'AKIAIOSFODNN7EXAMPLE';
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
  const out = notifyText('other', `key ${key} token ${jwt}`);
  assert.ok(!out.includes(key), out);
  assert.ok(!out.includes('eyJhbGciOiJIUzI1NiJ9'), out);
});
