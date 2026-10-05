// Bucket board: one column per bucket, Disagree first.
runLayouts.buckets = {
  render(m, h) {
    const r = m.review;
    if (!r) return reviewView.waiting(m, h);
    const cols = reviewStore.BUCKETS.map((b) => {
      const mine = r.items.map((x, i) => [x, i]).filter(([x]) => x.bucket === b);
      return `<section class="bcol${b === 'disagree' && mine.length ? ' hot halo' : ''}">${b === 'disagree' && mine.length ? '<span class="edge"></span>' : ''}<div class="bch"><span class="nm">${reviewView.LABEL[b]}</span><span class="n">${mine.length}</span></div>
        <div class="bcb" data-keep="bk-${b}">${mine.map(([x, i]) => reviewView.card(x, i, { bucket: false })).join('') || '<div class="empty">None.</div>'}</div></section>`;
    }).join('');
    return `<div class="bhead">${reviewView.verdicts(r)}</div><main class="bcols">${cols}</main>`;
  },
};
