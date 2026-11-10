/* The IDE screen: project files on the left, open files as tabs, agents beside the tree. Files are read-only here. */
globalThis.ideView = (() => {
  const st = { project: null, dirs: new Map(), open: new Set(['']), tabs: [], active: null, files: new Map() };
  const el = () => document.getElementById('ide');
  const shown = () => ui.view === 'ide' && Boolean(project());
  const FILE = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.1"><path d="M3.5 1.5h4.5l2.5 2.5v8.5h-7z"/><path d="M8 1.5V4h2.5"/></svg>';
  const CHEV = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3.5 2l3 3-3 3"/></svg>';

  async function load(rel) {
    if (st.dirs.has(rel)) return;
    st.dirs.set(rel, (await api.fsList(ui.projectId, rel || '.')) || []);
  }

  function changed() {
    const set = new Set();
    for (const x of ui.snap.sessions) for (const f of changedFiles(x.id)) set.add(String(f.path || f).replace(/\\/g, '/'));
    return set;
  }

  function tree(rel, depth, marks) {
    return (st.dirs.get(rel) || []).map((e) => {
      const path = rel ? `${rel}/${e.name}` : e.name;
      const pad = `style="padding-left:${8 + depth * 14}px"`;
      if (e.dir) return `<button class="trow dir${st.open.has(path) ? ' open' : ''}" data-dir="${esc(path)}" ${pad} aria-expanded="${st.open.has(path)}">${CHEV}<span>${esc(e.name)}</span></button>${st.open.has(path) ? tree(path, depth + 1, marks) : ''}`;
      return `<button class="trow${st.active === path ? ' cur' : ''}" data-file="${esc(path)}" ${pad}>${FILE}<span>${esc(e.name)}</span>${marks.has(path) ? '<i title="Changed by an agent"></i>' : ''}</button>`;
    }).join('');
  }

  function viewer() {
    if (!st.active) return '<p class="iempty">Pick a file on the left.</p>';
    const f = st.files.get(st.active);
    if (!f) return '<p class="iempty">Loading.</p>';
    if (f.error) return `<p class="iempty">${esc(f.error)}</p>`;
    const lines = f.text.split('\n');
    return `<div class="code"><pre class="ln" aria-hidden="true">${lines.map((_, i) => i + 1).join('\n')}</pre><pre class="tx">${esc(f.text)}</pre></div>`;
  }

  function agents() {
    const rows = ui.snap.sessions.filter((x) => x.state !== 'exited' && !ui.pendingHide.has(x.id)).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
    return rows.map((x) => `<button class="arow" data-action="pick" data-id="${esc(x.id)}"><span class="hdot ${x.state === 'waiting_for_you' ? 'wait' : x.state === 'working' || x.state === 'starting' ? 'work' : ''}"></span><span>${esc(taskOf(x))}</span>${x.state === 'waiting_for_you' ? '<b>Needs you</b>' : `<em>${esc(STATE_WORDS[x.state] || x.state)}</em>`}</button>`).join('') || '<p class="iempty small">No agents running.</p>';
  }

  function paint() {
    const marks = changed();
    const p = project();
    el().innerHTML = `<aside class="iside"><div class="ihd"><span>Explorer</span></div><div class="itree" role="tree" aria-label="${esc(p.name)} files"><div class="iroot">${esc(p.name)}</div>${tree('', 0, marks)}</div>
        <div class="ihd"><span>Agents</span></div><div class="iagents" id="ide-agents">${agents()}</div></aside>
      <section class="imain"><div class="itabs" role="tablist">${st.tabs.map((t) => `<span class="itab${t === st.active ? ' on' : ''}" role="tab" aria-selected="${t === st.active}"><button data-tab-file="${esc(t)}" title="${esc(t)}">${esc(t.split('/').pop())}</button><button class="x" data-close="${esc(t)}" aria-label="Close ${esc(t)}">x</button></span>`).join('')}</div>
        ${st.active ? `<div class="icrumb">${esc(st.active.split('/').join(' / '))}<span>Read only</span></div>` : ''}
        <div class="iview">${viewer()}</div></section>`;
  }

  async function openFile(rel) {
    if (!st.tabs.includes(rel)) st.tabs.push(rel);
    st.active = rel;
    paint();
    if (!st.files.has(rel)) { st.files.set(rel, await api.fsRead(ui.projectId, rel)); if (st.active === rel) paint(); }
  }

  async function draw() {
    el().hidden = !shown();
    if (!shown()) return;
    if (st.project !== ui.projectId) {
      Object.assign(st, { project: ui.projectId, dirs: new Map(), open: new Set(['']), tabs: [], active: null, files: new Map() });
      el().innerHTML = '';
      await load('');
      if (st.project === ui.projectId && shown()) paint();
      return;
    }
    const a = document.getElementById('ide-agents');
    if (a) a.innerHTML = agents(); else paint();
  }

  document.addEventListener('DOMContentLoaded', () => {
    el().addEventListener('click', async (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.dir !== undefined) {
        const d = t.dataset.dir;
        if (st.open.has(d)) st.open.delete(d); else { st.open.add(d); await load(d); }
        paint();
      } else if (t.dataset.file !== undefined) await openFile(t.dataset.file);
      else if (t.dataset.tabFile !== undefined) { st.active = t.dataset.tabFile; paint(); }
      else if (t.dataset.close !== undefined) {
        st.tabs = st.tabs.filter((x) => x !== t.dataset.close);
        if (st.active === t.dataset.close) st.active = st.tabs[st.tabs.length - 1] || null;
        paint();
      } else if (t.dataset.action === 'pick') homeView.set('wall');
    });
  });

  return { draw, shown };
})();
