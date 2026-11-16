import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultEngine } from '../ui/src/words.js';

const toReady = (ids: string[]) => ids.map((id) => ({ id }));

test('alphabetical ready list with no last pick gives claude', () => {
  const ready = toReady(['agy', 'claude', 'codex', 'copilot', 'gemini', 'opencode', 'pi']);
  assert.equal(defaultEngine(ready), 'claude');
});

test('no claude gives codex', () => {
  const ready = toReady(['agy', 'codex', 'copilot', 'gemini', 'opencode', 'pi']);
  assert.equal(defaultEngine(ready), 'codex');
});

test('only agy and pi gives agy', () => {
  const ready = toReady(['agy', 'pi']);
  assert.equal(defaultEngine(ready), 'agy');
});

test('only copilot and pi gives copilot', () => {
  const ready = toReady(['copilot', 'pi']);
  assert.equal(defaultEngine(ready), 'copilot');
});

test('last pick pi present gives pi', () => {
  const ready = toReady(['agy', 'claude', 'codex', 'copilot', 'gemini', 'opencode', 'pi']);
  assert.equal(defaultEngine(ready, 'pi'), 'pi');
});

test('last pick claude not installed falls back to the order', () => {
  const ready = toReady(['agy', 'codex', 'copilot', 'gemini', 'opencode', 'pi']);
  assert.equal(defaultEngine(ready, 'claude'), 'codex');
});

test('empty list gives empty string', () => {
  assert.equal(defaultEngine([]), '');
  assert.equal(defaultEngine([], 'claude'), '');
});
