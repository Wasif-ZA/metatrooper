import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// A hidden window never fires rAF, so gsap tweens queue up and replay at once on return, and DOM writes queue
// accessibility updates. While hidden the Wall must jump to end states and skip the sparkline redraws.
function wall(hidden: boolean) {
  const calls: string[] = [];
  const doc: Record<string, Array<() => void>> = {};
  let tick = () => {};
  const node = (): any => ({ dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, appendChild() {}, querySelector: () => null, getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }), innerHTML: '' });
  const tiles = new Map<string, any>();
  const tile = () => {
    const parts = new Map<string, any>();
    const classes = new Set<string>();
    return {
      dataset: {}, style: {}, hidden: false,
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c), toggle: (c: string, on?: boolean) => { const v = on ?? !classes.has(c); if (v) classes.add(c); else classes.delete(c); return v; } },
      querySelector: (sel: string) => parts.get(sel) || (parts.set(sel, { ...node(), sel }), parts.get(sel)), setAttribute() {}, addEventListener() {},
    };
  };
  const done: any[] = [];
  const children: any[] = [];
  const rec = (name: string) => (t: any, a: any, b?: any) => {
    calls.push(name);
    const v = b ?? a;
    const tw = { repeat: () => v?.repeat ?? 0, progress: (p: number) => { if (p === 1) done.push(tw); return tw; }, kill() {}, vars: v };
    if (name !== 'set') children.push(tw);
    if (name === 'set' && v?.onComplete) v.onComplete();
    return tw;
  };
  const gsap: any = { set: rec('set'), to: rec('to'), fromTo: rec('fromTo'), killTweensOf() {}, isTweening: () => false, delayedCall: () => ({ kill() {} }), globalTimeline: { getChildren: () => children } };
  const document: any = {
    hidden, body: node(),
    querySelector: () => node(), createElement: () => ({ content: { firstChild: node() } }),
    addEventListener: (type: string, f: () => void) => { (doc[type] ||= []).push(f); },
  };
  const ctx = vm.createContext({
    gsap, document, termView: { tile: (id: string) => tiles.get(id) || (tiles.set(id, tile()), tiles.get(id)) },
    matchMedia: () => ({ matches: false }), addEventListener() {}, setTimeout: () => 1, clearTimeout() {},
    setInterval: (f: () => void) => { tick = f; return 1; },
    innerWidth: 1064, innerHeight: 900, reportPaneBounds() {},
  });
  vm.runInContext(`${readFileSync(new URL('../renderer/wall.js', import.meta.url), 'utf8')}\nthis.wall = wall;`, ctx);
  const list = (n: number, state = 'working') => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, state }));
  return {
    w: ctx.wall, calls, done, children, tiles, list, tick: () => tick(),
    show: () => { document.hidden = false; for (const f of doc.visibilitychange || []) f(); },
  };
}

const tweens = (calls: string[]) => calls.filter((c) => c === 'to' || c === 'fromTo').length;

test('while hidden, Wall layout changes jump to their end state: no tweens are queued', () => {
  const h = wall(true);
  h.w.decide(h.list(4), 's0'); h.w.apply('single');
  h.w.decide(h.list(8), 's1'); h.w.apply('single');
  h.w.decide(h.list(3), 's2'); h.w.apply('single');
  assert.equal(tweens(h.calls), 0, h.calls.join(','));
  assert.ok(h.calls.includes('set'));
});

test('while visible, the same changes still animate', () => {
  const h = wall(false);
  h.w.decide(h.list(4), 's0'); h.w.apply('single');
  h.w.decide(h.list(8), 's1'); h.w.apply('single');
  assert.ok(tweens(h.calls) > 0);
});

test('the working shimmer is not started while hidden and starts for working tiles on return', () => {
  const h = wall(true);
  h.w.decide(h.list(3), 's0'); h.w.apply('single');
  const repeating = () => h.children.filter((t) => t.repeat() === -1).length;
  assert.equal(repeating(), 0, 'no endless shimmer while hidden');
  h.show();
  assert.equal(repeating(), 3, 'one shimmer per working tile after return');
});

test('on return, finite tweens queued before hiding jump to their end; endless ones are left alone', () => {
  const h = wall(false);
  h.w.decide(h.list(3), 's0'); h.w.apply('single');
  h.w.decide(h.list(6), 's1'); h.w.apply('single');
  const finite = h.children.filter((t) => t.repeat() !== -1).length;
  assert.ok(finite > 0);
  h.show();
  assert.equal(h.done.length, finite, 'every finite tween finished at once');
  assert.ok(h.done.every((t) => t.repeat() !== -1));
});

test('sparklines are not redrawn while hidden, and are drawn again on the first tick after return', () => {
  const h = wall(true);
  h.w.decide(h.list(2), 's0'); h.w.apply('single');
  const spk = () => h.tiles.get('s1').querySelector('.spk');
  spk().innerHTML = 'untouched';
  h.w.output('s1', 200);
  h.tick(); h.tick();
  assert.equal(spk().innerHTML, 'untouched', 'no DOM writes while hidden');
  h.show();
  h.tick();
  assert.notEqual(spk().innerHTML, 'untouched');
});
