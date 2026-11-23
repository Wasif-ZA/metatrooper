import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const MIN = 60_000;

/** wall.js in a sandbox with a controllable clock and timers; a tile is folded when its element has the 'fold' class. */
async function harness() {
  let now = 1_000_000_000;
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const tiles = new Map<string, any>();
  const node = (): any => {
    const cls = new Set<string>();
    return { dataset: {}, style: {}, hidden: false, cls, classList: { add: (c: string) => cls.add(c), remove: (c: string) => cls.delete(c), toggle: (c: string, on?: boolean) => { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); }, contains: (c: string) => cls.has(c) }, addEventListener() {}, setAttribute() {}, after() {}, appendChild() {}, remove() {}, querySelector: () => node(), getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) };
  };
  const tw = () => ({ kill() {} });
  class FakeDate extends Date { static now() { return now; } }
  const ctx = vm.createContext({
    gsap: { to: tw, set: tw, fromTo: tw, delayedCall: tw }, termView: { tile: (id: string) => tiles.get(id) ?? tiles.set(id, node()).get(id) }, matchMedia: () => ({ matches: false }),
    document: { body: { ...node(), classList: { add() {}, remove() {}, toggle() {}, contains: (c: string) => c === 'no-split' } }, querySelector: () => node(), createElement: () => ({ content: { firstChild: node() } }) },
    addEventListener() {}, setInterval() {}, innerWidth: 1400, innerHeight: 900, reportPaneBounds() {}, Date: FakeDate,
    setTimeout: (fn: () => void, ms: number) => { timers.push({ fn, ms, live: true }); return timers.length; },
    clearTimeout: (t: number) => { if (timers[t - 1]) timers[t - 1].live = false; },
  });
  vm.runInContext(`${readFileSync(new URL('../renderer/wall.js', import.meta.url), 'utf8')}\nthis.wall = wall;`, ctx);
  const wall = ctx.wall;
  return {
    wall, timers, advance: (ms: number) => { now += ms; },
    at: (agoMs: number) => now - agoMs,
    folded: (id: string) => tiles.get(id).cls.has('fold'),
    open: (id: string) => tiles.get(id).cls.has('done-open'),
  };
}

const big = { id: 'w', state: 'working' };

test('M8-17e a tile done 9 minutes ago is a full tile; at 10 minutes and later it is folded', async () => {
  const h = await harness();
  h.wall.decide([big, { id: 'd', state: 'done', stateAt: h.at(9 * MIN) }], 'w');
  h.wall.layout(false);
  assert.equal(h.folded('d'), false);
  h.advance(MIN);
  h.wall.layout(false);
  assert.equal(h.folded('d'), true, 'folded at exactly 10 minutes');
  h.advance(5 * MIN);
  h.wall.layout(false);
  assert.equal(h.folded('d'), true);
});

test('M8-17e the fold timer is set for the time left (+20 ms) and firing it folds the tile', async () => {
  const h = await harness();
  h.wall.decide([big, { id: 'd', state: 'done', stateAt: h.at(9 * MIN) }], 'w');
  h.wall.layout(false);
  const t = h.timers.filter((x) => x.live);
  assert.equal(t.length, 1);
  assert.equal(t[0].ms, MIN + 20);
  assert.equal(h.folded('d'), false);
  h.advance(MIN + 20);
  t[0].fn();
  assert.equal(h.folded('d'), true, 'the timer re-ran layout');
});

test('M8-17e a folded done tile opens with toggleOpen and closes with a second one', async () => {
  const h = await harness();
  h.wall.decide([big, { id: 'd', state: 'done', stateAt: h.at(30 * MIN) }], 'w');
  h.wall.layout(false);
  assert.equal(h.folded('d'), true);
  assert.equal(h.wall.toggleOpen('d'), true);
  assert.equal(h.folded('d'), false);
  assert.equal(h.open('d'), true);
  h.wall.toggleOpen('d');
  assert.equal(h.folded('d'), true);
  assert.equal(h.open('d'), false);
});

test('M8-17e a done tile with no state time folds at once; an idle tile folds whatever its age', async () => {
  const h = await harness();
  h.wall.decide([big, { id: 'd', state: 'done' }, { id: 'i', state: 'idle', stateAt: h.at(1000) }], 'w');
  h.wall.layout(false);
  assert.equal(h.folded('d'), true);
  assert.equal(h.folded('i'), true);
  assert.equal(h.timers.filter((x) => x.live).length, 0, 'no fold timer when nothing is fresh');
});

test('M8-17e app.js hands wall.decide the state time as stateAt: Date.parse(x.state_at)', () => {
  const src = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
  assert.match(src, /stateAt:[^,]*Date\.parse\(x\.state_at\)/);
});
