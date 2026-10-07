// Preview stage: a step rail on the left; the stage holds the site's preview and production links, the gate under them.
runLayouts['preview-stage'] = {
  render(m, h) {
    const out = (id) => (m.detail && m.detail.outputs[id]) || {};
    const link = (url) => (url ? `<a class="prl" href="${h.esc(url)}" target="_blank" rel="noopener">${h.esc(url)}</a>` : '');
    const step = (id) => m.list.find((s) => s.id === id);
    const gate = m.list.find((s) => s.kind === 'gate' && s.status === 'waiting');
    const rail = m.list.map((s) => `<div class="pr-step s-${h.esc(s.status)}${s.status === 'waiting' ? ' halo' : ''}">${s.status === 'waiting' ? '<span class="edge"></span>' : ''}<span class="gl">${h.glyph(s)}</span><span class="nm">${h.esc(s.title)}</span><span class="mt">${h.esc(h.label(s))}</span></div>`).join('');
    const box = (title, s, url) => `<section class="pv s-${h.esc(s ? s.status : 'pending')}"><div class="pvh"><span class="tt">${h.esc(title)}</span>${s ? `<span class="badge ${h.esc(s.status)}">${h.esc(h.label(s))}</span>` : ''}</div>
      <div class="pvb">${url ? link(url) : `<div class="empty">${s && s.status === 'failed' ? 'Failed. The run log has the error.' : 'Not deployed yet.'}</div>`}</div></section>`;
    return `<aside class="rail" data-keep="ps-rail">${rail}</aside>
      <main class="stage">
        <div class="boxes">${box('Preview', step('preview'), out('preview').url)}${box('Production', step('production'), out('production').url)}</div>
        ${gate ? `<section class="gatebox halo"><span class="edge"></span><div class="sec">${h.esc(gate.title)}</div>${h.gateCard(m, gate)}</section>` : ''}
        <section class="files" data-keep="ps-files"><div class="sec">Changes on the branch</div>${m.agent ? h.files(m) : '<div class="empty">No changes yet.</div>'}</section>
      </main>`;
  },
};
