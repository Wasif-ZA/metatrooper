/* The Needs you screen: every agent question, waiting approval and alert in one list, across projects. */
globalThis.inboxView = (() => {
  const FILTERS = [['all', 'All'], ['needs', 'Needs you'], ['done', 'Finished'], ['failed', 'Failed']];
  let filter = 'all';
  const el = () => document.getElementById('needsview');
  const shown = () => ui.view === 'inbox';

  function draw() {
    el().hidden = !shown();
    if (!shown()) return;
    const s = ui.snap;
    const away = (pid) => (pid === ui.projectId ? '' : `${(s.projects.find((p) => p.id === pid) || {}).name || 'other project'} · `);
    const asks = filter === 'all' || filter === 'needs' ? waitingAll() : [];
    const approvals = filter === 'all' || filter === 'needs' ? s.approvals || [] : [];
    const notes = s.needs_you.filter((n) => (filter === 'all' ? true : filter === 'needs' ? !isInfo(n) : n.kind === filter));
    const count = { all: waitingAll().length + (s.approvals || []).length + s.needs_you.length, needs: needsCount(), done: s.needs_you.filter((n) => n.kind === 'done').length, failed: s.needs_you.filter((n) => n.kind === 'failed').length };

    const askRows = asks.map((x) => `<div class="irow" data-action="pick" data-id="${esc(x.id)}" role="button" tabindex="0"><span class="hdot wait"></span><div class="ht"><b>${esc(taskOf(x))}</b><span>${esc(away(x.project_id))}${esc(x.engine_id)} is asking${x.last_line ? ` · ${esc(x.last_line)}` : ''}</span></div><button class="btn acc" data-action="pick" data-id="${esc(x.id)}">Answer</button></div>`).join('');
    const noteRows = notes.map((n) => `<div class="irow${n.read_at ? ' read' : ''}" data-action="inbox-open" data-id="${esc(n.id)}" role="button" tabindex="0"><span class="hdot${n.kind === 'failed' ? ' bad' : n.read_at || isInfo(n) ? '' : ' wait'}"></span><div class="ht"><b>${esc(n.text)}</b><span>${esc(n.kind)}</span></div><span class="hwhen" data-ago="${esc(n.at)}">${esc(ago(n.at))}</span>${loopOf(n) ? [['pause', 'Pause'], ['try-another-way', 'Try another way'], ['not-a-loop', 'Not a loop']].map(([c, label]) => `<button class="btn" data-action="loop-choose" data-id="${esc(loopOf(n))}" data-choice="${c}">${label}</button>`).join('') : ''}${lendOf(n) ? `<button class="btn acc" data-action="lend-set" data-project="${esc(lendOf(n).project)}" data-origin="${esc(lendOf(n).origin)}">Lend this site</button><button class="btn" data-action="dismiss" data-id="${esc(n.id)}">No</button>` : ''}<button class="link" data-action="${n.read_at ? 'inbox-unread' : 'inbox-read'}" data-id="${esc(n.id)}">${n.read_at ? 'Mark unread' : 'Mark read'}</button></div>`).join('');

    setHtml('needsview', `<div class="hcol">
      <header class="hhead"><div><h1>Needs you</h1><p>${count.needs ? `${count.needs} waiting on you` : 'Nothing is waiting on you'}</p></div></header>
      <div class="ifilters" role="group" aria-label="Filter">${FILTERS.map(([id, label]) => `<button data-filter="${id}" aria-pressed="${id === filter}">${label}<i>${count[id]}</i></button>`).join('')}</div>
      ${approvals.length ? `<h2>Agent actions waiting for a yes</h2><div class="igates">${approvals.map(approvalCard).join('')}</div>` : ''}
      ${askRows || noteRows ? `<div class="hrows">${askRows}${noteRows}</div>` : approvals.length ? '' : '<p class="hempty">Nothing here.</p>'}
    </div>`);
  }

  document.addEventListener('DOMContentLoaded', () => {
    el().addEventListener('click', (e) => {
      const f = e.target.closest('[data-filter]');
      if (f) { filter = f.dataset.filter; draw(); return; }
      const a = e.target.closest('[data-action]');
      if (a && (a.dataset.action === 'pick' || a.dataset.action === 'inbox-open')) homeView.set('wall');
    });
    el().addEventListener('keydown', (e) => {
      if ((e.key !== 'j' && e.key !== 'k') || e.ctrlKey || e.altKey || e.metaKey || e.target.closest('input, textarea, select')) return;
      const rows = [...el().querySelectorAll('.irow')];
      const next = rows[rows.indexOf(document.activeElement) + (e.key === 'j' ? 1 : -1)] || rows[e.key === 'j' ? 0 : rows.length - 1];
      if (next) { e.preventDefault(); next.focus(); }
    });
  });

  return { draw, shown };
})();
