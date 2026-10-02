'use strict';

const api = window.troop;
const PROBE = new URLSearchParams(location.search).has('probe');
const ROLES = ['trigger', 'ingest', 'research', 'plan', 'worker', 'review', 'verify', 'visual-check', 'gate', 'publish'];
const KINDS = ['agent', 'action', 'pipeline', 'code', 'gate'];
const STATE_WORDS = { starting: 'starting', working: 'working', waiting_for_you: 'waiting for you', done: 'done', idle: 'idle', unknown: 'state unknown', exited: 'exited' };

const ui = {
  snap: null,
  projectId: load('projectId'),
  tab: load('tab') || 'sessions',
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
  setTimeout(() => el.remove(), error ? 7000 : 3500);
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

function renderSide() {
  const s = ui.snap;
  const age = s.core.heartbeat_age_ms;
  setHtml('core', s.core.online
    ? `<span class="badge online"><span class="dot green"></span>Core online</span>`
    : `<span class="badge offline"><span class="dot red"></span>Core offline${age !== null ? `, last seen ${Math.round(age / 1000)}s ago` : ''}</span>`);
  setHtml('projects', s.projects.length
    ? s.projects.map((p) => `<li class="${p.id === ui.projectId ? 'on' : ''}" data-action="project" data-id="${esc(p.id)}" title="${esc(p.path)}">${esc(p.name)}</li>`).join('')
    : '<li class="empty">No projects yet</li>');
  setHtml('engines', s.engines.map((e) => {
    const words = e.light === 'green' ? 'installed, signed in' : e.light === 'red' ? (e.checked_at ? 'missing or signed out' : 'missing') : e.checked_at ? 'installed, sign-in unknown' : 'not checked yet';
    return `<li title="${esc(words)}"><span class="dot ${e.light}"></span>${esc(e.id)}<span class="ver">${esc(e.version ? (e.version.match(/\d+(\.\d+)+/) || [e.version])[0] : '')}</span></li>`;
  }).join('') || '<li class="empty">No engines</li>');
}

function renderTop() {
  const p = project();
  setHtml('project-title', p ? `${esc(p.name)}<small>${esc(p.path)}</small>` : 'Pick or open a project');
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === ui.tab);
  setHtml('usage-bar', usageBar(ui.snap.limits || []));
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

function sessionCard(x) {
  const run = x.run_id ? ` · step ${esc(x.step_id || '')}` : '';
  return `<div class="card" data-action="seen" data-id="${esc(x.id)}" data-drop-session="${esc(x.id)}" title="Drop files here to send their paths to this session">
    <div class="row"><span class="engine">${esc(x.engine_id)}</span><span class="state ${esc(x.state)}">${esc(STATE_WORDS[x.state] || x.state)}</span></div>
    <div class="meta">${esc(x.id.slice(-8).toLowerCase())}${run}</div>
    <div class="meta">${x.last_tool ? `last tool ${esc(x.last_tool)} · ` : ''}<span data-ago="${esc(x.state_at)}">${esc(ago(x.state_at))}</span></div>
    <div class="meta">${meter(x)}</div>
    <div class="actions">
      <button data-action="focus" data-id="${esc(x.id)}">Focus</button>
      <button data-action="hide" data-id="${esc(x.id)}">Hide</button>
    </div>
  </div>`;
}

function renderSessions() {
  const s = ui.snap;
  const launch = s.engines.map((e) => `<button data-action="launch" data-engine="${esc(e.id)}" ${e.light === 'red' ? 'disabled' : ''}>${esc(e.id)}</button>`).join('');
  return `<div class="toolbar"><span class="label">Launch</span>${launch}</div>
    ${s.sessions.length ? `<div class="cards">${s.sessions.map(sessionCard).join('')}</div>` : '<p class="empty">No sessions for this project.</p>'}`;
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
  const host = ui.tab === 'browser' && !ui.comment && ui.browserMode === 'live' ? document.getElementById('pane-host') : null;
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

function renderRail() {
  const s = ui.snap;
  const gates = s.gates;
  setHtml('gate-count', gates.length ? String(gates.length) : '');
  setHtml('gates', gates.length ? gates.map((g) => `<div class="gate">
      <div class="meta">${esc(g.pipeline_id)} · ${esc(g.kind === 'auto-external' ? 'external step (added by the runner)' : g.kind)}${g.guards_step ? ` · guards ${esc(g.guards_step)}` : ''}</div>
      <div class="summary">${esc(g.summary)}</div>
      <div class="actions">
        ${g.kind === 'handoff' ? `<button class="primary" data-action="gate" data-decision="approve" data-id="${esc(g.id)}">Continue</button>` : `
        <input placeholder="Note" data-note="${esc(g.id)}" data-key="note:${esc(g.id)}">
        <button class="primary" data-action="gate" data-decision="approve" data-id="${esc(g.id)}">Approve</button>
        <button class="danger" data-action="gate" data-decision="reject" data-id="${esc(g.id)}">Reject</button>`}
      </div></div>`).join('') : '<p class="empty">Nothing waiting.</p>');
  const needs = s.needs_you.filter((n) => n.kind !== 'gate' && n.kind !== 'handoff');
  setHtml('needs-count', needs.length ? String(needs.length) : '');
  setHtml('needs', needs.length ? needs.map((n) => `<div class="need">
      <div class="meta">${esc(n.kind)} · <span data-ago="${esc(n.at)}">${esc(ago(n.at))}</span></div>
      <div>${esc(n.text)}</div>
      <div class="actions"><button data-action="dismiss" data-id="${esc(n.id)}">Dismiss</button></div></div>`).join('') : '<p class="empty">All clear.</p>');
}

function renderHandback() {
  if (ui.handback === undefined && ui.projectId) {
    ui.handback = null;
    const id = ui.projectId;
    void api.handback(id, ui.runId).then((r) => { if (ui.projectId === id) { ui.handback = r; render(); } });
  }
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

function render() {
  if (!ui.snap) return;
  renderSide();
  renderTop();
  let html;
  if (!project()) html = '<p class="empty">Open a project folder to begin.</p>';
  else if (ui.tab === 'runs') html = renderRuns();
  else if (ui.tab === 'pipelines') html = renderPipelines();
  else if (ui.tab === 'browser') html = renderBrowser();
  else if (ui.tab === 'handback') html = renderHandback();
  else html = renderSessions();
  setHtml('view', html);
  reportPaneBounds();
  renderRail();
  if (PROBE) void api.probe({ sessions: ui.snap.sessions.map((x) => ({ id: x.id, state: x.state })), online: ui.snap.core.online });
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

async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
  const a = el.dataset.action;
  const id = el.dataset.id;
  if (a !== 'seen') e.stopPropagation();
  switch (a) {
    case 'open-folder': {
      const dir = await api.pickFolder();
      if (!dir) return;
      const r = await rpc('project.open', { path: dir });
      if (r.result) {
        ui.projectId = r.result.project_id;
        ui.handback = undefined;
        save('projectId', ui.projectId);
        setView();
      }
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
      ui.tab = el.dataset.tab;
      save('tab', ui.tab);
      if (ui.tab === 'handback') refreshHandback();
      else render();
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
    case 'launch':
      await rpc('session.launch', { project_id: ui.projectId, engine_id: el.dataset.engine });
      return;
    case 'focus':
      await rpc('session.focus', { session_id: id });
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
      if (r.result) { ui.paneId = r.result.pane_id; ui.tab = 'browser'; save('tab', ui.tab); render(); }
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

document.addEventListener('click', (e) => void onClick(e));
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  const card = e.target.closest && e.target.closest('[data-drop-session]');
  for (const c of document.querySelectorAll('.card.drop')) if (c !== card) c.classList.remove('drop');
  if (card) card.classList.add('drop');
  e.dataTransfer.dropEffect = card ? 'copy' : 'none';
});
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  for (const c of document.querySelectorAll('.card.drop')) c.classList.remove('drop');
  const card = e.target.closest && e.target.closest('[data-drop-session]');
  if (!card || !e.dataTransfer.files.length) return;
  const r = await api.commentFiles(card.dataset.dropSession, e.dataTransfer.files);
  toast(r.ok ? `${e.dataTransfer.files.length} file path(s) sent: on the clipboard, and in the session's next prompt for Claude.` : r.error, !r.ok);
});
document.addEventListener('keydown', (e) => {
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
  render();
});
document.addEventListener('change', onInput);
document.addEventListener('input', (e) => { if (e.target.tagName !== 'SELECT') onInput(e); });
observeLongTasks();
setInterval(tickAges, 5000);
setView();
