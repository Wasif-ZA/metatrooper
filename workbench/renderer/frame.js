'use strict';

// The left sidebar: nav, the orchestration tree (project > worktree > agents), Add-ons and Settings.
globalThis.frameView = (() => {
  const root = document.documentElement;
  const rail = () => root.classList.contains('side-rail');
  const view = { done: true };

  function set(narrow) {
    root.classList.toggle('side-rail', narrow);
    const b = document.getElementById('frameTog');
    const words = narrow ? 'Expand sidebar' : 'Collapse sidebar';
    b.title = `${words} (Ctrl+B)`;
    b.setAttribute('aria-label', words);
    b.setAttribute('aria-expanded', String(!narrow));
  }

  function toggle() {
    set(!rail());
    save('sidebar', rail() ? 'rail' : 'wide');
    dispatchEvent(new Event('resize'));
  }

  const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  const base = (p) => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || '';
  const STATE_RANK = { waiting_for_you: 0, working: 1, starting: 2, unknown: 3, idle: 4, done: 5, exited: 6 };
  const rankOf = (x) => STATE_RANK[x.state] ?? 3;
  const dotOf = (states) => (states.includes('waiting_for_you') ? 'wait' : states.some((s) => s === 'working' || s === 'starting') ? 'work' : 'done');
  // From t3code (MIT), apps/web/src/components/Sidebar.motion.ts: 150 ms ease-out row motion, adapted to rows keyed by id across redraws
  const motionTiming = { duration: 150, easing: 'ease-out' };
  const rowTravel = (height) => Math.min(height, 40);
  const MAX_FADED_ROWS_PER_UPDATE = 40;
  const rowsOf = (list) => [...list.querySelectorAll('[data-key]')];
  function rowTops(list) {
    if (!list?.getBoundingClientRect) return null;
    const origin = list.getBoundingClientRect().top;
    return new Map(rowsOf(list).map((n) => [n.dataset.key, n.getBoundingClientRect().top - origin]));
  }
  function animateRows(list, before) {
    if (!before || !list?.getBoundingClientRect || globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const origin = list.getBoundingClientRect().top;
    const rows = rowsOf(list).filter((n) => typeof n.animate === 'function');
    if (rows.filter((n) => !before.has(n.dataset.key)).length > MAX_FADED_ROWS_PER_UPDATE) return;
    for (const n of rows) {
      const box = n.getBoundingClientRect();
      const was = before.get(n.dataset.key);
      if (was === undefined) n.animate([{ opacity: 0, transform: `translateY(${-rowTravel(box.height)}px)` }, { opacity: 1, transform: 'translateY(0px)' }], motionTiming);
      else if (Math.abs(was - (box.top - origin)) > 0.5) n.animate([{ transform: `translateY(${was - (box.top - origin)}px)` }, { transform: 'translateY(0px)' }], motionTiming);
    }
  }

  /**
   * Groups snap.tree into projects > worktrees > agent lines. A root agent's worktree is its git root (else its cwd, else the
   * project folder); a sub-agent (parent_id) sits one level under its parent in the parent's worktree, whatever its own folder.
   */
  function treeGroups(tree, rows, git = {}, projects = [], hide = new Set(), selected = null) {
    const out = [];
    for (const g of tree || []) {
      const ids = g.sessions.filter((id) => rows[id] && !hide.has(id));
      if (!ids.length) continue;
      const mine = new Set(ids);
      const kids = new Map();
      const roots = [];
      for (const id of ids) {
        const p = rows[id].parent_id;
        if (p && p !== id && mine.has(p)) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(id); } else roots.push(id);
      }
      const home = projects.find((p) => p.id === g.project_id)?.path || '';
      const trees = new Map();
      const seen = new Set();
      const walk = (wt, id, depth) => {
        if (seen.has(id)) return;
        seen.add(id);
        wt.lines.push({ id, depth });
        for (const k of (kids.get(id) || []).slice().sort((a, b) => rankOf(rows[a]) - rankOf(rows[b]))) walk(wt, k, depth + 1);
      };
      const ordered = roots.slice().sort((a, b) => rankOf(rows[a]) - rankOf(rows[b]));
      for (const id of [...ordered, ...ids]) {
        if (seen.has(id)) continue;
        const x = rows[id];
        const at = git[id]?.root || x.cwd || home;
        const key = norm(at);
        if (!trees.has(key)) trees.set(key, { key, path: at, title: base(at) || g.name, branch: null, primary: Boolean(home) && key === norm(home), lines: [] });
        walk(trees.get(key), id, 0);
      }
      const worktrees = [...trees.values()].map((wt) => {
        const states = wt.lines.map((l) => rows[l.id].state);
        const branch = wt.lines.map((l) => git[l.id]?.branch).find(Boolean) || null;
        return { ...wt, branch, state: dotOf(states), open: states.filter((s) => s !== 'exited').length, selected: wt.lines.some((l) => l.id === selected) };
      }).sort((a, b) => Number(b.primary) - Number(a.primary));
      out.push({ project_id: g.project_id, name: g.name, worktrees });
    }
    return out;
  }

  const age = (iso) => {
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (Number.isNaN(s)) return '';
    return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
  };
  const rowDot = (x) => (x.state === 'waiting_for_you' ? 'wait' : x.state === 'working' || x.state === 'starting' ? 'work' : x.outcome === 'failed' ? 'fail' : x.state === 'unknown' ? 'idle' : 'done');
  const mark = (id) => (globalThis.engineMarkSvg ? globalThis.engineMarkSvg(id, 14) : `<span class="fmono">${esc(String(id || '').slice(0, 2).toUpperCase())}</span>`);
  const ICON = {
    folder: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z"/></svg>',
    search: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>',
    tasks: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M6 4h7.5M6 8h7.5M6 12h7.5"/><circle cx="3" cy="4" r=".6"/><circle cx="3" cy="8" r=".6"/><circle cx="3" cy="12" r=".6"/></svg>',
    autos: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2.5" y="3" width="11" height="10.5" rx="1.5"/><path d="M2.5 6.5h11M5.5 1.5v3M10.5 1.5v3M8 8.5v2l1.5 1"/></svg>',
    pr: '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="4" cy="3.5" r="1.75"/><circle cx="4" cy="12.5" r="1.75"/><circle cx="12" cy="12.5" r="1.75"/><path d="M4 5.25v5.5M12 10.75V7a2.5 2.5 0 0 0-2.5-2.5H7"/></svg>',
    filter: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2.5 4h11M4.5 8h7M6.5 12h3"/></svg>',
    addFolder: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1zM8 7.5v3.5M6.25 9.25h3.5"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9"/></svg>',
  };

  const STATUS_LABEL = { wait: 'Waiting for you', work: 'Working', fail: 'Failed', done: 'Done', idle: 'Idle' };
  // From t3code (MIT), apps/web/src/components/ThreadStatusIndicators.tsx: a 9px status dot in a 14px slot, pulsing while active
  const statusHtml = (s) => `<span class="fst ${s}" role="img" aria-label="${STATUS_LABEL[s]}"><span></span></span>`;

  function agentHtml(x, depth) {
    const title = (x.title || '').trim();
    const name = (title && !/[\\/]/.test(title) ? title : '') || (x.prompt || '').replace(/\s+/g, ' ').trim() || taskOf(x);
    const words = STATE_WORDS[x.state] || x.state;
    const tip = `${name}\n${x.model ? `${x.model} · ` : ''}${x.engine_id} · ${words}`;
    const sel = x.id === (ui.homeSel ?? ui.snap.selected);
    return `<button class="fagent ftree${x.state === 'exited' ? ' fgone' : ''}${sel ? ' sel' : ''}" data-action="home-select" data-id="${esc(x.id)}" data-key="s:${esc(x.id)}"${sel ? ' aria-current="true"' : ''} style="--depth:${Math.min(depth, 4)}" title="${esc(tip)}" aria-label="${esc(name)}, ${esc(x.model || x.engine_id)}, ${esc(words)}">${statusHtml(rowDot(x))}<span class="fmk">${mark(x.engine_id)}</span><span class="ft">${esc(name)}</span><span class="fmeta">${esc(age(x.started_at))}</span></button>`;
  }

  function treeHtml(groups, rows) {
    if (!groups.length) return '<p class="fempty">No agents running</p>';
    return groups.map((g) => `<button class="fproj" data-action="project" data-id="${esc(g.project_id)}" data-key="p:${esc(g.project_id)}" title="Open ${esc(g.name)}"><span class="fi">${ICON.folder}</span><span class="fl">${esc(g.name)}</span></button>`
      + g.worktrees.map((wt) => `<div class="fwt${wt.selected ? ' sel' : ''}"><div class="fwthead" data-key="w:${esc(wt.key)}" title="${esc(wt.path)}">${statusHtml(wt.state)}<span class="fwtn">${esc(wt.title)}</span>${wt.primary ? '<span class="fchip">primary</span>' : ''}</div>${wt.branch ? `<div class="fwtb">${esc(wt.branch)}</div>` : ''}`
        + wt.lines.filter((l) => view.done || rows[l.id].state !== 'exited').map((l) => agentHtml(rows[l.id], l.depth)).join('') + '</div>').join('')).join('');
  }

  const gh = { project: null, at: 0, issues: null };
  function drawGithub() {
    const pid = project()?.id ?? null;
    const pill = document.getElementById('frameGhCount');
    if (pill) { pill.hidden = !gh.issues?.length || gh.project !== pid; pill.textContent = gh.issues?.length ? String(gh.issues.length) : ''; }
    if (!pid || !globalThis.troop?.call || (gh.project === pid && Date.now() - gh.at < 300_000)) return;
    Object.assign(gh, { project: pid, at: Date.now(), issues: null });
    troop.call('gh.issues', { project_id: pid }).then((r) => {
      if (gh.project !== pid) return;
      gh.issues = Array.isArray(r?.reply?.result) ? r.reply.result : [];
      if (!gh.issues.length) gh.at -= 270_000;
      draw();
    }, () => {});
  }

  function githubPanel() {
    let p = document.getElementById('frameGhPanel');
    if (p) { p.remove(); return; }
    p = document.createElement('div');
    p.id = 'frameGhPanel';
    p.className = 'fghpanel';
    p.setAttribute('role', 'dialog');
    p.setAttribute('aria-label', 'Tasks: open GitHub issues');
    const list = gh.issues || [];
    p.innerHTML = `<div class="fghhead">Open issues<span class="fe">${list.length}</span></div>${list.length ? list.map((i) => `<div class="fghrow" title="${esc(i.url)}"><span class="fe">#${esc(i.number)}</span><span class="ft">${esc(i.title)}</span>${i.labels.map((n) => `<span class="fchip">${esc(n)}</span>`).join('')}${i.assignees.length ? `<span class="fe">${esc(i.assignees.join(', '))}</span>` : ''}</div>`).join('') : `<p class="fempty">${gh.issues ? 'No open issues, or gh is not signed in here' : 'Loading issues'}</p>`}`;
    document.body.appendChild(p);
  }

  function drawUsage() {
    const el = document.getElementById('frameUsage');
    if (!el) return;
    const ORDER = ['5h', 'daily', 'weekly', 'weekly-model'];
    const by = new Map();
    for (const r of ui.snap.limits || []) if (r.status === 'ok' && typeof r.used_pct === 'number') by.set(r.provider, [...(by.get(r.provider) || []), r]);
    el.hidden = !by.size;
    const pctOf = (r) => Math.round(Math.min(100, Math.max(0, r.used_pct)));
    const whenOf = (r) => {
      const left = r.resets_at ? Math.max(0, Date.parse(r.resets_at) - Date.now()) / 60000 : NaN;
      return Number.isNaN(left) ? '' : left >= 1440 ? `${Math.floor(left / 1440)}d ${Math.floor((left % 1440) / 60)}h` : `${Math.floor(left / 60)}h ${Math.floor(left % 60)}m`;
    };
    el.innerHTML = [...by.entries()].map(([provider, list]) => {
      const rows = list.slice().sort((a, b) => ORDER.indexOf(a.window) - ORDER.indexOf(b.window));
      const words = rows.map((r) => `${pctOf(r)}% ${whenOf(r)}`.trim()).join(' · ');
      return `<div class="fuse" title="${esc(rows.map((r) => `${r.window}: ${pctOf(r)}% used, resets in ${whenOf(r) || 'unknown'}`).join('\n'))}"><span class="fmk">${mark(provider)}</span><span class="fbar"><i style="width:${pctOf(rows[0])}%"></i></span><span class="fmeta">${esc(words)}</span></div>`;
    }).join('');
  }

  function draw() {
    const view_ = globalThis.settingsView?.isOpen() ? 'settings' : ui.view || 'wall';
    const narrow = view_ === 'settings' || view_ === 'ide';
    if (root.classList.contains('side-auto') !== narrow) {
      if (narrow) root.classList.add('side-auto'); else root.classList.remove('side-auto');
      dispatchEvent(new Event('resize'));
    }
    [...document.querySelectorAll('#frame [data-action="view"]'), ...document.querySelectorAll('#frame [data-action="settings"]')].forEach((b) => {
      if ((b.dataset.view || 'settings') === view_) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    const nw = document.querySelector?.('#frame .fnew');
    if (nw) nw.hidden = !project();
    const n = needsCount();
    const pill = document.getElementById('frameNeeds');
    pill.hidden = !n;
    pill.textContent = n ? String(n) : '';
    drawGithub();
    drawUsage();
    if (ui.snap.tree) {
      const rows = ui.snap.tree_rows || {};
      const list = document.getElementById('frame-agents');
      const before = rowTops(list);
      setHtml('frame-agents', treeHtml(treeGroups(ui.snap.tree, rows, ui.snap.git || {}, ui.snap.projects || [], ui.pendingHide, ui.snap.selected), rows));
      animateRows(list, before);
      return;
    }
    const mine = project() ? ui.snap.sessions.filter((x) => x.state !== 'exited' && !ui.pendingHide.has(x.id)).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)) : [];
    const mono = (x) => esc(String(x.engine_id || '').slice(0, 2).toUpperCase());
    const dot = (x) => (x.state === 'waiting_for_you' ? 'wait' : x.state === 'working' || x.state === 'starting' ? 'work' : '');
    setHtml('frame-agents', mine.length ? mine.map((x) => `<button class="fagent" data-action="pick" data-id="${esc(x.id)}" data-mono="${mono(x)}" title="${esc(taskOf(x))}" aria-label="${esc(taskOf(x))}, ${esc(x.engine_id)}, ${esc(STATE_WORDS[x.state] || x.state)}"><span class="fdot ${dot(x)}"></span><span class="ftx"><span class="ft">${esc(taskOf(x))}</span><span class="fe">${esc(x.engine_id)}</span></span></button>`).join('') : '<p class="fempty">No agents running</p>');
  }

  /** Selects an agent for Home: `ui.homeSel` plus a `home-select` event ({detail: {id}}), switching project first when the agent is elsewhere. */
  function homeSelect(id) {
    const row = ui.snap.tree_rows?.[id];
    if (row && row.project_id !== project()?.id && typeof switchProject === 'function') switchProject(row.project_id);
    ui.homeSel = id;
    globalThis.dispatchEvent?.(new CustomEvent('home-select', { detail: { id } }));
    homeView.set('home');
    draw();
  }

  /** One compact icon row (views, Automations, Search, Tasks), the Projects header and the usage meters, added to the static sidebar markup once. */
  function mount() {
    const nav = document.querySelector?.('#frame .fnav');
    if (!nav) return;
    nav.classList.add('ficons');
    nav.insertAdjacentHTML('beforeend', `<button data-action="view" data-view="automations" title="Automations" aria-label="Automations"><span class="fi">${ICON.autos}</span><span class="fl">Automations</span></button>`
      + `<button data-action="palette" title="Search (Ctrl+K)" aria-label="Search"><span class="fi">${ICON.search}</span><span class="fl">Search</span></button>`
      + `<button id="frameGh" title="Tasks: open GitHub issues for this project (read-only)" aria-label="Tasks"><span class="fi">${ICON.pr}</span><span class="fl">Tasks</span><span class="fpill fghn" id="frameGhCount" hidden></span></button>`);
    document.getElementById('frameGh').addEventListener('click', githubPanel);
    const sec = document.querySelector('#frame .fsec');
    if (sec) {
      sec.classList.add('fprojects');
      sec.innerHTML = `<span class="fl">Projects</span><button class="fic" id="frameDone" title="Hide finished agents" aria-label="Hide finished agents" aria-pressed="false">${ICON.filter}</button><button class="fic" data-action="open-folder" title="Open folder" aria-label="Open folder">${ICON.addFolder}</button><button class="fic" data-action="launch-menu" title="Start an agent or a terminal" aria-label="New agent">${ICON.plus}</button>`;
      document.getElementById('frameDone').addEventListener('click', (e) => {
        view.done = !view.done;
        e.currentTarget.setAttribute('aria-pressed', String(!view.done));
        draw();
      });
    }
    document.getElementById('frame-agents').insertAdjacentHTML('afterend', '<div class="fusage" id="frameUsage" hidden></div>');
  }

  document.addEventListener('DOMContentLoaded', () => {
    set(load('sidebar') === 'rail');
    document.getElementById('frameTog').addEventListener('click', toggle);
    document.getElementById('frame-agents').addEventListener('click', (e) => {
      const sel = e.target.closest('[data-action="home-select"]');
      if (sel) { e.stopPropagation(); homeSelect(sel.dataset.id); return; }
      if (e.target.closest('[data-action="pick"]') && ui.view !== 'wall') homeView.set('wall');
    });
    mount();
  });

  return { draw, toggle, treeGroups, homeSelect };
})();
