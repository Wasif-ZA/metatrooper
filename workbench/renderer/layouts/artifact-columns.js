// Artifact columns: one column per working step, left to right; gates sit in the seams between them.
runLayouts['artifact-columns'] = {
  render(m, h) {
    const parts = [];
    let n = 0;
    for (const s of m.list) {
      if (s.kind === 'gate') {
        parts.push(`<div class="seam s-${h.esc(s.status)}" title="${h.esc(s.title)}"><span class="line"></span><i class="dmd"></i><span class="sl">${h.esc(s.status === 'waiting' ? 'needs you' : s.status === 'done' ? 'approved' : s.status)}</span>
          ${s.status === 'waiting' ? `<div class="seamcard">${h.gateCard(m, s)}</div>` : ''}</div>`);
        continue;
      }
      n += 1;
      const body = m.agent && m.agent.id === s.id
        ? `${h.detail(m, s)}<div class="sec">Changes</div><div class="files">${h.files(m)}</div>`
        : h.detail(m, s);
      parts.push(`<section class="col${s.status === 'pending' ? ' pend' : ''}${s.status === 'running' ? ' working' : ''}">
        <div class="ch"><span class="no">${String(n).padStart(2, '0')}</span><span class="nm">${h.esc(s.title)}</span><span class="sp"></span><span class="badge ${h.esc(s.status)}">${h.esc(h.label(s))}</span></div>
        <div class="by"><b>${h.esc(h.who(s))}</b>${h.took(s) ? `  ·  ${h.took(s)}` : ''}</div>
        <div class="cb" data-keep="ac-${h.esc(s.id)}">${body}</div></section>`);
    }
    return `<main class="cols">${parts.join('')}</main>`;
  },
};
