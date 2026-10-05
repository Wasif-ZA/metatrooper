// Run log: the step list on the left, the picked step's log and gate on the right.
runLayouts['run-log'] = {
  render(m, h, S) {
    const pick = m.list.find((s) => s.id === S.sel) || window.layoutRules.activeStep(m.list).step;
    const rows = m.list.map((s) => `<div class="row k-${h.esc(s.kind)} s-${h.esc(s.status)}${pick && pick.id === s.id ? ' sel' : ''}" data-rs="sel" data-step="${h.esc(s.id)}" role="button" tabindex="0">
      <div class="rl"><span class="gl">${h.glyph(s)}</span><span class="mn"><div class="t">${h.esc(s.title)}</div><div class="m"><span class="eng">${h.esc(h.who(s))}</span>${h.esc(s.status === 'failed' && s.fails ? `${s.fails} fail${s.fails === 1 ? '' : 's'}` : s.role || s.uses)}</div></span>
        <span class="rd"><span class="dur">${h.took(s)}</span><span class="sw">${h.stamp(s)}</span></span></div>
      ${s.status === 'waiting' ? h.gateCard(m, s) : ''}</div>`).join('');
    const head = pick ? `<div class="rh"><span class="gl">${h.glyph(pick)}</span><span class="tt">${h.esc(pick.title)}</span><span class="eng">${h.esc(h.who(pick))}</span><span class="badge ${h.esc(pick.status)}">${h.esc(h.label(pick))}</span><span class="took">${h.took(pick)}</span></div>` : '';
    return `${h.sum(m)}
      <aside class="steps"><div class="sh"><h2>Steps</h2><span class="n">${m.done} of ${m.list.length} done</span></div><div class="list" data-keep="rl-list">${rows}</div></aside>
      <section class="rlog${pick && pick.status === 'waiting' ? ' wait' : ''}">${head}<div class="rb" data-keep="rl-log">${h.detail(m, pick)}</div></section>`;
  },
};
