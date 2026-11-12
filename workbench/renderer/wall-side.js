'use strict';

// Wall sidebar: numbered workspaces, then the agents in this one. Glyphs and state colours from herdr (Apache-2.0), src/client/shell.rs status_icon/status_color.
const wallSide = (() => {
  const KIND = { working: 'work', starting: 'work', waiting_for_you: 'block', done: 'done', idle: 'idle', exited: 'idle' };
  const GLYPH = { work: '◐', block: '×', done: '✓', idle: '○', unknown: '·' };
  const WORD = { work: 'working', block: 'blocked', done: 'done', idle: 'idle', unknown: 'unknown' };
  const kindOf = (state) => KIND[state] || 'unknown';
  const RANK = ['block', 'done', 'work', 'idle', 'unknown'];
  const worst = (kinds) => RANK.find((k) => kinds.includes(k)) || 'unknown';

  function draw() {
    const el = document.getElementById('hside');
    if (!el || !ui.snap) return;
    const cur = project();
    const g = projectGroups(ui.snap.projects.filter((p) => p.id !== ui.projectId));
    const list = [...(cur ? [cur] : []), ...g.projects, ...g.worktrees, ...g.scratch];
    const live = ui.snap.live || [];
    const ws = list.map((p, i) => {
      const on = p.id === ui.projectId;
      const kinds = on ? ui.snap.sessions.filter((x) => x.state !== 'exited').map((x) => kindOf(x.state)) : live.filter((x) => x.project_id === p.id).map((x) => kindOf(x.state));
      const k = kinds.length ? worst(kinds) : null;
      const branch = on && ui.git && ui.git.project === p.id ? ui.git.branch : '';
      return `<button class="hws${on ? ' on' : ''}" data-action="project" data-id="${esc(p.id)}" title="${esc(p.path || p.name)}"><span class="hn">${i + 1}</span><span class="hname">${esc(p.name)}</span>${k ? `<span class="hsdot hk-${k}">●</span>` : ''}${branch ? `<span class="hbr">${esc(branch)}</span>` : ''}</button>`;
    }).join('');
    const mine = cur ? ui.snap.sessions.filter((x) => x.state !== 'exited' && !ui.pendingHide.has(x.id)) : [];
    const sel = ui.snap.selected;
    const agents = mine.map((x) => {
      const k = kindOf(x.state);
      return `<button class="hag${x.id === sel ? ' on' : ''}" data-action="pick" data-id="${esc(x.id)}" title="${esc(taskOf(x))}"><span class="hg hk-${k}">${GLYPH[k]}</span><span class="hname">${esc(x.engine_id)}</span><span class="hst">${WORD[k]}</span></button>`;
    }).join('');
    const html = `<div class="hws-list">${ws}</div><button class="hnew" data-action="launch-menu" title="Start an agent or a terminal">new</button><div class="hag-head">agents</div><div class="hag-list">${agents}</div>`;
    if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
  }

  return { draw };
})();
