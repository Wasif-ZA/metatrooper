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
        const failed = wt.lines.some((l) => rows[l.id].outcome === 'failed');
        const state = states.includes('waiting_for_you') ? 'wait' : failed ? 'fail' : dotOf(states);
        const settled = states.filter((s) => s === 'exited' || s === 'done').length;
        return { ...wt, branch, state, settled, total: states.length, open: states.length - settled, selected: wt.lines.some((l) => l.id === selected) };
      }).sort((a, b) => Number(b.primary) - Number(a.primary));
      out.push({ project_id: g.project_id, name: g.name, worktrees });
    }
    return out;
  }

  const I = (name, size = 16) => globalThis.ourosIcon?.(name, size) || '';
  const cw = () => globalThis.ccWords;
  const engineText = (id) => esc(cw()?.engineName(id) ?? id ?? '');
  const mark = (id) => `<span class="fthmk">${globalThis.engineMarkSvg ? globalThis.engineMarkSvg(id, 14) : ''}</span>`;
  const engineHtml = (id) => `<span class="feng">${mark(id)}<span class="fengn">${engineText(id)}</span></span>`;
  const statusHtml = (x) => {
    const w = cw();
    const key = w ? w.statusOf(x) : 'running';
    return `<span class="ou-st ou-st-${key}">${esc(w ? w.STATUS_WORD[key] : x.state)}</span>`;
  };

  const selectedId = () => ui.homeSel ?? ui.snap.selected;
  let drawnSel;

  // Thread list: one row per task
  // (title + time, status word + project + branch, engine names), recent settled work on top, Working and Settled shelves below.
  const ACTIVE = new Set(['waiting_for_you', 'working', 'starting', 'unknown']);
  const ago = (iso) => {
    const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
    if (Number.isNaN(s)) return '';
    return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
  };
  const shelf = { working: true, settled: false };
  const openKids = new Set();
  const rowName = (x) => { const title = (x.title || '').trim(); return (title && !/[\\/]/.test(title) ? title : '') || (x.prompt || '').replace(/\s+/g, ' ').trim() || taskOf(x); };

  function threadRows(tree, rows, git = {}, hide = new Set()) {
    const out = [];
    for (const g of tree || []) {
      const ids = g.sessions.filter((id) => rows[id] && !hide.has(id));
      const mine = new Set(ids);
      for (const id of ids) {
        const x = rows[id];
        if (x.parent_id && x.parent_id !== id && mine.has(x.parent_id)) continue;
        const kids = ids.filter((k) => rows[k].parent_id === id && k !== id).map((k) => rows[k]);
        out.push({ x, kids, project_id: g.project_id, project: g.name, branch: git[id]?.branch || null, active: ACTIVE.has(x.state) });
      }
    }
    const at = (t) => Date.parse(t.x.state_at || t.x.started_at || '') || 0;
    out.sort((a, b) => at(b) - at(a));
    const done = out.filter((t) => !t.active);
    const recent = done.filter((t) => Date.now() - at(t) < 86_400_000).slice(0, 5);
    return { working: out.filter((t) => t.active), recent, settled: done.filter((t) => !recent.includes(t)) };
  }

  function kidHtml(k) {
    const name = rowName(k);
    const words = cw()?.statusWord(k) ?? k.state;
    const sel = k.id === selectedId();
    return `<button class="fthkid${sel ? ' sel' : ''}" data-action="home-select" data-id="${esc(k.id)}"${sel ? ' aria-current="true"' : ''} title="${esc(`${name}\n${k.model || k.engine_id} · ${words}`)}" aria-label="${esc(name)}, ${esc(k.model || k.engine_id)}, ${esc(words)}">`
      + `<span class="fth1"><span class="ft">${esc(name)}</span><span class="fthtime">${esc(ago(k.state_at || k.started_at))}</span></span>`
      + `<span class="fth2">${statusHtml(k)}<span class="fthsep">·</span>${engineHtml(k.engine_id)}</span></button>`;
  }

  function threadHtml(t, rows) {
    const { x } = t;
    const name = rowName(x);
    const words = cw()?.statusWord(x) ?? x.state;
    const sel = x.id === selectedId();
    const when = esc(ago(x.state_at || x.started_at));
    const crew = [x, ...t.kids];
    const engines = crew.slice(0, 3).map((k) => mark(k.engine_id)).join('') + (crew.length > 3 ? `<span class="fthmore">+${crew.length - 3}</span>` : '');
    const open = openKids.has(x.id);
    const n = t.kids.length;
    const toggle = n ? `<button class="fthx" data-kids="${esc(x.id)}" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} ${n} sub-agent${n === 1 ? '' : 's'} of ${esc(name)}" title="${n} sub-agent${n === 1 ? '' : 's'}">${I('chevronRight', 14)}</button>` : '';
    const kids = open ? `<div class="fthkids">${t.kids.map((k) => kidHtml(k)).join('')}</div>` : '';
    return `<div class="fthw${n ? ' haskids' : ''}${open ? ' open' : ''}" data-key="s:${esc(x.id)}"><button class="fth${sel ? ' sel' : ''}${x.state === 'exited' ? ' fgone' : ''}" data-action="home-select" data-id="${esc(x.id)}"${sel ? ' aria-current="true"' : ''} title="${esc(`${name}\n${t.project} · ${x.model || x.engine_id} · ${words}`)}" aria-label="${esc(name)}, ${esc(t.project)}, ${esc(words)}">`
      + `<span class="fth1"><span class="ft">${esc(name)}</span><span class="fthtime">${when}</span></span>`
      + `<span class="fth2">${statusHtml(x)}<span class="fthsep">·</span><span class="fthpn" data-proj="${esc(t.project_id)}">${esc(t.project)}</span>${t.branch ? `<span class="fthsep">·</span><span class="fthbr">${esc(t.branch)}</span>` : ''}</span>`
      + `<span class="fth3"><span class="fthmks">${engines}</span></span></button>${toggle}${kids}</div>`;
  }

  function shelfHtml(key, label, list, rows) {
    const open = shelf[key];
    return `<div class="fshelf" data-key="h:${key}"><button class="fshelfh" data-shelf="${key}" aria-expanded="${open}"><span class="fl">${label}</span><span class="fcount">${list.length}</span><span class="fchev">${I('chevronRight', 14)}</span></button>`
      + (open ? list.map((t) => threadHtml(t, rows)).join('') : '') + '</div>';
  }

  function threadsHtml(tree, rows, git, hide) {
    const { working, recent, settled } = threadRows(tree, rows, git, hide);
    if (!working.length && !recent.length && !settled.length) return '<p class="fempty">No agents running</p>';
    const top = view.done ? recent.map((t) => threadHtml(t, rows)).join('') : '';
    return `<div class="fthreads">${top}</div><div class="fshelves">${working.length ? shelfHtml('working', 'Working', working, rows) : ''}${view.done && settled.length ? shelfHtml('settled', 'Settled', settled, rows) : ''}</div>`;
  }

  const gh = { project: null, at: 0, issues: null };
  function drawGithub() {
    const pid = project()?.id ?? null;
    const pill = document.getElementById('frameGhCount');
    const n = gh.project === pid ? gh.issues?.length ?? 0 : 0;
    if (pill) { pill.hidden = !n; pill.textContent = n ? String(n) : ''; }
    const btn = document.getElementById('frameGh');
    if (btn) btn.title = n ? `${n} open issue${n === 1 ? '' : 's'} (read-only list)` : 'Open issues (read-only list)';
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
    p.innerHTML = `<div class="fghhead">Open issues<span class="fe">${list.length}</span></div>${list.length ? list.map((i) => `<div class="fghrow" role="button" tabindex="0" data-url="${esc(i.url)}" title="${esc(i.url)}"><span class="fe">#${esc(i.number)}</span><span class="ft">${esc(i.title)}</span>${i.labels.map((n) => `<span class="fchip">${esc(n)}</span>`).join('')}${i.assignees.length ? `<span class="fe">${esc(i.assignees.join(', '))}</span>` : ''}</div>`).join('') : `<p class="fempty">${gh.issues ? 'No open issues, or gh is not signed in here' : 'Loading issues'}</p>`}`;
    p.addEventListener('click', (e) => { const row = e.target.closest('.fghrow'); if (row) openTermLink(row.dataset.url); });
    p.addEventListener('keydown', (e) => { const row = e.target.closest('.fghrow'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTermLink(row.dataset.url); } });
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
      const top = rows.reduce((a, b) => (pctOf(b) > pctOf(a) ? b : a));
      return `<div class="fuse" title="${esc(rows.map((r) => `${r.window}: ${pctOf(r)}% used, resets in ${whenOf(r) || 'unknown'}`).join('\n'))}"><span class="fmk">${engineHtml(provider)}</span><span class="fbar"><i style="width:${pctOf(top)}%"></i></span><span class="fmeta fslot"><b>${pctOf(top)}%</b> ${esc(whenOf(top))}</span></div>`;
    }).join('');
  }

  function draw() {
    const view_ = globalThis.settingsView?.isOpen() ? 'settings' : ui.view || 'wall';
    const narrow = view_ === 'settings' || view_ === 'ide';
    if (root.dataset) root.dataset.view = view_;
    const nav = document.querySelector?.('.fnav');
    const spacer = document.querySelector?.('header.title .sp');
    if (nav && spacer) {
      // The Wall keeps its view pill in its own sidebar; every other view has the icons in the top bar.
      const wall = view_ === 'wall';
      nav.classList.toggle('tnav', !wall);
      if (wall && nav.parentElement?.id !== 'frame') document.getElementById('frame').insertBefore(nav, document.getElementById('frame-agents'));
      else if (!wall && nav.previousElementSibling !== spacer) spacer.after(nav);
    }
    if (root.classList.contains('side-auto') !== narrow) {
      if (narrow) root.classList.add('side-auto'); else root.classList.remove('side-auto');
      dispatchEvent(new Event('resize'));
    }
    [...document.querySelectorAll('[data-action="view"]'), ...document.querySelectorAll('#frame [data-action="settings"]')].forEach((b) => {
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
      setHtml('frame-agents', threadsHtml(ui.snap.tree, rows, ui.snap.git || {}, ui.pendingHide));
      const core = document.getElementById('frameCore');
      if (core) { core.innerHTML = document.getElementById('core')?.innerHTML || ''; core.title = core.querySelector('[title]')?.title || ''; }
      animateRows(list, before);
      drawnSel = selectedId();
      // Home picks its default selection while rendering, after this draw; catch up once when it changed.
      setTimeout(() => { if (selectedId() !== drawnSel) (typeof render === 'function' ? render : draw)(); }, 60);
      return;
    }
    const mine = project() ? ui.snap.sessions.filter((x) => x.state !== 'exited' && !ui.pendingHide.has(x.id)).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state)) : [];
    const dot = (x) => (x.state === 'waiting_for_you' ? 'wait' : x.state === 'working' || x.state === 'starting' ? 'work' : '');
    setHtml('frame-agents', mine.length ? mine.map((x) => `<button class="fagent" data-action="pick" data-id="${esc(x.id)}" title="${esc(taskOf(x))}" aria-label="${esc(taskOf(x))}, ${esc(x.engine_id)}, ${esc(STATE_WORDS[x.state] || x.state)}"><span class="fdot ${dot(x)}"></span><span class="ftx"><span class="ft">${esc(taskOf(x))}</span><span class="fe">${esc(x.engine_id)}</span></span></button>`).join('') : '<p class="fempty">No agents running</p>');
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

  // From t3code (MIT), apps/web/src/projectIconOptions.ts: the emoji offered for a project.
  const PROJECT_EMOJIS = ['💻', '🛠️', '🚀', '🤖', '✨', '⚡', '🌐', '📱', '🖥️', '⌨️', '⚙️', '🗄️', '☁️', '📦', '📚', '🧪', '🔒', '🎮', '🎵', '🎬', '🖼️', '🛍️', '🔥', '💡'];

  let opener = null;
  /** Closes the row menu and the icon panel; focus goes back to what opened them if it was inside one. */
  function closeIconUi() {
    const open = ['frameIconMenu', 'frameIconPick'].map((id) => document.getElementById(id)).filter(Boolean);
    const back = open.some((el) => el.contains(document.activeElement)) ? opener : null;
    for (const el of open) el.remove();
    back?.focus?.();
  }

  /** Right-click on a sidebar row: a one-item menu at the pointer. */
  function rowMenu(label, x, y, pick) {
    closeIconUi();
    opener = document.activeElement;
    const m = document.createElement('div');
    m.id = 'frameIconMenu';
    m.className = 'ficonmenu';
    m.setAttribute('role', 'menu');
    m.style.left = `${x}px`;
    m.style.top = `${y}px`;
    m.innerHTML = `<button role="menuitem">${label}</button>`;
    m.querySelector('button').addEventListener('click', () => { closeIconUi(); pick(); });
    document.body.appendChild(m);
    m.querySelector('button').focus();
  }

  /** The Change icon panel: a monogram (letters + colour), an emoji, or a line icon with a colour; Reset goes back to the favicon or the plain folder icon. */
  function iconPicker(projectId, x, y) {
    closeIconUi();
    opener = document.activeElement;
    const { PROJECT_COLOURS: colours, PICK_ICONS: names } = globalThis.projectIconChoices || { PROJECT_COLOURS: {}, PICK_ICONS: [] };
    const p = (ui.snap.projects || []).find((q) => q.id === projectId);
    const cur = p?.icon || {};
    const st = {
      tab: cur.kind === 'emoji' ? 'emoji' : cur.kind === 'icon' ? 'icon' : 'monogram',
      text: cur.kind === 'monogram' ? cur.text : String(p?.name || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase(),
      colour: cur.colour || 'blue', emoji: cur.emoji || PROJECT_EMOJIS[0], name: cur.name || names[0],
    };
    const box = document.createElement('div');
    box.id = 'frameIconPick';
    box.className = 'ficonpick';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', `Change icon for ${p?.name || 'project'}`);
    box.style.left = `${Math.max(8, Math.min(x, innerWidth - 300))}px`;
    box.style.top = `${Math.max(8, Math.min(y, innerHeight - 340))}px`;
    const swatches = () => `<div class="fswatches">${Object.entries(colours).map(([k, v]) => `<button class="fswatch${st.colour === k ? ' on' : ''}" data-colour="${k}" title="${k}" aria-label="${k}" style="background:${v}"></button>`).join('')}</div>`;
    const preview = () => (st.tab === 'emoji' ? { kind: 'emoji', emoji: st.emoji } : st.tab === 'icon' ? { kind: 'icon', name: st.name, colour: st.colour } : { kind: 'monogram', text: st.text || '?', colour: st.colour });
    const render = () => {
      const body = st.tab === 'monogram'
        ? `<label class="flabel">Letters <input class="fletters" maxlength="2" value="${esc(st.text)}" aria-label="Letters"></label>${swatches()}`
        : st.tab === 'emoji'
          ? `<div class="fgrid">${PROJECT_EMOJIS.map((e) => `<button class="fcell${st.emoji === e ? ' on' : ''}" data-emoji="${e}" aria-label="${e}">${e}</button>`).join('')}</div>`
          : `<div class="fgrid">${names.map((n) => `<button class="fcell${st.name === n ? ' on' : ''}" data-icon-name="${n}" title="${n}" aria-label="${n}"${st.name === n ? ` style="color:${colours[st.colour]}"` : ''}>${I(n, 16)}</button>`).join('')}</div>${swatches()}`;
      box.innerHTML = `<div class="fghhead"><span>Change icon</span><span class="fprev">${globalThis.projectIconHtml?.(preview(), 20) ?? ''}</span></div>`
        + `<div class="ftabs" role="tablist">${['monogram', 'emoji', 'icon'].map((t) => `<button role="tab" aria-selected="${st.tab === t}" data-tab="${t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div>`
        + `<div class="fpickbody">${body}</div><div class="fpickfoot"><button data-act="reset">Reset</button><span class="sp"></span><button data-act="cancel">Cancel</button><button class="fprimary" data-act="save">Save</button></div>`;
      box.querySelector('.fletters')?.addEventListener('input', (e) => { st.text = e.target.value.toUpperCase(); box.querySelector('.fprev').innerHTML = globalThis.projectIconHtml?.(preview(), 20) ?? ''; });
    };
    const save = async (icon) => {
      box.inert = true;
      const r = await troop.call('project.icon-set', { project_id: projectId, icon }).catch((e) => ({ reply: { error: e } }));
      box.inert = false;
      if (r?.reply?.error) { globalThis.toast?.(r.reply.error.message || 'Could not save the icon', true); return; }
      closeIconUi();
    };
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.tab) st.tab = b.dataset.tab;
      else if (b.dataset.colour) st.colour = b.dataset.colour;
      else if (b.dataset.emoji) st.emoji = b.dataset.emoji;
      else if (b.dataset.iconName) st.name = b.dataset.iconName;
      else if (b.dataset.act === 'cancel') return closeIconUi();
      else if (b.dataset.act === 'reset') return void save(null);
      else if (b.dataset.act === 'save') return void save(preview());
      render();
      box.querySelector(b.dataset.tab ? '[aria-selected="true"]' : b.dataset.colour ? '.fswatch.on' : '.fcell.on')?.focus();
    });
    render();
    document.body.appendChild(box);
    box.querySelector('[aria-selected="true"]').focus();
  }

  function mount() {
    for (const el of document.querySelectorAll?.('[data-icon]') ?? []) el.innerHTML = I(el.dataset.icon, Number(el.dataset.size) || 16);
    const nav = document.querySelector?.('.fnav');
    if (!nav) return;
    nav.classList.add('ficons');
    nav.insertAdjacentHTML('beforeend', `<button data-action="view" data-view="automations" title="Automations" aria-label="Automations"><span class="fi">${I('calendar')}</span><span class="fl">Automations</span></button>`);
    const foot = document.querySelector('#frame .ffoot');
    if (foot) foot.insertAdjacentHTML('beforeend', '<span class="fcore" id="frameCore"></span>');
    const sec = document.querySelector('#frame .fsec');
    if (sec) {
      sec.classList.add('fprojects', 'fsearchrow');
      sec.innerHTML = `<button class="fsearch" data-action="palette" title="Search (Ctrl+K)" aria-label="Search"><span class="fi">${I('search', 16)}</span><span class="fl">Search</span></button><button class="fic" id="frameDone" title="Hide finished agents" aria-label="Hide finished agents" aria-pressed="false">${I('filter', 16)}</button><button class="fic" data-action="open-folder" title="Open folder" aria-label="Open folder">${I('folderAdd', 16)}</button><button class="fic" id="frameGh" title="Tasks: open GitHub issues for this project (read-only)" aria-label="Tasks">${I('pullRequest', 16)}<span class="fpill" id="frameGhCount" hidden></span></button><button class="fic" data-action="launch-menu" title="Start an agent or a terminal" aria-label="New agent">${I('compose', 16) || I('plus', 16)}</button>`;
      document.getElementById('frameGh').addEventListener('click', githubPanel);
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
      const kx = e.target.closest('[data-kids]');
      if (kx) { if (openKids.has(kx.dataset.kids)) openKids.delete(kx.dataset.kids); else openKids.add(kx.dataset.kids); draw(); return; }
      const sh = e.target.closest('[data-shelf]');
      if (sh) { shelf[sh.dataset.shelf] = !shelf[sh.dataset.shelf]; draw(); return; }
      const sel = e.target.closest('[data-action="home-select"]');
      if (sel) { e.stopPropagation(); homeSelect(sel.dataset.id); return; }
      if (e.target.closest('[data-action="pick"]') && ui.view !== 'wall') homeView.set('wall');
    });
    document.getElementById('frame-agents').addEventListener('contextmenu', (e) => {
      const agent = e.target.closest('.fth[data-id], .fthkid[data-id], .fagent[data-id]');
      const x = agent && [...(ui.snap.sessions || []), ...(ui.snap.live || [])].find((s) => s.id === agent.dataset.id);
      if (agent && ccWords.canStop(x)) { e.preventDefault(); rowMenu('Stop agent', e.clientX, e.clientY, () => void stopAgent(x.id)); return; }
      const row = e.target.closest('.fproj, [data-proj]');
      if (!row) return;
      e.preventDefault();
      rowMenu('Change icon…', e.clientX, e.clientY, () => iconPicker(row.dataset.id || row.dataset.proj, e.clientX, e.clientY));
    });
    const closeGh = () => document.getElementById('frameGhPanel')?.remove();
    document.addEventListener('mousedown', (e) => { if (!e.target.closest?.('#frameIconMenu, #frameIconPick')) closeIconUi(); if (!e.target.closest?.('#frameGhPanel, #frameGh')) closeGh(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeIconUi(); closeGh(); } });
    mount();
  });

  return { draw, toggle, treeGroups, homeSelect, iconPicker };
})();
