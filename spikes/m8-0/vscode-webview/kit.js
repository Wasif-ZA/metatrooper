// Ouros kit: a fixed catalogue; agents send JSON, only catalogue parts render.
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const TYPES = { str: v => typeof v === 'string' || typeof v === 'number', num: Number.isFinite, bool: v => typeof v === 'boolean', arr: Array.isArray, obj: v => !!v && typeof v === 'object' && !Array.isArray(v), any: v => v !== undefined };
const raw = (x, why) => { let s; try { s = JSON.stringify(x, null, 1); } catch { s = '(unreadable input)'; } return `<pre class="kraw" title="${esc(why)}">${esc(s)}</pre>`; };
// need: nested text, else the item falls back; maybe: optional text; one: value from a fixed set
const need = v => { if (!TYPES.str(v)) throw 0; return esc(v); };
const maybe = v => v == null ? '' : need(v);
const one = (v, set, d) => set.includes(v) ? v : d;
const each = (a, f) => a.map((x, i) => { try { return f(x, i); } catch { return raw(x, 'bad item'); } }).join('');
const kids = a => a.map(render).join('');
const acts = a => a ? each(a, b => `<button class="btn${b.primary === true ? ' acc' : ''}" data-event="${maybe(b.event ?? b.label)}">${need(b.label)}${b.key ? ` <kbd>${need(b.key)}</kbd>` : ''}</button>`) : '';

