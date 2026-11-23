import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// M8-22b: after 2 minutes a gate turns solid orange and exactly one OS toast is sent.
// M822B_OVERRIDE (JSON {relative path: file}) lets a mutation check swap in a modified copy; unset in normal runs.
const over: Record<string, string> = JSON.parse(process.env.M822B_OVERRIDE || '{}');
const read = (rel: string) => readFileSync(over[rel] || new URL(`../${rel}`, import.meta.url), 'utf8');
const mod = over['src/queries.ts'] ? new URL(`file:///${over['src/queries.ts'].replace(/\\/g, '/')}`).href : '../src/queries.ts';
const { agedGates } = (await import(mod)) as typeof import('../src/queries.ts');

const T0 = Date.parse('2026-10-12T01:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const snap = (live: Array<[string, number]>, approvals: Array<[string, number]> = []) => ({
  live: live.map(([id, at]) => ({ id, state: 'waiting_for_you', state_at: iso(at), reason: 'which file?' })),
  approvals: approvals.map(([id, at]) => ({ id, session_id: 's9', created_at: iso(at), summary: 'run rm' })),
}) as unknown as Parameters<typeof agedGates>[1];

test('a waiting session is not aged at 1:59, is at 2:00, and only once over many later calls', () => {
  const s = snap([['s1', T0]]);
  let r = agedGates(null, s, T0);
  assert.deepEqual(r.aged, []);
  r = agedGates(r.seen, s, T0 + 119_999);
  assert.deepEqual(r.aged, []);
  r = agedGates(r.seen, s, T0 + 120_000);
  assert.equal(r.aged.length, 1);
  assert.equal(r.aged[0].session_id, 's1');
  assert.equal(r.aged[0].text, 'which file?');
  for (let i = 1; i <= 50; i++) { r = agedGates(r.seen, s, T0 + 120_000 + i * 1000); assert.deepEqual(r.aged, []); }
});

test('a waiting session with no reason says waiting for you', () => {
  const s = snap([['s1', T0]]);
  (s.live[0] as { reason: string | null }).reason = null;
  let r = agedGates(null, s, T0);
  r = agedGates(r.seen, s, T0 + 120_000);
  assert.equal(r.aged[0].text, 'waiting for you');
});

test('a working session is never a gate', () => {
  const s = snap([['s1', T0]]);
  (s.live[0] as { state: string }).state = 'working';
  let r = agedGates(null, s, T0);
  r = agedGates(r.seen, s, T0 + 600_000);
  assert.deepEqual(r.aged, []);
});

test('an approval ages the same way: not at 1:59, once at 2:00', () => {
  const s = snap([], [['ap1', T0]]);
  let r = agedGates(null, s, T0);
  r = agedGates(r.seen, s, T0 + 119_999);
  assert.deepEqual(r.aged, []);
  r = agedGates(r.seen, s, T0 + 120_000);
  assert.equal(r.aged.length, 1);
  assert.equal(r.aged[0].id, 'a:ap1');
  assert.equal(r.aged[0].session_id, 's9');
  assert.equal(r.aged[0].text, 'run rm');
  r = agedGates(r.seen, s, T0 + 180_000);
  assert.deepEqual(r.aged, []);
});

test('gates already older than 2 minutes at the first call are seeded and never returned', () => {
  const s = snap([['s1', T0]], [['ap1', T0]]);
  let r = agedGates(null, s, T0 + 10 * 60_000);
  assert.deepEqual(r.aged, []);
  assert.equal(r.seen.size, 2);
  for (let i = 0; i < 5; i++) { r = agedGates(r.seen, s, T0 + 11 * 60_000 + i * 1000); assert.deepEqual(r.aged, []); }
});

test('a gate that goes away and comes back with a new state_at is a new gate', () => {
  let r = agedGates(null, snap([['s1', T0]]), T0);
  r = agedGates(r.seen, snap([['s1', T0]]), T0 + 120_000);
  assert.equal(r.aged.length, 1);
  r = agedGates(r.seen, snap([]), T0 + 130_000);
  assert.deepEqual(r.aged, []);
  const back = T0 + 140_000;
  r = agedGates(r.seen, snap([['s1', back]]), back + 119_999);
  assert.deepEqual(r.aged, []);
  r = agedGates(r.seen, snap([['s1', back]]), back + 120_000);
  assert.equal(r.aged.length, 1);
});

test('ids of gone gates are pruned from seen', () => {
  let r = agedGates(null, snap([['s1', T0]], [['ap1', T0]]), T0);
  r = agedGates(r.seen, snap([['s1', T0]], [['ap1', T0]]), T0 + 120_000);
  assert.equal(r.seen.size, 2);
  r = agedGates(r.seen, snap([['s1', T0]]), T0 + 121_000);
  assert.deepEqual([...r.seen], [`w:s1:${iso(T0)}`]);
  r = agedGates(r.seen, snap([]), T0 + 122_000);
  assert.equal(r.seen.size, 0);
});

