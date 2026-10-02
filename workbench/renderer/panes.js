// Result panes for pipeline steps whose `view` is items, document, table or findings.
const panes = (() => {
  const SEVERITY = ['critical', 'high', 'medium', 'low'];

  function inline(s) {
    return esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  }

  /** Minimal markdown: headings, lists, fenced code, paragraphs. */
  function markdown(text) {
    const out = [];
    let list = false;
    let code = null;
    let para = [];
    const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
    for (const line of String(text || '').split(/\r?\n/)) {
      if (code !== null) {
        if (line.startsWith('```')) { out.push(`<pre>${esc(code.join('\n'))}</pre>`); code = null; } else code.push(line);
        continue;
      }
      if (line.startsWith('```')) { flush(); if (list) { out.push('</ul>'); list = false; } code = []; continue; }
      const h = /^(#{1,4})\s+(.*)$/.exec(line);
      const li = /^\s*[-*]\s+(.*)$/.exec(line);
      if (h) { flush(); if (list) { out.push('</ul>'); list = false; } out.push(`<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`); }
      else if (li) { flush(); if (!list) { out.push('<ul>'); list = true; } out.push(`<li>${inline(li[1])}</li>`); }
      else if (!line.trim()) { flush(); if (list) { out.push('</ul>'); list = false; } }
      else para.push(line.trim());
    }
    flush();
    if (list) out.push('</ul>');
    if (code !== null) out.push(`<pre>${esc(code.join('\n'))}</pre>`);
    return out.join('');
  }

  function items(p, ctx) {
    if (!Array.isArray(p.data)) return '<p class="empty">The items output is not a list yet.</p>';
    const count = (st) => p.data.filter((x) => (x.status || 'pending') === st).length;
    const head = `<div class="meta">${p.data.length} items · ${count('approved')} approved · ${count('dropped')} dropped · ${count('pending')} pending</div>`;
    const cards = p.data.map((x) => {
      const st = x.status || 'pending';
      const btn = (to, label, cls = '') => (p.editable && st !== to ? `<button class="${cls}" data-action="item-set" data-run="${esc(ctx.run)}" data-step="${esc(ctx.step)}" data-id="${esc(x.id)}" data-status="${to}">${label}</button>` : '');
      return `<div class="pane-card st-${esc(st)}">
        <div class="row"><b>${esc(x.title || x.id)}</b>${x.score !== undefined ? `<span class="pill">${esc(x.score)}</span>` : ''}<span class="state ${esc(st)}">${esc(st)}</span></div>
        ${x.preview ? `<div class="preview">${esc(x.preview)}</div>` : ''}
        ${x.reason ? `<div class="meta">${esc(x.reason)}</div>` : ''}
        ${x.error ? `<div class="step-err">${esc(x.error)}</div>` : ''}
        ${x.url ? `<div class="meta">${esc(x.url)}</div>` : ''}
        <div class="actions">${btn('approved', 'Approve', 'primary')}${btn('pending', 'Back to pending')}${btn('dropped', 'Drop', 'danger')}</div>
      </div>`;
    }).join('');
    return `${head}${p.editable ? '' : '<p class="meta">Read only: the items output is inline, not a file.</p>'}<div class="pane-cards">${cards}</div>`;
  }

  function documentPane(p) {
    const score = p.score && typeof p.score === 'object' ? p.score : null;
    const scoreHtml = score ? `<div class="score"><div class="row"><b>Score ${esc(score.score)}</b>${score.threshold !== undefined ? `<span class="meta">needs ${esc(score.threshold)}</span>` : ''}
        <span class="state ${score.threshold !== undefined && score.score < score.threshold ? 'failed' : 'done'}">${score.threshold !== undefined && score.score < score.threshold ? 'below' : 'passes'}</span></div>
        <div class="bar"><i style="width:${Math.max(0, Math.min(100, Number(score.score) || 0))}%"></i></div>
        ${Object.entries(score.parts || {}).map(([k, v]) => `<div class="part"><span>${esc(k)}</span><span class="meta">${esc(v)}</span></div>`).join('')}</div>` : '';
    const sources = Array.isArray(p.sources) && p.sources.length ? `<h4>Sources</h4><ol class="sources">${p.sources.map((s) => `<li>${esc(s.title || s.url)} <span class="meta">${esc(s.url || '')}</span></li>`).join('')}</ol>` : '';
    return `${scoreHtml}<div class="doc">${p.data ? markdown(p.data) : '<p class="empty">No document yet.</p>'}</div>${sources}`;
  }

  function table(p) {
    const d = p.data;
    if (!d || !Array.isArray(d.columns) || !Array.isArray(d.rows)) return '<p class="empty">The table output has no columns and rows yet.</p>';
    const dot = (st) => (st === 'running' ? 'working' : st === 'failed' ? 'failed' : 'idle');
    return `<div class="meta">${d.rows.length} rows</div><table class="pane-table"><thead><tr><th>Row</th>${d.columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td>${esc(r.id)}</td>${d.columns.map((c) => {
        const cell = (r.cells || {})[c];
        if (!cell) return '<td class="meta">-</td>';
        return `<td title="${esc(cell.error || '')}"><span class="dot ${dot(cell.status)}"></span> ${esc(cell.value ?? cell.status)}${cell.error ? `<div class="step-err">${esc(cell.error)}</div>` : ''}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
  }

  function findings(p) {
    if (!Array.isArray(p.data)) return '<p class="empty">The findings output is not a list yet.</p>';
    if (!p.data.length) return '<p class="empty">No findings.</p>';
    return SEVERITY.map((sev) => {
      const list = p.data.filter((f) => f.severity === sev);
      if (!list.length) return '';
      return `<h4 class="sev-${sev}">${sev} <span class="count">${list.length}</span></h4>${list.map((f) => `<div class="finding sev-${sev}">
        <div><b>${esc(f.title)}</b>${f.file ? ` <span class="meta">${esc(f.file)}${f.line ? `:${esc(f.line)}` : ''}</span>` : ''}${f.fixed_by ? ` <span class="state done">fixed by ${esc(f.fixed_by)}</span>` : ''}</div>
        <div class="meta">${esc(f.detail || '')}</div></div>`).join('')}`;
    }).join('');
  }

  function render(p, ctx) {
    if (!p) return '<p class="empty">Loading.</p>';
    if (p.error) return `<p class="empty">${esc(p.error)}</p>`;
    if (p.view === 'items') return items(p, ctx);
    if (p.view === 'document') return documentPane(p);
    if (p.view === 'table') return table(p);
    if (p.view === 'findings') return findings(p);
    return '<p class="empty">Unknown pane.</p>';
  }

  return { render, markdown };
})();
