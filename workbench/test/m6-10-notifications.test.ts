import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { taskOf, toastFor } from '../src/queries.ts';

const session = { engine_id: 'claude', title: 'Fix the login bug', cwd: 'C:/code/app', step_id: null, started_at: '2026-10-12T01:00:00Z' };
const done = { id: 'n1', at: '2026-10-12T01:05:00Z', kind: 'done', ref: 's1', text: 'claude finished', read_at: null };

test('no toast for the focused tile while the window has focus', () => {
  assert.equal(toastFor(done, session, { window: true, session: 's1' }), null);
});

test('a toast shows when the window is unfocused or another tile is focused', () => {
  assert.ok(toastFor(done, session, { window: false, session: 's1' }));
  assert.ok(toastFor(done, session, { window: true, session: 's2' }));
  assert.ok(toastFor(done, session, { window: true, session: null }));
});

test('the toast names the task line, not only the engine', () => {
  const t = toastFor(done, session, { window: false, session: null })!;
  assert.equal(t.title, 'Agent finished: claude · Fix the login bug');
  assert.equal(t.body, 'claude finished');
  assert.match(toastFor({ ...done, kind: 'failed' }, session, { window: false, session: null })!.title, /^Agent failed: claude · Fix the login bug$/);
});

test('the task line falls back like the tile: path-like title, then step, then folder', () => {
  assert.equal(taskOf({ ...session, title: 'C:\\code\\app' , step_id: 'build' }), 'build');
  assert.match(taskOf({ ...session, title: null }), /^in app, opened /);
  assert.equal(taskOf({ ...session, title: null, cwd: null, started_at: 'x' }), 'new session');
});

test('a row with no session keeps the plain title and is never suppressed', () => {
  const other = { ...done, kind: 'other', ref: 'sink1', text: 'notify failed' };
  assert.deepEqual(toastFor(other, null, { window: true, session: 'sink1' }), { title: 'MetaTrooper needs you', body: 'notify failed' });
});


test('main.ts builds every toast through toastFor', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /toastFor\(n, sessionOf\(s, n\), \{ window: [^}]*win\.isFocused\(\), session: focused \}\)/);
  assert.match(main, /on\('focus', \(id: unknown\) => \{\s*focused = typeof id === 'string' \? id : null;/);
  assert.match(main, /new Notification\(\{ \.\.\.toast/);
});

test('the renderer reports the tile it shows big, so a shell pick or project switch moves toast suppression with it', () => {
  const app = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
  assert.match(app, /const big = wall\.decide\([^\n]*\n  reportFocus\(big\);/);
  const sent: Array<string | null> = [];
  const ui: any = {};
  const src = app.match(/^function reportFocus\([^]*?\n}\n/m)![0];
  const reportFocus = new Function('ui', 'api', `${src}; return reportFocus;`)(ui, { focus: (id: string | null) => sent.push(id) });
  reportFocus('s1');
  reportFocus('s1');
  reportFocus('sh_1');
  reportFocus(null);
  assert.deepEqual(sent, ['s1', 'sh_1', null]);
});
