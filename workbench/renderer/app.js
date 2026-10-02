'use strict';

const api = window.troop;
const PROBE = new URLSearchParams(location.search).has('probe');
const ROLES = ['trigger', 'ingest', 'research', 'plan', 'worker', 'review', 'verify', 'visual-check', 'gate', 'publish'];
const KINDS = ['agent', 'action', 'pipeline', 'code', 'gate'];
const STATE_WORDS = { starting: 'starting', working: 'working', waiting_for_you: 'waiting for you', done: 'done', idle: 'idle', unknown: 'state unknown', exited: 'exited' };

const ui = {
  snap: null,
  projectId: load('projectId'),
  tab: ['diff', 'handback', 'browser', 'runs', 'pipelines'].includes(load('tab')) ? load('tab') : 'diff',
  split: load('split') !== '0',
  mode: load('mode') === 'grid' ? 'grid' : 'single',
  localSel: null,
  shells: [],
  shellKinds: [],
  shellSel: null,
  look: null,
  runId: null,
  pipelineId: null,
  editor: null,
  paneId: null,
  browserMode: 'live',
  comment: null,
  swap: false,
  images: {},
  lastBounds: '',
  log: [],
  rendered: {},
};

function load(key) {
  try { return localStorage.getItem(`troop.${key}`); } catch { return null; }
}

function save(key, value) {
  try { if (value === null) localStorage.removeItem(`troop.${key}`); else localStorage.setItem(`troop.${key}`, value); } catch {}
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function ago(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function toast(text, error = false) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = text;
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), error ? (ui.look ? ui.look.ui.error_toast_ms : 7000) : (ui.look ? ui.look.ui.toast_ms : 3500));
}

async function rpc(method, params, quiet = false) {
  const out = await api.call(method, params);
  if (out.kind === 'queued') {
    toast('Queued: it runs when the core starts.');
    return { queued: true };
  }
  if (out.kind === 'offline') {
    toast('The core is offline.', true);
    return { error: { message: 'core offline' } };
  }
  const r = out.reply;
  if (r.error) {
    const detail = r.error.data && Array.isArray(r.error.data.errors) ? `\n${r.error.data.errors.join('\n')}` : '';
    if (!quiet) toast(`${r.error.message}${detail}`, true);
    return { error: r.error };
  }
  return { result: r.result };
}

function setHtml(id, html) {
  if (ui.rendered[id] === html) return;
  ui.rendered[id] = html;
  const el = document.getElementById(id);
  const focused = el.contains(document.activeElement) ? document.activeElement : null;
  const key = focused && focused.dataset ? focused.dataset.key : null;
  const pos = focused && 'selectionStart' in focused ? [focused.selectionStart, focused.selectionEnd] : null;
  el.innerHTML = html;
  if (key) {
    const again = el.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (again) {
      again.focus();
      if (pos && 'setSelectionRange' in again) try { again.setSelectionRange(pos[0], pos[1]); } catch {}
    }
  }
}

function project() {
  return ui.snap && ui.snap.projects.find((p) => p.id === ui.projectId);
}



