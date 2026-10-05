// Triage: every finding in one list, most severe first.
runLayouts.triage = {
  render(m, h) {
    const r = m.review;
    if (!r) return reviewView.waiting(m, h);
    const list = r.items.map((x, i) => [x, i]).sort(([a], [b]) => a.rank - b.rank || (b.bucket === 'disagree') - (a.bucket === 'disagree'));
    const counts = reviewStore.SEV.map((s, k) => `<span class="tc s${k}"><b>${r.items.filter((x) => x.rank === k).length}</b> ${s}</span>`).join('');
    return `<div class="thead">${reviewView.verdicts(r)}<span class="tcs">${counts}</span></div>
      <main class="tlist" data-keep="triage">${list.map(([x, i]) => reviewView.card(x, i)).join('') || '<div class="empty">Neither engine reported a finding.</div>'}</main>`;
  },
};
