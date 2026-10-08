// Browser pane chrome: tab strip, run banner and the ... menu items, as HTML strings with no DOM access.
const browserChrome = (() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TAB_MS = 240, BANNER_MS = 320, TICK_MS = 200, THUMB_MS = 200;
  let seen = { tab: null, from: 0, banner: null, steps: {}, thumbs: {} };
  const held = {};
  // the class stays for the animation's length so a re-render inside it builds the same string and setHtml skips it
  const hold = (key, changed, ms, now) => { if (changed) held[key] = now + ms; return (held[key] || 0) > now; };

  function tabs(items, activeId, now = Date.now()) {
    const i = Math.max(0, items.findIndex((t) => t.id === activeId));
    const moved = seen.tab !== null && seen.tab !== i && items.length > 0;
    if (moved) seen.from = seen.tab;
    seen.tab = items.length ? i : null;
    const move = hold('tab', moved, TAB_MS, now);
    return `<div class="bstrip" style="--i:${i};--from:${seen.from}">${items.length ? `<i class="ind${move ? ' move' : ''}"></i>` : ''}
      ${items.map((t, k) => `<button class="bt${k === i ? ' on' : ''}" data-action="pane" data-id="${esc(t.id)}" title="${esc(t.url)}"><span class="dot ${esc(t.dot)}"></span><span class="nm">${esc(t.title)}</span>${t.tag ? `<span class="tag">${esc(t.tag)}</span>` : ''}<span class="x" data-action="pane-close" data-id="${esc(t.id)}" title="Close pane">&times;</span></button>`).join('')}
      <button class="plus" data-action="pane-new" title="New pane (Ctrl+T)">+</button></div>`;
  }

  function urlField(url, draft, zoom) {
    let host = url || '', path = '';
    try { const u = new URL(url); host = u.host ? `${u.protocol === 'https:' ? '' : u.protocol + '//'}${u.host}` : url; path = u.host ? u.pathname + u.search + u.hash : ''; } catch {}
    if (path === '/') path = '';
    const z = zoom && Math.abs(zoom - 1) > 0.001 ? `<button class="zoom" data-action="pane-act" data-act="zoom-reset" title="Reset zoom (Ctrl+0)">${Math.round(zoom * 100)}%</button>` : '';
    return `<label class="burl${draft != null ? ' drafting' : ''}"><span class="shown"><span class="host-part" data-scr="url-host">${esc(host)}</span><span class="path" data-scr="url-path">${esc(path)}</span></span>
      <input data-key="url" id="pane-url" value="${esc(draft ?? url ?? '')}" placeholder="Search, or type a URL like localhost:3001 (Ctrl+L)" spellcheck="false">${z}</label>`;
  }

  const CK = '<svg class="ck" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 5.2l2.3 2.3 4.7-5"/></svg>';
  const STATE = { done: 'done', skipped: 'done', running: 'run', waiting: 'run', failed: 'fail' };

  function thumb(label, shot, now) {
    if (!shot) { seen.thumbs[label] = null; return `<span class="thumb empty" title="No ${label} yet"></span>`; }
    const dev = hold('th:' + shot.id, seen.thumbs[label] !== undefined && seen.thumbs[label] !== shot.id, THUMB_MS, now);
    seen.thumbs[label] = shot.id;
    return shot.src ? `<img class="thumb${dev ? ' dev' : ''}" src="${esc(shot.src)}" alt="${label}" title="${label}">` : `<span class="thumb" title="${label}"></span>`;
  }

  // run: { id, name, steps: [{ id, title, status }], check: index of the step that holds the captures, before, after: { id, src } | null }
  function banner(run, now = Date.now()) {
    if (!run) { seen.banner = null; return ''; }
    const wipe = hold('banner', seen.banner !== run.id, BANNER_MS, now);
    if (seen.banner !== run.id) seen.thumbs = {};
    seen.banner = run.id;
    const steps = run.steps.map((s, k) => {
      const st = STATE[s.status] || 'pending';
      const key = run.id + ':' + s.id;
      const tick = hold('st:' + key, st === 'done' && seen.steps[key] !== undefined && seen.steps[key] !== 'done', TICK_MS, now);
      seen.steps[key] = st;
      const thumbs = k === run.check ? thumb('Before', run.before, now) + thumb('After', run.after, now) : '';
      return `${k ? `<span class="link${st === 'done' || st === 'run' ? ' done' : ''}"></span>` : ''}<span class="step ${st}${tick ? ' tick' : ''}" title="${esc(s.id)}: ${esc(s.status || 'pending')}"><span class="num"><span class="n">${k + 1}</span>${CK}</span>${esc(s.title)}${thumbs}</span>`;
    }).join('');
    return `<div class="brun"><div class="runb${wipe ? ' wipe' : ''}"><span class="who">Opened by run <b data-scr="run">${esc(run.name)}</b></span><span class="sep"></span>${steps}</div></div>`;
  }

  function menuItems(pane, sessions, mode, canCompare) {
    return [
      { id: 'before', label: 'Take Before' },
      { id: 'after', label: 'Take After' },
      { id: 'mode', label: mode === 'compare' ? 'Live' : 'Compare', enabled: mode === 'compare' || canCompare },
      { id: 'find', label: 'Find in page' },
      { type: 'separator' },
      { label: 'Driven by', submenu: [{ id: 'own:', label: 'You only', checked: !pane.session_id }, ...sessions.map((s) => ({ id: 'own:' + s.id, label: s.label, checked: s.id === pane.session_id }))] },
      { type: 'separator' },
      { id: 'close', label: 'Close pane' },
    ];
  }

  const timers = {};
  const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const last = {};
  function scramble(el, text) {
    const noise = '#%&*+=<>/|01';
    const start = Date.now();
    // progress comes from the clock, so throttled timers end on the real text instead of stalling mid-noise
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / 350);
      const n = Math.floor(text.length * p);
      el.textContent = p >= 1 ? text : text.slice(0, n) + [...text.slice(n)].map((c) => (c === ' ' ? ' ' : noise[(Math.random() * noise.length) | 0])).join('');
      if (p < 1) timers[el.dataset.scr] = setTimeout(tick, 44);
      else delete timers[el.dataset.scr];
    };
    tick();
  }

  // after each render: scramble text that changed since the last render, and pause the running-step blink while hidden
  function after(root) {
    if (!after.wired) { after.wired = true; document.addEventListener('visibilitychange', () => document.body.classList.toggle('doc-hidden', document.hidden)); }
    for (const el of root.querySelectorAll('[data-scr]')) {
      const k = el.dataset.scr, text = el.textContent;
      if (timers[k]) continue;
      if (last[k] !== undefined && last[k] !== text && text && !reduced() && !document.hidden) scramble(el, text);
      last[k] = text;
    }
  }

  const reset = () => { seen = { tab: null, from: 0, banner: null, steps: {}, thumbs: {} }; for (const k in held) delete held[k]; };
  return { tabs, urlField, banner, menuItems, after, reset };
})();
if (typeof window !== 'undefined') window.browserChrome = browserChrome; else globalThis.browserChrome = browserChrome;