const STILLS = ['dashboard', 'site', 'pdf', 'video', 'photo'];
const stillSvg = (k, noBar, figs) => {
  const F = i => Array.isArray(figs) && typeof figs[i] === 'string' && figs[i] ? esc(figs[i].length > 34 ? figs[i].slice(0, figs[i].lastIndexOf(' ', 34) > 10 ? figs[i].lastIndexOf(' ', 34) : 34) : figs[i]) : '';
  const r = (x, y, w, h, c = 'a') => `<rect class="${c}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
  const lines = (x, y, ws, c = 'b', g = 9) => ws.map((w, i) => r(x, y + i * g, w, 3, c)).join('');
  const t = (x, y, s, c) => `<text class="${c}" x="${x}" y="${y}">${s}</text>`;
  const body = {
    dashboard: r(0, 0, 320, 22) + r(10, 8, 40, 6, 'b') + r(262, 8, 48, 6, 'b') + r(10, 32, 96, 52) + t(18, 64, F(0) || '128', F(0).length > 4 ? 'big2' : 'big') + t(18, 78, F(3) || '+12% this week', 'sm') + r(114, 32, 96, 52) + t(122, 64, F(1) || '41', F(1).length > 4 ? 'big2' : 'big') + r(218, 32, 92, 52) + t(226, 64, F(2) || '3', F(2).length > 4 ? 'big2' : 'big')
      + r(10, 94, 300, 96) + [30, 44, 36, 58, 50, 70, 84].map((h, i) => r(24 + i * 40, 182 - h, 24, h, i === 6 ? 'c' : 'b')).join(''),
    site: r(0, 0, 320, 20) + r(10, 7, 22, 6, 'c') + r(210, 8, 24, 4, 'b') + r(242, 8, 24, 4, 'b') + r(274, 8, 28, 4, 'b')
      + (F(0) ? t(16, 52, F(0), 'hero') + (F(1) ? t(16, 70, F(1), 'hero') : '') : r(16, 40, 150, 12, 'c') + r(16, 58, 110, 12, 'c')) + lines(16, 84, [140, 128]) + r(16, 112, F(2) ? Math.max(52, F(2).length * 5 + 14) : 52, 16, 'c') + (F(2) ? t(23, 123, F(2), 'btn') : '') + r(184, 36, 120, 90)
      + [0, 1, 2].map(i => r(16 + i * 100, 142, 90, 44) + (F(3 + i) ? t(24 + i * 100, 156, F(3 + i).slice(0, 16), 'sct') : r(24 + i * 100, 150, 40, 4, 'b')) + r(24 + i * 100, 164, 70, 3, 'b') + r(24 + i * 100, 172, 54, 3, 'b')).join(''),
    pdf: r(0, 0, 320, 200) + r(85, 10, 150, 182, 'pg') + (F(0) ? t(100, 32, F(0), 'ttl') : r(100, 24, 90, 8, 'ink'))
      + (F(1) ? [1, 2, 3, 4, 5, 6, 7, 8].map((j, k) => F(j) ? t(100, 50 + k * 15, F(j).length > 30 ? F(j).slice(0, F(j).lastIndexOf(' ', 30)) : F(j), 'pl') : '').join('') : lines(100, 44, [120, 116, 120, 98], 'ln') + r(100, 86, 120, 40, 'ln2') + lines(100, 136, [120, 120, 112, 120, 72], 'ln')),
    video: r(0, 0, 320, 200) + `<path class="a2" d="M0 150h320v50H0z"/><ellipse class="b" cx="160" cy="138" rx="70" ry="9"/><path class="c" d="M136 134c-14-18-10-40 4-52 4-4 4-10 2-14h36c-2 4-2 10 2 14 14 12 18 34 4 52z"/><rect class="b" x="40" y="70" width="46" height="70"/><rect class="a" x="46" y="78" width="34" height="8"/><rect class="a" x="46" y="94" width="34" height="8"/>` + (F(0) ? `<text class="cap" x="160" y="${noBar ? 186 : 174}" text-anchor="middle">${F(0)}</text>` : '') + (F(1) ? t(14, 30, F(1), 'tc') : '') + (noBar ? '' : r(14, 186, 292, 3, 'b') + r(14, 186, 118, 3, 'c')) + `<path class="c" d="M268 24l16 10-16 10z"/>`,
    photo: r(0, 0, 320, 200) + `<circle class="c" cx="236" cy="52" r="16"/><path class="b" d="M0 150L70 84l52 50 40-34 78 70v30H0z"/><path class="a2" d="M0 176l90-30 70 22 160-40v72H0z"/>`
  }[k] || '';
  return `<svg class="kst" viewBox="0 0 320 200" aria-hidden="true">${body}</svg>`;
};
const KIT = {
  page: { req: { children: 'arr' }, r: p => `<div class="usage kpage">${kids(p.children)}</div>`,
    ex: { type: 'page', children: [{ type: 'note', text: 'Any parts go here.' }] } },
  header: { req: { title: 'str' }, opt: { sub: 'str', big: 'bool', tabs: 'arr' },
    r: p => `<div class="uh"><div><div class="big${p.big ? '' : ' mid'}">${esc(p.title)}</div>${p.sub ? `<div class="sub">${esc(p.sub)}</div>` : ''}</div><span class="sp"></span>${p.tabs ? `<span class="seg2">${each(p.tabs, (t, i) => `<a class="${i ? '' : 'on'}">${need(t)}</a>`)}</span>` : ''}</div>`,
    ex: { type: 'header', title: '412k tokens', sub: 'today · 3 agents', big: true, tabs: ['Today', 'Week'] } },
  columns: { req: { children: 'arr' }, r: p => { const g = [], cols = p.children.map(c => (Array.isArray(c) ? c : [c]).filter(x => !(x && x.type === 'gate' && g.push(x)))); return `<div class="ucols">${cols.map(c => `<div>${kids(c)}</div>`).join('')}</div>${kids(g)}`; },
    ex: { type: 'columns', children: [[{ type: 'note', text: 'left' }], [{ type: 'note', text: 'right' }]] } },
  section: { req: { label: 'str', children: 'arr' }, opt: { aside: 'str' },
    r: p => `<div class="ksec"><div class="g">${esc(p.label)}${p.aside ? `<span style="margin-left:auto">${esc(p.aside)}</span>` : ''}</div>${kids(p.children)}</div>`,
    ex: { type: 'section', label: 'Where it went', children: [{ type: 'bar', label: 'File reads', value: '190k', pct: 46 }] } },
  bar: { req: { label: 'str', value: 'str', pct: 'num' }, opt: { note: 'str', tone: 'str' }, set: { tone: ['need', 'fail', 'lead'] },
    r: p => `<div class="cb${p.tone ? ' tn-' + p.tone : ''}"><span class="n">${esc(p.label)}</span><span class="bar"><i style="width:${Math.max(0, Math.min(100, p.pct))}%"></i></span><span class="k">${esc(p.value)}</span><span class="note">${esc(p.note || '')}</span></div>`,
    ex: { type: 'bar', label: 'Shell output', value: '88k', pct: 21, note: 'shrunk by metarouter', tone: 'lead' } },
  toggle: { req: { label: 'str', on: 'bool' }, opt: { note: 'str' },
    r: p => `<div class="sv ${p.on ? '' : 'off'}"><span class="sw"><i></i></span><span><b>${esc(p.label)}</b>${p.note ? `<span class="d">${esc(p.note)}</span>` : ''}</span></div>`,
    ex: { type: 'toggle', label: 'Lean handoffs', on: false, note: 'Between tasks only.' } },
  table: { req: { cols: 'arr', rows: 'arr' }, opt: { foot: 'str' },
    r: p => { const num = v => typeof v === 'number' || (typeof v === 'string' && /^[-+$]?[\d.,]+\s?(%|k|m|kb|mb|ms|s|h|kg|g|mm)?$/i.test(v.trim())); const rows = p.rows.filter(Array.isArray); const nc = p.cols.map((_, i) => rows.length > 0 && rows.filter(r => r[i] != null && r[i] !== '').every(r => num(r[i]))); return `<table class="lt4"><thead><tr>${each(p.cols, (c, i) => `<th${nc[i] ? ' class="n"' : ''}>${need(c)}</th>`)}</tr></thead><tbody>${each(p.rows, r => `<tr>${each(r, (c, i) => `<td${nc[i] ? ' class="n"' : ''}>${c && typeof c === 'object' ? render(c) : maybe(c)}</td>`)}</tr>`)}</tbody></table>${p.foot ? `<div class="lt4f">${esc(p.foot)}</div>` : ''}`; },
    ex: { type: 'table', cols: ['Change', 'Broke', ''], rows: [['Run tsc first', '0', { type: 'pill', text: 'kept', tone: 'kept' }]] } },
  pill: { req: { text: 'str' }, opt: { tone: 'str' }, r: p => `<span class="pill ${one(p.tone, ['kept', 'dropped', 'ok', 'warn', 'error', 'info', 'need'], '')}">${esc(p.text)}</span>`,
    ex: { type: 'pill', text: 'dropped', tone: 'dropped' } },
  note: { req: { text: 'str' }, r: p => `<div class="foot">${esc(p.text)}</div>`, ex: { type: 'note', text: 'Ctrl Z on any row undoes it.' } },
  headline: { req: { text: 'str' }, opt: { actions: 'arr' },
    r: p => `<div class="khl"><div class="t">${esc(p.text)}</div>${p.actions ? `<div class="a">${acts(p.actions)}</div>` : ''}</div>`,
    ex: { type: 'headline', text: 'Table 2 row 3 says 0.421. Re-run gives 0.412.', actions: [{ label: 'Use 0.412', primary: true }, { label: 'Open table' }] } },
  check: { req: { label: 'str', state: 'str' }, opt: { value: 'str', event: 'str' },
    r: p => `<div class="kck ${one(p.state, ['done', 'needs', 'skip', 'open'], 'open')}"><span class="bx"${p.event ? ` data-event="${esc(p.event)}"` : ''}></span><span>${esc(p.label)}</span><span class="v">${esc(p.value || '')}</span></div>`,
    ex: { type: 'check', label: 'Numbers re-run match', state: 'needs', value: '1 differs' } },
  meter: { req: { label: 'str', value: 'num', max: 'num' }, opt: { unit: 'str', prefix: 'str' },
    r: p => `<div class="kmt"><span>${esc(p.label)}</span><span class="v">${maybe(p.prefix)}${esc(p.value.toLocaleString('en-AU'))} of ${maybe(p.prefix)}${esc(p.max.toLocaleString('en-AU'))}${p.unit ? ' ' + esc(p.unit) : ''}</span><span class="dith" style="--w:${(p.max > 0 ? Math.max(0, Math.min(100, p.value / p.max * 100)) : 0).toFixed(1)}%"></span></div>`,
    ex: { type: 'meter', label: 'Words', value: 5801, max: 6000 } },
  choice: { req: { question: 'str', options: 'arr' }, opt: { picked: 'num', field: 'str', from: 'str', actions: 'arr' }, set: { picked: [0, 1, 2, 3, 4, 5] },
    r: p => `<div class="kch"><div class="h"><span>${esc(SOURCE === 'system' ? (p.from || 'agent') : AGENT)} is asking · your answer goes to ${esc(SOURCE === 'system' ? (p.from || 'agent') : AGENT)}</span><span>no time limit · also on your phone</span></div><div class="q">${esc(p.question)}</div>
      <div class="o">${each(p.options, (o, i) => `<div class="op${i === p.picked ? ' on' : ''}"><b>${i + 1} · ${need(o.title)}</b><span>${maybe(o.note)}</span></div>`)}</div>
      ${p.field ? `<div class="f">${esc(p.field)} <em class="to">goes to ${esc(SOURCE === 'system' ? (p.from || 'agent') : AGENT)}</em></div>` : ''}<div class="a">${acts(p.actions || [{ label: 'Send', primary: true, key: 'Enter' }])}</div></div>`,
    ex: { type: 'choice', from: 'claude', question: 'Which limiter?', options: [{ title: 'In-memory', note: 'Resets on restart.' }, { title: 'Cloudflare binding', note: 'Needs a config change.' }] } },
  // harvested from round-3 ide3.js, round-2 ide2.js and the stashed workflow screens
  log: { req: { lines: 'arr' },
    r: p => `<div class="klog">${each(p.lines, l => l.kind === 'group' ? `<div class="row grp${l.state === 'fail' ? ' gfail' : l.state === 'todo' ? ' gtodo' : ''}"><span class="gs ${one(l.state, ['done', 'run', 'fail', 'todo'], 'done')}"></span>${need(l.text)}${l.detail ? ` <span class="v">${need(l.detail)}</span>` : ''}${l.took ? `<span class="tk">${need(l.took)}</span>` : ''}</div>` : `<div class="row${l.kind === 'fail' ? ' fail' : ''}">${l.time ? `<span class="tm">${need(l.time)}</span>` : ''}<span class="m">${l.kind === 'heal' ? '<span class="heal">↻</span>' : l.kind === 'run' ? '⠋' : l.kind === 'fail' ? '✕' : '·'}</span><span class="${l.kind === 'run' ? 'run' : ''}">${need(l.text)}</span>${l.detail ? ` <span class="v">${need(l.detail)}</span>` : ''}</div>`)}</div>`,
    ex: { type: 'log', lines: [{ text: 'api overloaded (529)', detail: 'retried after 4s', kind: 'heal' }, { text: 'Running npm test', detail: '38 passed so far', kind: 'run' }] } },
  gate: { req: { text: 'str', why: 'str' }, opt: { title: 'str', aside: 'str', actions: 'arr', action: 'str', hash: 'str' },
    r: p => SOURCE !== 'system' ? `<div class="kask"><span class="lt">${esc(AGENT)} asks you · not a gate</span><div class="gl"><span class="q2">${esc(p.text)}</span>${acts(p.actions)}</div><span class="why">${esc(p.why)}</span></div>` : `<div class="inbox3 gatebox kgate"><span class="lt">${esc(p.title || 'stopped · needs you')}</span><span class="rt">${esc(p.aside || 'never auto-approved')}</span><div class="gl"><span class="q2">${esc(p.text)}</span>${acts(p.actions)}</div>${p.action ? `<code class="act">${need(p.action)}${p.hash ? ` <span>${need(p.hash)}</span>` : ''}</code>` : ''}<span class="why">${esc(p.why)}</span></div>`,
    ex: { type: 'gate', text: 'git reset --hard main would discard 3 uncommitted files', why: 'on the stop list: discards uncommitted work', actions: [{ label: 'Stash first' }, { label: "Don't reset", primary: true, key: 'N' }] } },
  digest: { req: { title: 'str', facts: 'str' }, opt: { note: 'str', actions: 'arr' },
    r: p => `<div class="kdg"><b>${esc(p.title)}</b><span class="a">${acts(p.actions)}</span><span class="f">${esc(p.facts)}</span>${p.note ? `<span class="n">${esc(p.note)}</span>` : ''}</div>`,
    ex: { type: 'digest', title: 'claude finished · 3m 40s in auto', facts: '2 files +16 −1 · npm test 41 passed · 0 asks', note: 'Nothing needed you.', actions: [{ label: 'Review' }, { label: 'Undo all' }] } },
  tile: { req: { engine: 'str', task: 'str', state: 'str', lines: 'arr' }, opt: { branch: 'str', add: 'str', del: 'str', foot: 'str' }, set: { state: ['working', 'needs', 'done'] },
    r: p => `<section class="pane tile${p.state === 'working' ? ' working' : ''}${p.state === 'needs' && SOURCE === 'system' ? ' attn' : ''} ktile"><div class="ph"><div class="r1"><span class="dot" style="background:var(--sc)"></span><span class="eng">${esc(p.engine)}</span><span class="task">${esc(p.task)}</span>${p.state === 'needs' && SOURCE === 'system' ? '<span class="stamp"><span class="si"><span class="ink y">needs you</span><span class="ink p">needs you</span></span></span>' : `<span class="badge ${p.state === 'working' ? 'work' : 'unseen'}">${p.state === 'working' ? 'working' : 'done'}</span>`}</div><div class="r2"><span class="fl">${esc(p.branch || '')}</span><span class="meta"><span class="ad">${esc(p.add || '')}</span><span class="dl">${esc(p.del || '')}</span></span></div></div>
      <div class="term2">${each(p.lines, l => `<div>${need(l)}</div>`)}</div><div class="tfoot">${esc(p.foot || '')}</div></section>`,
    ex: { type: 'tile', engine: 'codex', task: 'Fix redirect loop', state: 'working', branch: 'ouros/redirect-loop', add: '+12', del: '-9', lines: ['$ npm test -- domains', ' PASS test/domains.test.ts (9)'], foot: '88k tok · 12s ago' } },
  diff: { req: { path: 'str', hunks: 'arr' }, opt: { add: 'str', del: 'str', actions: 'arr', viewed: 'bool' },
    r: p => `<div class="rf"><div class="fh">${esc(p.path)} <span class="plus">${esc(p.add || '')}</span> <span class="minus">${esc(p.del || '')}</span><span class="sp"></span>${acts(p.actions)}${typeof p.viewed === 'boolean' ? `<span class="vw${p.viewed ? ' on' : ''}"><i></i>Viewed</span>` : ''}</div><div class="dl">${each(p.hunks, h => `<div class="hk">${need(h.head)}</div>${each(h.lines || [], l => `<div class="${String(l)[0] === '+' ? 'a' : String(l)[0] === '-' ? 'r' : ''}">${need(l)}</div>`)}`)}</div></div>`,
    ex: { type: 'diff', path: 'src/routes/shorten.ts', add: '+2', hunks: [{ head: '@@ -16,6 +16,8 @@', lines: ['+  if (!take(req.key)) return res.status(429).end()'] }] } },
  steps: { req: { steps: 'arr' },
    r: p => `<div class="steps">${each(p.steps, (s, i) => `<div class="sp2 ${one(s.state, ['done', 'cur', 'todo', 'fail'], 'todo')}"><span class="o">${s.state === 'fail' ? '✕' : s.state === 'done' ? '✓' : i + 1}</span><div><div class="t">${need(s.title)}</div><div class="s">${maybe(s.sub)}</div></div><span class="v">${maybe(s.value)}</span></div>`)}</div>`,
    ex: { type: 'steps', steps: [{ title: 'Spec', sub: 'claude wrote it', state: 'done' }, { title: 'Review', sub: 'gemini checks the PR', state: 'cur', value: '2 findings' }, { title: 'Hand back' }] } },
  list: { req: { groups: 'arr' }, opt: { search: 'str', keys: 'arr' },
    r: p => `<div class="qo kqo">${p.search ? `<div class="in"><span class="qph">${esc(p.search)}</span></div>` : ''}${each(p.groups, g => `<div class="grp"><span>${need(g.label)}</span><span>${maybe(g.aside)}</span></div>${each(g.rows, r => `<div class="row${r.cur === true ? ' cur' : ''}"><span class="fi">${maybe(r.icon ?? 'TS')}</span>${need(r.name)}<span class="d">${maybe(r.dir)}</span><span class="r">${r.agent ? `<span class="adot ${one(r.agent, ['claude', 'codex', 'gemini'], '')}"></span>` : ''}${maybe(r.right)}</span></div>`)}`)}${p.keys ? `<div class="foot">${each(p.keys, k => `<span>${need(k)}</span>`)}</div>` : ''}</div>`,
    ex: { type: 'list', search: 'Search files, or ? to search by meaning', groups: [{ label: 'Agent changes', rows: [{ name: 'limit.ts', dir: 'src', agent: 'claude', right: '+14 −1', cur: true }] }], keys: ['↵ open'] } },
  // from the 17 MetaTrooper pipeline screens (PIPELINES.md) and the outside research (MORE.md)
  pipe: { req: { nodes: 'arr' }, opt: { title: 'str', note: 'str' },
    r: p => `<div class="kpipe">${p.title ? `<div class="g">${need(p.title)}${p.note ? `<span style="margin-left:auto">${need(p.note)}</span>` : ''}</div>` : ''}<div class="nodes" style="--n:${p.nodes.length}">${each(p.nodes, (n, i) => `${i ? `<i class="wire${n.state && n.state !== 'todo' ? ' on' : ''}"></i>` : ''}<span class="node s-${one(n.state, ['done', 'cur', 'todo', 'needs', 'failed'], 'todo')}"><span class="gl ${one(n.kind, ['step', 'gate', 'fanout', 'loop'], 'step')}"></span><span class="nm">${need(n.title)}</span><span class="mt">${maybe(n.value)}</span></span>`)}</div></div>`,
    ex: { type: 'pipe', title: 'spec-to-pr', nodes: [{ title: 'spec', state: 'done' }, { title: 'build', state: 'done', value: '14 tests' }, { title: 'approve-pr', kind: 'gate', state: 'needs' }, { title: 'open-pr' }] } },
  handback: { req: { items: 'arr' }, opt: { title: 'str' },
    r: p => `<div class="khb"><div class="g">${maybe(p.title ?? 'Hand back')}</div>${each(p.items, (it, i) => `<div class="hi ${one(it.kind, ['you', 'run', 'info'], 'info')}${it.done === true ? ' done' : ''}"><span class="n">${i + 1}</span><span>${need(it.text)}${it.command ? `<code>${need(it.command)}</code>` : ''}</span></div>`)}</div>`,
    ex: { type: 'handback', items: [{ text: 'Merge PR #41', kind: 'you', command: 'gh pr merge 41' }, { text: 'Tests ran: 14 passed', kind: 'run', done: true }] } },
  preview: { req: { kind: 'str', title: 'str' }, opt: { url: 'str', widths: 'arr', versions: 'arr', marks: 'arr', lines: 'arr', labels: 'arr', still: 'str', figures: 'arr' }, set: { kind: ['page', 'video', 'window'], still: STILLS },
    r: p => `<div class="kpv ${p.kind}"><div class="bar"><b>${need(p.title)}</b>${p.url ? `<span class="url">${need(p.url)}</span>` : ''}<span class="sp"></span>${p.versions ? `<span class="seg2">${each(p.versions, (v, i) => `<a class="${i === p.versions.length - 1 ? 'on' : ''}">${need(v)}</a>`)}</span>` : ''}${p.widths ? `<span class="seg2">${each(p.widths, (w, i) => `<a class="${i ? '' : 'on'}">${need(w)}</a>`)}</span>` : ''}</div>
      <div class="stage${p.still ? ' still' : ''}">${p.still ? stillSvg(p.still, p.kind === 'video' && !!p.marks, p.figures) + (p.kind === 'video' && p.marks ? `<div class="scrub">${each(p.marks, m => `<i style="left:${Math.max(0, Math.min(100, Number(m.at) || 0))}%"></i>`)}</div>` : '') : p.kind === 'video' ? `<div class="play">▶</div><div class="scrub">${each(p.marks || [], m => `<i style="left:${Math.max(0, Math.min(100, Number(m.at) || 0))}%"></i>`)}</div>` : `<div class="wire">${each(p.lines || [], (l, i) => `<div class="wl${i ? '' : ' h'}">${need(l)}${p.labels && p.labels[i] ? `<span class="lb">${need(p.labels[i])}</span>` : ''}</div>`)}</div>`}</div>
      ${p.marks ? `<div class="marks">${each(p.marks, (m, i) => `<div><span class="mk">${i + 1}</span>${maybe(m.time)} ${need(m.text)}</div>`)}</div>` : ''}</div>`,
    ex: { type: 'preview', kind: 'page', title: 'linkkit.dev', url: 'preview-41.linkkit.dev', widths: ['1280', '390'], versions: ['build', 'critique 1'], still: 'site', marks: [{ text: 'Hero text wraps at 390' }] } },
  doc: { req: { title: 'str', blocks: 'arr' }, opt: { status: 'str', by: 'str' },
    r: p => `<div class="kdoc"><div class="dh"><b>${need(p.title)}</b><span>${maybe(p.by)}</span>${p.status ? `<span class="pill">${need(p.status)}</span>` : ''}</div>${each(p.blocks, b => `<p class="${one(b.mark, ['added', 'flag', 'none'], 'none')}">${need(b.text)}${b.refs ? each(b.refs, r => ` <span class="ref">${need(r)}</span>`) : ''}</p>`)}</div>`,
    ex: { type: 'doc', title: 'report.md', by: 'claude', status: 'draft', blocks: [{ text: 'Token buckets reset on restart.', refs: ['s3', 'q7'] }] } },
  finding: { req: { title: 'str', sev: 'str' }, opt: { where: 'str', state: 'str', opinions: 'arr', actions: 'arr' }, set: { sev: ['high', 'med', 'low'], state: ['open', 'fixed', 'both', 'disagree', 'rejected'] },
    r: p => `<div class="kfd"><div class="fh"><span class="sev ${p.sev}">${p.sev}</span><b>${need(p.title)}</b><span class="sp"></span>${p.state ? `<span class="pill">${p.state}</span>` : ''}</div>${p.where ? `<div class="wh">${need(p.where)}</div>` : ''}${p.opinions ? `<div class="ops">${each(p.opinions, o => `<div><span class="eng">${need(o.engine)}</span>${need(o.text)}</div>`)}</div>` : ''}${p.actions ? `<div class="a">${acts(p.actions)}</div>` : ''}</div>`,
    ex: { type: 'finding', sev: 'high', title: 'Idle keys never evicted', where: 'src/limit.ts:16', state: 'disagree', opinions: [{ engine: 'codex', text: 'Memory grows without bound.' }, { engine: 'gemini', text: 'Fine for one worker.' }] } },
  matrix: { req: { cols: 'arr', rows: 'arr' },
    r: p => `<div class="kmx" style="--n:${p.cols.length}"><span></span>${each(p.cols, c => `<span class="ch">${need(c)}</span>`)}${each(p.rows, r => `<span class="rl">${need(r.label)}</span>${each(r.cells, c => `<span class="c ${one(c, ['ok', 'fail', 'warn', 'run', 'none'], 'none')}"></span>`)}`)}</div>`,
    ex: { type: 'matrix', cols: ['title', 'speed', 'links'], rows: [{ label: '/', cells: ['ok', 'warn', 'ok'] }, { label: '/pricing', cells: ['fail', 'ok', 'none'] }] } },
  compare: { req: { left: 'obj', right: 'obj' }, opt: { delta: 'str' },
    r: p => { const side = s => `<div class="sd"><div class="t">${need(s.title)}</div><div class="s">${maybe(s.sub)}</div>${each(s.lines || [], l => `<div class="l">${need(l)}</div>`)}</div>`; return `<div class="kcmp">${side(p.left)}<div class="dl">${maybe(p.delta) || '→'}</div>${side(p.right)}</div>`; },
    ex: { type: 'compare', left: { title: 'Before', sub: 'health 43', lines: ['LCP 4.1s'] }, right: { title: 'After', sub: 'health 100', lines: ['LCP 1.2s'] }, delta: '+57' } },
  cards: { req: { items: 'arr' }, opt: { pick: 'num' },
    r: p => `<div class="kcards"${p.items.length <= 4 ? ` style="grid-template-columns:repeat(${p.items.length},minmax(0,1fr))"` : ''}>${each(p.items, (c, i) => `<div class="cd${i === p.pick ? ' on' : ''}"><div class="th${STILLS.includes(c.still) ? ' still' : ''}"${Array.isArray(c.palette) ? ` style="${['--pa', '--pb', '--pc'].map((v, j) => /^#[0-9a-f]{3,6}$/i.test(c.palette[j]) ? `${v}:${c.palette[j]}` : '').filter(Boolean).join(';')}"` : ''}>${STILLS.includes(c.still) ? stillSvg(c.still, true, c.figures) : each(c.lines || [], l => `<i>${need(l)}</i>`)}</div><b>${need(c.title)}</b>${each(c.facts || [], f => `<span class="f">${need(f)}</span>`)}${c.note ? `<span class="nt">${need(c.note)}</span>` : ''}</div>`)}</div>`,
    ex: { type: 'cards', items: [{ title: 'A · Quiet', facts: ['2 fonts'], lines: ['Hero', 'Grid'] }, { title: 'B · Bold', facts: ['1 font'], lines: ['Hero'] }] } },
  queue: { req: { items: 'arr' }, opt: { selected: 'num' },
    r: p => `<div class="kq">${each(p.items, (q, i) => `<div class="qi${i === p.selected ? ' on' : ''}${q.flag === true ? ' flag' : ''}"><span class="t">${need(q.title)}</span><span class="tg">${maybe(q.tag)}</span><span class="s">${maybe(q.sub)}</span>${q.actions ? `<span class="qa">${acts(q.actions)}</span>` : ''}</div>`)}</div>`,
    ex: { type: 'queue', selected: 0, items: [{ title: 'Invoice overdue', sub: 'accounts@', tag: 'P0', flag: true }, { title: 'Lunch?', tag: 'P3' }] } },
  timeline: { req: { tracks: 'arr' }, opt: { playhead: 'num', marks: 'arr', scale: 'arr' },
    r: p => `<div class="ktl">${p.scale ? `<div class="sc">${each(p.scale, s => `<span>${need(s)}</span>`)}</div>` : ''}${each(p.tracks, t => `<div class="tr"><span class="lb">${need(t.label)}</span><span class="ln">${each(t.spans, s => `<i class="${one(s.state, ['ok', 'fail', 'run', 'cut', 'none'], 'none')}" style="left:${Math.max(0, Math.min(100, Number(s.start) || 0))}%;width:${Math.max(0.5, Math.min(100, Number(s.len) || 0))}%" title="${maybe(s.label)}"></i>`)}</span></div>`)}${Number.isFinite(p.playhead) ? `<b class="ph" style="left:calc(90px + (100% - 90px) * ${Math.max(0, Math.min(100, p.playhead)) / 100})"></b>` : ''}</div>`,
    ex: { type: 'timeline', scale: ['0:00', '5:00', '10:00'], playhead: 40, tracks: [{ label: 'video', spans: [{ start: 0, len: 30, state: 'ok' }, { start: 32, len: 40, state: 'ok' }] }, { label: 'cuts', spans: [{ start: 30, len: 2, state: 'cut' }] }] } },
  kv: { req: { rows: 'arr' },
    r: p => `<div class="kkv">${each(p.rows, r => `<span class="k">${need(r[0])}</span><span class="v">${need(r[1])}</span>`)}</div>`,
    ex: { type: 'kv', rows: [['run', 'r-0412'], ['branch', 'ouros/rate-limit'], ['tokens', '164k']] } },
  tool: { req: { name: 'str', state: 'str' }, opt: { input: 'str', output: 'str', ms: 'num' }, set: { state: ['run', 'ok', 'fail', 'wait'] },
    r: p => `<div class="ktool ${p.state}"><div class="h"><span class="st"></span><b>${need(p.name)}</b><span class="in">${maybe(p.input)}</span><span class="sp"></span><span class="ms">${Number.isFinite(p.ms) ? (p.ms / 1000).toFixed(1) + 's' : ''}</span></div>${p.output ? `<pre>${need(p.output)}</pre>` : ''}</div>`,
    ex: { type: 'tool', name: 'Bash', state: 'ok', input: 'npm test', output: '41 passed, 0 failed', ms: 2100 } },
  tree: { req: { nodes: 'arr' },
    r: p => { const walk = (ns, d) => d > 6 ? '' : each(ns, n => `<div class="tn" style="padding-left:${d * 14}px"><span class="tw">${n.children ? '▾' : ''}</span><span class="${n.children && !n.state ? 'dir' : one(n.state, ['ok', 'fail', 'run', 'none'], 'none')}"></span><span class="tl">${need(n.label)}</span><span class="r">${maybe(n.right)}</span></div>${n.children ? walk(n.children, d + 1) : ''}`); return `<div class="ktree">${walk(p.nodes, 0)}</div>`; },
    ex: { type: 'tree', nodes: [{ label: 'test/domains.test.ts', right: '9', children: [{ label: 'lower-cases host', state: 'ok' }, { label: 'upper-case host', state: 'fail', right: '12ms' }] }] } },
  // basics (RESEARCH.md: json-render, A2UI, Zed) and shared data/agent parts (MORE.md top 15)
  text: { req: { text: 'str' }, opt: { size: 'str', tone: 'str' }, set: { size: ['h1', 'h2', 'body', 'small'], tone: ['plain', 'mute', 'ok', 'error'] },
    r: p => `<div class="ktext ${p.size || 'body'} ${p.tone || 'plain'}">${esc(p.text)}</div>`, ex: { type: 'text', text: 'Rate limit is live on /shorten.', size: 'h2' } },
  buttons: { req: { actions: 'arr' }, r: p => `<div class="kbtns">${acts(p.actions)}</div>`,
    ex: { type: 'buttons', actions: [{ label: 'Open PR', primary: true, event: 'open-pr' }, { label: 'Later' }] } },
  tabs: { req: { tabs: 'arr' }, opt: { active: 'num' },
    r: p => `<div class="ktabs"><div class="tl">${each(p.tabs, (t, i) => `<a class="${i === (p.active ?? 0) ? 'on' : ''}">${need(t.label)}${t.count != null ? ` <span>${need(t.count)}</span>` : ''}</a>`)}</div>${(() => { const t = p.tabs[p.active ?? 0]; return t && Array.isArray(t.children) ? kids(t.children) : ''; })()}</div>`,
    ex: { type: 'tabs', tabs: [{ label: 'Files', count: 2, children: [{ type: 'note', text: 'limit.ts, shorten.ts' }] }, { label: 'Checks', count: 3 }] } },
  fold: { req: { title: 'str', children: 'arr' }, opt: { open: 'bool', aside: 'str' },
    r: p => `<details class="kfold"${p.open ? ' open' : ''}><summary>${esc(p.title)}<span>${maybe(p.aside)}</span></summary>${kids(p.children)}</details>`,
    ex: { type: 'fold', title: '6 commands', aside: 'all passed', children: [{ type: 'note', text: 'npm test ×3, tsc, grep, ls' }] } },
  code: { req: { text: 'str' }, opt: { lang: 'str', title: 'str' },
    r: p => `<div class="kcode">${p.title || p.lang ? `<div class="h">${maybe(p.title)}<span>${maybe(p.lang)}</span></div>` : ''}<pre>${esc(p.text)}</pre></div>`,
    ex: { type: 'code', title: 'wrangler.toml', lang: 'toml', text: '[[unsafe.bindings]]\nname = "RATE"' } },
  spinner: { req: { text: 'str' }, r: p => `<div class="kspin"><i></i>${esc(p.text)}</div>`, ex: { type: 'spinner', text: 'Running npm test' } },
  callout: { req: { text: 'str' }, opt: { tone: 'str', title: 'str' }, set: { tone: ['info', 'ok', 'error'] },
    r: p => `<div class="kcall ${p.tone || 'info'}">${p.title ? `<b>${esc(p.title)}</b>` : ''}<span>${esc(p.text)}</span></div>`,
    ex: { type: 'callout', tone: 'info', title: 'Read only', text: 'This run cannot write outside test/.' } },
  empty: { req: { title: 'str' }, opt: { hint: 'str' }, r: p => `<div class="kempty"><b>${esc(p.title)}</b><span>${maybe(p.hint)}</span></div>`,
    ex: { type: 'empty', title: 'No findings', hint: 'Both engines approved.' } },
  json: { req: { value: 'any' }, opt: { depth: 'num' },
    r: p => { const lim = Math.max(1, Math.min(6, p.depth ?? 3)); const v = (x, d) => x === null || typeof x !== 'object' ? `<span class="${typeof x}">${esc(JSON.stringify(x))}</span>` : d >= lim ? `<span class="more">${Array.isArray(x) ? `[${x.length}]` : '{…}'}</span>` : Array.isArray(x) ? `[${x.slice(0, 20).map(y => v(y, d + 1)).join(', ')}${x.length > 20 ? ', …' : ''}]` : `{<div class="o">${Object.entries(x).slice(0, 30).map(([k, y]) => `<div><span class="key">${esc(k)}</span>: ${v(y, d + 1)}</div>`).join('')}</div>}`; return `<div class="kjson">${v(p.value, 0)}</div>`; },
    ex: { type: 'json', value: { key: 'anon', tokens: 59, at: 1730000000 } } },
  spark: { req: { values: 'arr' }, opt: { label: 'str', value: 'str' },
    r: p => { const n = p.values.filter(Number.isFinite).slice(-60); if (n.length < 2) throw 0; const lo = Math.min(...n), hi = Math.max(...n) || 1, w = 120, h = 24; const pts = n.map((y, i) => `${(i / (n.length - 1) * w).toFixed(1)},${(h - (y - lo) / (hi - lo || 1) * h).toFixed(1)}`).join(' '); return `<div class="kspark">${p.label ? `<span>${esc(p.label)}</span>` : ''}<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}"/></svg>${p.value ? `<b>${esc(p.value)}</b>` : ''}</div>`; },
    ex: { type: 'spark', label: 'tokens/min', values: [12, 18, 9, 22, 30, 26, 14], value: '14k' } },
  tracker: { req: { cells: 'arr' }, opt: { label: 'str' },
    r: p => `<div class="ktrk">${p.label ? `<span>${esc(p.label)}</span>` : ''}<span class="cells">${each(p.cells.slice(-60), c => `<i class="${one(c, ['ok', 'fail', 'run', 'none'], 'none')}"></i>`)}</span></div>`,
    ex: { type: 'tracker', label: 'last 8 runs', cells: ['ok', 'ok', 'fail', 'ok', 'ok', 'ok', 'ok', 'run'] } },
  thread: { req: { path: 'str', comments: 'arr' }, opt: { line: 'num', resolved: 'bool' },
    r: p => `<div class="kthr${p.resolved ? ' done' : ''}"><div class="h">${esc(p.path)}${Number.isFinite(p.line) ? `:${p.line}` : ''}${p.resolved ? ' <span class="pill">resolved</span>' : ''}</div>${each(p.comments, c => `<div class="c"><b>${need(c.who)}</b>${need(c.text)}</div>`)}</div>`,
    ex: { type: 'thread', path: 'src/limit.ts', line: 16, comments: [{ who: 'codex', text: 'Map never shrinks.' }, { who: 'claude', text: 'Added hourly reset.' }] } },
  trace: { req: { error: 'str', frames: 'arr' }, opt: { msg: 'str' },
    r: p => `<div class="ktrace"><div class="e">${esc(p.error)}${p.msg ? `: <span>${esc(p.msg)}</span>` : ''}</div>${each(p.frames.slice(0, 12), f => `<div class="f${f.internal ? ' int' : ''}">at ${need(f.fn)} <span>${need(f.file)}${f.line != null ? ':' + need(f.line) : ''}</span></div>`)}</div>`,
    ex: { type: 'trace', error: 'TypeError', msg: "Cannot read properties of undefined (reading 'tokens')", frames: [{ fn: 'remaining', file: 'src/limit.ts', line: 20 }, { fn: 'node:internal', file: 'loader', internal: true }] } },
  agent: { req: { name: 'str' }, opt: { model: 'str', state: 'str' }, set: { state: ['idle', 'working', 'needs', 'done'] },
    r: p => `<span class="kagent ${p.state || 'idle'}"><i class="adot ${one(p.name, ['claude', 'codex', 'gemini'], '')}"></i>${esc(p.name)}${p.model ? ` <span>${esc(p.model)}</span>` : ''}</span>`,
    ex: { type: 'agent', name: 'claude', model: 'opus', state: 'working' } },
  sources: { req: { items: 'arr' }, r: p => `<ol class="ksrc">${each(p.items, s => `<li><b>${need(s.title)}</b><span>${maybe(s.path ?? s.url)}</span>${s.quote ? `<q>${need(s.quote)}</q>` : ''}</li>`)}</ol>`,
    ex: { type: 'sources', items: [{ title: 'RFC 6585, 429 Too Many Requests', url: 'rfc-editor.org/rfc/rfc6585', quote: 'the user has sent too many requests' }] } },
  kbd: { req: { keys: 'arr' }, opt: { label: 'str' }, r: p => `<span class="kkbd">${each(p.keys, k => `<kbd>${need(k)}</kbd>`)}${p.label ? ` ${esc(p.label)}` : ''}</span>`,
    ex: { type: 'kbd', keys: ['Ctrl', 'Alt', 'W'], label: 'wall' } },
  time: { req: { iso: 'str' }, opt: { label: 'str' }, r: p => { const t = Date.parse(p.iso); if (!Number.isFinite(t)) throw 0; const s = Math.round((NOW - t) / 1000), a = Math.abs(s); const r = a < 60 ? 'just now' : a < 3600 ? `${Math.round(a / 60)}m` : a < 86400 ? `${Math.round(a / 3600)}h` : `${Math.round(a / 86400)}d`; return `<time class="ktime" title="${esc(p.iso)}">${p.label ? `<b>${esc(p.label)}</b> ` : ''}${a < 60 ? r : s >= 0 ? r + ' ago' : 'in ' + r}</time>`; },
    ex: { type: 'time', iso: '2026-10-30T14:02:00+11:00' } },
  file: { req: { path: 'str' }, opt: { line: 'num', text: 'str' },
    r: p => `<a class="kfile" data-event="open-file" data-path="${esc(p.path)}"${Number.isFinite(p.line) ? ` data-line="${p.line}"` : ''}>${esc(p.text ?? p.path)}${Number.isFinite(p.line) && p.text == null ? `:${p.line}` : ''}</a>`,
    ex: { type: 'file', path: 'src/limit.ts', line: 16 } },
  // general screens for anyone, not only developers
  stat: { req: { label: 'str', value: 'str' }, opt: { delta: 'str', dir: 'str', sub: 'str' }, set: { dir: ['up', 'down', 'flat'] },
    r: p => `<div class="kstat"><span class="l">${esc(p.label)}</span><b>${esc(p.value)}</b>${p.delta ? `<span class="d ${p.dir || 'flat'}">${p.dir === 'up' ? '▲' : p.dir === 'down' ? '▼' : ''} ${esc(p.delta)}</span>` : ''}${p.sub ? `<span class="s">${esc(p.sub)}</span>` : ''}</div>`,
    ex: { type: 'stat', label: 'Orders this week', value: '128', delta: '12%', dir: 'up', sub: 'vs last week' } },
  grid: { req: { children: 'arr' }, opt: { cols: 'num' }, r: p => `<div class="kgrid" style="--c:${Math.max(1, Math.min(6, Math.round(p.cols ?? 3)))}">${kids(p.children)}</div>`,
    ex: { type: 'grid', cols: 3, children: [{ type: 'stat', label: 'Spent', value: '$412' }, { type: 'stat', label: 'Left', value: '$188' }, { type: 'stat', label: 'Days', value: '4' }] } },
  chart: { req: { kind: 'str', labels: 'arr', series: 'arr' }, opt: { title: 'str', unit: 'str', target: 'num', forecast: 'num', tones: 'arr' }, set: { kind: ['bar', 'line', 'share'] },
    r: p => { if (p.kind === 'share') { const L = p.labels.slice(0, 8).map(need), v = (() => { if (p.series[0].values.length < L.length) throw 0; return p.series[0].values.slice(0, L.length).map(x => { if (!Number.isFinite(x) || x < 0) throw 0; return x; }); })(), sum = v.reduce((a, b) => a + b, 0) || 1; return `<figure class="kchart share">${p.title ? `<figcaption>${esc(p.title)}</figcaption>` : ''}<div class="sb">${v.map((x, i) => `<i class="c${i % 6}" style="width:${(x / sum * 100).toFixed(1)}%"></i>`).join('')}</div><div class="lg">${L.map((l, i) => `<span><i class="c${i % 6}"></i>${l} ${Math.round(v[i] / sum * 100)}%</span>`).join('')}</div></figure>`; }
      const L = p.labels.slice(0, 24).map(need), S = p.series.slice(0, 4).map(s => { if (s.values.length < L.length) throw 0; return { name: need(s.name), v: s.values.slice(0, L.length).map(x => { if (!Number.isFinite(x) || x < 0) throw 0; return x; }) }; }); const hi = Math.max(1, ...S.flatMap(s => s.v), Number.isFinite(p.target) ? p.target : 0), W = 480, H = 140, bw = W / L.length;
      const fc = i => (Number.isFinite(p.forecast) && i >= p.forecast ? ' fc' : '') + (p.tones && ['need', 'fail', 'lead'].includes(p.tones[i]) ? ' tn-' + p.tones[i] : '');
      const body = (p.kind === 'bar' ? S.map((s, j) => s.v.map((v, i) => `<rect class="s${j}${fc(i)}" x="${(i * bw + bw * 0.2 + j * bw * 0.6 / S.length).toFixed(1)}" y="${(H - v / hi * H).toFixed(1)}" width="${Math.max(1, bw * 0.6 / S.length - (S.length > 1 ? 2 : 0)).toFixed(1)}" height="${(v / hi * H).toFixed(1)}"/>`).join('')).join('') : S.map((s, j) => `<polyline class="s${j}" points="${s.v.map((v, i) => `${(i * bw + bw / 2).toFixed(1)},${(H - v / hi * H).toFixed(1)}`).join(' ')}"/>`).join('')) + (Number.isFinite(p.target) ? `<line class="tg" x1="0" x2="${W}" y1="${(H - Math.min(p.target, hi) / hi * H).toFixed(1)}" y2="${(H - Math.min(p.target, hi) / hi * H).toFixed(1)}"/>` : '');
      return `<figure class="kchart">${p.title ? `<figcaption>${esc(p.title)}${p.unit ? ` <span>${esc(p.unit)}</span>` : ''}</figcaption>` : ''}<svg viewBox="0 -4 ${W} ${H + 4}" preserveAspectRatio="none">${body}</svg><div class="xl">${L.map(l => `<span>${l}</span>`).join('')}</div>${S.length > 1 ? `<div class="lg">${S.map((s, j) => `<span><i class="s${j}"></i>${s.name}</span>`).join('')}</div>` : ''}</figure>`; },
    ex: { type: 'chart', kind: 'bar', title: 'Orders per day', labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], series: [{ name: 'orders', values: [18, 22, 15, 30, 43] }] } },
  field: { req: { label: 'str', kind: 'str' }, opt: { value: 'str', options: 'arr', placeholder: 'str', event: 'str', to: 'str' }, set: { kind: ['text', 'longtext', 'number', 'date', 'select', 'check', 'money'] },
    r: p => `<label class="kfield ${p.kind}"><span>${esc(p.label)} <em class="to">${SOURCE !== 'system' ? 'goes to ' + esc(AGENT) : typeof p.to === 'string' && p.to ? esc(p.to) : 'stays in Ouros'}</em></span>${p.kind === 'check' ? `<i class="bx${p.value === 'yes' ? ' on' : ''}"></i>` : `<span class="f" data-event="${maybe(p.event ?? 'field')}">${p.kind === 'money' ? '$ ' : ''}${p.value != null ? esc(p.value) : `<i>${maybe(p.placeholder)}</i>`}${p.kind === 'select' ? `<em>▾${p.options ? ' ' + p.options.map(need).length + ' options' : ''}</em>` : ''}${p.kind === 'date' ? '<em>▦</em>' : ''}${p.event && (p.kind === 'text' || p.kind === 'longtext') ? '<em><kbd>Enter</kbd></em>' : ''}</span>`}</label>`,
    ex: { type: 'field', label: 'Budget per night', kind: 'money', value: '120' } },
  calendar: { req: { days: 'arr', events: 'arr' }, opt: { hours: 'arr' },
    r: p => `<div class="kcal" style="--d:${Math.min(7, p.days.length)}"><span></span>${each(p.days.slice(0, 7), d => `<span class="dh">${need(d)}</span>`)}<div class="ev" style="grid-column:2/-1">${each(p.events, e => { if (!Number.isInteger(e.day) || e.day < 0 || e.day > 6) throw 0; return `<div class="e ${one(e.tone, ['plain', 'mark', 'done'], 'plain')}" style="grid-column:${e.day + 1}"><b>${maybe(e.time)}</b>${need(e.title)}</div>`; })}</div></div>`,
    ex: { type: 'calendar', days: ['Mon', 'Tue', 'Wed'], events: [{ day: 0, time: '9:00', title: 'Cells and organelles' }, { day: 2, time: '14:00', title: 'Practice paper 1', tone: 'mark' }] } },
  image: { req: { asset: 'str', alt: 'str' }, opt: { caption: 'str', still: 'str' }, set: { still: STILLS },
    r: p => { if (!/^asset:[a-z0-9-]{1,40}$/.test(p.asset)) throw 0; return `<figure class="kimg"><div class="ph" role="img" aria-label="${esc(p.alt)}">${stillSvg(p.still || 'photo')}<span>${esc(p.alt)} · ${esc(p.asset)}</span></div>${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''}</figure>`; },
    ex: { type: 'image', asset: 'asset:kiln-photo', alt: 'Kiln with cracked door seal', caption: 'From your Photos folder' } },
  use: { req: { template: 'str' }, opt: { data: 'obj' },
    r: p => { if (!Object.hasOwn(TEMPLATES, p.template) || USE_DEPTH > 2) throw 0; const d = p.data || {}; const filled = JSON.parse(JSON.stringify(TEMPLATES[p.template]).replace(/"\{\{(\w+)\}\}"|\{\{(\w+)\}\}/g, (m, whole, part) => whole ? JSON.stringify(d[whole] ?? '') : JSON.stringify(String(d[part] ?? '')).slice(1, -1))); USE_DEPTH++; try { return render(filled); } finally { USE_DEPTH--; } },
    ex: { type: 'use', template: 'hello', data: { who: 'Sam' } } }
};
// templates: saved specs with {{slot}} strings, filled by `use`; PROFILE: what this user hides
const TEMPLATES = { hello: { type: 'text', text: 'Morning {{who}}, nothing needs you.' } };
const PROFILE = { hide: [] };
const NOW = Date.parse('2026-10-30T17:00:00+11:00');
let USE_DEPTH = 0;
// SOURCE: only 'system' surfaces (Ouros's own gate and pipeline runner) may draw orange or a real gate
let SOURCE = 'agent', AGENT = 'agent', DEPTH = 0, COUNT = 0;
const MAX_DEPTH = 12, MAX_PARTS = 1500, NEVER_HIDE = ['gate', 'choice', 'handback', 'page', 'section', 'columns', 'grid', 'tabs', 'fold', 'use', 'pipe'];
function surface(spec, source = 'agent', agent = 'agent') {
  SOURCE = source === 'system' ? 'system' : 'agent'; AGENT = String(agent); DEPTH = 0; COUNT = 0;
  try { return `<div class="ksurf ${SOURCE}" data-agent="${esc(AGENT)}">${render(spec)}</div>`; } finally { SOURCE = 'agent'; AGENT = 'agent'; }
}

