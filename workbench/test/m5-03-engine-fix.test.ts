import test from 'node:test';
import assert from 'node:assert/strict';
import { engineFix, light } from '../src/queries.ts';

test('M5-03 engine failure details produce their expected fix lines', () => {
  const codex = {
    id: 'codex',
    install: 'npm install -g @openai/codex',
    login: 'codex login',
    min_version: '1.0.0',
  };

  assert.equal(engineFix(codex, 'missing'), 'Install it: npm install -g @openai/codex');
  assert.match(engineFix(codex, 'too-old') ?? '', /1\.0\.0/);
  assert.equal(engineFix(codex, 'not-logged-in'), 'codex login');
  assert.match(engineFix(codex, 'timeout') ?? '', /codex/);
});

test('M5-03 a non-green engine does not count as a green engine', () => {
  assert.equal(light({ installed: 0, auth: 'missing' }), 'red');
  assert.equal(light({ installed: 1, auth: 'unknown' }), 'grey');
});
