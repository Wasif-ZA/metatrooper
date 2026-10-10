// PR first: the run read as the pull request it is heading to; the approve gate is the merge box.
runLayouts['pr-first'] = {
  render(m, h) {
    const st = h.status(m);
    const sums = h.sums(m);
    const gate = [...m.list].reverse().find((s) => s.kind === 'gate');
    const publish = m.list[m.list.length - 1];
    const pill = publish && publish.status === 'done' ? 'opened' : st === 'failed' || st === 'cancelled' ? 'stopped' : 'draft';
    const desc = h.spec(m) || m.list.filter((s) => s.kind === 'agent').map((s) => `<div class="kv"><span class="k">${h.esc(s.title)}</span><span class="v">${h.esc(s.session ? s.session.last_line || s.session.title || h.label(s) : h.label(s))}</span></div>`).join('');
    const checks = m.list.map((s) => `<div class="ck s-${h.esc(s.status)}" data-rs="sel" data-step="${h.esc(s.id)}"><span class="gl">${h.glyph(s)}</span><span class="t">${h.esc(s.title)}</span><span class="s">${h.esc(h.label(s))}</span></div>`).join('');
    let merge;
    if (gate && gate.status === 'waiting') merge = `<div class="mb wait halo"><span class="edge"></span><div class="mt">Ready when you are</div>${h.gateCard(m, gate)}</div>`;
    else if (publish && publish.status === 'done') merge = `<div class="mb"><span class="verdict">PR opened</span>${h.detail(m, publish)}</div>`;
    else if (gate && gate.status === 'done') merge = `<div class="mb"><span class="verdict">Approved</span><span class="mt">${h.esc(publish ? h.label(publish) : '')}</span></div>`;
    else merge = `<div class="mb"><div class="mt">${h.esc(gate ? `${gate.title}: ${h.label(gate)}` : 'No merge gate in this pipeline.')}</div></div>`;
    return `<section class="prh">
        <div class="l"><h1><span class="ttl">${h.esc(m.title)}</span><span class="num">${h.esc(m.run.id.slice(0, 8))}</span></h1>
          <div class="prs"><span class="pill ${pill}">${pill}</span>${h.pr(m)}<b>troop</b><span>${sums ? `${sums.files} files, +${sums.add} -${sums.del}` : 'no changes yet'}</span></div></div>
        <div class="r"><div class="stat"><span class="k">Elapsed</span><span class="v">${h.fmt(m.elapsed)}</span></div><div class="stat money"><span class="k">Tokens</span><span class="v">${m.tokens ? m.tokens.toLocaleString('en-US') : '-'}</span></div><div class="stat money"><span class="k">Cost</span><span class="v">${m.usd ? `$${m.usd.toFixed(2)}` : '-'}</span></div></div>
      </section>
      <aside class="pc cl"><div class="pcard desc"><h3>Description${h.spec(m) ? '<span class="x">spec.md</span>' : ''}</h3>${desc || '<div class="empty">No agent steps.</div>'}</div>${h.inputs(m) ? `<div class="pcard"><h3>Asked for</h3>${h.inputs(m)}</div>` : ''}</aside>
      <main class="pc cc"><div class="pcard files"><h3>Files changed${sums ? `<span class="x">${sums.files}</span>` : ''}</h3><div class="fl" data-keep="pr-files">${h.files(m)}</div></div>${merge}</main>
      <aside class="pc cr"><div class="pcard"><h3>Checks<span class="x">${m.done} of ${m.list.length}</span></h3>${checks}</div></aside>`;
  },
};