function untilText(iso) {
  const ms = Date.parse(iso) - Date.now();
  if (!(ms > 0)) return 'reset passed';
  const h = Math.floor(ms / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 24 ? `resets in ${Math.floor(h / 24)}d ${h % 24}h` : `resets in ${h}h ${m}m`;
}

function usageBar(rows) {
  const by = new Map();
  for (const r of rows) by.set(r.provider, [...(by.get(r.provider) || []), r]);
  return [...by].map(([provider, list]) => {
    const ok = list.filter((r) => r.status === 'ok' && r.used_pct !== null);
    if (!ok.length) return `<span class="chip" title="No local source for this provider's limits">${esc(provider)} · usage unavailable</span>`;
    const hot = ok.some((r) => r.used_pct >= 80);
    const parts = ok.map((r) => `${Math.round(r.used_pct)}% ${esc(r.window === 'weekly' ? 'wk' : r.window)}${r.used_pct >= 80 && r.resets_at ? ` (${esc(untilText(r.resets_at).replace("resets in ", ""))} left)` : ''}`);
    const title = ok.map((r) => `${r.window}: ${Math.round(r.used_pct)}%${r.resets_at ? `, ${untilText(r.resets_at)}` : ''}`).join('\n') + `\nread ${ok[0].read_at}`;
    return `<span class="chip ${hot ? 'warn' : ''}" title="${esc(title)}">${esc(provider)} ${parts.join(' · ')}</span>`;
  }).join('');
}

function meter(x) {
  if (x.tokens === null || x.tokens === undefined) return 'tokens unknown';
  const usd = x.usd === null || x.usd === undefined ? 'price unknown' : `$${x.usd.toFixed(2)}`;
  return `${x.tokens.toLocaleString()} tokens · ${usd}`;
}



function inputField(name, spec) {
  const key = `input:${name}`;
  const label = esc(spec.label || name);
  if (spec.type === 'boolean') return `<label>${label}</label><input type="checkbox" data-input="${esc(name)}" data-key="${esc(key)}">`;
  if (spec.type === 'choice') return `<label>${label}</label><select data-input="${esc(name)}" data-key="${esc(key)}">${(spec.choices || []).map((c) => `<option>${esc(c)}</option>`).join('')}</select>`;
  const type = spec.type === 'number' ? 'number' : 'text';
  return `<label>${label}</label><input type="${type}" data-input="${esc(name)}" data-key="${esc(key)}" value="${esc(spec.default ?? '')}">`;
}

function renderRuns() {
  const s = ui.snap;
  const valid = s.pipelines.filter((p) => p.valid);
  if (!ui.pipelineId || !valid.some((p) => p.id === ui.pipelineId)) ui.pipelineId = valid[0] ? valid[0].id : null;
  const chosen = valid.find((p) => p.id === ui.pipelineId);
  const start = `<div class="panel">
    <h3>Start a run</h3>
    ${valid.length ? `<div class="form">
      <label>Pipeline</label><select data-action="pick-pipeline" data-key="pick-pipeline">${valid.map((p) => `<option value="${esc(p.id)}" ${p.id === ui.pipelineId ? 'selected' : ''}>${esc(p.title)} (${esc(p.source)})</option>`).join('')}</select>
      ${chosen ? Object.entries(chosen.inputs).map(([n, spec]) => inputField(n, spec)).join('') : ''}
      <span></span><div><button class="primary" data-action="start-run">Start</button></div>
    </div>` : '<p class="empty">No valid pipelines. Add one on the Pipelines tab.</p>'}
  </div>`;
  const top = s.runs.filter((r) => !r.parent_run);
  const list = top.length
    ? `<div class="list">${top.map((r) => `<div class="item ${r.id === ui.runId ? 'on' : ''}" data-action="run" data-id="${esc(r.id)}">
        <span class="grow">${esc(r.pipeline_id)} <span class="meta" data-ago="${esc(r.started_at)}">${esc(ago(r.started_at))}</span></span>
        <span class="state ${esc(r.status)}">${esc(r.status)}${r.paused_why ? `: ${esc(r.paused_why)}` : ''}</span></div>`).join('')}</div>`
    : '<p class="empty">No runs yet.</p>';
  return `${start}<div class="split"><div class="panel"><h3>Runs</h3>${list}</div><div>${renderRunDetail()}</div></div>`;
}

function renderRunDetail() {
  const s = ui.snap;
  const run = s.runs.find((r) => r.id === ui.runId);
  if (!run) return '<div class="panel empty">Pick a run to see its steps.</div>';
  const children = new Set(s.runs.filter((r) => r.parent_run === run.id).map((r) => r.id));
  const steps = s.steps.filter((x) => x.run_id === run.id || children.has(x.run_id));
  const actions = [];
  if (run.status === 'running' || run.status === 'paused') actions.push('<button class="danger" data-action="cancel-run">Cancel</button>');
  if ((run.status === 'paused' && run.paused_why !== 'gate' && run.paused_why !== 'handoff') || (run.status === 'failed' && run.paused_why !== 'breaker')) {
    actions.push(run.paused_why === 'budget'
      ? '<span class="label">Raise tokens to</span><input type="number" data-key="raise-tokens" id="raise-tokens" style="width:110px"><button data-action="resume-run">Resume</button>'
      : '<button data-action="resume-run">Resume</button>');
  }
  const rows = steps.map((x) => `<tr>
    <td>${children.has(x.run_id) ? '↳ ' : ''}${esc(x.step_id)}</td><td>${x.iteration}</td><td>${x.fanout_index}</td>
    <td><span class="state ${esc(x.status)}">${esc(x.status)}</span></td><td>${esc(x.engine_id || '')}</td>
    <td>${x.fail_count || ''}</td><td>${x.session_id ? `<button class="link" data-action="focus" data-id="${esc(x.session_id)}">window</button>` : ''}</td></tr>`).join('');
  return `<div class="panel">
    <div class="toolbar"><h3 style="margin:0">${esc(run.pipeline_id)}</h3><span class="state ${esc(run.status)}">${esc(run.status)}${run.paused_why ? `: ${esc(run.paused_why)}` : ''}</span>${actions.join('')}</div>
    <table><thead><tr><th>Step</th><th>Loop</th><th>Index</th><th>Status</th><th>Engine</th><th>Fails</th><th></th></tr></thead><tbody>${rows}</tbody></table>
  </div>
  ${renderVariants()}
  ${renderReview()}
  ${renderBoard()}
  <div class="panel"><h3>Log</h3><div class="log">${esc(ui.log.map(formatLog).join('\n')) || '<span class="empty">empty</span>'}</div></div>`;
}

function renderVariants() {
  const vs = ui.snap.variants || [];
  if (!vs.length) return '';
  ui.combine = (ui.combine || []).filter((i) => vs.some((v) => v.idx === i && v.status !== 'discarded'));
  const tiles = vs.map((v) => {
    const live = v.status !== 'discarded';
    const where = [v.branch, v.dev_port ? `port ${v.dev_port}` : '', v.step_id && v.step_id.startsWith('combine-') ? v.step_id : ''].filter(Boolean).map(esc).join(' · ');
    return `<div class="card ${v.status === 'picked' ? 'on' : ''} ${live ? '' : 'gone'}">
      <div class="toolbar"><b>Variant ${v.idx + 1}</b><span class="state ${esc(v.status)}">${esc(v.status)}</span>
        ${live ? `<label class="meta"><input type="checkbox" data-action="variant-toggle" data-idx="${v.idx}" ${ui.combine.includes(v.idx) ? 'checked' : ''}> combine</label>` : ''}</div>
      <div class="meta">${esc(v.engine_id || 'engine pending')} · ${esc(meter(v))}</div>
      ${where ? `<div class="meta">${where}</div>` : ''}
      <div class="actions">
        ${v.pane_id && live ? `<button data-action="variant-pane" data-id="${esc(v.pane_id)}">Pane</button>` : ''}
        ${live && v.status !== 'picked' ? `<button class="primary" data-action="variant-pick" data-idx="${v.idx}">Pick</button>` : ''}
        ${live ? `<button class="danger" data-action="variant-discard" data-idx="${v.idx}">Discard</button>` : ''}
      </div></div>`;
  }).join('');
  const n = ui.combine.length;
  return `<div class="panel"><h3>Variants</h3><div class="cards">${tiles}</div>
    <div class="form"><label>Combine note</label><textarea rows="2" data-key="combine-note" id="combine-note" placeholder="What to take from each"></textarea>
    <span></span><div><button data-action="variant-combine" ${n < 2 ? 'disabled' : ''}>Combine ${n} selected</button> <span class="meta">${n < 2 ? 'Tick at least 2 variants.' : 'Starts a new variant from the project HEAD with your note, their diffs and screenshots.'}</span></div></div>
  </div>`;
}

function finding(f) {
  if (!f) return '<td></td>';
  return `<td><b>${esc(f.severity || '')}</b> ${esc(f.file || '')}:${esc(f.line_start ?? '')}-${esc(f.line_end ?? '')}<div>${esc(f.title || '')}</div><div class="meta">${esc(f.body || '')}</div></td>`;
}

function renderReview() {
  const r = ui.review;
  if (!r) return '';
  const names = { both: 'Both found', codex_only: 'Only Codex', gemini_only: 'Only Gemini', disagree: 'Disagree (one approves)' };
  const sections = Object.entries(names).map(([k, title]) => {
    const rows = (r[k] || []).map((x) => `<tr>${finding(x.codex)}${finding(x.gemini)}</tr>`).join('');
    return `<h3>${esc(title)} <span class="count">${(r[k] || []).length}</span></h3>
      ${rows ? `<table><thead><tr><th>Codex</th><th>Gemini</th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">None.</p>'}`;
  }).join('');
  return `<div class="panel"><h3>Review</h3>
    <div class="meta">Codex: ${esc(r.codex_verdict ?? 'unknown')} · Gemini: ${esc(r.gemini_verdict ?? 'unknown')}</div>${sections}</div>`;
}

function renderBoard() {
  const items = ui.snap.board || [];
  if (!items.length) return '';
  const img = (file) => {
    if (!file) return '<p class="empty">no capture</p>';
    if (ui.images[file] === undefined) {
      ui.images[file] = null;
      void api.snapshotImage(file).then((d) => { ui.images[file] = d || ''; render(); });
    }
    return ui.images[file] ? `<img src="${esc(ui.images[file])}" alt="">` : '<p class="empty">loading</p>';
  };
  const cards = items.map((b) => `<figure class="board-card ${b.pinned ? 'pinned' : ''}">
      ${img(b.capture_path)}
      <figcaption>
        <div class="meta" title="${esc(b.source_url)}">${esc(hostOf(b.source_url))}</div>
        <p>${esc(b.reason)}</p>
        <div class="row">
          <button data-action="board-pin" data-id="${esc(b.id)}" data-on="${b.pinned ? '0' : '1'}">${b.pinned ? 'Unpin' : 'Pin'}</button>
          <button data-action="board-open" data-url="${esc(b.source_url)}">Open in pane</button>
          <button class="danger" data-action="board-remove" data-id="${esc(b.id)}">Remove</button>
        </div>
      </figcaption>
    </figure>`).join('');
  const pinned = items.filter((b) => b.pinned).length;
  return `<div class="panel"><h3>Inspiration board · ${items.length} references${pinned ? `, ${pinned} pinned` : ''}</h3><div class="board">${cards}</div></div>`;
}

function formatLog(line) {
  try {
    const e = JSON.parse(line);
    const time = String(e.at || '').slice(11, 19);
    const what = e.event || e.line || '';
    const where = [e.step, e.index !== undefined ? `#${e.index}` : '', e.why || e.detail || ''].filter(Boolean).join(' ');
    return `${time} ${what}${where ? `  ${where}` : ''}`;
  } catch {
    return line;
  }
}

function hostOf(url) {
  try { return new URL(url).host || url; } catch { return url || 'blank'; }
}

function renderBrowser() {
  const s = ui.snap;
  if (ui.paneId && !s.panes.some((p) => p.id === ui.paneId)) ui.paneId = null;
  if (!ui.paneId && s.panes[0]) ui.paneId = s.panes[0].id;
  const engineOf = (sid) => (s.sessions.find((x) => x.id === sid) || {}).engine_id;
  const chips = s.panes.map((p) => `<button class="chip ${p.id === ui.paneId ? 'on' : ''}" data-action="pane" data-id="${esc(p.id)}">${esc(hostOf(p.url))}${p.session_id ? ` · ${esc(engineOf(p.session_id) || 'session')}` : p.variant !== null ? ` · variant ${p.variant + 1}` : ''}</button>`).join('');
  const pane = s.panes.find((p) => p.id === ui.paneId);
  let body;
  if (ui.comment) body = renderCommentForm();
  else if (!pane) body = '<p class="empty">No browser pane. Open one, or run a pipeline step with browser: true.</p>';
  else if (ui.browserMode === 'compare') body = renderCompare(pane);
  else body = '<div id="pane-host" class="pane-host"></div>';
  const controls = pane && !ui.comment ? `<div class="toolbar">
      <input class="url" data-key="url" id="pane-url" value="${esc(pane.url || '')}" placeholder="https://example.com or http://localhost:3001">
      <button data-action="pane-go">Go</button>
      <button data-action="pane-comment" title="Point at an element and leave a comment for a session (C)">Comment</button>
      <button data-action="pane-capture" data-label="before">Before</button>
      <button data-action="pane-capture" data-label="after">After</button>
      <button data-action="pane-mode">${ui.browserMode === 'compare' ? 'Live' : 'Compare'}</button>
      <select data-action="pane-owner" data-key="pane-owner" title="The one session allowed to drive this pane">
        <option value="">Driven by: you only</option>
        ${s.sessions.map((x) => `<option value="${esc(x.id)}" ${x.id === pane.session_id ? 'selected' : ''}>Driven by: ${esc(x.engine_id)} ${esc(x.id.slice(-8).toLowerCase())}</option>`).join('')}
      </select>
      <button class="danger" data-action="pane-close">Close</button>
    </div>` : '';
  return `<div class="browser">
    <div class="toolbar">${chips}<button data-action="pane-new">New pane</button></div>
    ${controls}
    ${body}
  </div>`;
}

function renderCommentForm() {
  const c = ui.comment;
  const s = ui.snap;
  return `<div class="panel comment-form">
    <h3>Comment on ${esc(c.selector || 'element')}</h3>
    <img class="crop" src="data:image/png;base64,${esc(c.crop)}" alt="The element you picked">
    <div class="form">
      <label>For</label><select id="comment-session" data-key="comment-session">${s.sessions.map((x) => `<option value="${esc(x.id)}">${esc(x.engine_id)} ${esc(x.id.slice(-8).toLowerCase())} (${esc(STATE_WORDS[x.state] || x.state)})</option>`).join('')}</select>
      <label>Note</label><textarea id="comment-note" data-key="comment-note" rows="4" placeholder="What should change here?"></textarea>
      <span></span><div class="toolbar"><button class="primary" data-action="comment-send" ${s.sessions.length ? '' : 'disabled'}>Send</button><button data-action="comment-cancel">Cancel</button></div>
    </div>
  </div>`;
}

function renderCompare(pane) {
  const shots = ui.snap.snapshots.filter((x) => x.pane_id === pane.id);
  const before = shots.find((x) => x.label === 'before');
  const after = shots.find((x) => x.label === 'after');
  if (!before || !after) return '<p class="empty">Take a Before and an After capture to compare them.</p>';
  const img = (file) => {
    if (!file) return '';
    if (ui.images[file] === undefined) {
      ui.images[file] = null;
      void api.snapshotImage(file).then((d) => { ui.images[file] = d || ''; render(); });
    }
    return ui.images[file] ? `<img src="${esc(ui.images[file])}" alt="">` : '<p class="empty">loading</p>';
  };
  const side = (label, shot) => `<figure><figcaption>${label} · <span data-ago="${esc(shot.taken_at)}">${esc(ago(shot.taken_at))}</span></figcaption>`;
  const [left, right] = ui.swap ? [after, before] : [before, after];
  return `<p class="meta">Hold Space to swap.</p>
    ${[390, 1280].map((w) => `<h3>${w} px</h3><div class="compare">
      ${side(left === before ? 'Before' : 'After', left)}${img(left[`w${w}_path`])}</figure>
      ${side(right === before ? 'Before' : 'After', right)}${img(right[`w${w}_path`])}</figure>
    </div>`).join('')}`;
}

function reportPaneBounds() {
  const host = ui.tab === 'browser' && ui.split && !ui.comment && ui.browserMode === 'live' ? document.getElementById('pane-host') : null;
  const r = host ? host.getBoundingClientRect() : null;
  const key = r ? `${ui.paneId}:${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}` : 'none';
  if (key === ui.lastBounds) return;
  ui.lastBounds = key;
  void api.paneShow(r ? ui.paneId : null, r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null);
}

async function startComment() {
  if (!ui.paneId) return;
  toast('Click the element you want to comment on.');
  await api.panePick(ui.paneId);
}

function blankPipeline() {
  return { schema: 1, id: 'new-pipeline', title: 'New pipeline', steps: [{ id: 'work', kind: 'agent', role: 'worker', prompt: '', outputs: ['summary'] }] };
}

function renderPipelines() {
  const s = ui.snap;
  if (ui.editor) return renderEditor();
  const rows = s.pipelines.map((p) => `<tr>
    <td>${esc(p.title)}</td><td>${esc(p.id)}</td><td>${esc(p.source)}</td>
    <td>${p.valid ? '<span class="state done">valid</span>' : `<span class="state failed" title="${esc(p.errors.join('\n'))}">${p.errors.length} error${p.errors.length === 1 ? '' : 's'}</span>`}</td>
    <td>${p.source === 'project' ? `<button data-action="edit-pipeline" data-id="${esc(p.id)}">Edit</button>` : `<button data-action="copy-pipeline" data-id="${esc(p.id)}">Copy to project</button>`}</td></tr>`).join('');
  return `<div class="toolbar"><button class="primary" data-action="new-pipeline">New pipeline</button></div>
    <div class="panel">${s.pipelines.length ? `<table><thead><tr><th>Title</th><th>Id</th><th>Source</th><th>Checks</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<p class="empty">No pipelines yet.</p>'}</div>`;
}

function stepErrors(i) {
  return (ui.editor.errors || []).filter((e) => e.startsWith(`/steps/${i} `) || e.startsWith(`/steps/${i}/`) || e.startsWith(`/steps/${i}:`));
}

function renderEditor() {
  const ed = ui.editor;
  const p = ed.json;
  const engines = ui.snap.engines.map((e) => e.id);
  const general = (ed.errors || []).filter((e) => !/^\/steps\/\d+/.test(e));
  const steps = (p.steps || []).map((st, i) => {
    const errs = stepErrors(i);
    const opt = (list, value, blank) => `${blank !== undefined ? `<option value="">${esc(blank)}</option>` : ''}${list.map((x) => `<option ${x === value ? 'selected' : ''}>${esc(x)}</option>`).join('')}`;
    const field = (label, html) => `<label>${label}</label>${html}`;
    const f = (name, extra = '') => `data-step="${i}" data-field="${name}" data-key="s${i}.${name}" ${extra}`;
    let body = field('Id', `<input ${f('id')} value="${esc(st.id)}">`) +
      field('Kind', `<select ${f('kind')}>${opt(KINDS, st.kind)}</select>`) +
      field('Role', `<select ${f('role')}>${opt(ROLES, st.role, 'none')}</select>`);
    if (st.kind === 'agent') {
      body += field('Engine', `<select ${f('engine')}>${opt(engines, typeof st.engine === 'string' ? st.engine : '', 'pick by role')}</select>`) +
        field('Prompt', `<textarea rows="4" ${f('prompt')}>${esc(st.prompt || '')}</textarea>`) +
        field('Outputs', `<input ${f('outputs')} value="${esc((st.outputs || []).join(', '))}" placeholder="summary, passed">`);
      if (st.role === 'publish' || st.external) body += field('Destination', `<input ${f('destination')} value="${esc(st.destination || '')}">`);
    }
    if (st.kind === 'action' || st.kind === 'pipeline') {
      body += field('Uses', `<input ${f('uses')} value="${esc(st.uses || '')}" placeholder="${st.kind === 'action' ? 'plugin:repo/diff' : 'pipeline:other-id'}">`) +
        field('With (JSON)', `<textarea rows="2" ${f('with')}>${esc(st.with ? JSON.stringify(st.with) : '')}</textarea>`);
    }
    if (st.kind === 'code') body += field('Module', `<input ${f('code')} value="${esc(st.code || '')}" placeholder="steps/check.mjs">`);
    if (st.kind === 'gate') {
      body += field('Gate', `<select ${f('gate')}>${opt(['approve', 'handoff'], st.gate || 'approve')}</select>`) +
        field('Summary', `<input ${f('gate_summary')} value="${esc(st.gate_summary || '')}">`);
    }
    if (st.kind !== 'gate') body += field('Fan-out', `<input type="number" min="0" max="8" ${f('fanout')} value="${esc(st.fanout || '')}" placeholder="1">`);
    return `<div class="step-edit ${errs.length ? 'bad' : ''}">
      <div class="head"><span class="grow">${i + 1}. ${esc(st.title || st.id)}</span>
        <button data-action="gate-before" data-step="${i}" title="Add an approve gate before this step">+ gate</button>
        <button data-action="step-up" data-step="${i}" ${i === 0 ? 'disabled' : ''}>Up</button>
        <button data-action="step-down" data-step="${i}" ${i === p.steps.length - 1 ? 'disabled' : ''}>Down</button>
        <button class="danger" data-action="step-remove" data-step="${i}">Remove</button></div>
      <div class="form">${body}</div>
      ${errs.length ? `<ul class="errors">${errs.map((e) => `<li>${esc(e.replace(/^\/steps\/\d+( \([^)]*\))?:?\s*/, ''))}</li>`).join('')}</ul>` : ''}
    </div>`;
  }).join('');
  return `<div class="toolbar">
      <button data-action="close-editor">Back</button>
      <button class="primary" data-action="save-pipeline">Save to project</button>
      <button data-action="toggle-raw">${ed.raw ? 'Form view' : 'JSON view'}</button>
      <span class="label">${ed.errors === null ? 'checking' : ed.errors.length ? `${ed.errors.length} problem${ed.errors.length === 1 ? '' : 's'}` : 'valid'}</span>
    </div>
    ${ed.raw ? `<div class="panel"><textarea rows="30" data-action="raw" data-key="raw">${esc(ed.rawText)}</textarea>${general.length || ed.errors ? `<ul class="errors">${(ed.errors || []).map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}</div>` : `
    <div class="panel form">
      <label>Id</label><input data-meta="id" data-key="m.id" value="${esc(p.id)}">
      <label>Title</label><input data-meta="title" data-key="m.title" value="${esc(p.title)}">
    </div>
    ${general.length ? `<ul class="errors">${general.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
    ${steps}
    <div class="toolbar"><button data-action="step-add">Add step</button></div>`}`;
}


function loadHandback() {
  if (ui.handback !== undefined || !ui.projectId) return;
  ui.handback = null;
  const id = ui.projectId;
  void api.handback(id, ui.runId).then((r) => { if (ui.projectId === id) { ui.handback = r; render(); } });
}

function renderHandback() {
  loadHandback();
  const h = ui.handback;
  const title = h && h.variant !== undefined ? `Picked variant ${h.variant + 1} (${esc(h.branch)})` : 'Staged changes';
  const bar = `<div class="toolbar"><h3 style="margin:0">${title}</h3><button data-action="handback-refresh">Refresh</button></div>`;
  if (!h) return `<div class="panel">${bar}<p class="empty">Loading.</p></div>`;
  if (h.error) return `<div class="panel">${bar}<p class="empty">${esc(h.error)}</p></div>`;
  const byName = h.files.filter((f) => f.kind !== 'text').map((f) => `<li>${esc(f.path)} <span class="meta">${esc(f.kind)}</span></li>`).join('');
  const texts = h.files.filter((f) => f.kind === 'text').map((f) => `<button class="chip ${ui.hbFile === f.path ? 'on' : ''}" data-action="hb-file" data-file="${esc(f.path)}">${esc(f.path)} <span class="meta">+${f.added} -${f.deleted}</span></button>`).join('');
  return `<div class="panel">${bar}
    ${h.files.length ? `<div class="log">${esc(h.stat)}</div>` : `<p class="empty">${h.variant !== undefined ? 'No changes in this variant.' : 'Nothing staged.'}</p>`}
    ${texts ? `<h3>Comment on a line</h3><div class="toolbar">${texts}</div>${renderDiff()}` : ''}
    ${byName ? `<h3>Binary and submodules</h3><ul>${byName}</ul>` : ''}
    ${h.untracked.length ? `<h3>Untracked (never staged here)</h3><ul>${h.untracked.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${h.files.length ? `<h3>Command to run</h3><div class="log">${esc(h.command)}</div>
    <div class="actions"><button class="primary" data-action="handback-copy">Copy</button></div>` : ''}
  </div>`;
}

function renderDiff() {
  if (!ui.hbFile) return '<p class="meta">Pick a file to see its diff, then click a line.</p>';
  if (ui.hbDiff === undefined) return '<p class="empty">Loading diff.</p>';
  if (ui.hbDiff === null) return '<p class="empty">Could not read the diff for this file.</p>';
  const lines = diffLines(ui.hbDiff);
  const rows = lines.map((l, i) => l.kind === 'hunk'
    ? `<div class="hunk">${esc(l.text)}</div>`
    : `<div class="${l.kind}${ui.hbLine === i ? ' on' : ''}" data-action="hb-line" data-i="${i}">${esc(String(l.line).padStart(5))} ${esc(l.text)}</div>`).join('');
  const picked = ui.hbLine !== null && ui.hbLine !== undefined ? lines[ui.hbLine] : null;
  const sessions = ui.snap.sessions.filter((x) => x.state !== 'exited');
  const form = picked ? `<div class="form">
      <label>Line</label><div class="meta">${esc(ui.hbFile)}:${picked.line}${picked.kind === 'del' ? ' (removed line, old numbering)' : ''}</div>
      <label>Note</label><textarea rows="2" id="hb-note" data-key="hb-note"></textarea>
      <label>Session</label><select id="hb-session" data-key="hb-session">${sessions.map((x) => `<option value="${esc(x.id)}">${esc(x.engine_id)} · ${esc(x.id.slice(-8).toLowerCase())}</option>`).join('')}</select>
      <span></span><div><button class="primary" data-action="hb-send" ${sessions.length ? '' : 'disabled'}>Send</button> ${sessions.length ? '' : '<span class="meta">No live session to send to.</span>'}</div>
    </div>` : '';
  return `<div class="diff">${rows}</div>${form}`;
}

function refreshHandback() {
  ui.handback = undefined;
  ui.hbFile = null;
  ui.hbLine = null;
  render();
}


const TABS = [['diff', 'Diff'], ['handback', 'Hand-back'], ['browser', 'Browser'], ['runs', 'Runs'], ['pipelines', 'Pipelines']];
const THEME_VARS = { bg: '--bg', panel: '--panel', panel2: '--panel-2', line: '--line', text: '--text', muted: '--muted', accent: '--accent', on_accent: '--on-accent', ok: '--green', warn: '--amber', bad: '--red', grey: '--grey', unseen: '--unseen', term_bg: '--term-bg', term_fg: '--term-fg', add_bg: '--add-bg', add_fg: '--add-fg', del_bg: '--del-bg', del_fg: '--del-fg', font_ui: '--font-ui', font_mono: '--font-mono' };

function applyLook(look) {
  ui.look = look;
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(THEME_VARS)) if (look.theme[k]) root.setProperty(v, look.theme[k]);
  root.setProperty('--blue', look.theme.accent);
  root.setProperty('--chip-bg', look.theme.panel2);
  root.setProperty('--rail-w', `${look.ui.rail_width}px`);
  root.setProperty('--split-w', `${look.ui.split_width}px`);
  root.colorScheme = look.theme.scheme || 'dark';
  termView.setLook(look);
}

function short(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function taskOf(x) {
  const t = (x.title || '').trim();
  if (t && !/[\\/]/.test(t)) return t;
  return x.step_id || 'session';
}

function unseen(x) {
  return x.state === 'done';
}

function liveSessions() {
  return ui.snap.sessions.filter((x) => x.state !== 'exited');
}

function shellRows() {
  return ui.shells.filter((x) => x.project_id === ui.projectId).map((x) => ({ id: x.id, engine_id: x.label, state: x.exited ? 'exited' : 'idle', task: x.cwd, title: x.cwd, shell: true }));
}

function selectedSession() {
  if (ui.shellSel) { const sh = shellRows().find((x) => x.id === ui.shellSel); if (sh) return sh; }
  const s = ui.snap.sessions;
  return s.find((x) => x.id === ui.snap.selected) || s.find((x) => x.id === ui.localSel) || liveSessions()[0] || null;
}

function stepsOf(runId) {
  const s = ui.snap;
  const run = s.runs.find((r) => r.id === runId);
  if (!run) return null;
  const rows = s.steps.filter((x) => x.run_id === runId);
  const pipe = s.pipelines.find((p) => p.id === run.pipeline_id);
  const ids = pipe && pipe.step_defs.length ? pipe.step_defs.map((d) => d.id) : [...new Set(rows.map((x) => x.step_id))];
  const list = ids.map((id) => {
    const mine = rows.filter((x) => x.step_id === id);
    const iter = mine.reduce((m, x) => Math.max(m, x.iteration), 0);
    const cur = mine.filter((x) => x.iteration === iter);
    const def = pipe ? pipe.step_defs.find((d) => d.id === id) : null;
    const status = !mine.length ? 'pending' : cur.some((x) => x.status === 'failed') ? 'failed' : cur.some((x) => x.status === 'running') ? 'running'
      : cur.some((x) => x.status === 'waiting') ? 'waiting' : cur.every((x) => x.status === 'done' || x.status === 'skipped') ? 'done' : cur[0].status;
    return {
      id, status, def,
      items: cur.length > 1 ? { done: cur.filter((x) => x.status === 'done').length, total: cur.length } : null,
      loop: iter > 0 ? { at: iter + 1, max: def && def.loop_max ? def.loop_max : null } : null,
      fails: mine.reduce((n, x) => n + (x.fail_count || 0), 0),
      gates: s.gates.filter((g) => g.run_id === runId && g.step_id === id),
    };
  });
  const at = list.findIndex((x) => x.status !== 'done' && x.status !== 'skipped');
  return { run, list, at: at < 0 ? list.length : at + 1 };
}

function stepError(runId, stepId) {
  const cache = (ui.stepErrors ||= {});
  const key = `${runId}:${ui.snap.at - (ui.snap.at % 5000)}`;
  if (!cache[runId] || cache[runId].key !== key) {
    cache[runId] = { key, log: cache[runId] ? cache[runId].log : [] };
    void api.runLog(runId).then((log) => { cache[runId].log = log || []; render(); });
  }
  for (const line of [...cache[runId].log].reverse()) {
    try {
      const e = JSON.parse(line);
      if (e.event === 'step failed' && e.step === stepId) return e.why || 'failed';
    } catch {}
  }
  return null;
}

function stepListHtml(steps) {
  const dot = (st) => (st === 'running' ? 'working' : st === 'waiting' ? 'waiting_for_you' : st);
  return `<div class="steps"><div class="s cur"><span class="dot ${esc(dot(steps.run.status === 'running' ? 'running' : steps.run.status))}"></span>${esc(steps.run.pipeline_id)} step ${Math.min(steps.at, steps.list.length)} of ${steps.list.length}</div>
    ${steps.list.map((st) => {
      const meta = [st.items ? `${st.items.done}/${st.items.total}` : '', st.loop ? `loop ${st.loop.at}${st.loop.max ? ` of ${st.loop.max}` : ''}` : '', st.fails ? `${st.fails} fail${st.fails === 1 ? '' : 's'}` : '', st.status].filter(Boolean).join(' · ');
      const err = st.status === 'failed' ? stepError(steps.run.id, st.id) : null;
      const gates = st.gates.map((g) => `<div class="step-gate">${esc(g.summary)}
        ${g.kind === 'handoff' ? `<button class="primary" data-action="gate" data-decision="approve" data-id="${esc(g.id)}">Continue</button>`
          : `<button class="primary" data-action="gate" data-decision="approve" data-id="${esc(g.id)}">Approve</button><button class="danger" data-action="gate" data-decision="reject" data-id="${esc(g.id)}">Reject</button>`}</div>`).join('');
      return `<div class="s s-${esc(st.status)}" data-step="${esc(st.id)}"><span class="dot ${esc(dot(st.status))}"></span>${esc(st.id)} <span class="meta">${esc(meta)}</span></div>${gates}${err ? `<div class="step-err">${esc(err)}</div>` : ''}`;
    }).join('')}</div>`;
}

function gateHtml(g) {
  return `<div class="gate">
    <div class="meta">${esc(g.pipeline_id)} · ${esc(g.kind === 'auto-external' ? 'external step' : g.kind)}${g.guards_step ? ` · guards ${esc(g.guards_step)}` : ''}</div>
    <div class="summary">${esc(g.summary)}</div>
    <div class="actions">
      ${g.kind === 'handoff' ? `<button class="primary" data-action="gate" data-decision="approve" data-id="${esc(g.id)}">Continue</button>` : `
      <input placeholder="Note" data-note="${esc(g.id)}" data-key="note:${esc(g.id)}">
      <button class="primary" data-action="gate" data-decision="approve" data-id="${esc(g.id)}">Approve</button>
      <button class="danger" data-action="gate" data-decision="reject" data-id="${esc(g.id)}">Reject</button>`}
    </div></div>`;
}

function resumeButton(x) {
  const e = ui.snap.engines.find((y) => y.id === x.engine_id);
  return e && e.resumable && x.native_id
    ? `<button data-action="resume" data-id="${esc(x.id)}" title="Start ${esc(x.engine_id)} again with this conversation">Resume</button>`
    : `<button data-action="resume" data-id="${esc(x.id)}" title="Start ${esc(x.engine_id)} in the same folder">Start new here</button>`;
}

function rowHtml(x, sel) {
  const g = (ui.snap.git || {})[x.id];
  const asking = x.state === 'waiting_for_you';
  const lines = [];
  if (g && g.branch) lines.push(`<div class="sub">${esc(g.branch)} <span class="add">+${g.added}</span> <span class="del">-${g.deleted}</span></div>`);
  if (x.last_line) lines.push(`<div class="sub${asking ? ' asking' : ''}" title="${esc(x.last_line)}">${esc(x.last_line)}</div>`);
  const steps = sel && x.run_id ? stepsOf(x.run_id) : null;
  const stepList = steps ? stepListHtml(steps) : '';
  return `<div class="srow${sel ? ' on' : ''}" data-action="pick" data-id="${esc(x.id)}" data-drop-session="${esc(x.id)}" title="Drop files here to send their paths to this session">
    <div class="top-line"><span class="dot ${esc(x.state)}${unseen(x) ? ' unseen' : ''}"></span>${esc(x.engine_id)} <span class="task">${esc(taskOf(x))}</span>
      <span class="when" data-short="${esc(x.state_at)}">${esc(short(x.state_at))}</span><button class="link hide" data-action="hide" data-id="${esc(x.id)}" title="Hide this session">x</button></div>
    ${lines.join('')}${x.state === 'exited' ? `<div class="sub">${resumeButton(x)}</div>` : ''}</div>${stepList}`;
}

function renderRail(sel) {
  const s = ui.snap;
  const age = s.core.heartbeat_age_ms;
  setHtml('core', s.core.online ? '<span class="dot green" title="Core online"></span>'
    : `<span class="badge offline" title="${age !== null ? `last seen ${Math.round(age / 1000)}s ago` : ''}">offline</span>`);
  setHtml('project-pick', s.projects.length
    ? s.projects.map((p) => `<option value="${esc(p.id)}" ${p.id === ui.projectId ? 'selected' : ''} title="${esc(p.path)}">${esc(p.name)}</option>`).join('')
    : '<option value="">No project</option>');
  const needs = s.needs_you.filter((n) => !['gate', 'handoff', 'done', 'failed'].includes(n.kind));
  setHtml('gates', s.gates.length || needs.length ? `<div class="head">Needs you</div>${s.gates.map(gateHtml).join('')}${needs.map((n) => `<div class="gate need">
      <div class="meta">${esc(n.kind)} · <span data-ago="${esc(n.at)}">${esc(ago(n.at))}</span></div><div>${esc(n.text)}</div>
      <div class="actions"><button data-action="dismiss" data-id="${esc(n.id)}">Dismiss</button></div></div>`).join('')}` : '');
  const shells = shellRows();
  setHtml('sessions', (s.sessions.length ? `<div class="head">Agents</div>${s.sessions.map((x) => rowHtml(x, sel && x.id === sel.id)).join('')}` : '')
    + (shells.length ? `<div class="head">Shells</div>${shells.map((x) => `<div class="srow${sel && sel.id === x.id ? ' on' : ''}" data-action="pick-shell" data-id="${esc(x.id)}">
        <div class="top-line"><span class="dot ${x.state === 'exited' ? 'exited' : 'idle'}"></span>${esc(x.engine_id)} <span class="task">${esc(x.task)}</span>
        <button class="link hide" data-action="shell-close" data-id="${esc(x.id)}" title="Close this shell">x</button></div></div>`).join('')}` : ''));
  setHtml('launch', project() ? `<span class="label">New</span>${s.engines.map((e) => `<button data-action="launch" data-engine="${esc(e.id)}" ${e.light === 'red' ? 'disabled' : ''} title="Start ${esc(e.id)} in this project">${esc(e.id)}</button>`).join('')}${ui.shellKinds.map((k) => `<button data-action="shell-open" data-kind="${esc(k.kind)}" title="A plain ${esc(k.label)} tab in this project">${esc(k.label)}</button>`).join('')}` : '');
}

function renderTermHead(sel) {
  if (sel && sel.shell && ui.mode !== 'grid') {
    setHtml('term-head', `<span class="dot idle"></span><b>${esc(sel.engine_id)}</b><span class="what">${esc(sel.task)}</span><span class="grow"></span><button data-action="mode" title="Ctrl+G">Grid</button>`);
    return;
  }
  if (!sel || ui.mode === 'grid') {
    setHtml('term-head', ui.mode === 'grid' ? `<b>All agents</b><span class="what">${liveSessions().length} live</span><span class="grow"></span><button data-action="mode" title="Ctrl+G">One terminal</button>` : '');
    return;
  }
  setHtml('term-head', `<span class="dot ${esc(sel.state)}${unseen(sel) ? ' unseen' : ''}"></span><b>${esc(sel.engine_id)}</b>
    <span class="what">${esc(taskOf(sel))} · ${esc(STATE_WORDS[sel.state] || sel.state)}</span><span class="grow"></span>
    ${sel.state === 'exited' ? resumeButton(sel) : ''}
    <button data-action="mode" title="Ctrl+G">Grid</button>
    <button data-action="tab" data-tab="diff" title="Show what this agent changed">Diff</button>
    <button data-action="tab" data-tab="handback" title="The command to commit these changes">Hand back</button>`);
}

function renderStart() {
  const el = document.getElementById('start');
  const show = !project() || (!ui.snap.sessions.length && !shellRows().length);
  el.hidden = !show;
  document.getElementById('centre').hidden = show;
  if (!show) return;
  const p = project();
  const engines = ui.snap.engines;
  setHtml('start', `<h3>Start an agent</h3><ol>
    <li class="${p ? 'done' : ''}">${p ? `Folder: <b>${esc(p.name)}</b> <span class="meta">${esc(p.path)}</span>` : '<button class="primary" data-action="open-folder">Open a project folder</button>'}</li>
    <li>${p ? `Agent: ${engines.map((e) => `<button class="${ui.startEngine === e.id ? 'primary' : ''}" data-action="start-engine" data-engine="${esc(e.id)}" ${e.light === 'red' ? 'disabled' : ''}>${esc(e.id)}</button>`).join(' ')}` : 'Pick an agent'}</li>
    <li>${p ? `Task (optional):<textarea rows="3" id="start-task" data-key="start-task" placeholder="What should it do? Leave empty to just open it."></textarea>
      <div class="actions"><button class="primary" data-action="start-go" ${ui.startEngine ? '' : 'disabled'}>Start</button></div>` : 'Say what to do, or leave it empty'}</li>
  </ol>`);
}

function renderTabs() {
  const d = ui.sdiff && ui.sdiff.data;
  const n = d && d.files ? d.files.length + d.untracked.length : 0;
  setHtml('tabs', TABS.map(([id, label]) => `<button class="${ui.tab === id ? 'on' : ''}" data-action="tab" data-tab="${id}">${label}${id === 'diff' && n ? `<span class="n">${n}</span>` : ''}</button>`).join('')
    + '<button data-action="split-close" title="Close the side panel">x</button>');
}

function loadSessionDiff(sel) {
  if (!sel || (ui.sdiff && ui.sdiff.session === sel.id && ui.sdiff.at > Date.now() - (ui.look ? ui.look.terminal.git_every_ms : 10000))) return;
  ui.sdiff = { session: sel.id, at: Date.now(), data: ui.sdiff && ui.sdiff.session === sel.id ? ui.sdiff.data : null };
  void api.sessionDiff(sel.id).then((data) => { if (ui.sdiff && ui.sdiff.session === sel.id) { ui.sdiff.data = data; render(); } });
}

function renderDiffTab(sel) {
  if (!sel) return '<p class="empty">Pick an agent to see what it changed.</p>';
  loadSessionDiff(sel);
  const d = ui.sdiff && ui.sdiff.data;
  if (!d) return '<p class="empty">Loading.</p>';
  if (d.error) return `<p class="empty">${esc(d.error)}</p>`;
  if (!d.files.length && !d.untracked.length) return '<p class="empty">No uncommitted changes in this agent\'s folder.</p>';
  if (!ui.sdFile || !d.files.some((f) => f.path === ui.sdFile)) ui.sdFile = d.files[0] ? d.files[0].path : null;
  const want = `${sel.id}:${ui.sdFile}:${ui.sdiff.at}`;
  if (ui.sdFile && ui.sdKey !== want) {
    ui.sdKey = want;
    const file = ui.sdFile;
    void api.sessionDiffFile(sel.id, file).then((text) => { if (ui.sdFile === file) { ui.hbFile = file; ui.hbDiff = text; render(); } });
  }
  const chips = d.files.map((f) => `<button class="chip ${ui.sdFile === f.path ? 'on' : ''}" data-action="sd-file" data-file="${esc(f.path)}">${esc(f.path)} <span class="meta">+${f.added ?? '?'} -${f.deleted ?? '?'}</span></button>`).join('');
  ui.hbFile = ui.sdFile;
  return `<div class="toolbar">${chips}</div>${ui.sdFile ? renderDiff() : ''}${d.untracked.length ? `<h3>New files not yet added</h3><ul>${d.untracked.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}`;
}

function renderStrip(sel) {
  const s = ui.snap;
  const needs = s.needs_you.filter((n) => !n.read_at).length + s.sessions.filter((x) => x.state === 'waiting_for_you').length;
  const steps = sel && sel.run_id ? stepsOf(sel.run_id) : null;
  const working = s.sessions.filter((x) => x.state === 'working').length;
  setHtml('strip', `${needs ? `<span class="needs" data-action="inbox"><span class="dot waiting_for_you"></span> ${needs} need${needs === 1 ? 's' : ''} you</span>` : '<span class="link" data-action="inbox">nothing waiting</span>'}
    ${steps ? `<span>${esc(steps.run.pipeline_id)} <b>step ${Math.min(steps.at, steps.list.length)} of ${steps.list.length}</b></span>` : ''}
    <span>${working} working</span><span class="grow"></span>
    <span class="usage-bar">${usageBar(s.limits || [])}</span>
    <button class="link" data-action="palette" title="Command palette">Ctrl+K</button>`);
}

function renderInbox() {
  const el = document.getElementById('inbox');
  if (el.hidden) return;
  const s = ui.snap;
  const waiting = s.sessions.filter((x) => x.state === 'waiting_for_you');
  const rows = s.needs_you.map((n) => `<div class="item${n.read_at ? ' read' : ''}" data-action="inbox-open" data-id="${esc(n.id)}">
      <span class="dot ${n.kind === 'done' ? 'done unseen' : n.kind === 'failed' ? 'failed' : 'waiting_for_you'}"></span>
      <span class="grow">${esc(n.text)}<span class="meta"> · ${esc(n.kind)} · <span data-ago="${esc(n.at)}">${esc(ago(n.at))}</span></span></span>
      <button class="link" data-action="${n.read_at ? 'inbox-unread' : 'inbox-read'}" data-id="${esc(n.id)}">${n.read_at ? 'Mark unread' : 'Mark read'}</button></div>`).join('');
  const asks = waiting.map((x) => `<div class="item" data-action="pick" data-id="${esc(x.id)}"><span class="dot waiting_for_you"></span><span class="grow">${esc(x.engine_id)} ${esc(taskOf(x))} is asking you<span class="meta"> · ${esc(x.last_line || '')}</span></span></div>`).join('');
  setHtml('inbox-list', asks + rows || '<p class="empty" style="padding:6px 14px">Nothing here.</p>');
}

function paletteItems() {
  const s = ui.snap;
  const items = [];
  for (const g of s.gates) if (g.kind !== 'handoff') items.push({ group: 'Needs you', label: `Approve: ${g.summary}`, run: () => rpc('gate.resolve', { gate_id: g.id, decision: 'approve', action_hash: g.action_hash }) });
  for (const x of s.sessions) items.push({ group: 'Agents', label: `${x.engine_id} ${taskOf(x)}`, meta: STATE_WORDS[x.state] || x.state, run: () => pick(x.id) });
  if (project()) for (const e of s.engines) if (e.light !== 'red') items.push({ group: 'Start', label: `New ${e.id} agent`, run: async () => { const r = await rpc('session.launch', { project_id: ui.projectId, engine_id: e.id }); if (r.result) await pick(r.result.session_id); } });
  const sel = selectedSession();
  if (sel) items.push({ group: 'Actions', label: 'Paste the held prompt into this terminal', run: async () => { const r = await rpc('session.paste-prompt', { session_id: sel.id }); if (r.result && !r.result.written) toast(r.result.reason); } });
  for (const k of ui.shellKinds) if (project()) items.push({ group: 'Start', label: `New ${k.label} tab`, run: () => openShell(k.kind) });
  for (const p of s.pipelines.filter((x) => x.valid)) items.push({ group: 'Run', label: `Run ${p.title}`, meta: p.id, run: async () => { const r = await rpc('run.start', { pipeline_id: p.id, project_id: ui.projectId, inputs: {} }); if (r.result) { ui.runId = r.result.run_id; setView(); openTab('runs'); } } });
  items.push({ group: 'Actions', label: ui.mode === 'grid' ? 'Show one terminal' : 'Show all agents as a grid', meta: 'Ctrl+G', run: () => setMode(ui.mode === 'grid' ? 'single' : 'grid') });
  items.push({ group: 'Actions', label: 'Open a browser pane', run: async () => { const r = await rpc('pane.open', { project_id: ui.projectId }); if (r.result) { ui.paneId = r.result.pane_id; openTab('browser'); } } });
  items.push({ group: 'Actions', label: 'Open a project folder', run: openFolder });
  for (const [id, label] of TABS) items.push({ group: 'Panels', label, run: () => openTab(id) });
  for (const t of (ui.look && ui.look.themes) || []) items.push({ group: 'Theme', label: `Theme: ${t.label}`, meta: ui.look.theme.name === t.id ? 'current' : '', run: async () => { const theme = await api.setTheme(t.id); if (theme) applyLook({ ...ui.look, theme }); render(); } });
  return items;
}

function renderPalette() {
  const q = document.getElementById('palette-input').value.trim().toLowerCase();
  const all = paletteItems().filter((x) => !q || `${x.group} ${x.label}`.toLowerCase().includes(q));
  ui.paletteItems = all;
  ui.paletteAt = Math.min(ui.paletteAt || 0, Math.max(0, all.length - 1));
  let last = '';
  document.getElementById('palette-list').innerHTML = all.map((x, i) => {
    const head = x.group !== last ? `<div class="group">${esc(x.group)}</div>` : '';
    last = x.group;
    return `${head}<div class="item${i === ui.paletteAt ? ' on' : ''}" data-palette="${i}">${esc(x.label)}${x.meta ? `<span class="meta">${esc(x.meta)}</span>` : ''}</div>`;
  }).join('') || '<p class="empty" style="padding:6px 14px">No match.</p>';
}

function openPalette() {
  const el = document.getElementById('palette');
  el.hidden = false;
  const input = document.getElementById('palette-input');
  input.value = '';
  ui.paletteAt = 0;
  renderPalette();
  input.focus();
}

function closePalette() {
  document.getElementById('palette').hidden = true;
}

async function runPalette(i) {
  const item = (ui.paletteItems || [])[i];
  closePalette();
  if (item) await item.run();
}

async function openTab(tab) {
  if (tab === 'browser' && ui.projectId && !ui.snap.panes.length) {
    const r = await rpc('pane.open', { project_id: ui.projectId });
    if (r.result) ui.paneId = r.result.pane_id;
  }
  ui.tab = tab;
  ui.split = true;
  save('tab', tab);
  save('split', '1');
  if ((tab === 'handback' || tab === 'diff') && ui.handback === undefined) refreshHandback();
  else render();
}

function setMode(mode) {
  ui.mode = mode;
  save('mode', mode);
  render();
}

function selectShell(id) {
  ui.shellSel = id;
  ui.mode = 'single';
  render(true);
}

async function openShell(kind) {
  const r = await rpc('shell.open', { project_id: ui.projectId, kind });
  if (!r.result) return;
  ui.shells.push({ id: r.result.shell_id, label: r.result.label, cwd: r.result.cwd, project_id: ui.projectId });
  selectShell(r.result.shell_id);
}

async function pick(id) {
  ui.shellSel = null;
  ui.localSel = id;
  ui.mode = 'single';
  save('mode', 'single');
  await rpc('session.focus', { session_id: id }, true);
  render(true);
}

function render(focus = false) {
  if (!ui.snap) return;
  const sel = selectedSession();
  document.body.classList.toggle('no-split', !ui.split);
  renderRail(sel);
  renderTermHead(sel);
  renderStart();
  const shown = [...ui.snap.sessions, ...shellRows()].filter((x) => ui.mode === 'grid' ? x.state !== 'exited' : true)
    .map((x) => ({ id: x.id, engine_id: x.engine_id, state: x.state, task: x.shell ? x.task : taskOf(x), unseen: !x.shell && unseen(x), words: x.shell ? 'shell' : STATE_WORDS[x.state] || x.state }));
  termView.show({ mode: ui.mode, selected: sel ? sel.id : null, sessions: project() ? shown : [], onPick: (id) => (id.startsWith('sh_') ? selectShell(id) : void pick(id)), onExit: (id) => { const sh = ui.shells.find((x) => x.id === id); if (sh) { sh.exited = true; render(); } }, focus });
  renderTabs();
  let html;
  if (!project()) html = '<p class="empty">Open a project folder to begin.</p>';
  else if (ui.tab === 'runs') html = renderRuns();
  else if (ui.tab === 'pipelines') html = renderPipelines();
  else if (ui.tab === 'browser') html = renderBrowser();
  else if (ui.tab === 'handback') html = renderHandback();
  else html = renderDiffTab(sel);
  setHtml('view', html);
  reportPaneBounds();
  renderStrip(sel);
  renderInbox();
  if (PROBE) void api.probe({ sessions: ui.snap.sessions.map((x) => ({ id: x.id, state: x.state })), online: ui.snap.core.online, term: termView.state(), layout: { tab: ui.tab, split: ui.split, mode: ui.mode, rows: document.querySelectorAll('.srow').length, start: !document.getElementById('start').hidden } });
}

async function refreshLog() {
  if (!ui.runId) {
    ui.log = [];
    ui.review = null;
    return;
  }
  const id = ui.runId;
  const [log, review] = await Promise.all([api.runLog(id), api.review(id)]);
  if (ui.runId !== id) return;
  ui.log = log;
  ui.review = review;
}

function setView() {
  void api.view({ projectId: ui.projectId, runId: ui.runId });
}

let validateTimer = null;

function editorChanged() {
  const ed = ui.editor;
  if (!ed.raw) ed.rawText = JSON.stringify(ed.json, null, 2);
  ed.errors = null;
  clearTimeout(validateTimer);
  validateTimer = setTimeout(async () => {
    let json;
    try {
      json = JSON.parse(ed.rawText);
    } catch (e) {
      ed.errors = [`not valid JSON: ${e.message}`];
      render();
      return;
    }
    const r = await rpc('pipeline.validate', { json }, true);
    if (ui.editor !== ed) return;
    ed.errors = r.result ? r.result.errors : [r.error ? r.error.message : 'the core is offline, so the pipeline was not checked'];
    render();
  }, 300);
  render();
}

function openEditor(json) {
  ui.editor = { json, raw: false, rawText: JSON.stringify(json, null, 2), errors: null };
  editorChanged();
}

async function openFolder() {
  const dir = await api.pickFolder();
  if (!dir) return;
  const r = await rpc('project.open', { path: dir });
  if (r.result) {
    ui.projectId = r.result.project_id;
    ui.handback = undefined;
    save('projectId', ui.projectId);
    setView();
  }
}

async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
  const a = el.dataset.action;
  const id = el.dataset.id;
  if (a !== 'seen') e.stopPropagation();
  switch (a) {
    case 'open-folder':
      await openFolder();
      return;
    case 'pick':
      await pick(id);
      return;
    case 'mode':
      setMode(ui.mode === 'grid' ? 'single' : 'grid');
      return;
    case 'split-close':
      ui.split = false;
      save('split', '0');
      render();
      return;
    case 'palette':
      openPalette();
      return;
    case 'inbox': {
      const box = document.getElementById('inbox');
      box.hidden = !box.hidden;
      renderInbox();
      return;
    }
    case 'inbox-read':
      await rpc('needs_you.mark-read', { id });
      return;
    case 'inbox-unread':
      await rpc('needs_you.mark-unread', { id });
      return;
    case 'inbox-open': {
      const n = ui.snap.needs_you.find((y) => y.id === id);
      document.getElementById('inbox').hidden = true;
      if (!n) return;
      if ((n.kind === 'done' || n.kind === 'failed') && n.ref) await pick(n.ref);
      else { await rpc('needs_you.mark-read', { id }, true); document.getElementById('gates').scrollIntoView({ block: 'start' }); }
      return;
    }
    case 'resume': {
      const r = await rpc('session.resume', { session_id: id });
      if (r.result) await pick(r.result.session_id);
      return;
    }
    case 'clear-status':
      document.getElementById('menu').hidden = true;
      await rpc('session.clear-status', { session_id: id });
      return;
    case 'menu-hide':
      document.getElementById('menu').hidden = true;
      await rpc('session.hide', { session_id: id });
      return;
    case 'start-engine':
      ui.startEngine = el.dataset.engine;
      render();
      return;
    case 'start-go': {
      const task = (document.getElementById('start-task') || {}).value || '';
      const params = { project_id: ui.projectId, engine_id: ui.startEngine };
      if (task.trim()) params.prompt = task.trim();
      const r = await rpc('session.launch', params);
      if (r.result) { ui.startEngine = null; await pick(r.result.session_id); }
      return;
    }
    case 'project':
      ui.projectId = id;
      ui.runId = null;
      ui.editor = null;
      ui.handback = undefined;
      save('projectId', id);
      setView();
      return;
    case 'tab':
      await openTab(el.dataset.tab);
      return;
    case 'handback-refresh':
      refreshHandback();
      return;
    case 'handback-copy':
      if (ui.handback && ui.handback.command) {
        await api.copyText(ui.handback.command);
        toast('Copied. Run it yourself.');
      }
      return;
    case 'check-engines':
      await rpc('engines.check', {});
      return;
    case 'launch': {
      const r = await rpc('session.launch', { project_id: ui.projectId, engine_id: el.dataset.engine });
      if (r.result && r.result.setup) toast(`Set up ${el.dataset.engine} for Metatrooper: ${r.result.setup.join(', ')}`);
      if (r.result) await pick(r.result.session_id);
      return;
    }
    case 'shell-open':
      await openShell(el.dataset.kind);
      return;
    case 'pick-shell':
      selectShell(id);
      return;
    case 'shell-close':
      await rpc('shell.close', { shell_id: id }, true);
      ui.shells = ui.shells.filter((x) => x.id !== id);
      if (ui.shellSel === id) ui.shellSel = null;
      render();
      return;
    case 'focus':
      await pick(id);
      return;
    case 'hide':
      await rpc('session.hide', { session_id: id });
      return;
    case 'seen': {
      const x = ui.snap.sessions.find((y) => y.id === id);
      if (x && x.state === 'done') await rpc('session.seen', { session_id: id }, true);
      return;
    }
    case 'run':
      ui.runId = id;
      setView();
      await refreshLog();
      render();
      return;
    case 'start-run': {
      const chosen = ui.snap.pipelines.find((p) => p.id === ui.pipelineId);
      if (!chosen) return;
      const inputs = {};
      for (const input of document.querySelectorAll('[data-input]')) {
        const spec = chosen.inputs[input.dataset.input] || {};
        inputs[input.dataset.input] = spec.type === 'boolean' ? input.checked : spec.type === 'number' ? Number(input.value) : input.value;
      }
      const r = await rpc('run.start', { pipeline_id: chosen.id, project_id: ui.projectId, inputs });
      if (r.result) {
        ui.runId = r.result.run_id;
        setView();
      }
      return;
    }
    case 'cancel-run':
      await rpc('run.cancel', { run_id: ui.runId });
      return;
    case 'hb-file': {
      const file = el.dataset.file;
      ui.hbFile = file;
      ui.hbDiff = undefined;
      ui.hbLine = null;
      render();
      const text = await api.handbackFile(ui.projectId, ui.runId, file);
      if (ui.hbFile === file) { ui.hbDiff = text; render(); }
      return;
    }
    case 'sd-file':
      ui.sdFile = el.dataset.file;
      ui.hbDiff = undefined;
      render();
      return;
    case 'hb-line':
      ui.hbLine = Number(el.dataset.i);
      render();
      return;
    case 'hb-send': {
      const l = diffLines(ui.hbDiff || '')[ui.hbLine];
      const note = (document.getElementById('hb-note') || {}).value || '';
      const session_id = (document.getElementById('hb-session') || {}).value;
      if (!l || !note.trim()) { toast('Write a note first.', true); return; }
      const r = await api.commentDiffLine({ session_id, note, file: ui.hbFile, line: l.line, text: l.text });
      if (!r.ok) { toast(r.error, true); return; }
      toast('Comment sent: on the clipboard, and in the session\'s next prompt for Claude.');
      ui.hbLine = null;
      render();
      return;
    }
    case 'variant-toggle': {
      const idx = Number(el.dataset.idx);
      ui.combine = el.checked ? [...new Set([...(ui.combine || []), idx])] : (ui.combine || []).filter((i) => i !== idx);
      render();
      return;
    }
    case 'variant-pane':
      ui.paneId = id;
      ui.browserMode = 'live';
      ui.tab = 'browser';
      ui.split = true;
      save('tab', ui.tab);
      render();
      return;
    case 'variant-pick': {
      const r = await rpc('variant.pick', { run_id: ui.runId, idx: Number(el.dataset.idx) });
      if (!r.error && !r.queued) toast(`Variant ${Number(el.dataset.idx) + 1} picked. Its diff is in Hand-back.`);
      return;
    }
    case 'variant-discard': {
      const idx = Number(el.dataset.idx);
      if (!window.confirm(`Discard variant ${idx + 1}? This removes its worktree and branch, stops its dev server and closes its pane.`)) return;
      await rpc('variant.discard', { run_id: ui.runId, idx });
      return;
    }
    case 'variant-combine': {
      const note = (document.getElementById('combine-note') || {}).value || '';
      if (!note.trim()) { toast('Write a note saying what to take from each variant.', true); return; }
      const r = await rpc('variant.combine', { run_id: ui.runId, indices: ui.combine, note });
      if (r.result) { ui.combine = []; toast(`Combine started as ${r.result.step_id}.`); }
      return;
    }
    case 'resume-run': {
      const raise = document.getElementById('raise-tokens');
      const params = { run_id: ui.runId };
      if (raise && raise.value) params.max_tokens = Number(raise.value);
      await rpc('run.resume', params);
      return;
    }
    case 'gate': {
      const g = ui.snap.gates.find((x) => x.id === id);
      if (!g) return;
      const note = document.querySelector(`[data-note="${CSS.escape(id)}"]`);
      const params = { gate_id: id, decision: el.dataset.decision, action_hash: g.action_hash };
      if (note && note.value) params.note = note.value;
      await rpc('gate.resolve', params);
      return;
    }
    case 'pane':
      ui.paneId = id;
      ui.browserMode = 'live';
      render();
      return;
    case 'pane-new': {
      const r = await rpc('pane.open', { project_id: ui.projectId });
      if (r.result) ui.paneId = r.result.pane_id;
      return;
    }
    case 'pane-close':
      await rpc('pane.close', { pane_id: ui.paneId });
      ui.paneId = null;
      return;
    case 'pane-go': {
      const url = document.getElementById('pane-url').value.trim();
      if (!url) return;
      const r = await api.paneNavigate(ui.paneId, url);
      if (!r.ok) toast(r.error, true);
      return;
    }
    case 'pane-comment':
      await startComment();
      return;
    case 'board-pin':
      await rpc('board.pin', { item_id: el.dataset.id, pinned: el.dataset.on === '1' });
      return;
    case 'board-remove':
      await rpc('board.remove', { item_id: el.dataset.id });
      return;
    case 'board-open': {
      const r = await rpc('pane.open', { project_id: ui.projectId, url: el.dataset.url });
      if (r.result) { ui.paneId = r.result.pane_id; ui.tab = 'browser';
      ui.split = true; save('tab', ui.tab); render(); }
      return;
    }
    case 'pane-capture':
      toast(`Capturing ${el.dataset.label} at 390 and 1280 px`);
      await rpc('pane.capture', { pane_id: ui.paneId, label: el.dataset.label });
      return;
    case 'pane-mode':
      ui.browserMode = ui.browserMode === 'compare' ? 'live' : 'compare';
      render();
      return;
    case 'comment-cancel':
      ui.comment = null;
      render();
      return;
    case 'comment-send': {
      const note = document.getElementById('comment-note').value.trim();
      const session_id = document.getElementById('comment-session').value;
      if (!note) return toast('Write a note first.', true);
      const r = await api.commentSave({ ...ui.comment, session_id, note });
      if (!r.ok) return toast(r.error, true);
      toast('Comment sent: on the clipboard, and in the session\'s next prompt for Claude.');
      ui.comment = null;
      render();
      return;
    }
    case 'dismiss':
      await rpc('needs.dismiss', { id });
      return;
    case 'new-pipeline':
      openEditor(blankPipeline());
      return;
    case 'edit-pipeline':
    case 'copy-pipeline': {
      const text = await api.readPipeline(id);
      if (!text) return toast('Could not read that pipeline file.', true);
      try {
        openEditor(JSON.parse(text));
      } catch (err) {
        toast(`The file is not valid JSON: ${err.message}`, true);
      }
      return;
    }
    case 'close-editor':
      ui.editor = null;
      render();
      return;
    case 'toggle-raw': {
      const ed = ui.editor;
      if (ed.raw) {
        try {
          ed.json = JSON.parse(ed.rawText);
        } catch (err) {
          return toast(`Fix the JSON first: ${err.message}`, true);
        }
      }
      ed.raw = !ed.raw;
      editorChanged();
      return;
    }
    case 'save-pipeline': {
      const r = await api.savePipeline(ui.projectId, ui.editor.raw ? ui.editor.rawText : JSON.stringify(ui.editor.json));
      if (!r.ok) return toast(r.error, true);
      toast(`Saved ${r.path}`);
      await rpc('pipeline.validate', { json: ui.editor.raw ? JSON.parse(ui.editor.rawText) : ui.editor.json }, true);
      return;
    }
    case 'step-add':
      ui.editor.json.steps.push({ id: `step-${ui.editor.json.steps.length + 1}`, kind: 'agent', role: 'worker', prompt: '', outputs: ['summary'] });
      editorChanged();
      return;
    case 'step-remove':
      ui.editor.json.steps.splice(Number(el.dataset.step), 1);
      editorChanged();
      return;
    case 'step-up':
    case 'step-down': {
      const i = Number(el.dataset.step);
      const j = a === 'step-up' ? i - 1 : i + 1;
      const s = ui.editor.json.steps;
      [s[i], s[j]] = [s[j], s[i]];
      editorChanged();
      return;
    }
    case 'gate-before': {
      const i = Number(el.dataset.step);
      const taken = new Set(ui.editor.json.steps.map((s) => s.id));
      let n = 1;
      while (taken.has(`approve-${n}`)) n++;
      ui.editor.json.steps.splice(i, 0, { id: `approve-${n}`, kind: 'gate', gate: 'approve' });
      editorChanged();
      return;
    }
  }
}

function onInput(e) {
  const el = e.target;
  if (el.id === 'palette-input') {
    ui.paletteAt = 0;
    renderPalette();
    return;
  }
  if (el.dataset.action === 'project-pick') {
    if (e.type !== 'change' || !el.value) return;
    ui.projectId = el.value;
    ui.runId = null;
    ui.editor = null;
    ui.handback = undefined;
    save('projectId', el.value);
    setView();
    return;
  }
  if (el.dataset.action === 'pane-owner') {
    if (e.type === 'change') void rpc('pane.assign', { pane_id: ui.paneId, session_id: el.value || null });
    return;
  }
  if (!ui.editor) {
    if (el.dataset.action === 'pick-pipeline') {
      ui.pipelineId = el.value;
      render();
    }
    return;
  }
  const ed = ui.editor;
  if (el.dataset.action === 'raw') {
    ed.rawText = el.value;
    editorChanged();
    return;
  }
  if (el.dataset.meta) {
    ed.json[el.dataset.meta] = el.value;
    editorChanged();
    return;
  }
  if (el.dataset.step === undefined || !el.dataset.field) return;
  const st = ed.json.steps[Number(el.dataset.step)];
  const f = el.dataset.field;
  const v = el.value;
  if (f === 'outputs') st.outputs = v.split(',').map((x) => x.trim()).filter(Boolean);
  else if (f === 'fanout') {
    if (Number(v) >= 2) st.fanout = Number(v);
    else delete st.fanout;
  } else if (f === 'with') {
    try {
      st.with = v.trim() ? JSON.parse(v) : undefined;
      if (st.with === undefined) delete st.with;
    } catch {
      return;
    }
  } else if (v === '' && f !== 'prompt') delete st[f];
  else st[f] = v;
  if (f === 'kind') {
    for (const k of ['prompt', 'engine', 'outputs', 'uses', 'with', 'code', 'gate', 'gate_summary', 'destination']) delete st[k];
    if (v === 'agent') st.prompt = '';
    if (v === 'gate') st.gate = 'approve';
  }
  editorChanged();
}

function observeLongTasks() {
  if (typeof PerformanceObserver === 'undefined') return;
  let batch = [];
  try {
    new PerformanceObserver((list) => {
      for (const t of list.getEntries()) batch.push({ start: Math.round(t.startTime), duration: Math.round(t.duration) });
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    return;
  }
  setInterval(() => {
    if (!batch.length) return;
    const send = batch;
    batch = [];
    void api.longtasks(send);
  }, 5000);
}

function tickAges() {
  for (const el of document.querySelectorAll('[data-ago]')) {
    const text = ago(el.dataset.ago);
    if (el.textContent !== text) el.textContent = text;
  }
  for (const el of document.querySelectorAll('[data-short]')) {
    const text = short(el.dataset.short);
    if (el.textContent !== text) el.textContent = text;
  }
}

api.onSnapshot(async (s) => {
  ui.snap = s;
  if (ui.projectId && !s.projects.some((p) => p.id === ui.projectId)) {
    ui.projectId = null;
    save('projectId', null);
  }
  if (!ui.projectId && s.projects[0]) {
    ui.projectId = s.projects[0].id;
    setView();
  }
  if (ui.tab === 'runs' && ui.runId) await refreshLog();
  render();
});

document.addEventListener('click', (e) => {
  const item = e.target.closest && e.target.closest('[data-palette]');
  if (item) { void runPalette(Number(item.dataset.palette)); return; }
  if (!document.getElementById('palette').hidden && !e.target.closest('#palette')) closePalette();
  if (!e.target.closest('#menu')) document.getElementById('menu').hidden = true;
  if (!document.getElementById('inbox').hidden && !e.target.closest('#inbox') && !e.target.closest('[data-action="inbox"]')) document.getElementById('inbox').hidden = true;
  void onClick(e);
});
document.addEventListener('contextmenu', (e) => {
  const row = e.target.closest && e.target.closest('.srow');
  const menu = document.getElementById('menu');
  if (!row) { menu.hidden = true; return; }
  e.preventDefault();
  const id = row.dataset.id;
  menu.innerHTML = `<div class="item" data-action="clear-status" data-id="${esc(id)}">Clear status</div><div class="item" data-action="menu-hide" data-id="${esc(id)}">Hide</div>`;
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.hidden = false;
});
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  const card = e.target.closest && e.target.closest('[data-drop-session]');
  const onTerm = e.target.closest && e.target.closest('#centre .tile');
  for (const c of document.querySelectorAll('.srow.drop')) if (c !== card) c.classList.remove('drop');
  if (card) card.classList.add('drop');
  e.dataTransfer.dropEffect = card || onTerm ? 'copy' : 'none';
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const onTerm = e.target.closest && e.target.closest('#centre .tile');
  if (onTerm && e.dataTransfer.files.length) {
    const paths = api.filePaths(e.dataTransfer.files).map((p) => (/[\s"]/.test(p) ? `"${p.replace(/"/g, '\\"')}"` : p));
    termView.type(paths.join(' ') + ' ');
    return;
  }
  for (const c of document.querySelectorAll('.srow.drop')) c.classList.remove('drop');
  const card = e.target.closest && e.target.closest('[data-drop-session]');
  if (!card || !e.dataTransfer.files.length) return;
  const r = await api.commentFiles(card.dataset.dropSession, e.dataTransfer.files);
  toast(r.ok ? `${e.dataTransfer.files.length} file path(s) sent: on the clipboard, and in the session's next prompt for Claude.` : r.error, !r.ok);
});
document.addEventListener('keydown', (e) => {
  const palette = !document.getElementById('palette').hidden;
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if (palette) closePalette(); else openPalette(); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') { e.preventDefault(); setMode(ui.mode === 'grid' ? 'single' : 'grid'); return; }
  if (palette) {
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ui.paletteAt = Math.max(0, Math.min((ui.paletteItems || []).length - 1, (ui.paletteAt || 0) + (e.key === 'ArrowDown' ? 1 : -1))); renderPalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); void runPalette(ui.paletteAt || 0); }
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
  if (ui.tab !== 'browser' || typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'c' && ui.browserMode === 'live' && !ui.comment) void startComment();
  if (e.key === ' ' && ui.browserMode === 'compare' && !ui.swap) {
    e.preventDefault();
    ui.swap = true;
    render();
  }
});
document.addEventListener('keyup', (e) => {
  if (e.key === ' ' && ui.swap) {
    ui.swap = false;
    render();
  }
});
window.addEventListener('resize', reportPaneBounds);
api.onCommentPicked((info) => {
  ui.comment = info;
  ui.tab = 'browser';
      ui.split = true;
  render();
});
document.addEventListener('change', onInput);
document.addEventListener('input', (e) => { if (e.target.tagName !== 'SELECT') onInput(e); });
observeLongTasks();
setInterval(tickAges, 5000);
void api.uiSettings().then((look) => { applyLook(look); render(); });
void rpc('shell.list', {}, true).then((r) => { if (r.result) { ui.shellKinds = r.result.shells; render(); } });
setView();
