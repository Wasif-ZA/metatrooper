'use strict';

// Layout and motion of the core wall; app.js owns the data and termView owns the terminals.
const wall = (() => {
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstChild; };
  const STAMP = '<span class="stamp"><span class="si"><span class="ink y" aria-hidden="true">Needs you</span><span class="ink p">Needs you</span></span></span>';
  const TOP = 64, G = 8, BAR = 36, SPN = 15;
  const S = {};
  let BIG = [], ORDER = [], PAIR_AT = 0, mode = 'single', placed = false, snapSel, pending = [];
  const pane = (id) => termView.tile(id);
  const active = (s) => s.shell || !['done', 'idle', 'exited'].includes(s.state);
  const folded = (s) => !active(s) && !s.open;
  const waiting = () => [...BIG, ...ORDER].filter((id) => S[id] && S[id].state === 'waiting_for_you');

  function setBig(id) {
    if (!S[id] || BIG[0] === id) return;
    if (BIG[1] === id) { BIG.reverse(); return; }
    const i = ORDER.indexOf(id);
    if (BIG[0]) { if (i >= 0) ORDER[i] = BIG[0]; else ORDER.unshift(BIG[0]); } else if (i >= 0) ORDER.splice(i, 1);
    BIG[0] = id;
  }

  /** Records state changes, keeps the order, and picks the big pane; returns its id. */
  function decide(list, selected) {
    const ids = new Set(list.map((x) => x.id));
    const fx = [];
    for (const x of list) {
      const s = S[x.id];
      if (!s) { S[x.id] = { state: x.state, shell: x.shell, open: false, hist: Array(SPN).fill(0), lvl: 0 }; fx.push([x.id, null, x.state]); }
      else if (s.state !== x.state) { fx.push([x.id, s.state, x.state]); s.state = x.state; if (active(s)) s.open = false; }
    }
    for (const id of Object.keys(S)) if (!ids.has(id)) { stopLive(id); delete S[id]; }
    BIG = BIG.filter((id) => S[id]);
    ORDER = ORDER.filter((id) => S[id] && !BIG.includes(id));
    for (const id of ids) if (!BIG.includes(id) && !ORDER.includes(id)) ORDER.push(id);
    if (selected !== snapSel) { snapSel = selected; setBig(selected); }
    if (!BIG.length && ORDER.length) setBig(ORDER.find((id) => S[id].state === 'waiting_for_you') || ORDER[0]);
    if (placed) {
      const bigWaits = () => BIG.some((id) => S[id].state === 'waiting_for_you');
      for (const [id, from, to] of fx) if (to === 'waiting_for_you' && from !== null && !bigWaits()) setBig(id);
      if (!bigWaits() && fx.some(([id, from]) => from === 'waiting_for_you' && BIG.includes(id)) && waiting()[0]) setBig(waiting()[0]);
    }
    pending = pending.concat(fx);
    return BIG[0] || null;
  }

  function apply(nextMode) {
    const moved = placed && nextMode !== mode;
    mode = nextMode;
    for (const [id, from, to] of pending) {
      const el = pane(id);
      if (!el) continue;
      const anim = placed && from !== null;
      setBadge(id, anim);
      if (to === 'waiting_for_you') { attn(id, true, anim ? 0.8 : 0); if (anim) sweep(el); }
      else if (from === 'waiting_for_you') attn(id, false);
      if (to === 'working') startLive(id); else stopLive(id);
    }
    pending = [];
    layout(placed, moved ? 0.6 : 1.1);
    placed = true;
  }

  const colW = (W) => (BIG.length > 1 ? (W - 32) * 0.625 : (W - 32) / 3.3 * 1.3);
  function rects() {
    const W = innerWidth, H = innerHeight - TOP - 60;
    const R = {};
    const ids = [...BIG, ...ORDER].filter((id) => S[id]);
    if (mode === 'grid') {
      const cols = Math.ceil(Math.sqrt(ids.length)), rows = Math.ceil(ids.length / cols);
      const w = (W - 16 - G * (cols - 1)) / cols, hh = (H - G * (rows - 1)) / rows;
      ids.forEach((id, i) => R[id] = { left: 8 + (i % cols) * (w + G), top: TOP + Math.floor(i / cols) * (hh + G), width: w, height: hh });
      return { R, C: colW(W), RX: 8, box: 0, H };
    }
    const C = colW(W), RX = 8 + C + G, RW = W - 8 - RX;
    const rb = document.getElementById('runbox');
    rb.style.display = rb.childElementCount ? 'block' : 'none';
    rb.style.height = 'auto';
    const box = rb.childElementCount ? Math.min(rb.scrollHeight + 2, Math.round(H * 0.45)) : 0;
    const bh = box ? H - box - G : H;
    const bw = (C - G * (BIG.length - 1)) / BIG.length;
    BIG.forEach((id, i) => R[id] = { left: 8 + i * (bw + G), top: TOP, width: bw, height: bh });
    const rest = ORDER.filter((id) => !BIG.includes(id));
    const work = rest.filter((id) => active(S[id])), open = rest.filter((id) => !active(S[id]) && S[id].open);
    const bars = rest.filter((id) => folded(S[id])).slice(0, Math.max(0, Math.floor((H * 0.5) / (BAR + G))));
    const A = H - bars.length * (BAR + G);
    const wh = !open.length ? A : !work.length ? 0 : (A - G) * 1.2 / 2.2;
    const row = (list, y, hh) => list.forEach((id, i) => {
      const w = (RW - G * (list.length - 1)) / list.length;
      R[id] = { left: RX + i * (w + G), top: y, width: w, height: hh };
    });
    row(work, TOP, wh);
    row(open, work.length ? TOP + wh + G : TOP, work.length ? A - wh - G : A);
    bars.forEach((id, i) => R[id] = { left: RX, top: TOP + A + G + i * (BAR + G), width: RW, height: BAR });
    return { R, C, RX, box, H };
  }

  function layout(animate, dur = 1.1) {
    const { R, C, RX, box, H } = rects();
    document.body.classList.toggle('paired', BIG.length > 1 && mode !== 'grid');
    for (const id of Object.keys(S)) {
      const el = pane(id), r = R[id];
      if (!el) continue;
      el.hidden = !r;
      if (!r) continue;
      const big = mode !== 'grid' && BIG.includes(id);
      el.classList.toggle('big', big);
      el.classList.toggle('big2', mode !== 'grid' && BIG[1] === id);
      el.classList.toggle('fold', mode !== 'grid' && !big && folded(S[id]));
      el.classList.toggle('done-open', mode !== 'grid' && !big && !active(S[id]) && S[id].open);
      const key = `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`;
      if (el._r === key) continue;
      el._r = key;
      if (!animate || RM) {
        gsap.set(el, r);
        if (animate && RM) gsap.fromTo(el, { opacity: 0.4 }, { opacity: 1, duration: 0.4 });
        continue;
      }
      if (el.dataset.fresh) {
        delete el.dataset.fresh;
        gsap.set(el, { ...r, x: 32, opacity: 0 });
        gsap.to(el, { x: 0, opacity: 1, duration: 0.9, ease: 'power3.out' });
        continue;
      }
      gsap.to(el, { ...r, duration: dur, ease: dur < 1 ? 'power3.inOut' : 'power2.inOut', overwrite: 'auto' });
    }
    for (const id of Object.keys(S)) { const el = pane(id); if (el) delete el.dataset.fresh; }
    const go = animate && !RM;
    const to = (sel, v) => gsap[go ? 'to' : 'set'](sel, { ...v, ...(go ? { duration: dur, ease: 'power2.inOut', overwrite: 'auto' } : {}) });
    to('.strip', { width: C });
    to('#sheet', { left: 16 + C });
    to('#split', { left: RX });
    gsap.set('#runbox', { left: 8, top: TOP + H - box, width: C, height: box, display: box ? 'block' : 'none' });
  }

  function pair(id) {
    if (BIG.length > 1 || BIG.includes(id) || !S[id]) return;
    PAIR_AT = ORDER.indexOf(id);
    ORDER.splice(PAIR_AT, 1); BIG.push(id);
    layout(true, 0.6);
  }
  function unpair() {
    if (BIG.length < 2) return;
    ORDER.splice(Math.min(PAIR_AT, ORDER.length), 0, BIG.pop());
    layout(true, 0.6);
  }
  function toggleOpen(id) {
    if (!S[id] || active(S[id])) return false;
    S[id].open = !S[id].open;
    layout(true);
    return true;
  }

  function startLive(id) {
    const s = S[id], el = pane(id);
    if (!s || s.shimT || !el || RM) return;
    gsap.to($('.shim', el), { opacity: 0.85, duration: 0.6 });
    s.shimT = gsap.fromTo($('.shim i', el), { xPercent: -100 }, { xPercent: 360, duration: 2.8, ease: 'sine.inOut', repeat: -1, repeatDelay: 0.6, delay: Math.random() * 1.5 });
  }
  function stopLive(id) {
    const s = S[id];
    if (!s || !s.shimT) return;
    s.shimT.kill(); s.shimT = null;
    const el = pane(id);
    if (el) { gsap.to($('.shim', el), { opacity: 0, duration: 0.5 }); drawSpk(id, Array(SPN).fill(0)); }
  }

  const spkPts = (a) => a.map((v, i) => [0, 1, 2, 3, 4].map((j) => `<rect x="${i * 2}" y="${(9.6 - j * 2.4).toFixed(1)}" width="1.6" height="1.6"${j < Math.round(v * 5) ? ' class="on"' : ''}/>`).join('')).join('');
  function drawSpk(id, a) { const el = pane(id); const p = el && $('.spk', el); if (p) p.innerHTML = spkPts(a); }
  function output(id, n) { const s = S[id]; if (s) s.lvl += 0.45 + Math.min(0.55, n / 400); }
  setInterval(() => {
    for (const [id, s] of Object.entries(S)) {
      if (s.state !== 'working' && !s.lvl) continue;
      s.hist.shift(); s.hist.push(Math.min(1, s.lvl)); s.lvl = s.lvl < 0.01 ? 0 : s.lvl * 0.45;
      drawSpk(id, s.hist);
    }
  }, 350);

  function stampLand(sp) {
    if (RM) return gsap.fromTo(sp, { opacity: 0 }, { opacity: 1, duration: 0.3 });
    gsap.fromTo(sp, { opacity: 0 }, { opacity: 1, duration: 0.06 });
    gsap.fromTo($('.si', sp), { scale: 1.25 }, { scale: 1, duration: 0.3, ease: 'power3.out' });
    gsap.fromTo($('.ink.y', sp), { x: 6, y: -4 }, { x: 0, y: 0, duration: 0.3, ease: 'power2.out' });
    gsap.fromTo($('.ink.p', sp), { x: -3, y: 3 }, { x: 0, y: 0, duration: 0.3, ease: 'power2.out' });
  }
  function setBadge(id, anim) {
    const s = S[id], el = pane(id);
    const b = $('.badge', el), sp = $('.stamp', el);
    el.classList.toggle('working', s.state === 'working');
    if (s.state === 'waiting_for_you') {
      b.style.display = 'none';
      if (!sp) { const n = h(STAMP); b.after(n); if (anim) stampLand(n); }
      return;
    }
    b.className = `tile-state badge ${s.state === 'working' ? 'work' : s.state === 'done' ? 'unseen' : 'done'}`;
    const show = () => { b.style.display = ''; if (anim) gsap.fromTo(b, { opacity: 0 }, { opacity: 1, duration: 0.3 }); };
    if (sp) {
      if (!anim) { sp.remove(); return show(); }
      gsap.to($('.si', sp), RM ? { opacity: 0, duration: 0.2 } : { scale: 1.12, y: -6, opacity: 0, duration: 0.25, ease: 'power2.in' });
      gsap.delayedCall(0.26, () => { sp.remove(); show(); });
      return;
    }
    show();
  }

  function attn(id, on, delay = 0) {
    const el = pane(id), edge = $('.edge', el);
    el.classList.toggle('attn', on);
    if (el._br) el._br.kill();
    if (!on) return gsap.to(edge, { opacity: 0, duration: 0.6 });
    if (RM) return gsap.set(edge, { opacity: 1 });
    gsap.set(edge, { opacity: 0.3 });
    el._br = gsap.to(edge, { opacity: 1, duration: 1.2, ease: 'sine.inOut', yoyo: true, repeat: -1, delay });
  }
  function sweep(el) {
    if (RM) return;
    const c = h('<span class="swc"><i class="sweep"></i></span>');
    el.appendChild(c);
    gsap.fromTo($('i', c), { xPercent: -110 }, { xPercent: 230, duration: 0.8, ease: 'power2.inOut', onComplete: () => c.remove() });
  }

  function roll(el, n) {
    const old = el.lastElementChild;
    if (!old || old.textContent === String(n)) return;
    if (RM) { old.textContent = n; gsap.fromTo(old, { opacity: 0.2 }, { opacity: 1, duration: 0.3 }); return; }
    const up = +n > +old.textContent ? 1 : -1;
    const nu = h(`<span>${n}</span>`);
    el.appendChild(nu);
    gsap.fromTo(nu, { yPercent: 100 * up }, { yPercent: 0, duration: 0.5, ease: 'power3.out' });
    gsap.to(old, { yPercent: -100 * up, duration: 0.5, ease: 'power3.out', onComplete: () => old.remove() });
  }

  /** Replaces a gate's actions with an APPROVED or REJECTED stamp, then fades the card. */
  function verdict(card, ok) {
    if (!card) return;
    const ga = card.querySelector('.ga') || card;
    ga.innerHTML = `<span class="verdict ${ok ? 'ok' : 'no'}">${ok ? 'Approved' : 'Rejected'}</span>`;
    const v = $('.verdict', ga);
    if (RM) gsap.fromTo(v, { opacity: 0, rotation: -2 }, { opacity: 1, duration: 0.3 });
    else gsap.fromTo(v, { scale: 1.3, rotation: -2, opacity: 0 }, { scale: 1, rotation: -2, opacity: 1, duration: 0.3, ease: 'power3.out' });
  }

  const T = (open, d) => (RM ? 0.15 : open ? d : d * 0.6);
  let listOpen = false, sheetOpen = false;
  function setList(open) {
    listOpen = open;
    const l = $('#list');
    $('#listBtn').classList.toggle('on', open); $('#listBtn').setAttribute('aria-pressed', open);
    if (open) {
      gsap.set(l, { visibility: 'visible' });
      if (RM) gsap.set(l, { x: 0 });
      gsap.to(l, RM ? { opacity: 1, duration: T(1) } : { x: 0, opacity: 1, duration: T(1, 0.26), ease: 'power3.out' });
    } else gsap.to(l, RM ? { opacity: 0, duration: T(0), onComplete: () => gsap.set(l, { visibility: 'hidden', x: -310 }) } : { x: -310, duration: T(0, 0.26), ease: 'power2.in', onComplete: () => gsap.set(l, { visibility: 'hidden' }) });
    gsap.to('.scrim', { autoAlpha: open ? 1 : 0, duration: T(open, 0.22) });
  }
  function setSheet(open) {
    sheetOpen = open;
    const sh = $('#sheet');
    sh.classList.toggle('up', open);
    sh.querySelector('.tab').setAttribute('aria-expanded', open);
    gsap.to(sh, RM ? { y: open ? 0 : 208, duration: 0 } : { y: open ? 0 : 208, duration: T(open, 0.28), ease: open ? 'back.out(1.2)' : 'power2.in' });
    gsap.to('.sheet .chev', { rotation: open ? 180 : 0, duration: T(open, 0.28) });
  }
  function openSearch() {
    const box = $('#search');
    if (box.classList.contains('open')) return;
    box.classList.add('open');
    gsap.fromTo(box, { width: 300 }, { width: 600, duration: RM ? 0 : 0.24, ease: 'power3.out' });
    gsap.fromTo(['#palette-list', '.sfoot'], { opacity: 0, y: RM ? 0 : -6 }, { opacity: 1, y: 0, duration: 0.22, ease: 'back.out(1.4)' });
  }
  function closeSearch() {
    const box = $('#search');
    if (!box.classList.contains('open')) return;
    box.classList.remove('open');
    gsap.to(box, { width: 300, duration: RM ? 0 : 0.16, ease: 'power2.in' });
  }

  gsap.set('#list', { x: -310, visibility: 'hidden' });
  gsap.set('#sheet', { y: 208 });
  addEventListener('resize', () => layout(false));

  return {
    promote: setBig,
    decide, apply, layout, pair, unpair, toggleOpen, output, roll, verdict, setList, setSheet, openSearch, closeSearch,
    big: () => BIG[0] || null,
    isBig: (id) => BIG.includes(id),
    isFolded: (id) => Boolean(S[id]) && folded(S[id]) && !BIG.includes(id),
    listOpen: () => listOpen,
    sheetOpen: () => sheetOpen,
  };
})();
