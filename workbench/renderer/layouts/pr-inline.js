// PR inline: findings pinned under the lines they are about, file by file.
runLayouts['pr-inline'] = {
  render(m, h) {
    const r = m.review;
    if (!r) return reviewView.waiting(m, h);
    const diff = reviewStore.parseDiff(m.detail && m.detail.docs && m.detail.docs.diff);
    const names = [...new Set([...diff.map((f) => f.file), ...r.items.map((x) => x.file)])];
    const files = names.map((name) => {
      const d = diff.find((f) => f.file === name);
      const mine = r.items.map((x, i) => [x, i]).filter(([x]) => x.file === name);
      const placed = new Set();
      let body = '';
      if (d) {
        for (const l of d.lines) {
          body += `<span class="ln c-${l.kind === '+' ? 'add' : l.kind === '-' ? 'del' : l.kind === '@' ? 'hunk' : 'say'}"><i class="no">${l.n ?? ''}</i>${reviewView.esc(l.kind === '@' ? l.text : `${l.kind}${l.text}`)}</span>`;
          for (const [x, i] of mine) {
            if (!placed.has(i) && l.n != null && x.to != null && l.n === x.to) { placed.add(i); body += `<div class="pin">${reviewView.card(x, i)}</div>`; }
          }
        }
      }
      const rest = mine.filter(([, i]) => !placed.has(i)).map(([x, i]) => `<div class="pin">${reviewView.card(x, i)}</div>`).join('');
      return `<section class="pfile"><div class="dfh"><span class="fn">${reviewView.esc(name)}</span>${d ? `<span class="ad">+${d.add}</span><span class="dl">-${d.del}</span>` : ''}<span class="sp"></span><span class="n">${mine.length} finding${mine.length === 1 ? '' : 's'}</span></div>${body ? `<div class="tb hk">${body}</div>` : ''}${rest}</section>`;
    }).join('');
    return `<div class="phead">${reviewView.verdicts(r)}${diff.length ? '' : '<span class="note">Diff lines are not available for this run; findings are listed by file.</span>'}</div><main class="pfiles" data-keep="pr-inline">${files || '<div class="empty">Neither engine reported a finding.</div>'}</main>`;
  },
};
