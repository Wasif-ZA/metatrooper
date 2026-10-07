// Hand-back: the numbered list the handback step wrote, each item ticked off by hand; ticks are kept per run in localStorage.
const handBack = (() => {
  const key = (runId) => `metatrooper.handback.${runId}`;
  function ticks(runId) {
    try { return new Set(JSON.parse(localStorage.getItem(key(runId)) || '[]')); } catch { return new Set(); }
  }
  function toggle(runId, n) {
    const t = ticks(runId);
    if (t.has(n)) t.delete(n); else t.add(n);
    try { localStorage.setItem(key(runId), JSON.stringify([...t])); } catch {}
  }
  const items = (m) => (m.detail && m.detail.outputs.handback && Array.isArray(m.detail.outputs.handback.items) ? m.detail.outputs.handback.items : null);
  const plain = (x) => `${x.n}. [${x.kind}] ${String(x.text).replace(/\*\*/g, '')}`;
  return { ticks, toggle, items, plain };
})();

runLayouts['hand-back'] = {
  render(m, h) {
    const list = handBack.items(m);
    if (!list) {
      const live = window.layoutRules.activeStep(m.list).step;
      return `<main class="hb"><div class="hbh"><h1>Hand-back</h1><span class="sub">${h.esc(live ? `${live.id} is ${h.label(live)}` : 'not started')}</span></div>
        <div class="empty">The hand-back is written when the run reaches its last step.</div></main><aside class="side">${h.sum(m)}</aside>`;
    }
    const done = handBack.ticks(m.run.id);
    const left = list.filter((x) => !done.has(x.n)).length;
    const rows = list.map((x) => {
      const on = done.has(x.n);
      return `<li class="hbi k-${h.esc(x.kind)}${on ? ' ticked' : ' halo'}">${on ? '' : '<span class="edge"></span>'}
        <button class="tick" data-rs="tick" data-n="${x.n}" aria-pressed="${on}" title="${on ? 'Mark as not done' : 'Mark as done'}">${on ? '&#10003;' : ''}</button>
        <span class="no">${x.n}</span><span class="kind">${h.esc(x.kind)}</span><span class="tx">${h.esc(String(x.text).replace(/\*\*/g, ''))}</span>
        <button class="lnk" data-rs="hbcopy" data-n="${x.n}">Copy</button></li>`;
    }).join('');
    return `<main class="hb"><div class="hbh"><h1>Hand-back</h1><span class="sub">${left ? `${left} of ${list.length} item${list.length === 1 ? '' : 's'} wait for you` : 'every item is ticked off'}</span><span class="sp"></span><button class="lnk" data-rs="hbcopy" data-n="all">Copy all</button></div>
      <ol class="hbl" data-keep="hb-list">${rows}</ol></main><aside class="side">${h.sum(m)}</aside>`;
  },
};