test('main.ts: toastAged runs from the 1 s poll in watch() and from push() only when readFromDb', () => {
  const src = read('src/main.ts');
  assert.match(src, /const POLL_MS = 1000;/);
  const watch = src.slice(src.indexOf('function watch()'));
  const poll = watch.slice(watch.indexOf('setInterval('));
  assert.match(poll.slice(0, 80), /^setInterval\(\(\) => \{\s*toastAged\(\);/);
  assert.match(poll, /\}, POLL_MS\);/);
  const push = src.slice(src.indexOf('function push()'), src.indexOf('function push()') + 400);
  assert.match(push, /if \(readFromDb\) \{ lastSnap = s; toastAged\(\); \}/);
  assert.equal([...src.matchAll(/toastAged\(\)/g)].length, 2);
});

test('main.ts: toastAged uses agedGates and toastFor and shows one Notification per aged gate', () => {
  const src = read('src/main.ts');
  const fn = src.slice(src.indexOf('function toastAged('), src.indexOf('function push()'));
  assert.match(fn, /if \(!lastSnap\) return;/);
  assert.match(fn, /agedGates\(agedSeen, lastSnap, now\)/);
  assert.match(fn, /agedSeen = next\.seen/);
  assert.match(fn, /for \(const g of next\.aged\)/);
  assert.match(fn, /toastFor\(/);
  assert.match(fn, /if \(!toast\) continue;/);
  assert.equal([...fn.matchAll(/new Notification\(/g)].length, 1);
  assert.equal([...fn.matchAll(/note\.show\(\)/g)].length, 1);
});

function classRunner(code: string, ctx: Record<string, unknown>, el: { dataset: Record<string, string> }) {
  const classes = new Set<string>();
  const full = { ...el, classList: { toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c); } } };
  return { run: () => { vm.runInNewContext(code, { ...ctx, Number, String, Boolean, el: full }); return classes.has('aged'); }, el: full };
}

test('terminal.js label: data-wait-at only for waiting tiles, aged toggled at 120000 ms', () => {
  const lines = read('renderer/terminal.js').split('\n').filter((l) => /dataset\.waitAt =|toggle\('aged'/.test(l));
  assert.equal(lines.length, 2);
  const code = lines.join('\n').replace(/t\.el/g, 'el');
  const run = (state: string, stateAt: number | undefined, now: number) => {
    const r = classRunner(code, { x: { state, stateAt }, Date: { now: () => now } }, { dataset: {} });
    const aged = r.run();
    return { wait: r.el.dataset.waitAt, aged };
  };
  assert.deepEqual(run('waiting_for_you', T0, T0 + 119_999), { wait: String(T0), aged: false });
  assert.deepEqual(run('waiting_for_you', T0, T0 + 120_000), { wait: String(T0), aged: true });
  assert.deepEqual(run('working', T0, T0 + 600_000), { wait: '', aged: false });
  assert.deepEqual(run('waiting_for_you', undefined, T0 + 600_000), { wait: '', aged: false });
});

test('app.js tickAges toggles aged on .tile[data-wait-at] at 120000 ms and runs every 5 s', () => {
  const src = read('renderer/app.js');
  const line = src.split('\n').find((l) => l.includes('.tile[data-wait-at]'))!;
  assert.ok(line, 'tickAges line');
  assert.match(src.slice(src.indexOf('function tickAges')), /^function tickAges\(\) \{\n\s*for \(const el of document\.querySelectorAll\('\.tile\[data-wait-at\]'\)\)/);
  assert.match(src, /setInterval\(tickAges, 5000\);/);
  const run = (waitAt: string, now: number) => {
    const classes = new Set<string>();
    const el = { dataset: { waitAt }, classList: { toggle: (c: string, on: boolean) => { if (on) classes.add(c); else classes.delete(c); } } };
    vm.runInNewContext(line, { document: { querySelectorAll: () => [el] }, Date: { now: () => now }, Number, Boolean });
    return classes.has('aged');
  };
  assert.equal(run(String(T0), T0 + 119_999), false);
  assert.equal(run(String(T0), T0 + 120_000), true);
  assert.equal(run('', T0 + 999_999), false);
});

test('wall.css: an aged waiting tile gets a solid var(--wait) header', () => {
  const css = read('renderer/wall.css');
  assert.match(css, /\.tile\[data-state="waiting_for_you"\]\.aged \.ph \{ background: var\(--wait\);/);
});
