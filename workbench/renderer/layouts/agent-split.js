// Agent split: the working agent's live terminal stays in the wall's big slot; this half shows what it is making.
runLayouts['agent-split'] = {
  render(m, h) {
    const w = m.watch;
    const prog = m.list.map((s) => `<span class="seg s-${h.esc(s.status)}" title="${h.esc(`${s.title}: ${h.label(s)}`)}"><i></i></span>`).join('');
    const gate = m.list.find((s) => s.kind === 'gate' && s.status === 'waiting');
    const sums = h.sums(m);
    return `<nav class="prog">${prog}</nav>
      <section class="who">${w ? `<span class="gl">${h.glyph(w)}</span><span class="tt">${h.esc(w.title)}</span><span class="eng">${h.esc(h.who(w))}</span><span class="took">${h.took(w)}</span><span class="sp"></span><span class="hint">live terminal on the left</span>` : '<span class="hint">No agent is working on this run yet.</span>'}</section>
      <section class="arts"><div class="sec">Changes${sums ? `  ·  ${sums.files} files  +${sums.add} -${sums.del}` : ''}</div><div class="files" data-keep="as-files">${h.files(m)}</div>
        <div class="sec">Run log</div><div class="tb" data-keep="as-log" data-follow>${m.log.map(h.eventLine).join('') || '<span class="ln c-dim">No log lines yet.</span>'}</div></section>
      ${gate ? `<section class="drawer">${h.gateCard(m, gate)}</section>` : ''}
      <footer class="foot"><span>elapsed <b>${h.fmt(m.elapsed)}</b></span><span><b>${m.tokens ? m.tokens.toLocaleString('en-US') : '-'}</b> tok</span><span><b>${m.usd ? `$${m.usd.toFixed(2)}` : '-'}</b></span><span>${m.done} of ${m.list.length} steps</span></footer>`;
  },
};