function render(spec) {
  try {
    const c = spec && typeof spec === 'object' && typeof spec.type === 'string' && Object.hasOwn(KIT, spec.type) ? KIT[spec.type] : null;
    if (!c) return raw(spec, 'not in the catalogue');
    if (DEPTH === 0) COUNT = 0;
    if (++COUNT > MAX_PARTS) return COUNT === MAX_PARTS + 1 ? raw({ type: spec.type }, 'screen too big: over ' + MAX_PARTS + ' parts') : '';
    if (DEPTH >= MAX_DEPTH) return raw({ type: spec.type }, 'nested too deep');
    if (!NEVER_HIDE.includes(spec.type) && PROFILE.hide.includes(spec.type)) return '';
    const bad = Object.entries(c.req).find(([k, t]) => !TYPES[t](spec[k]))?.[0]
      || Object.entries(c.opt || {}).find(([k, t]) => spec[k] !== undefined && !TYPES[t](spec[k]))?.[0]
      || (c.set && Object.entries(c.set).find(([k, s]) => spec[k] !== undefined && !s.includes(spec[k]))?.[0]);
    if (bad) return raw(spec, 'wrong or missing prop: ' + bad);
    DEPTH++; try { return c.r(spec); } finally { DEPTH--; }
  } catch { return raw(spec, 'could not draw'); }
}
