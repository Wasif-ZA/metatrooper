// The pipe: every step as a node on one line, gates as diamonds; the picked node opens below it.
runLayouts.pipe = {
  render(m, h, S) {
    const pick = m.list.find((s) => s.id === S.sel) || window.layoutRules.activeStep(m.list).step;
    const nodes = m.list.map((s, i) => `${i ? `<span class="wire${s.status !== 'pending' ? ' on' : ''}"></span>` : ''}<button class="node k-${h.esc(s.kind)} s-${h.esc(s.status)}${pick && pick.id === s.id ? ' sel' : ''}${s.status === 'waiting' ? ' halo' : ''}" data-rs="sel" data-step="${h.esc(s.id)}">${s.status === 'waiting' ? '<span class="edge"></span>' : ''}
        <span class="gl">${h.glyph(s)}</span><span class="nm">${h.esc(s.id)}</span><span class="mt">${h.esc(h.label(s))}${h.took(s) ? ` · ${h.took(s)}` : ''}</span></button>`).join('');
    return `<section class="band"><div class="bh"><h1>${h.esc(m.title)}</h1><span class="sub">${m.meta.lane ? `${h.esc(m.meta.lane)} lane` : ''}</span><span class="lg"><i class="dmd"></i>diamonds are gates: the run waits until you approve</span></div>
        <div class="nodes">${nodes}</div></section>
      <section class="stage${pick && pick.status === 'waiting' ? ' wait halo' : ''}">${pick && pick.status === 'waiting' ? '<span class="edge"></span>' : ''}${pick ? `<div class="rh"><span class="gl">${h.glyph(pick)}</span><span class="tt">${h.esc(pick.title)}</span><span class="eng">${h.esc(h.who(pick))}</span><span class="badge ${h.esc(pick.status)}">${h.esc(h.label(pick))}</span></div>` : ''}<div class="rb" data-keep="pp-stage">${h.detail(m, pick)}</div></section>
      <aside class="side">${h.sum(m)}</aside>`;
  },
};
