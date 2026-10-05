// Two-engine review results: review-buckets.json read through api.review, flattened to one finding list.
const reviewStore = (() => {
  const SEV = ['critical', 'high', 'medium', 'low'];
  const BUCKETS = ['disagree', 'both', 'codex_only', 'gemini_only'];
  const cache = {};

  const sevRank = (s) => { const i = SEV.indexOf(String(s || '').toLowerCase()); return i < 0 ? SEV.length : i; };
  const num = (v) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : null);
  const text = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v));

  function item(bucket, pair) {
    const a = pair.codex || null;
    const b = pair.gemini || null;
    const one = a || b || {};
    const worse = a && b ? (sevRank(a.severity) <= sevRank(b.severity) ? a : b) : one;
    return {
      bucket,
      sev: text(worse.severity) || 'unrated',
      rank: sevRank(worse.severity),
      file: text(one.file) || '(no file)',
      from: num(one.line_start),
      to: num(one.line_end ?? one.line_start),
      title: text(one.title) || text(one.body).slice(0, 80) || 'Untitled finding',
      codex: a ? text(a.body || a.title) : null,
      gemini: b ? text(b.body || b.title) : null,
    };
  }

  /** raw: the parsed review-buckets.json, or null. */
  function normalise(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const items = BUCKETS.flatMap((k) => (Array.isArray(raw[k]) ? raw[k] : []).filter((p) => p && typeof p === 'object').map((p) => item(k, p)));
    return {
      verdicts: { codex: text(raw.codex_verdict) || 'unknown', gemini: text(raw.gemini_verdict) || 'unknown' },
      items,
      disagree: items.filter((x) => x.bucket === 'disagree').length,
      critical: items.filter((x) => x.rank === 0).length,
      files: new Set(items.map((x) => x.file)).size,
    };
  }

  /** Cached review for a run; refetched when sig (the step statuses) changes or every 8 s. */
  function get(api, runId, sig, onChange) {
    const c = (cache[runId] ||= { at: 0, data: null, sig });
    if (c.sig !== sig || Date.now() - c.at > 8000) {
      c.sig = sig;
      c.at = Date.now();
      void api.review(runId).then((raw) => { c.data = normalise(raw); onChange(); });
    }
    return c.data;
  }

  /** Unified diff text to [{ file, add, del, lines: [{ n, kind: '+'|'-'|' '|'@', text }] }], n = new-side line number. */
  function parseDiff(diff) {
    if (!diff) return [];
    const files = [];
    let f = null;
    let n = 0;
    for (const line of diff.split('\n')) {
      const head = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      if (head) { f = { file: head[2], add: 0, del: 0, lines: [] }; files.push(f); continue; }
      if (!f || /^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity |rename )/.test(line)) continue;
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)/.exec(line);
      if (hunk) { n = Number(hunk[1]); f.lines.push({ n: null, kind: '@', text: line }); continue; }
      const kind = line[0];
      if (kind === '+') { f.add += 1; f.lines.push({ n: n++, kind, text: line.slice(1) }); }
      else if (kind === '-') { f.del += 1; f.lines.push({ n: null, kind, text: line.slice(1) }); }
      else if (kind === ' ') f.lines.push({ n: n++, kind, text: line.slice(1) });
    }
    return files;
  }

  return { SEV, BUCKETS, normalise, get, sevRank, parseDiff };
})();

const reviewView = (() => {
  const LABEL = { disagree: 'Disagree', both: 'Both', codex_only: 'Only Codex', gemini_only: 'Only Gemini' };
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const where = (x) => `${x.file}${x.from != null ? `:${x.from}${x.to != null && x.to !== x.from ? `-${x.to}` : ''}` : ''}`;
  const hot = (x) => x.bucket === 'disagree' || x.rank === 0;

  function card(x, i, opts = {}) {
    return `<article class="fnd${hot(x) ? ' hot halo' : ''}" data-f="${i}">${hot(x) ? '<span class="edge"></span>' : ''}
      <header><span class="sev s${x.rank}">${esc(x.sev)}</span>${opts.bucket === false ? '' : `<span class="bk bk-${x.bucket}">${LABEL[x.bucket]}</span>`}<span class="wh">${esc(where(x))}</span></header>
      <div class="ft">${esc(x.title)}</div>
      ${x.codex != null ? `<div class="op"><span class="who cx">Codex</span><span>${esc(x.codex)}</span></div>` : ''}
      ${x.gemini != null ? `<div class="op"><span class="who gm">Gemini</span><span>${esc(x.gemini)}</span></div>` : ''}
      <div class="fa"><button class="lnk" data-rs="copy" data-f="${i}">Copy as comment</button></div>
    </article>`;
  }

  function verdicts(r) {
    const v = (who, cls, val) => `<div class="vd"><span class="who ${cls}">${who}</span><span class="vv v-${esc(val)}">${esc(val)}</span></div>`;
    return `<div class="vds">${v('Codex', 'cx', r.verdicts.codex)}${v('Gemini', 'gm', r.verdicts.gemini)}</div>`;
  }

  /** Text copied by "Copy as comment". */
  const comment = (x) => [`${x.sev.toUpperCase()}: ${x.title} (${where(x)})`, x.codex != null ? `Codex: ${x.codex}` : '', x.gemini != null ? `Gemini: ${x.gemini}` : ''].filter(Boolean).join('\n');

  const waiting = (m, h) => (m.review ? '' : `<div class="empty">${m.list.some((s) => s.status === 'running') ? 'The reviews are still running.' : 'No review results yet.'}</div>`);

  return { LABEL, esc, where, hot, card, verdicts, comment, waiting };
})();
