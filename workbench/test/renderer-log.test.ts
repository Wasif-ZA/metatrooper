import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rendererLogger } from '../src/renderer-log.ts';

const ev = (level: unknown, message: string, sourceId = 'file:///C:/app/workbench/renderer/home.js', lineNumber = 41) => ({ level, message, sourceId, lineNumber });

test('renderer warnings and errors become one short line with file and line; info and debug are skipped', () => {
  let now = 0;
  const log = rendererLogger(50, () => now);
  assert.deepEqual(log(ev('error', "TypeError: Cannot read properties of undefined (reading 'name')")), ["renderer error home.js:41 TypeError: Cannot read properties of undefined (reading 'name')"]);
  assert.deepEqual(log(ev('warning', 'slow thing')), ['renderer warning home.js:41 slow thing']);
  assert.deepEqual(log(ev('info', 'hello')), []);
  assert.deepEqual(log(ev('debug', 'hello')), []);
  assert.deepEqual(log(ev(3, 'old style error')), ['renderer error home.js:41 old style error'], 'numeric levels: 2 warning, 3 error');
  assert.deepEqual(log(ev(1, 'old style info')), []);
});

test('only the first line is kept, cut to 200 characters, so stacks and terminal text stay out', () => {
  const log = rendererLogger(50, () => 0);
  const [line] = log(ev('error', `Uncaught (in promise) Error: ${'y'.repeat(400)}\n    at secret-terminal-text\nPS C:\\> typed`));
  assert.ok(line.length <= 'renderer error home.js:41 '.length + 200, line.length.toString());
  assert.doesNotMatch(line, /secret-terminal-text|typed|\n/);
});

test('at most 50 lines a minute; the next minute first says how many were dropped', () => {
  let now = 0;
  const log = rendererLogger(50, () => now);
  for (let i = 0; i < 50; i++) assert.equal(log(ev('error', `e${i}`)).length, 1);
  for (let i = 0; i < 10; i++) assert.deepEqual(log(ev('error', `over${i}`)), []);
  now = 60_000;
  assert.deepEqual(log(ev('error', 'next')), ['renderer: 10 lines dropped over the cap in the last minute', 'renderer error home.js:41 next']);
  assert.equal(log(ev('error', 'again')).length, 1, 'the drop note is said once');
});

test('the window writes its console warnings and errors to the workbench log through the logger', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /import \{ rendererLogger \} from '\.\/renderer-log\.ts'/);
  assert.match(main, /win\.webContents\.on\('console-message'/);
});

test('a message without a source or text never throws', () => {
  const log = rendererLogger(50, () => 0);
  assert.deepEqual(log({ level: 'error', message: undefined, sourceId: undefined, lineNumber: undefined } as any), ['renderer error ?:0 ']);
});
