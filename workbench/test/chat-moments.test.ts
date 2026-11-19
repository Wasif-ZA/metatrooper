import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

(globalThis as any).matchMedia = () => ({ matches: false });
const { reveal, settle } = await import('../ui/src/motion.js');

const fakeEl = (over: Record<string, unknown> = {}) => {
  const calls: any[] = [];
  const kids = [0, 1].map(() => ({ offsetHeight: 20, animate: (k: any, o: any) => { calls.push({ kid: true, k, o }); return {}; } }));
  return {
    calls,
    el: { scrollHeight: 120, offsetHeight: 40, getAnimations: () => [], animate: (k: any, o: any) => { calls.push({ k, o }); return { onfinish: null, cancel() {} }; }, querySelectorAll: (sel: string) => (sel.includes('>') || sel === ':scope li' ? kids : []), ...over },
  };
};

test('chat tool rows open at the reference duration, other drops keep the shared 180 ms', () => {
  const a = fakeEl();
  reveal(a.el, ':scope > *', 250);
  assert.equal(a.calls[0].o.duration, 250);
  const b = fakeEl();
  reveal(b.el);
  assert.equal(b.calls[0].o.duration, 180);
});

test('tool output rows get the row stagger, not only list items', () => {
  const chat = readFileSync(new URL('../ui/src/chat.jsx', import.meta.url), 'utf8');
  for (const cls of ['ou-hm-tooloutput', 'ou-hm-chatsteplist']) {
    const drop = chat.match(new RegExp(`<Drop open[^\n]*?${cls}"`))?.[0] || '';
    assert.match(drop, /ms=\{250\}/, `${cls} opens at 250 ms`);
    assert.match(drop, /rows=["']:scope > \*["']/, `${cls} staggers its div rows`);
  }
  const home = readFileSync(new URL('../ui/src/home.jsx', import.meta.url), 'utf8');
  assert.match(home, /export function Drop\(\{[^}]*\bms\b[^}]*\brows\b|export function Drop\(\{[^}]*\brows\b[^}]*\bms\b/, 'Drop takes ms and rows');
});

test('a composer that shrinks after send eases down over about 83 ms; growing stays a snap', () => {
  const a = fakeEl({ offsetHeight: 40 });
  settle(a.el, 120);
  assert.equal(a.calls.length, 1);
  assert.deepEqual(a.calls[0].k.map((f: any) => f.height), ['120px', '40px']);
  assert.ok(a.calls[0].o.duration >= 67 && a.calls[0].o.duration <= 100, `duration ${a.calls[0].o.duration}`);
  const b = fakeEl({ offsetHeight: 140 });
  settle(b.el, 120);
  assert.equal(b.calls.length, 0, 'no animation when the box grows');
});

test('the working label shimmers once every 4 s, only in the chat thread, and not under reduced motion', () => {
  const css = readFileSync(new URL('../ui/src/home-ref.css', import.meta.url), 'utf8');
  const rule = css.match(/\.ou-hm-worked \.ou-st-running[^{]*\{[^}]*animation:[^;}]*/);
  assert.ok(rule, 'shimmer is scoped to .ou-hm-worked .ou-st-running');
  assert.match(rule[0], /4000ms|4s/);
  assert.match(css, /@keyframes ou-chat-shimmer/);
  assert.match(css, /prefers-reduced-motion: reduce\)[^{]*\{[^}]*\.ou-hm-worked \.ou-st-running[^}]*animation: none/);
});

test('your own send brings the bubble into view even when scrolled up', () => {
  const chat = readFileSync(new URL('../ui/src/chat.jsx', import.meta.url), 'utf8');
  assert.match(chat, /scrollTo\(\{[^}]*behavior/, 'scrolls with scrollTo and a behavior option');
});
