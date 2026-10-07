// Before / after: each round of the looping or fixing step on the left, what the work changed on the right.
runLayouts['before-after'] = {
  render(m, h) {
    const s = m.list.find((x) => x.def && x.def.loop) || m.list.find((x) => x.role === 'visual-check' || x.role === 'verify') || m.list[0];
    const rounds = h.events(m, s && s.id).filter((e) => e.event);
    const gaveUp = m.run.paused_why === 'loop-max';
    const notes = rounds.length ? `<div class="tb">${rounds.map(h.eventLine).join('')}</div>` : '<div class="empty">No rounds yet.</div>';
    const gate = m.list.find((x) => x.kind === 'gate' && x.status === 'waiting');
    return `<aside class="notes${gaveUp ? ' halo' : ''}" data-keep="ba-notes">${gaveUp ? '<span class="edge"></span>' : ''}
        <div class="sec">${h.esc(s ? s.title : 'Rounds')}${gaveUp ? ' gave up after its last round' : ''}</div>${notes}${s ? h.detail(m, s) : ''}</aside>
      <main class="after" data-keep="ba-after">
        ${gate ? `<section class="gatebox halo"><span class="edge"></span><div class="sec">${h.esc(gate.title)}</div>${h.gateCard(m, gate)}</section>` : ''}
        <div class="sec">What changed</div><div class="files">${m.agent ? h.files(m) : '<div class="empty">No changes yet.</div>'}</div>
      </main>`;
  },
};
