import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const app = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const fn = (name: string) => app.match(new RegExp(`^(?:async )?function ${name}\\([^]*?\\n}\\n`, 'm'))![0];

function wallWithClock() {
  const node = (): any => ({ dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, after() {}, appendChild() {}, remove() {}, querySelector: () => node(), getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) });
  const tiles = new Map<string, any>();
  const tw = () => ({ kill() {} });
  const gsap = { to: tw, set: tw, fromTo: tw, delayedCall: tw };
  const listeners: Record<string, Array<(e: unknown) => void>> = {};
  let now = 1_000_000;
  let timer: { at: number; f: () => void } | null = null;
  const ctx = vm.createContext({
    gsap, termView: { tile: (id: string) => tiles.get(id) || (tiles.set(id, node()), tiles.get(id)) },
    matchMedia: () => ({ matches: false }),
    document: { body: node(), querySelector: () => node(), createElement: () => ({ content: { firstChild: node() } }) },
    addEventListener: (type: string, f: (e: unknown) => void) => { (listeners[type] ||= []).push(f); },
    setInterval() {}, innerWidth: 1400, innerHeight: 900, reportPaneBounds() {},
    Date: { now: () => now },
    setTimeout: (f: () => void, ms: number) => { timer = { at: now + ms, f }; return 1; },
    clearTimeout: () => { timer = null; },
  });
  vm.runInContext(`${readFileSync(new URL('../renderer/wall.js', import.meta.url), 'utf8')}\nthis.wall = wall;`, ctx);
  const wall = ctx.wall;
  const bigTile = { closest: (s: string) => (s === '.tile.big' ? {} : null) };
  return {
    wall,
    press: () => { for (const f of listeners.keydown) f({ target: bigTile }); },
    advance: (ms: number) => { now += ms; if (timer && timer.at <= now) { const t = timer; timer = null; t.f(); } },
  };
}

test('M6-09a: Alt+J picks the smallest since, ties to the lower session id', () => {
  const oldestWaiting = new Function(`${fn('oldestWaiting')}; return oldestWaiting;`)();
  const s = [
    { id: 's_c', state: 'waiting_for_you', state_at: '2026-10-12T10:00:05.000Z' },
    { id: 's_b', state: 'waiting_for_you', state_at: '2026-10-12T10:00:01.000Z' },
    { id: 's_a', state: 'working', state_at: '2026-10-12T09:00:00.000Z' },
    { id: 's_d', state: 'waiting_for_you', state_at: '2026-10-12T10:00:01.000Z' },
  ];
  assert.equal(oldestWaiting(s).id, 's_b');
  assert.equal(oldestWaiting(s.filter((x) => x.id !== 's_b')).id, 's_d');
  assert.equal(oldestWaiting([s[2]]), null);
});

test('M6-09a: Alt+J is caught before the terminal and its tile header shows the reason', () => {
  assert.match(app, /function wallKeys\(e\) \{\n  if \(!e\.altKey[^\n]*e\.code !== 'KeyJ'/);
  assert.match(app, /document\.addEventListener\('keydown', wallKeys, true\)/);
  const waitReason = new Function(`${fn('waitReason')}; return waitReason;`)();
  assert.equal(waitReason({ last_tool: 'Bash' }), 'permission: Bash');
  assert.equal(waitReason({ last_tool: null }), 'question');
  assert.equal(waitReason({ reason: 'approval: deploy', last_tool: 'Bash' }), 'approval: deploy');
  assert.match(app, /last: x\.shell \? '' : x\.state === 'waiting_for_you' \? waitReason\(x\) : x\.last_line/);
});

test('M6-09a: a key press in the big tile holds the big slot for 3 s, then the waiting tile moves in', () => {
  const { wall, press, advance } = wallWithClock();
  let woke = 0;
  const list = (s2: string) => [{ id: 's1', state: 'working' }, { id: 's2', state: s2 }];
  wall.onWake(() => { woke++; wall.decide(list('waiting_for_you'), 's1'); wall.apply('single'); });
  assert.equal(wall.decide(list('working'), 's1'), 's1');
  wall.apply('single');
  press();
  advance(500);
  assert.equal(wall.decide(list('waiting_for_you'), 's1'), 's1');
  wall.apply('single');
  advance(2400);
  assert.equal(woke, 0);
  assert.equal(wall.big(), 's1');
  advance(200);
  assert.equal(woke, 1);
  assert.equal(wall.big(), 's2');
});

test('M6-09a: a press during the hold restarts it, and with no press a waiting tile moves in at once', () => {
  const { wall, press, advance } = wallWithClock();
  const list = (s2: string) => [{ id: 's1', state: 'working' }, { id: 's2', state: s2 }];
  wall.onWake(() => { wall.decide(list('waiting_for_you'), 's1'); });
  wall.decide(list('working'), 's1'); wall.apply('single');
  press();
  wall.decide(list('waiting_for_you'), 's1');
  advance(2000);
  press();
  advance(1100);
  assert.equal(wall.big(), 's1');
  advance(2000);
  assert.equal(wall.big(), 's2');

  const fresh = wallWithClock();
  fresh.wall.decide(list('working'), 's1'); fresh.wall.apply('single');
  fresh.advance(5000);
  assert.equal(fresh.wall.decide(list('waiting_for_you'), 's1'), 's2');
});
