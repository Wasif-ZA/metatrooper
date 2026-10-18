import test from 'node:test';
import assert from 'node:assert/strict';
import { awaitArrived, chipLabel, glideMs, modeOf, place, planGlide, type Rect } from '../src/cursor-glide.ts';

const host = { width: 1920, height: 1080 };
const box = (cx: number, cy: number, w = 80, h = 30): Rect => ({ x: cx - w / 2, y: cy - h / 2, width: w, height: h });

test('M6-18f glide time: worked values, bounds and direction', () => {
  // protects=M6-18f the per-action budget: no glide over 220 ms or under 90 ms
  // fails_when=glideMs drops the clamp, the log2 term or the rounding
  // no_claim=the overlay plays the glide in that time
  assert.equal(glideMs(600, 80), 220);
  assert.equal(glideMs(40, 120), 93);
  for (const d of [0, 1, 50, 500, 5000, 1e6]) for (const w of [0, 1, 20, 200, 2000]) {
    const v = glideMs(d, w);
    assert.ok(v >= 90 && v <= 220, `${d} ${w} ${v}`);
  }
  assert.ok(glideMs(300, 80) > glideMs(100, 80));
  assert.ok(glideMs(300, 200) < glideMs(300, 40));
});

test('M6-18g glide rules: first, near, far, reduced motion, modes, key keeps its place', () => {
  // protects=M6-18g which actions glide and which snap
  // fails_when=a rule in planGlide is dropped or its threshold moves
  // no_claim=how either host draws the result
  const base = { mode: 'snappy' as const, reducedMotion: false, host };
  assert.deepEqual(planGlide({ ...base, prev: null, target: box(500, 400) }), { from: { x: 500, y: 400 }, to: { x: 500, y: 400 }, ms: 0 });
  assert.equal(planGlide({ ...base, prev: { x: 500, y: 400 }, target: box(503, 400) }).ms, 0);
  assert.ok(planGlide({ ...base, prev: { x: 500, y: 400 }, target: box(800, 400) }).ms > 0);
  assert.ok(planGlide({ ...base, prev: { x: 100, y: 100 }, target: box(700, 100) }).ms > 0, 'a 600 px move glides (D54)');
  assert.equal(planGlide({ ...base, prev: { x: 0, y: 0 }, target: box(1900, 1000) }).ms, 0, 'over half the diagonal snaps');
  assert.equal(planGlide({ ...base, reducedMotion: true, prev: { x: 500, y: 400 }, target: box(800, 400) }).ms, 0);
  assert.equal(planGlide({ ...base, mode: 'instant', prev: { x: 500, y: 400 }, target: box(800, 400) }).ms, 0);
  const snappy = planGlide({ ...base, prev: { x: 500, y: 400 }, target: box(800, 400) }).ms;
  assert.equal(planGlide({ ...base, mode: 'human', prev: { x: 500, y: 400 }, target: box(800, 400) }).ms, Math.round(snappy * 2.5));
  const wide = { x: 0, y: 0, width: 1000, height: 800 };
  assert.deepEqual(planGlide({ ...base, keep: true, prev: { x: 100, y: 100 }, target: wide }).to, { x: 100, y: 100 });
  assert.deepEqual(planGlide({ ...base, keep: true, prev: { x: 1500, y: 100 }, target: wide }).to, { x: 500, y: 400 });
});

test('M6-18 chip label: the whole label stays within 28 characters; mode falls back to snappy', () => {
  // protects=D50 the chip length, and agent_cursor.mode accepting only the four modes
  // fails_when=chipLabel cuts only the task, or modeOf passes an unknown value through
  // no_claim=how the chip renders
  assert.equal(chipLabel('claude', 'fix the login'), 'claude · fix the login');
  const long = chipLabel('claude', 'refactor the whole payment pipeline today');
  assert.equal(Array.from(long).length, 28);
  assert.ok(long.startsWith('claude · refactor') && long.endsWith('…'));
  assert.equal(chipLabel('codex', '  '), 'codex');
  assert.equal(modeOf('human'), 'human');
  assert.equal(modeOf('zoom'), 'snappy');
});

test('M6-18m placement with a faked 100% + 150% screen lands within 3 px', () => {
  // protects=M6-18m physical rectangles land on the right display's window at the right DIP point
  // fails_when=place skips toDip, picks the wrong display or forgets the display origin
  // no_claim=real Windows conversion (M6-18d is a hand run)
  const displays = [{ id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } }, { id: 2, bounds: { x: 1920, y: 0, width: 1920, height: 1080 } }];
  const toDip = (r: Rect) => (r.x >= 1920 ? { x: 1920 + (r.x - 1920) / 1.5, y: r.y / 1.5, width: r.width / 1.5, height: r.height / 1.5 } : r);
  const matching = (r: Rect) => displays[r.x + r.width / 2 >= 1920 ? 1 : 0];
  const left = place([400, 300, 80, 40], toDip, matching);
  assert.equal(left.display.id, 1);
  assert.ok(Math.hypot(left.rect.x + left.rect.width / 2 - 440, left.rect.y + left.rect.height / 2 - 320) <= 3);
  const right = place([1920 + 300, 150, 60, 30], toDip, matching);
  assert.equal(right.display.id, 2);
  assert.ok(Math.hypot(right.rect.x + right.rect.width / 2 - 220, right.rect.y + right.rect.height / 2 - 110) <= 3, JSON.stringify(right));
});

test('M6-18h awaitArrived: resolves on the matching id, else null at ms + 16', async () => {
  // protects=M6-18h a silent or destroyed overlay delays input by ms + 16 and no more
  // fails_when=the timeout goes, or an arrival for another id ends the wait
  // no_claim=the Electron ipc wiring
  const listeners = new Set<(...a: any[]) => void>();
  const wc = { isDestroyed: () => false, ipc: { on: (_c: string, f: any) => listeners.add(f), removeListener: (_c: string, f: any) => listeners.delete(f) } };
  const p = awaitArrived(wc, 'g1', 1000);
  for (const f of listeners) f({}, { id: 'other', at: 1 });
  for (const f of [...listeners]) f({}, { id: 'g1', at: 5, x: 1, y: 2 });
  assert.deepEqual(await p, { id: 'g1', at: 5, x: 1, y: 2 });
  assert.equal(listeners.size, 0);
  const t0 = Date.now();
  assert.equal(await awaitArrived({ isDestroyed: () => true }, 'g2', 40), null);
  const waited = Date.now() - t0;
  assert.ok(waited >= 50 && waited <= 90, String(waited));
});
