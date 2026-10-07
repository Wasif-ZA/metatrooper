// Variants grid: one tile per fan-out variant with its server link, last agent line, and Pick, Pane and Discard.
runLayouts['variants-grid'] = {
  render(m, h) {
    const gate = m.list.find((x) => x.kind === 'gate' && x.status === 'waiting');
    const tiles = m.variants.map((v) => {
      const live = v.status !== 'discarded';
      const s = v.session_id && m.sessions.find((x) => x.id === v.session_id);
      const url = v.dev_port ? `http://localhost:${v.dev_port}/` : '';
      return `<section class="vt s-${h.esc(v.status)}${v.status === 'failed' ? ' halo' : ''}">${v.status === 'failed' ? '<span class="edge"></span>' : ''}
        <div class="vth"><b>${String.fromCharCode(65 + v.idx)}</b><span class="badge ${h.esc(v.status)}">${h.esc(v.status)}</span><span class="sp"></span><span class="mt">${h.esc(v.engine_id || '')}</span></div>
        <div class="vtb">${url ? `<a class="prl" href="${h.esc(url)}" target="_blank" rel="noopener">${h.esc(url)}</a>` : `<div class="empty">waiting for its server</div>`}
          <div class="mt">${h.esc(v.branch || '')}</div>${s ? `<div class="tb"><span class="ln c-say">${h.esc(s.last_line || s.last_tool || 'starting')}</span></div>` : ''}</div>
        <div class="vta">${v.pane_id && live ? `<button class="lnk" data-action="variant-pane" data-id="${h.esc(v.pane_id)}">Pane</button>` : ''}
          ${live && v.status !== 'picked' ? `<button class="lnk" data-action="variant-pick" data-idx="${v.idx}">Pick</button>` : ''}
          ${live ? `<button class="lnk" data-action="variant-discard" data-idx="${v.idx}">Discard</button>` : ''}</div></section>`;
    }).join('');
    const live = window.layoutRules.activeStep(m.list).step;
    return `${gate ? `<section class="gatebox halo"><span class="edge"></span><div class="sec">${h.esc(gate.title)}</div>${h.gateCard(m, gate)}</section>` : ''}
      <main class="grid">${tiles || `<div class="empty">${h.esc(live ? `${live.title}: ${h.label(live)}` : 'No variants yet.')}</div>`}</main>`;
  },
};
