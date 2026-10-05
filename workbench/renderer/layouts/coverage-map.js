// Coverage map: one row per changed file, a strip per engine marking where its findings landed.
runLayouts['coverage-map'] = {
  render(m, h) {
    const r = m.review;
    if (!r) return reviewView.waiting(m, h);
    const diff = reviewStore.parseDiff(m.detail && m.detail.docs && m.detail.docs.diff);
    const names = [...new Set([...diff.map((f) => f.file), ...r.items.map((x) => x.file)])];
    const strip = (name, who) => {
      const d = diff.find((f) => f.file === name);
      const nums = d ? d.lines.filter((l) => l.n != null).map((l) => l.n) : [];
      const lo = nums.length ? Math.min(...nums) : 1;
      const hi = Math.max(nums.length ? Math.max(...nums) : 1, ...r.items.filter((x) => x.file === name && x.to != null).map((x) => x.to));
      const marks = r.items.map((x, i) => [x, i]).filter(([x]) => x.file === name && x[who] != null).map(([x, i]) => {
        const at = x.from == null ? 0 : (x.from - lo) / Math.max(1, hi - lo);
        const w = x.from == null || x.to == null ? 0.02 : Math.max(0.02, (x.to - x.from + 1) / Math.max(1, hi - lo + 1));
        return `<i class="mk${reviewView.hot(x) ? ' hot' : ''}" style="left:${(Math.max(0, Math.min(0.98, at)) * 100).toFixed(1)}%;width:${(w * 100).toFixed(1)}%" title="${reviewView.esc(`${x.sev}: ${x.title}`)}"></i>`;
      }).join('');
      return `<span class="strip ${who === 'codex' ? 'cx' : 'gm'}">${marks}</span>`;
    };
    const rows = names.map((name) => {
      const n = (who) => r.items.filter((x) => x.file === name && x[who] != null).length;
      const hot = r.items.some((x) => x.file === name && reviewView.hot(x));
      return `<div class="crow${hot ? ' halo' : ''}">${hot ? '<span class="edge"></span>' : ''}<span class="fn">${reviewView.esc(name)}</span><span class="who cx">Codex ${n('codex')}</span>${strip(name, 'codex')}<span class="who gm">Gemini ${n('gemini')}</span>${strip(name, 'gemini')}</div>`;
    }).join('');
    return `<div class="chead">${reviewView.verdicts(r)}<span class="note">Marks show where each engine reported a finding. Which lines each engine read is not recorded.</span></div><main class="crows" data-keep="coverage">${rows || '<div class="empty">No changed files or findings.</div>'}</main>`;
  },
};
