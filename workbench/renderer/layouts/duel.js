// Duel: both verdicts side by side with equal weight; each finding shows what each engine said.
runLayouts.duel = {
  render(m, h) {
    const r = m.review;
    if (!r) return reviewView.waiting(m, h);
    const order = ['disagree', 'both', 'codex_only', 'gemini_only'];
    const rows = order.flatMap((b) => r.items.map((x, i) => [x, i]).filter(([x]) => x.bucket === b)).map(([x, i]) => `<div class="drow${reviewView.hot(x) ? ' hot halo' : ''}">${reviewView.hot(x) ? '<span class="edge"></span>' : ''}
        <div class="dh"><span class="sev s${x.rank}">${reviewView.esc(x.sev)}</span><span class="bk bk-${x.bucket}">${reviewView.LABEL[x.bucket]}</span><span class="wh">${reviewView.esc(reviewView.where(x))}</span><span class="ft">${reviewView.esc(x.title)}</span><span class="sp"></span><button class="lnk" data-rs="copy" data-f="${i}">Copy as comment</button></div>
        <div class="dc">${x.codex != null ? reviewView.esc(x.codex) : '<span class="none">no finding here</span>'}</div>
        <div class="dc">${x.gemini != null ? reviewView.esc(x.gemini) : '<span class="none">no finding here</span>'}</div></div>`).join('');
    return `<section class="duel"><div class="dvh">${reviewView.verdicts(r)}</div><div class="dbody" data-keep="duel">${rows || '<div class="empty">Neither engine reported a finding.</div>'}</div></section>`;
  },
};
