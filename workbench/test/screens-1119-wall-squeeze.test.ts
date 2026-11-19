import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Many live sessions used to split the right column evenly with no floor, so tiles shrank below their own header:
// the second header line was sliced and the terminal had no room. A squeezed tile must become a one-row bar instead.
function wallAt(width: number, height: number) {
  const tiles = new Map<string, any>();
  const node = (): any => ({ dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, appendChild() {}, querySelector: () => null, getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) });
  const tile = () => {
    const classes = new Set<string>();
    return {
      dataset: {}, style: {}, hidden: false, rect: null as any,
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c), toggle: (c: string, on?: boolean) => { const v = on ?? !classes.has(c); if (v) classes.add(c); else classes.delete(c); return v; } },
      querySelector: () => node(), setAttribute() {}, addEventListener() {},
    };
  };
  const set = (el: any, r: any) => { if (el && typeof r === 'object' && 'height' in r) el.rect = { ...r }; return { kill() {} }; };
  const gsap = { set, to: set, fromTo: (el: any, _a: any, b: any) => set(el, b), delayedCall: () => ({ kill() {} }), killTweensOf() {} };
  const body = { ...node(), classList: { add() {}, remove() {}, toggle() {}, contains: (c: string) => c === 'no-split' } };
  const ctx = vm.createContext({
    gsap, termView: { tile: (id: string) => tiles.get(id) || (tiles.set(id, tile()), tiles.get(id)) },
    matchMedia: () => ({ matches: true }),
    document: { body, querySelector: () => node(), createElement: () => ({ content: { firstChild: node() } }) },
    addEventListener() {}, setInterval() {}, setTimeout: () => 1, clearTimeout() {},
    innerWidth: width, innerHeight: height, reportPaneBounds() {},
  });
  vm.runInContext(`${readFileSync(new URL('../renderer/wall.js', import.meta.url), 'utf8')}\nthis.wall = wall;`, ctx);
  return { wall: ctx.wall, tiles };
}

function run(n: number) {
  const w = wallAt(1064, 900);
  const list = Array.from({ length: n }, (_, i) => ({ id: `s${i}`, state: 'working' }));
  w.wall.decide(list, 's0');
  w.wall.apply('single');
  return w;
}

test('twenty live sessions: every tile stays on the Wall, and none is drawn shorter than a usable tile unless it is a one-row bar', () => {
  const { tiles } = run(20);
  assert.equal(tiles.size, 20);
  for (const [id, t] of tiles) {
    assert.ok(t.rect && !t.hidden, `${id} is placed`);
    if (t.classList.contains('big')) continue;
    if (t.classList.contains('fold')) assert.ok(t.rect.height >= 30, `${id} bar keeps a full row (${t.rect.height})`);
    else assert.ok(t.rect.height >= 96, `${id} is ${Math.round(t.rect.height)} px tall without being a bar`);
  }
});

test('three live sessions keep normal tiles, not bars', () => {
  const { tiles } = run(3);
  for (const [id, t] of tiles) assert.equal(t.classList.contains('fold'), false, id);
});
