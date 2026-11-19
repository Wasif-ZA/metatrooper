import test from 'node:test';
import assert from 'node:assert/strict';
import { baselineOf, liveChunks, mergeEcho, paceFor, revealSteps } from '../ui/src/chat-model.js';

const user = (t: string, id?: string) => ({ kind: 'user', text: t, ...(id ? { id } : {}) });
const text = (t: string, id?: string) => ({ kind: 'text', text: t, ...(id ? { id } : {}) });

test('a sent message shows at once, before the transcript has it', () => {
  const items = [user('hi', 'u1'), text('Hello.', 'a1:0')];
  const echoes = [{ text: 'write a haiku', seen: [], at: 1000 }];
  const r = mergeEcho(items, echoes, 1200);
  assert.deepEqual(r.items.slice(0, 2), items);
  assert.equal(r.items.length, 3);
  assert.equal(r.items[2].kind, 'user');
  assert.equal(r.items[2].text, 'write a haiku');
  assert.equal(r.items[2].echo, true);
  assert.equal(r.pending.length, 1);
});

test('the echo goes away once the transcript carries the same message under a new id', () => {
  const items = [user('hi', 'u1'), text('Hello.', 'a1:0'), user('write a haiku ', 'u2')];
  const r = mergeEcho(items, [{ text: 'write a haiku', seen: [], at: 1000 }], 2500);
  assert.equal(r.items.length, 3);
  assert.equal(r.items.filter((i: any) => i.echo).length, 0);
  assert.deepEqual(r.pending, []);
});

test('sending the same words twice keeps the second echo until a copy with a new id lands', () => {
  const items = [user('yes', 'u1'), text('Done.', 'a1:0')];
  const echo = { text: 'yes', seen: ['u1'], at: 1000 };
  const r = mergeEcho(items, [echo], 1100);
  assert.equal(r.items.length, 3);
  assert.equal(r.items[2].echo, true);
  const r2 = mergeEcho([...items, user('yes', 'u2')], [echo], 1500);
  assert.equal(r2.items.filter((i: any) => i.echo).length, 0);
  assert.deepEqual(r2.pending, []);
});

test('the oldest copy sliding out of the window does not confirm or duplicate an echo', () => {
  const echo = { text: 'yes', seen: ['u1'], at: 1000 };
  const slid = [text('Done.', 'a1:0')];
  const r = mergeEcho(slid, [echo], 1100);
  assert.equal(r.items.filter((i: any) => i.echo).length, 1, 'still pending: the old copy left, no new copy came');
  const r2 = mergeEcho([...slid, user('yes', 'u2')], [echo], 1200);
  assert.equal(r2.items.filter((i: any) => i.echo).length, 0);
});

test('items without ids fall back to counting copies', () => {
  const echo = { text: 'yes', seen: [null], at: 1000 };
  assert.equal(mergeEcho([user('yes')], [echo], 1100).pending.length, 1);
  assert.equal(mergeEcho([user('yes'), user('yes')], [echo], 1100).pending.length, 0);
});

test('an echo the transcript never confirms drops after 30 seconds', () => {
  const echoes = [{ text: 'lost', seen: [], at: 1000 }];
  assert.equal(mergeEcho([], echoes, 30999).pending.length, 1);
  const r = mergeEcho([], echoes, 31001);
  assert.deepEqual(r.items, []);
  assert.deepEqual(r.pending, []);
});

test('no echoes leaves the items array untouched', () => {
  const items = [user('a')];
  const r = mergeEcho(items, [], 0);
  assert.deepEqual(r.items, items);
  assert.deepEqual(r.pending, []);
});

test('new text is revealed in growing steps that end on word boundaries and finish inside the window', () => {
  const before = 'The rain falls.';
  const full = before + ' Soft drops on the tin roof sing a quiet song tonight.';
  const steps = revealSteps(before.length, full, 1200);
  assert.ok(steps.length >= 3, `expected several steps, got ${steps.length}`);
  let lastAt = -1, lastLen = before.length;
  for (const s of steps) {
    assert.ok(s.at >= lastAt, 'times never go backwards');
    assert.ok(s.len > lastLen, 'each step shows more text');
    assert.ok(s.at <= 1200, 'every step lands inside the window');
    const next = full[s.len];
    assert.ok(s.len === full.length || next === ' ' || next === '\n', `step ends mid-word at ${s.len}`);
    lastAt = s.at; lastLen = s.len;
  }
  assert.equal(steps.at(-1).len, full.length);
  assert.equal(steps[0].at, 0);
});

test('a huge tail is revealed in a bounded number of steps', () => {
  const full = Array.from({ length: 5000 }, (_, i) => `word${i}`).join(' ');
  const steps = revealSteps(0, full, 1200);
  assert.ok(steps.length <= 60, `too many steps: ${steps.length}`);
  assert.equal(steps.at(-1).len, full.length);
});

test('nothing new means nothing to reveal; shrunk or replaced text shows at once', () => {
  assert.deepEqual(revealSteps(10, '0123456789', 1200), []);
  assert.deepEqual(revealSteps(20, 'short', 1200), [{ at: 0, len: 5 }]);
});

test('the chat polls fast only while a reply is in flight and the window is visible', async () => {
  const { pollDelay } = await import('../ui/src/chat-model.js');
  assert.equal(pollDelay({ state: 'working', pending: 0, hidden: false }), 300);
  assert.equal(pollDelay({ state: 'starting', pending: 0, hidden: false }), 300);
  assert.equal(pollDelay({ state: 'idle', pending: 1, hidden: false }), 300);
  assert.equal(pollDelay({ state: 'idle', pending: 0, hidden: false }), 1500);
  assert.equal(pollDelay({ state: 'waiting_for_you', pending: 0, hidden: false }), 1500);
  assert.equal(pollDelay({ state: 'exited', pending: 0, hidden: false }), 1500);
  assert.equal(pollDelay({ state: 'working', pending: 1, hidden: true }), 1500);
  assert.equal(pollDelay({ state: undefined, pending: 0, hidden: false }), 1500);
});

test('text on first load counts as seen; text arriving later starts from nothing, matched by id not position', () => {
  const first = baselineOf(null, [user('a', 'u1'), text('Old reply.', 'a1:0')]);
  assert.equal(first.get('a1:0'), 'Old reply.'.length);
  const slid = baselineOf(first, [text('Old reply. More.', 'a1:0'), text('New.', 'a2:0')]);
  assert.equal(slid.get('a1:0'), 'Old reply.'.length, 'a known item keeps its first-seen length');
  assert.equal(slid.get('a2:0'), 0, 'a new item reveals from the start');
});

test('a fading chunk stays a span until its fade ends', () => {
  const chunks = [{ born: 0 }, { born: 50 }, { born: 100 }, { born: 130 }];
  assert.deepEqual(liveChunks(chunks, 140, 120).map((c: any) => c.born), [50, 100, 130]);
  assert.deepEqual(liveChunks(chunks, 400, 120), []);
});

test('reveal pace follows the reference word rate and caps at the poll gap', () => {
  assert.equal(paceFor(' one two three four five'), 250);
  assert.equal(paceFor(Array(100).fill('w').join(' ')), 1200);
  assert.equal(paceFor(''), 0);
});
