'use strict';

// One cursor per agent session (contracts/agent-cursor.md). Host 1: the overlay view above a browser pane; host 2: a desktop overlay window.
const bridge = window.overlayBridge;
const cursors = new Map();
const NS = 'http://www.w3.org/2000/svg';
const SAMPLE_MS = 4;
let top = 1;

const now = () => performance.timeOrigin + performance.now();
const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

function make(session) {
  const el = document.createElement('div');
  el.className = 'cursor';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', '18');
  svg.setAttribute('height', '22');
  svg.setAttribute('viewBox', '0 0 18 22');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', 'M1 1 L1 18 L5.5 14 L8.5 21 L11.5 19.7 L8.6 13 L15 13 Z');
  svg.append(path);
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const chip = document.createElement('span');
  chip.className = 'chip';
  const caption = document.createElement('span');
  caption.className = 'caption';
  el.append(ripple, svg, chip, caption);
  document.body.append(el);
  const c = { el, chip, caption, ripple, x: 0, y: 0, raf: 0, timer: 0, after: 0, gone: 0 };
  cursors.set(session, c);
  return c;
}

function draw(c, p) {
  c.x = p.x;
  c.y = p.y;
  c.el.style.transform = `translate(${p.x}px, ${p.y}px)`;
}

/** The path as timed samples: eased, with one gentle bend; human mode bends more and overshoots. */
function plan(from, to, ms, human) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const d = Math.hypot(dx, dy) || 1;
  const bend = Math.min(human ? 90 : 40, d * (human ? 0.25 : 0.12));
  const cx = (from.x + to.x) / 2 - (dy / d) * bend, cy = (from.y + to.y) / 2 + (dx / d) * bend;
  const ease = human
    ? (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2)
    : (t) => 1 - Math.pow(1 - t, 3);
  const n = Math.max(2, Math.ceil(ms / SAMPLE_MS) + 1);
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = ease(i / (n - 1)), u = 1 - t;
    out.push({ x: u * u * from.x + 2 * u * t * cx + t * t * to.x, y: u * u * from.y + 2 * u * t * cy + t * t * to.y });
  }
  out[n - 1] = { x: to.x, y: to.y };
  return out;
}

function afterArrive(c, m, reduced) {
  clearTimeout(c.after);
  if (reduced) {
    c.el.classList.remove('flash');
    void c.el.offsetWidth;
    c.el.classList.add('flash');
  } else {
    c.ripple.classList.remove('on');
    void c.ripple.offsetWidth;
    c.ripple.classList.add('on');
  }
  c.caption.textContent = m.caption || '';
  c.caption.classList.toggle('on', Boolean(m.caption));
  c.after = setTimeout(() => c.caption.classList.remove('on'), 1200);
}

bridge.onGlide((m) => {
  let c = cursors.get(m.session);
  const fresh = !c;
  if (!c) c = make(m.session);
  clearTimeout(c.gone);
  cancelAnimationFrame(c.raf);
  clearTimeout(c.timer);
  c.el.classList.remove('fading');
  c.el.style.setProperty('--c', m.colour);
  c.el.style.zIndex = String(++top);
  if (c.chip.textContent !== m.label) c.chip.textContent = m.label;
  const reduced = Boolean(m.reducedMotion) || reducedQuery.matches;
  const ms = fresh || reduced ? 0 : Math.max(0, Number(m.ms) || 0);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(c.raf);
    clearTimeout(c.timer);
    draw(c, m.to);
    bridge.arrived({ id: m.id, at: now(), x: m.to.x, y: m.to.y });
    afterArrive(c, m, reduced);
  };
  if (fresh) {
    c.el.classList.remove('appear');
    void c.el.offsetWidth;
    c.el.classList.add('appear');
  }
  if (ms === 0) return finish();
  const samples = plan({ x: c.x, y: c.y }, m.to, ms, m.mode === 'human');
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / ms);
    if (k >= 1) return finish();
    const f = k * (samples.length - 1), i = Math.floor(f), r = f - i;
    const a = samples[i], b = samples[Math.min(i + 1, samples.length - 1)];
    draw(c, { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r });
    c.raf = requestAnimationFrame(step);
  };
  c.raf = requestAnimationFrame(step);
  // a hidden or throttled host may stop frames; the clock still ends the glide on time
  c.timer = setTimeout(finish, ms + 4);
});

bridge.onHide(({ session }) => {
  const c = cursors.get(session);
  if (!c) return;
  c.el.classList.add('fading');
  clearTimeout(c.gone);
  c.gone = setTimeout(() => {
    c.el.remove();
    if (cursors.get(session) === c) cursors.delete(session);
  }, 300);
});
