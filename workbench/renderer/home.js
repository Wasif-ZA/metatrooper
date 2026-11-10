/* The Home screen: what is happening and what needs you, from the same snapshot the wall draws. */
globalThis.homeView = (() => {
  const el = () => document.getElementById('home');
  const shown = () => ui.view === 'home' && Boolean(project());

  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  }

  function tile(label, n, sub, hot) {
    return `<div class="htile${hot ? ' hot' : ''}"><span>${esc(label)}</span><b>${n}</b><i>${esc(sub)}</i></div>`;
  }

  function draw() {
    el().hidden = !shown();
    document.querySelectorAll('.vseg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === (ui.view || 'wall'))));
    if (!shown()) return;
    const s = ui.snap;
    const mine = s.sessions.filter((x) => x.state !== 'exited' && !ui.pendingHide.has(x.id)).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
    const waiting = waitingAll();
    const working = mine.filter((x) => x.state === 'working' || x.state === 'starting');
    const done = mine.filter((x) => x.state === 'done');
    const files = mine.reduce((n, x) => n + changedFiles(x.id).length, 0);
    const alerts = s.needs_you.filter((n) => !n.read_at && !INFO_KINDS.includes(n.kind));
    const recent = s.needs_you.filter((n) => n.kind === 'done' || n.kind === 'failed').slice(0, 6);
    const name = (x) => (x.project_id === ui.projectId ? '' : `${(s.projects.find((p) => p.id === x.project_id) || {}).name || 'other project'} · `);
    const ready = s.engines.filter((e) => e.light !== 'red');
    const needs = waiting.length + (s.approvals || []).length + alerts.length;

    const asks = waiting.map((x) => `<div class="hrow" data-action="pick" data-id="${esc(x.id)}" role="button" tabindex="0"><span class="hdot wait"></span><div class="ht"><b>${esc(taskOf(x))}</b><span>${esc(name(x))}${esc(x.engine_id)}${x.last_line ? ` · ${esc(x.last_line)}` : ''}</span></div><span class="hpill wait">Needs you</span><button class="btn acc" data-action="pick" data-id="${esc(x.id)}">Answer</button></div>`).join('')
      + ((s.approvals || []).length ? `<div class="hrow" data-action="sheet" role="button" tabindex="0"><span class="hdot wait"></span><div class="ht"><b>${s.approvals.length} agent ${s.approvals.length === 1 ? 'action waits' : 'actions wait'} for a yes</b><span>Allow or refuse each one</span></div><button class="btn acc" data-action="sheet">Review</button></div>` : '')
      + alerts.map((n) => `<div class="hrow" data-action="inbox-open" data-id="${esc(n.id)}" role="button" tabindex="0"><span class="hdot wait"></span><div class="ht"><b>${esc(n.text)}</b><span>${esc(n.kind)} · <span data-ago="${esc(n.at)}">${esc(ago(n.at))}</span></span></div><button class="btn" data-action="inbox-open" data-id="${esc(n.id)}">Open</button></div>`).join('');

    const cards = mine.map((x) => `<div class="hcard" data-action="pick" data-id="${esc(x.id)}" role="button" tabindex="0">
      <header><span class="hdot ${x.state === 'waiting_for_you' ? 'wait' : x.state === 'working' || x.state === 'starting' ? 'work' : ''}"></span><b>${esc(x.engine_id)}</b><span class="hstate">${esc(STATE_WORDS[x.state] || x.state)}</span></header>
      <p>${esc(taskOf(x))}</p>
      <footer><span>${esc(x.last_line || '')}</span>${changedFiles(x.id).length ? `<i>${changedFiles(x.id).length} files</i>` : ''}</footer></div>`).join('');

    setHtml('home', `<div class="hcol">
      <header class="hhead"><div><h1>${greeting()}</h1><p>${mine.length ? `${mine.length} ${mine.length === 1 ? 'agent' : 'agents'} in ${esc(project().name)}` : `No agents running in ${esc(project().name)}`}</p></div></header>
      ${ready.length ? `<div class="hcomp"><textarea rows="2" data-key="home-task" placeholder="What should an agent do? Leave it empty to just open one." aria-label="Task for a new agent"></textarea>
        <div class="hcf"><select data-key="home-engine" aria-label="Agent">${ready.map((e) => `<option value="${esc(e.id)}"${e.id === (load('engine') || ready[0].id) ? ' selected' : ''}>${esc(e.id)}</option>`).join('')}</select><button class="btn acc" data-home-start>Start</button></div></div>` : ''}
      <div class="htiles">${tile('Needs you', needs, needs ? 'waiting on an answer' : 'nothing waiting', needs > 0)}${tile('Working', working.length, working.length ? 'running now' : 'none running', false)}${tile('Finished', done.length, done.length ? 'ready to review' : 'nothing to review', false)}${tile('Changed files', files, files ? 'not handed back yet' : 'no changes', false)}</div>
      ${asks ? `<h2>Waiting on you</h2><div class="hrows">${asks}</div>` : ''}
      <h2>Agents</h2>${cards ? `<div class="hcards">${cards}</div>` : '<p class="hempty">Start one with the box above.</p>'}
      ${recent.length ? `<h2>Recent</h2><div class="hrows">${recent.map((n) => `<div class="hrow" data-action="inbox-open" data-id="${esc(n.id)}" role="button" tabindex="0"><span class="hdot${n.kind === 'failed' ? ' bad' : ''}"></span><div class="ht"><b>${esc(n.text)}</b></div><span class="hwhen" data-ago="${esc(n.at)}">${esc(ago(n.at))}</span></div>`).join('')}</div>` : ''}
    </div>`);
  }

  function set(view) {
    ui.view = view;
    save('view', view);
    if (view !== 'wall') document.activeElement?.blur?.();
    render();
  }

  document.addEventListener('DOMContentLoaded', () => {
    el().addEventListener('click', async (e) => {
      if (!e.target.closest('[data-home-start]')) return;
      const task = el().querySelector('[data-key="home-task"]').value.trim();
      const engine = el().querySelector('[data-key="home-engine"]').value;
      const r = await rpc('session.launch', { project_id: ui.projectId, engine_id: engine, ...(task ? { prompt: task } : {}) });
      if (!r.result) return;
      delete ui.drafts['home-task'];
      save('engine', engine);
      set('wall');
      await pick(r.result.session_id);
    });
    el().addEventListener('click', (e) => { if (e.target.closest('[data-action="pick"], [data-action="launch"], [data-action="sheet"]')) set('wall'); });
  });

  return { draw, set, shown };
})();
