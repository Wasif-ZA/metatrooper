// The run screen: one pipeline run shown full screen over the wall, in the layout layoutRules picks.
const runLayouts = {};

const runScreen = (() => {
  const rules = window.layoutRules;
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const NAME = { 'run-log': 'Run log', 'artifact-columns': 'Artifact columns', 'pr-first': 'PR first', pipe: 'The pipe', 'agent-split': 'Agent split', 'pr-inline': 'PR inline', duel: 'Duel', buckets: 'Bucket board', 'coverage-map': 'Coverage map', triage: 'Triage', 'hand-back': 'Hand-back', 'preview-stage': 'Preview stage', 'before-after': 'Before / after', 'variants-grid': 'Variants grid', timeline: 'Timeline' };
  const SVG = (body) => `<svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor">${body}</svg>`;
  const REVIEW_ICON = {
    'pr-inline': SVG('<path d="M1.5 2.5h13M1.5 6h9M1.5 11.5h13" stroke-dasharray="1 1"/><rect x="3" y="7.5" width="11" height="2.5" stroke-width="1.2"/>'),
    duel: SVG('<rect x="1" y="1.5" width="6.2" height="11" stroke-dasharray="1 1.2"/><rect x="8.8" y="1.5" width="6.2" height="11" stroke-dasharray="1 1.2"/>'),
    buckets: SVG('<rect x=".8" y="1.5" width="3" height="11" stroke-dasharray="1 1"/><rect x="4.6" y="1.5" width="3" height="11" stroke-dasharray="1 1"/><rect x="8.4" y="1.5" width="3" height="11" stroke-dasharray="1 1"/><rect x="12.2" y="1.5" width="3" height="11" stroke-dasharray="1 1"/>'),
    'coverage-map': SVG('<path d="M1.5 3h13M1.5 7h13M1.5 11h13" stroke-dasharray="1 1.5"/><path d="M5 3h3M10 7h2M3 11h4" stroke-width="2"/>'),
    triage: SVG('<path d="M1.5 2.5h13" stroke-width="2"/><path d="M1.5 6.5h10M1.5 10h7M1.5 13h4" stroke-dasharray="1 1"/>'),
  };
  const ICON = {
    'run-log': '<svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor"><path d="M1.5 2.5h4M1.5 6h4M1.5 9.5h4" stroke-width="1.6" stroke-dasharray="1 1"/><rect x="7.5" y="1.5" width="7" height="11" stroke-dasharray="1 1.2"/></svg>',
    'artifact-columns': '<svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor"><rect x="1" y="1.5" width="3" height="11" stroke-dasharray="1 1"/><rect x="6.5" y="1.5" width="3" height="11" stroke-dasharray="1 1"/><rect x="12" y="1.5" width="3" height="11" stroke-dasharray="1 1"/></svg>',
    'pr-first': '<svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor"><path d="M1.5 2h13" stroke-width="1.6" stroke-dasharray="1 1"/><rect x="1.5" y="4.5" width="8.5" height="5" stroke-dasharray="1 1.2"/><rect x="11.5" y="4.5" width="3" height="8" stroke-dasharray="1 1"/><path d="M1.5 12h8.5" stroke-width="1.6"/></svg>',
    pipe: '<svg width="16" height="14" viewBox="0 0 16 14" fill="currentColor"><circle cx="2" cy="7" r="1.4"/><circle cx="5" cy="7" r=".7"/><circle cx="7" cy="7" r=".7"/><path d="M10.5 4.2l2.8 2.8-2.8 2.8-2.8-2.8z" opacity=".9"/><circle cx="15" cy="7" r=".9"/></svg>',
    'hand-back': '<svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor"><rect x="1.5" y="2" width="3" height="3" stroke-dasharray="1 1"/><path d="M6.5 3.5h8" stroke-width="1.6"/><rect x="1.5" y="9" width="3" height="3" stroke-dasharray="1 1"/><path d="M6.5 10.5h8" stroke-width="1.6" stroke-dasharray="1 1"/></svg>',
    'preview-stage': '<svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor"><rect x="1" y="1.5" width="3" height="11" stroke-dasharray="1 1"/><rect x="5.5" y="1.5" width="9.5" height="7.5" stroke-width="1.4"/><path d="M5.5 11.5h9.5" stroke-dasharray="1 1"/></svg>',
    'before-after': '<svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor"><rect x="1" y="1.5" width="6.2" height="11" stroke-dasharray="1 1.2"/><rect x="8.8" y="1.5" width="6.2" height="11" stroke-width="1.4"/></svg>',
    'variants-grid': '<svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor"><rect x="1" y="1.5" width="4" height="11" stroke-dasharray="1 1"/><rect x="6" y="1.5" width="4" height="11" stroke-dasharray="1 1"/><rect x="11" y="1.5" width="4" height="11" stroke-dasharray="1 1"/></svg>',
    timeline: '<svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor"><path d="M3 1.5v11" stroke-dasharray="1 1"/><circle cx="3" cy="3.5" r="1.3" fill="currentColor"/><circle cx="3" cy="10.5" r="1.3" fill="currentColor"/><path d="M6 3.5h9M6 10.5h7" stroke-width="1.4"/></svg>',
    'agent-split': '<svg width="16" height="14" viewBox="0 0 16 14" fill="none" stroke="currentColor"><path d="M1 1.5h14" stroke-width="1.6" stroke-dasharray="2 1"/><rect x="1" y="4" width="6.2" height="9" stroke-dasharray="1 1.2"/><rect x="8.8" y="4" width="6.2" height="9" stroke-dasharray="1 1.2"/></svg>',
  };
  const S = { runId: null, cur: null, manual: null, slot: null, railSel: null, lastTouch: -1e12, timer: null, sel: null, focused: null, html: '' };
  const meta = {};
  const logs = {};
  const diffs = {};
  const details = {};
  const hunks = {};
  const shotSrcs = {};
  let ctx = null;
  let el = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`; };
  const ended = (run) => ['done', 'failed', 'cancelled'].includes(run.status);

  function init(c) {
    ctx = c;
    el = document.createElement('section');
    el.className = 'runscreen';
    el.id = 'runscreen';
    el.hidden = true;
    document.body.appendChild(el);
    const touch = () => { S.lastTouch = Date.now(); };
    document.addEventListener('pointerdown', touch, true);
    document.addEventListener('keydown', touch, true);
    el.addEventListener('click', onClick);
    el.addEventListener('pointerdown', () => { S.deliberate = true; });
  }

  function pipeMeta(id) {
    if (!meta[id]) {
      meta[id] = { title: id, steps: {}, inputs: {} };
      void ctx.api.readPipeline(id).then((text) => {
        try {
          const j = JSON.parse(text);
          meta[id] = { title: j.title || id, lane: j.lane || '', budget: j.budget && j.budget.max_minutes, inputs: j.inputs || {}, steps: Object.fromEntries((j.steps || []).map((s) => [s.id, s])) };
          render();
        } catch {}
      });
    }
    return meta[id];
  }

  function runLog(runId, sig) {
    const c = (logs[runId] ||= { at: 0, events: [], sig });
    if (c.sig !== sig || Date.now() - c.at > 4000) {
      c.sig = sig;
      c.at = Date.now();
      void ctx.api.runLog(runId).then((lines) => {
        c.events = (lines || []).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
        render();
      });
    }
    return c.events;
  }

  function runDetail(runId, sig) {
    const c = (details[runId] ||= { at: 0, data: null, sig });
    if (c.sig !== sig || Date.now() - c.at > 8000) {
      c.sig = sig;
      c.at = Date.now();
      void ctx.api.runDetail(runId).then((d) => { c.data = d && !d.error ? d : null; render(); });
    }
    return c.data;
  }

  function fileHunk(sessionId, file) {
    const key = `${sessionId}:${file}`;
    const c = (hunks[key] ||= { at: 0, text: null });
    if (Date.now() - c.at > 8000) {
      c.at = Date.now();
      void ctx.api.sessionDiffFile(sessionId, file, 'branch').then((t) => { c.text = typeof t === 'string' ? t : null; render(); });
    }
    return c.text;
  }

  function shotSrc(runId, name) {
    const key = `${runId}:${name}`;
    if (!(key in shotSrcs)) {
      shotSrcs[key] = null;
      void ctx.api.runShot(runId, name).then((src) => { shotSrcs[key] = src || null; if (src) { S.html = ''; render(); } });
    }
    return shotSrcs[key];
  }

  function sessionDiff(sessionId) {
    if (!sessionId) return null;
    const c = (diffs[sessionId] ||= { at: 0, data: null });
    if (Date.now() - c.at > 8000) {
      c.at = Date.now();
      void ctx.api.sessionDiff(sessionId, 'branch').then((d) => { c.data = d; render(); });
    }
    return c.data;
  }

  function model() {
    const snap = ctx.snap();
    const run = snap && snap.runs.find((r) => r.id === S.runId);
    if (!run) return null;
    const st = ctx.stepsOf(run.id);
    const pipe = snap.pipelines.find((p) => p.id === run.pipeline_id) || null;
    const m = pipeMeta(run.pipeline_id);
    const sessions = snap.sessions.filter((x) => x.run_id === run.id);
    const list = st.list.map((x) => {
      const d = m.steps[x.id] || {};
      const session = sessions.filter((z) => z.step_id === x.id).pop() || null;
      const rows = snap.steps.filter((r) => r.run_id === run.id && r.step_id === x.id);
      const row = rows[rows.length - 1] || null;
      return { ...x, title: d.title || x.id, kind: (x.def && x.def.kind) || d.kind || '', role: d.role || '', uses: d.uses || '', session, engine: session ? session.engine_id : row && row.engine_id, output: row && row.output_path };
    });
    const agent = [...list].reverse().find((x) => x.session && x.kind === 'agent' && x.status !== 'pending' && (m.steps[x.id] || {}).worktree);
    const now = Date.now();
    return {
      run, pipe, meta: m, list, at: st.at, sessions,
      title: (pipe && pipe.title) || m.title,
      num: snap.runs.filter((r) => r.pipeline_id === run.pipeline_id && r.started_at <= run.started_at).length,
      done: list.filter((x) => x.status === 'done').length,
      waiting: list.filter((x) => x.status === 'waiting').length,
      tokens: sessions.reduce((n, x) => n + (x.tokens || 0), 0),
      usd: sessions.reduce((n, x) => n + (x.usd || 0), 0),
      elapsed: (run.ended_at ? Date.parse(run.ended_at) : now) - Date.parse(run.started_at),
      log: runLog(run.id, list.map((x) => x.status).join()),
      detail: runDetail(run.id, list.map((x) => x.status).join()),
      review: run.pipeline_id === 'two-engine-review' ? reviewStore.get(ctx.api, run.id, list.map((x) => x.status).join(), render) : null,
      findings: run.pipeline_id === 'e2e-browser-qa' ? findingStore.get(ctx.api, run.id, list.map((x) => x.status).join(), render) : null,
      agent,
      diff: agent ? sessionDiff(agent.session.id) : null,
      gates: snap.gates.filter((g) => g.run_id === run.id),
      variants: snap.variants || [],
    };
  }

  function sinceOf(m) {
    const { step } = rules.activeStep(m.list);
    return step && step.session && step.status === 'running' ? Date.parse(step.session.started_at) : null;
  }

  function open(runId, auto) {
    if (S.runId !== runId) Object.assign(S, { runId, cur: null, manual: null, slot: null, railSel: null, sel: null, focused: null, html: '', deliberate: false });
    if (!auto) {
      S.deliberate = true;
      if (document.activeElement) document.activeElement.blur();
    }
    render();
  }
  function close() {
    const was = S.runId;
    S.runId = null;
    clearTimeout(S.timer);
    if (el) el.hidden = true;
    if (was && ctx.onClose) ctx.onClose();
  }
  const isOpen = () => Boolean(S.runId);

  function render() {
    if (!el || !S.runId) return;
    const m = model();
    if (!m) return close();
    if (S.manual && ended(m.run) && !S.pickedEnded) S.manual = null;
    const want = rules.pickLayout(m.run, m.pipe, m.list, S.manual, m.review || m.findings || rules.flagsOf(m.detail));
    if (!S.cur) S.cur = want;
    else if (want !== S.cur) {
      clearTimeout(S.timer);
      const d = rules.due(S.cur, want, m.list, Date.now(), sinceOf(m), S.lastTouch);
      if (d.move) return show(want);
      if (d.retryIn != null) S.timer = setTimeout(render, d.retryIn + 50);
    }
    paint(m);
  }

  function show(name) {
    const was = S.cur;
    S.cur = name;
    if (name !== 'agent-split') S.focused = null;
    const ghost = was && was !== name && !RM && window.gsap ? el.querySelector('.rsv') : null;
    if (ghost) {
      const g = ghost.cloneNode(true);
      g.classList.add('rs-ghost');
      el.appendChild(g);
      gsap.to(g, { opacity: 0, duration: 0.5, ease: 'power2.inOut', onComplete: () => g.remove() });
    }
    S.html = '';
    render();
    const v = el.querySelector('.rsv');
    if (ghost && v) gsap.fromTo(v, { opacity: 0 }, { opacity: 1, duration: 0.55, delay: 0.05, ease: 'power2.inOut' });
  }

  function placeForSplit() {
    const big = document.querySelector('#centre .pane.big');
    const r = big && !big.hidden ? big.getBoundingClientRect() : null;
    el.style.left = S.cur === 'agent-split' && r && r.width ? `${Math.round(r.right + 8)}px` : '';
  }

  function formatOnlyList(files) {
    if (!files || !files.length) return '';
    return `<details class="rs-outside"><summary>${files.length} file${files.length === 1 ? '' : 's'} format only, not reviewed</summary><ul>${files.map((f) => `<li>${esc(f)}</li>`).join('')}</ul></details>`;
  }

  function outsideList(review) {
    const list = review && review.outside;
    if (!list || !list.length) return '';
    return `<details class="rs-outside"><summary>${list.length} finding${list.length === 1 ? '' : 's'} outside the change</summary><ul>${list.map((x) => `<li>${esc(x.file)}${x.from ? `:${x.from}` : ''} ${esc(x.title)}</li>`).join('')}</ul></details>`;
  }

  function helperChips(list) {
    if (!list || !list.length) return '';
    return `<div class="rs-helpers" aria-label="Helper tools">${list.map((a) => {
      const tip = [a.installed ? `${a.name} ${a.version || 'installed'}` : `not installed: ${a.install}`, `steps: ${a.steps.join(', ')}`, a.risk === 'caution' && a.risk_note ? a.risk_note : '', a.egress !== 'none' ? `sends: ${a.egress}` : ''].filter(Boolean).join(' · ');
      return `<span class="chip helper ${a.installed ? 'on' : 'off'}${a.egress !== 'none' ? ' egress' : ''}" data-helper="${esc(a.tool)}" title="${esc(tip)}">${esc(a.name)}<span class="hv">${a.installed ? esc(a.version || 'installed') : 'not installed'}</span>${a.risk === 'caution' && a.risk_note ? `<span class="hn">${esc(a.risk_note)}</span>` : ''}</span>`;
    }).join('')}</div>`;
  }

  function paint(m) {
    const L = runLayouts[S.cur] || runLayouts['run-log'];
    const live = rules.activeStep(m.list).step;
    m.watch = live && live.kind === 'agent' && live.session ? live : m.agent;
    const five = rules.ruleOf(m.run.pipeline_id).five;
    if (S.cur === 'agent-split') {
      m.rail = agentRail.shown(m, S.manual === 'agent-split' && S.slot != null && five.indexOf('agent-split') !== S.slot);
      const sel = m.rail && S.railSel ? m.sessions.find((x) => x.id === S.railSel) : null;
      if (sel) {
        const step = m.list.find((x) => x.id === sel.step_id);
        m.watch = { ...(step || { id: sel.step_id, title: sel.step_id, kind: 'agent', status: 'running' }), session: sel, engine: sel.engine_id };
        m.agent = { session: sel };
        m.diff = sessionDiff(sel.id);
      }
    }
    if (S.cur === 'agent-split' && m.watch && S.focused !== m.watch.session.id) {
      S.focused = m.watch.session.id;
      void ctx.promote(m.watch.session.id);
    }
    const head = `<header class="rs-head">
      <span class="crumb"><button class="lnk0" data-rs="wall" title="Back to the wall (Esc)">Wall</button><span>/</span><span class="here">${esc(m.title)}</span><span>/</span><span class="rid" title="${esc(m.run.id)}">#${m.num}</span></span>
      <span class="chip needs ${m.waiting ? 'on' : ''}"><span class="n">${m.waiting}</span>need you</span>
      <span class="sp"></span>
      ${ctx.cancelButton(m.run)}
      <span class="lsw" role="toolbar" aria-label="Layout">${five.map((k, i) => { const on = S.manual && S.slot != null ? i === S.slot : k === S.cur && five.indexOf(k) === i; return `<button data-rs="layout" data-l="${k}" data-slot="${i}" class="${on ? `on${S.manual ? ' hand' : ''}` : ''}" title="${i + 1}  ${k === 'agent-split' && five.indexOf(k) !== i ? 'Agent split, worktree rail' : NAME[k]}" aria-pressed="${on}">${ICON[k] || REVIEW_ICON[k] || ""}</button>`; }).join('')}<button class="auto ${S.manual ? '' : 'on'}" data-rs="auto" title="${S.manual ? 'Manual pick held. Press 0 to follow the run again' : 'Auto: the layout follows the active step'}"><span class="lt"></span>${S.manual ? 'Manual' : 'Auto'}</button></span>
      <span class="chip"><kbd>Esc</kbd> wall</span>
    </header>`;
    const html = `${head}${helperChips(m.detail && m.detail.assists)}${outsideList(m.review)}${formatOnlyList(m.detail && m.detail.formatOnly)}<div class="rsv L-${S.cur}">${L.render(m, helpers, S)}</div>`;
    el.hidden = false;
    placeForSplit();
    if (html === S.html) return;
    const keep = [...el.querySelectorAll('[data-keep]')].map((x) => [x.dataset.keep, x.scrollTop]);
    for (const g of el.querySelectorAll('.rs-ghost')) g.remove();
    el.innerHTML = html;
    S.html = html;
    for (const [k, top] of keep) { const x = el.querySelector(`[data-keep="${k}"]`); if (x) x.scrollTop = top; }
    for (const x of el.querySelectorAll('[data-follow]')) x.scrollTop = x.scrollHeight;
  }

  function onClick(e) {
    if (e.target.closest('[data-action="focus"]')) return close();
    if (e.target.closest('[data-action="variant-pane"]') && !e.target.closest('a, input, label')) return close();
    const b = e.target.closest('[data-rs]');
    if (!b) return;
    const what = b.dataset.rs;
    if (what === 'wall') return close();
    if (what === 'layout') return manual(b.dataset.l, Number(b.dataset.slot));
    if (what === 'rail') { S.railSel = b.dataset.id; S.html = ''; return render(); }
    if (what === 'auto') return auto();
    if (what === 'sel') { S.sel = b.dataset.step; S.html = ''; return render(); }
    if (what === 'tick') { handBack.toggle(S.runId, Number(b.dataset.n)); S.html = ''; return render(); }
    if (what === 'hbcopy') {
      const m = model();
      const list = m && handBack.items(m);
      const pick = list && (b.dataset.n === 'all' ? list : list.filter((x) => x.n === Number(b.dataset.n)));
      if (pick && pick.length) void ctx.api.copyText(pick.map(handBack.plain).join('\n')).then(() => { b.textContent = 'Copied'; });
      return;
    }
    if (what === 'copy') {
      const m = model();
      const x = m && m.review && m.review.items[Number(b.dataset.f)];
      if (x) void ctx.api.copyText(reviewView.comment(x)).then(() => { b.textContent = 'Copied'; });
    }
  }

  function manual(name, slot = null) {
    const m = model();
    S.manual = name;
    S.slot = slot;
    S.pickedEnded = Boolean(m && ended(m.run));
    show(name);
  }
  function auto() {
    S.manual = null;
    S.slot = null;
    const m = model();
    if (m) show(rules.pickLayout(m.run, m.pipe, m.list, null, m.review || m.findings || rules.flagsOf(m.detail)));
  }

  /** Handles the run screen's own keys; returns true when it used the key. */
  function key(e) {
    if (!S.runId || !S.deliberate || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (e.key === 'Escape') { close(); return true; }
    if (e.key === '0') { auto(); return true; }
    const m = /^[1-5]$/.test(e.key) && model();
    if (m) { manual(rules.ruleOf(m.run.pipeline_id).five[Number(e.key) - 1], Number(e.key) - 1); return true; }
    return false;
  }

  const HUNK_FILES = 12;
  const HUNK_LINES = 300;
  const DOT = '<svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="var(--done)" stroke-width="1.4" stroke-dasharray="1.2 2.4"/></svg>';
  const helpers = {
    esc, fmt,
    glyph(s) {
      if (s.kind === 'gate') return '<i class="dmd"></i>';
      if (s.status === 'done') return '<svg width="16" height="16" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" fill="none" stroke="var(--faint)" stroke-dasharray="1 2"/><path d="M4.5 8.2l2.3 2.3L11.5 5.5" fill="none" stroke="var(--body-strong)" stroke-width="1.6"/></svg>';
      if (s.status === 'running') return '<svg class="spin" width="16" height="16" viewBox="0 0 16 16">' + [...Array(8)].map((_, i) => { const a = i / 8 * Math.PI * 2; return `<circle cx="${(8 + 5.6 * Math.cos(a)).toFixed(2)}" cy="${(8 + 5.6 * Math.sin(a)).toFixed(2)}" r="1.25" fill="var(--work)" opacity="${(0.15 + i / 8 * 0.85).toFixed(2)}"/>`; }).join('') + '</svg>';
      if (s.status === 'failed') return '<svg width="16" height="16"><path d="M4 4l8 8M12 4l-8 8" stroke="var(--del)" stroke-width="1.6"/></svg>';
      if (s.status === 'skipped') return '<svg width="16" height="16"><path d="M4 8h8" stroke="var(--done)" stroke-width="1.4" stroke-dasharray="1 2"/></svg>';
      return DOT;
    },
    stamp(s) {
      if (s.status === 'done') return s.kind === 'gate' ? '<span class="st ok">Approved</span>' : '<span class="st">Done</span>';
      if (s.status === 'failed') return '<span class="st no">Failed</span>';
      return s.status === 'skipped' ? '<span class="st">Skipped</span>' : '';
    },
    label: (s) => (s.status === 'waiting' ? 'needs you' : s.status),
    who: (s) => s.engine || s.kind,
    took(s) {
      if (!s.session) return '';
      const end = s.status === 'running' || s.status === 'waiting' ? Date.now() : Date.parse(s.session.state_at);
      return fmt(end - Date.parse(s.session.started_at));
    },
    events: (m, stepId) => m.log.filter((e) => !stepId || e.step === stepId),
    eventLine(e) {
      const time = esc(e.at ? `${String(e.at).slice(11, 19)}  ` : '');
      if (!e.event) return `<span class="ln c-dim">${time}${esc([e.step, e.line ?? e.board ?? ''].filter(Boolean).join('  ·  '))}</span>`;
      const c = /failed/.test(e.event) ? 'fail' : /done|passed|resolved/.test(e.event) ? 'ok' : 'say';
      const tail = [e.step, e.iteration ? `iteration ${e.iteration}` : '', e.why].filter(Boolean).join('  ·  ');
      return `<span class="ln c-${c}">${time}${esc(e.event)}${tail ? `  ·  ${esc(tail)}` : ''}</span>`;
    },
    gateCard(m, s) {
      const g = m.gates.find((x) => x.step_id === s.id);
      if (!g) return '';
      return `<div class="gin"><div class="gs">${esc(g.summary)}</div>
        <div class="gh"><span>guards ${esc(g.guards_step || 'the next step')}</span>${g.action_hash ? `<span>hash ${esc(String(g.action_hash).slice(0, 4))}…${esc(String(g.action_hash).slice(-3))}</span>` : ''}</div>
        <div class="ga">${ctx.gateButtons(g)}</div></div>`;
    },
    files(m) {
      const d = m.diff;
      if (!d) return '<div class="empty">No changes yet.</div>';
      if (d.error) return `<div class="empty">${esc(d.error)}</div>`;
      const sid = m.agent.session.id;
      const rows = [...d.files.map((f, i) => `<div class="dfile"><div class="dfh"><span class="fn">${esc(f.path)}</span><span class="ad">+${f.added ?? '?'}</span><span class="dl">-${f.deleted ?? '?'}</span></div>${i < HUNK_FILES ? helpers.hunk(fileHunk(sid, f.path)) : ''}</div>`),
        ...d.untracked.map((f) => `<div class="dfh"><span class="fn">${esc(f)}</span><span class="ad">new</span></div>`)];
      return rows.length ? rows.join('') : '<div class="empty">No changes on this branch.</div>';
    },
    sums(m) {
      const d = m.diff && !m.diff.error ? m.diff : null;
      return d ? { files: d.files.length + d.untracked.length, add: d.files.reduce((n, f) => n + (f.added || 0), 0), del: d.files.reduce((n, f) => n + (f.deleted || 0), 0) } : null;
    },
    hunk(text) {
      if (!text) return '';
      const lines = text.split('\n').filter((l) => l && !/^(diff --git|index |--- |\+\+\+ |new file mode|deleted file mode)/.test(l));
      const body = lines.slice(0, HUNK_LINES).map((l) => `<span class="ln c-${l[0] === '@' ? 'hunk' : l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : 'say'}">${esc(l)}</span>`).join('');
      return `<div class="tb hk">${body}${lines.length > HUNK_LINES ? `<span class="ln c-dim">${lines.length - HUNK_LINES} more lines in the Diff tab</span>` : ''}</div>`;
    },
    spec(m) {
      const text = m.detail && m.detail.docs.spec ? m.detail.docs.spec.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim() : '';
      return text ? `<div class="md">${panes.markdown(text)}</div>` : '';
    },
    inputs(m) {
      const vals = m.detail ? Object.entries(m.detail.inputs) : [];
      return vals.map(([k, v]) => `<div class="kv"><span class="k">${esc((m.meta.inputs[k] && m.meta.inputs[k].label) || k)}</span><span class="v">${esc(typeof v === 'string' ? v : JSON.stringify(v))}</span></div>`).join('');
    },
    /** Saved shots grouped by round, oldest first: [{round, shots: [{name, label}]}]. */
    rounds(m) {
      const by = {};
      for (const n of (m.detail && m.detail.shots) || []) {
        const x = /^.+-(\d+)-([a-z0-9-]+)\.png$/.exec(n);
        if (x) (by[x[1]] ||= []).push({ name: n, label: x[2] });
      }
      return Object.keys(by).map(Number).sort((a, b) => a - b).map((round) => ({ round, shots: by[round].sort((a, b) => (Number(b.label) || 0) - (Number(a.label) || 0) || a.label.localeCompare(b.label)) }));
    },
    shotRow(m, r) {
      return `<div class="shots">${r.shots.map((x) => {
        const src = shotSrc(m.run.id, x.name);
        const cap = /^\d+$/.test(x.label) ? `${x.label} px` : x.label;
        return `<figure class="shot">${src ? `<img src="${src}" alt="${esc(`round ${r.round}, ${cap}`)}">` : '<div class="empty">Loading.</div>'}<figcaption>${esc(cap)}</figcaption></figure>`;
      }).join('')}</div>`;
    },
    pr: (m) => (m.detail && m.detail.pr ? `<a class="prl" href="${esc(m.detail.pr.url)}" target="_blank" rel="noopener" title="${esc(m.detail.pr.url)}">${m.detail.pr.number != null ? `PR #${m.detail.pr.number}` : 'Pull request'}</a>` : ''),
    open: (s) => `<button class="lnk" data-action="focus" data-id="${esc(s.session.id)}">Open terminal</button>`,
    status(m) {
      const r = m.run;
      return r.status === 'running' && m.waiting ? 'waiting' : r.status === 'paused' ? (r.paused_why === 'gate' ? 'waiting' : 'paused') : r.status;
    },
    sum(m) {
      const st = helpers.status(m);
      const cells = m.list.map((s) => `<i class="${s.status === 'done' ? 'd' : s.status === 'running' ? 'r' : s.status === 'waiting' ? 'w' : s.status === 'failed' ? 'x' : ''}" title="${esc(s.title)}"></i>`).join('');
      const budget = m.meta.budget ? Math.min(100, m.elapsed / 600 / m.meta.budget) : 0;
      return `<section class="sum">
        <div><span class="k">Run</span><span class="v"><span class="rid">${esc(m.run.id.slice(0, 8))}</span><span class="badge ${esc(st)}">${esc(st === 'waiting' ? 'needs you' : st)}</span></span></div>
        <div><span class="k">Pipeline</span><span class="v">${esc(m.title)}<span class="f">${esc(m.meta.lane || '')}</span></span></div>
        <div><span class="k">Elapsed</span><span class="v">${fmt(m.elapsed)}${m.meta.budget ? `<span class="bar" title="of ${m.meta.budget} min budget"><i style="width:${budget.toFixed(1)}%"></i></span><span class="f">${m.meta.budget}m</span>` : ''}</span></div>
        <div><span class="k">Tokens</span><span class="v">${m.tokens ? m.tokens.toLocaleString('en-US') : '-'}</span></div>
        <div><span class="k">Cost</span><span class="v">${m.usd ? `$${m.usd.toFixed(2)}` : '-'}</span></div>
        <div><span class="k">Steps</span><span class="v"><span class="cells">${cells}</span><span class="f">${m.done} of ${m.list.length}</span></span></div>
      </section>`;
    },
    detail(m, s) {
      if (!s) return '<div class="empty">This run has no steps.</div>';
      const evs = helpers.events(m, s.id);
      const log = evs.length ? `<div class="tb">${evs.map(helpers.eventLine).join('')}</div>` : '';
      if (s.status === 'pending' || s.status === 'skipped') {
        return `<div class="empty">${s.status === 'skipped' ? 'Skipped.' : s.kind === 'gate' ? `Stops the run and asks you before ${esc((m.gates.find((g) => g.step_id === s.id) || {}).guards_step || 'the next step')}.` : 'Waits for the step above.'}</div>`;
      }
      if (s.kind === 'gate') {
        const card = s.status === 'waiting' ? helpers.gateCard(m, s) : `<div class="rec"><span class="verdict ${s.status === 'failed' ? 'no' : ''}">${s.status === 'done' ? 'Approved' : esc(s.status)}</span></div>`;
        const before = m.list[m.list.indexOf(s) - 1];
        const what = before && before.role === 'plan' ? (helpers.spec(m) ? `<div class="sec">What you are approving</div>${helpers.spec(m)}` : '')
          : s.status === 'waiting' ? `<div class="sec">Changes</div><div class="files">${helpers.files(m)}</div>` : '';
        return `<div class="dec">${card}</div>${what}${log}`;
      }
      const term = s.session ? `<div class="tb"><span class="ln c-dim">${esc(s.session.engine_id)}  ·  ${esc(s.session.cwd || '')}</span><span class="ln c-say">${esc(s.session.last_line || s.session.last_tool || 'starting')}</span></div><div class="ga0">${helpers.open(s)}</div>` : '';
      const out = s.output ? `<div class="sec">Output</div><div class="tb"><span class="ln c-dim">${esc(s.output)}</span></div>` : '';
      const doc = s.role === 'plan' && helpers.spec(m) ? `<div class="sec">spec.md</div>${helpers.spec(m)}` : '';
      const pr = s.role === 'publish' && helpers.pr(m) ? `<div class="sec">Pull request</div><div class="ga0">${helpers.pr(m)}</div>` : '';
      return term + doc + pr + out + (log || (term || doc ? '' : '<div class="empty">No log lines yet.</div>'));
    },
  };

  return { init, open, close, isOpen, render, key, layout: () => S.cur };
})();
