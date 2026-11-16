const N = 170;

function bodyPoints(t) {
  return Array.from({ length: N }, (_, k) => {
    const r = Math.sqrt((k + 0.5) / N) * 0.92, a = k * 2.39996 + t * 0.35;
    const ripple = 1 + Math.sin(t * 2.2 - r * 7) * 0.035;
    return [Math.cos(a) * r * ripple, Math.sin(a) * r * ripple];
  });
}

export function createByte(canvas, options = {}) {
  const ctx = canvas.getContext('2d');
  const win = canvas.ownerDocument?.defaultView || globalThis;
  const size = 128, dpr = win.devicePixelRatio || 1;
  canvas.width = canvas.height = size * dpr;
  ctx?.setTransform?.(dpr, 0, 0, dpr, 0, 0);
  const token = (name, fallback) => typeof win.getComputedStyle === 'function' ? win.getComputedStyle(canvas).getPropertyValue(name).trim() || fallback : fallback;
  const { reducedMotion = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false,
    color = () => token('--color-text-primary', '#fff'),
    raf = (fn) => win.requestAnimationFrame(fn), caf = (id) => win.cancelAnimationFrame(id),
    now = () => win.performance.now() } = options;
  const cache = new Map();
  const dots = bodyPoints(1).map(([x, y]) => ({ x, y, vx: 0, vy: 0, s: 0.6 + Math.random() * 0.8 }));
  let alive = !reducedMotion, pending, label = null, until = 0, blinkAt = now() + 1500;
  let x = size / 2, y = size / 2, targetX = x, targetY = y;

  function glyphPoints(text) {
    if (cache.has(text)) return cache.get(text);
    const c = canvas.ownerDocument?.createElement?.('canvas');
    if (!c) return null;
    c.width = c.height = 96;
    const g = c.getContext('2d');
    if (!g || typeof g.fillText !== 'function' || typeof g.getImageData !== 'function') return null;
    g.fillStyle = '#000'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `800 ${text.length > 2 ? 40 : text.length > 1 ? 56 : 74}px ${token('--mono', '"JetBrains Mono", monospace')}`;
    g.fillText(text, 48, 51);
    const data = g.getImageData(0, 0, 96, 96).data, pts = [];
    for (let j = 0; j < 96; j += 2) for (let i = 0; i < 96; i += 2) if (data[(j * 96 + i) * 4 + 3] > 128) pts.push([(i - 48) / 48, (j - 48) / 48]);
    if (!pts.length) return null;
    const out = Array.from({ length: N }, (_, k) => pts[Math.floor(k / N * pts.length)]);
    cache.set(text, out);
    return out;
  }

  function eye(cx, cy, rx, ry) {
    ctx.beginPath();
    if (typeof ctx.ellipse === 'function') ctx.ellipse(cx, cy, rx, ry, 0, 0, 7);
    else ctx.arc(cx, cy, Math.min(rx, ry), 0, 7);
    ctx.fill();
  }
  function draw() {
    if (!ctx) return;
    const time = now(), r = size * 0.36, ink = color();
    const glyph = !reducedMotion && label && time < until ? glyphPoints(label) : null;
    const targets = glyph || bodyPoints(reducedMotion ? 1 : time / 1000);
    x += (targetX - x) * 0.12; y += (targetY - y) * 0.12;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = ink;
    dots.forEach((d, k) => {
      d.vx = (d.vx + (targets[k][0] - d.x) * 0.09) * 0.8;
      d.vy = (d.vy + (targets[k][1] - d.y) * 0.09) * 0.8;
      if (reducedMotion) { d.x = targets[k][0]; d.y = targets[k][1]; }
      else { d.x += d.vx; d.y += d.vy; }
      ctx.beginPath(); ctx.arc(x + d.x * r, y + d.y * r, Math.max(0.8, r * 0.032 * d.s), 0, 7); ctx.fill();
    });
    if (!glyph) {
      const dt = blinkAt - time;
      const open = reducedMotion || Math.abs(dt) >= 110 ? 1 : Math.max(0.08, Math.abs(dt) / 110);
      if (dt < -110) blinkAt = time + 2200 + Math.random() * 3300;
      for (const side of [-1, 1]) {
        const ex = x + side * r * 0.33, ey = y - r * 0.16, er = r * 0.2;
        ctx.fillStyle = token('--color-background-body', '#111'); eye(ex, ey, er, er * 1.15 * open);
        if (open > 0.35) { ctx.fillStyle = ink; eye(ex, ey, er * 0.46, er * 0.56 * open); }
      }
    }
    ctx.fillStyle = ink;
  }
  const frame = () => { if (!alive) return; draw(); if (alive) pending = raf(frame); };
  draw();
  if (alive) pending = raf(frame);
  return {
    morph(text, ms = 1600) { if (reducedMotion) return; label = String(text); until = now() + ms; },
    moveTo(tx, ty) { if (reducedMotion) return; targetX = tx; targetY = ty; },
    stop() { alive = false; if (pending !== undefined) { caf(pending); pending = undefined; } },
    running: () => alive,
    draw,
  };
}
