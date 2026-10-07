// Browser QA findings: findings.json read through api.runDetail, and the timeline layout that lists them in the order found.
const findingStore = (() => {
  const SEV = ['critical', 'high', 'medium', 'low'];
  const cache = {};
  const text = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

  /** raw: the findings.json array, or null. */
  function normalise(raw) {
    if (!Array.isArray(raw)) return null;
    const items = raw.filter((f) => f && typeof f === 'object').map((f) => ({
      sev: text(f.severity).toLowerCase() || 'unrated',
      title: text(f.title) || 'Untitled finding',
      file: text(f.file),
      line: f.line ?? null,
      detail: text(f.detail),
      fixed: Boolean(f.fixed_by),
    }));
    return {
      items,
      critical: items.filter((x) => x.sev === 'critical' && !x.fixed).length,
      fixed: items.filter((x) => x.fixed).length,
      open: items.filter((x) => !x.fixed).length,
      files: new Set(items.filter((x) => !x.fixed).map((x) => x.file || '(no file)')).size,
      rank: (x) => { const i = SEV.indexOf(x.sev); return i < 0 ? SEV.length : i; },
    };
  }

  /** Cached findings for a run; refetched when sig (the step statuses) changes or every 8 s. */
  function get(api, runId, sig, onChange) {
    const c = (cache[runId] ||= { at: 0, data: null, sig });
    if (c.sig !== sig || Date.now() - c.at > 8000) {
      c.sig = sig;
      c.at = Date.now();
      void api.runDetail(runId).then((d) => { c.data = normalise(d && !d.error ? d.findings : null); onChange(); });
    }
    return c.data;
  }

  function row(x, h) {
    return `<li class="fd sev-${h.esc(x.sev)}${x.fixed ? ' fixed' : ''}${x.sev === 'critical' && !x.fixed ? ' halo' : ''}">${x.sev === 'critical' && !x.fixed ? '<span class="edge"></span>' : ''}
      <span class="sv">${h.esc(x.sev)}</span><span class="tt">${h.esc(x.title)}</span>${x.file ? `<span class="at">${h.esc(x.file)}${x.line != null ? `:${h.esc(x.line)}` : ''}</span>` : ''}
      <span class="st">${x.fixed ? 'fixed' : 'open'}</span>${x.detail ? `<div class="dt">${h.esc(x.detail)}</div>` : ''}</li>`;
  }

  return { normalise, get, row };
})();

runLayouts.timeline = {
  render(m, h) {
    const f = m.findings;
    const live = window.layoutRules.activeStep(m.list).step;
    const watch = m.list.find((s) => s.session && s.status === 'running') || [...m.list].reverse().find((s) => s.session);
    const list = f && f.items.length ? `<ol class="fdl">${f.items.map((x) => findingStore.row(x, h)).join('')}</ol>` : `<div class="empty">${f ? 'No findings.' : 'No findings yet.'}</div>`;
    return `<main class="trace" data-keep="tl-list"><div class="hbh"><h1>Findings</h1><span class="sub">${f ? `${f.fixed} fixed · ${f.open} open` : h.esc(live ? `${live.id} is ${h.label(live)}` : '')}</span></div>${list}</main>
      <aside class="side">${watch ? `<div class="sec">${h.esc(watch.title)}</div>${h.detail(m, watch)}` : ''}${h.sum(m)}</aside>`;
  },
};
