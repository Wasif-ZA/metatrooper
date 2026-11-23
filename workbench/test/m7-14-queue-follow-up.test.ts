import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-ignore plain JS module
import { flushQueued, queuedText, setQueued } from '../ui/src/queue.js';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

// Drive the same call the renderer makes on each snapshot; returns what was sent.
const run = (id: string, states: string[]) => {
  const sent: string[][] = [];
  for (const state of states) flushQueued([{ id, state }], (x: any, t: string) => { sent.push([x.id, t]); });
  return sent;
};

test('M7-14a: sent exactly once, trimmed, at the first idle', () => {
  setQueued('a1', '  hello  ');
  const sent: string[][] = [];
  const log: string[] = [];
  for (const state of ['working', 'idle', 'idle', 'done', 'working', 'idle']) {
    flushQueued([{ id: 'a1', state }], (x: any, t: string) => { sent.push([x.id, t]); log.push(state); });
  }
  assert.deepEqual(sent, [['a1', 'hello']]);
  assert.deepEqual(log, ['idle']);
  assert.equal(log.length, 1);
  assert.equal(queuedText('a1'), '');
});

test('M7-14a: done as the first settled state also sends once', () => {
  setQueued('a2', 'go');
  assert.deepEqual(run('a2', ['working', 'done', 'idle', 'done']), [['a2', 'go']]);
  assert.equal(queuedText('a2'), '');
});

test('M7-14a: waiting and starting never send; exited drops the text', () => {
  setQueued('a3', 'later');
  assert.deepEqual(run('a3', ['starting', 'waiting', 'working', 'waiting']), []);
  assert.equal(queuedText('a3'), 'later');
  assert.deepEqual(run('a3', ['exited', 'idle', 'done']), []);
  assert.equal(queuedText('a3'), '');
});

test('M7-14b: clearing before settling sends nothing', () => {
  setQueued('b1', 'x');
  setQueued('b1', '   ');
  assert.equal(queuedText('b1'), '');
  assert.deepEqual(run('b1', ['working', 'idle', 'done']), []);
});

test('M7-14b: editing replaces the old text and only the edit is sent', () => {
  setQueued('b2', 'original');
  setQueued('b2', 'edited');
  assert.equal(queuedText('b2'), 'edited');
  assert.deepEqual(run('b2', ['working', 'idle', 'idle']), [['b2', 'edited']]);
});

test('M7-14: two sessions keep separate queues', () => {
  setQueued('c1', 'one');
  setQueued('c2', 'two');
  const sent: string[][] = [];
  const send = (x: any, t: string) => { sent.push([x.id, t]); };
  flushQueued([{ id: 'c1', state: 'working' }, { id: 'c2', state: 'idle' }], send);
  assert.deepEqual(sent, [['c2', 'two']]);
  assert.equal(queuedText('c1'), 'one');
  setQueued('c1', '');
  flushQueued([{ id: 'c1', state: 'idle' }, { id: 'c2', state: 'idle' }], send);
  assert.deepEqual(sent, [['c2', 'two']]);
});

test('M7-14a: app.js flushes the queue right after storing the snapshot', () => {
  const src = read('../renderer/app.js');
  const i = src.indexOf('api.onSnapshot(');
  assert.ok(i >= 0);
  const body = src.slice(i);
  assert.match(body, /^api\.onSnapshot\(async \(s\) => \{\s*ui\.snap = s;\s*globalThis\.flushQueued\?\.\(\[\.\.\.s\.sessions, \.\.\.\(s\.live \|\| \[\]\)\.filter\(\(x\) => !s\.sessions\.some\(\(y\) => y\.id === x\.id\)\)\]\);/);
});

test('M7-14a: a follow-up for a session of another project (only in live) is sent when it goes idle', () => {
  setQueued('d1', 'other project');
  const sent: string[][] = [];
  const send = (x: any, t: string) => { sent.push([x.id, t]); };
  flushQueued([{ id: 'here', state: 'working' }, { id: 'd1', state: 'working' }], send);
  assert.deepEqual(sent, []);
  assert.equal(queuedText('d1'), 'other project');
  flushQueued([{ id: 'here', state: 'working' }, { id: 'd1', state: 'idle' }], send);
  assert.deepEqual(sent, [['d1', 'other project']]);
});

test('M7-14a: a queued id missing from every list is dropped and never sent later', () => {
  setQueued('e1', 'gone');
  const sent: string[][] = [];
  const send = (x: any, t: string) => { sent.push([x.id, t]); };
  flushQueued([{ id: 'other', state: 'working' }], send);
  assert.equal(queuedText('e1'), '');
  flushQueued([{ id: 'e1', state: 'idle' }], send);
  assert.deepEqual(sent, []);
});

test('M7-14a: home.jsx sends t + CR and wires flushQueued to sendFollowUp', () => {
  const src = read('../ui/src/home.jsx');
  const i = src.indexOf("const sendFollowUp = async (x, t) => {");
  assert.ok(i >= 0, "sendFollowUp present");
  assert.ok(src.slice(i, i + 250).includes("troop.termInput(x.id, t + '" + String.fromCharCode(92) + "r')"));
  assert.match(src, /globalThis\.flushQueued = \(sessions\) => flushQueued\(sessions, sendFollowUp\);/);
});

test('M7-14c: the queue box has its own draft; the answer box keeps answer', () => {
  const src = read('../ui/src/home.jsx');
  assert.match(src, /const \[draft, setDraft\] = useState\(''\);/);
  assert.match(src, /label="Queue a follow-up"[^\n]*value=\{draft\} onChange=\{setDraft\} onEnter=\{enqueue\}/);
  assert.match(src, /const enqueue = \(\) => \{ if \(!draft\.trim\(\)\) return; setQueued\(x\.id, draft\); setDraft\(''\);/);
  assert.match(src, /const editQueued = \(\) => \{ if \(!isWorking\(x\)\) return; setDraft\(queuedText/);
  assert.doesNotMatch(src, /label="Queue a follow-up"[^\n]*value=\{answer\}/);
  assert.match(src, /value=\{answer\}[^\n]*onChange=\{setAnswer\}/);
});

test('M7-14c: Send now and Edit are disabled and return early when the agent is not working', () => {
  const src = read('../ui/src/home.jsx');
  assert.match(src, /const working = isWorking\(x\);/);
  assert.match(src, /label="Send now" isDisabled=\{!working\}/);
  assert.match(src, /label="Edit" isDisabled=\{!working\}/);
  assert.match(src, /const sendNow = async \(\) => \{ if \(!isWorking\(x\)\) return;/);
  assert.match(src, /const editQueued = \(\) => \{ if \(!isWorking\(x\)\) return;/);
});
