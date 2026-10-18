'use strict';

const api = window.troop;
const PROBE = new URLSearchParams(location.search).has('probe');
const DEMO = new URLSearchParams(location.search).has('demo');
const LIVE_STATES = ['starting', 'working', 'waiting_for_you', 'unknown'];
const STATE_WORDS = { starting: 'starting', working: 'working', waiting_for_you: 'waiting for you', done: 'done', idle: 'idle', unknown: 'state unknown', exited: 'exited' };

const ui = {
  snap: null,
  projectId: load('projectId'),
  tab: ['diff', 'git', 'handback', 'browser'].includes(load('tab')) ? load('tab') : 'diff',
  paneCache: {},
  diffScope: ['turn', 'uncommitted', 'branch'].includes(load('diffScope')) ? load('diffScope') : 'turn',
  split: false,
  mode: load('mode') === 'grid' ? 'grid' : 'single',
  localSel: null,
  shells: [],
  shellKinds: [],
  shellSel: null,
  look: null,
  paneId: null,
  paneState: {},
  urlDraft: null,
  find: null,
  perms: [],
  browserMode: 'live',
  comment: null,
  swap: false,
  images: {},
  lastBounds: '',
  rendered: {},
  drafts: {},
  pendingHide: new Set(),
  hideDone: new Set(),
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

function toast(text, error = false, action = null) {
  const el = document.createElement('div');
  el.className = `toast${error ? ' error' : ''}`;
  el.textContent = action ? `${text} · ` : text;
  if (action) {
    const b = document.createElement('button');
    b.className = 'link';
    b.textContent = action.label;
    b.addEventListener('click', (e) => { e.stopPropagation(); el.remove(); action.run(); });
    el.append(b);
  }
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), action ? UNDO_MS : error ? (ui.look ? ui.look.ui.error_toast_ms : 7000) : (ui.look ? ui.look.ui.toast_ms : 3500));
}

const UNDO_MS = 7000;


/** Takes the ids off the wall and list at once and sends one session.hide each after UNDO_MS, unless Undo is clicked or the session went live again. */
function hideLater(ids, text) {
  ids = ids.filter((id) => canHide(id) && !ui.pendingHide.has(id));
  if (!ids.length) return;
  for (const id of ids) ui.pendingHide.add(id);
  render();
  const projectId = ui.projectId;
  const timer = setTimeout(async () => {
    // after a project switch the snapshot no longer holds these ids, so their state comes from the core
    let away = null;
    if (ids.some((id) => !ui.snap.sessions.some((x) => x.id === id))) {
      const r = await rpc('session.list', { project_id: projectId }, true);
      away = new Map(((r.result && r.result.sessions) || []).map((x) => [x.id, x.state]));
    }
    const settled = (id) => (ui.snap.sessions.some((x) => x.id === id) ? canHide(id) : Boolean(away) && away.has(id) && !LIVE_STATES.includes(away.get(id)));
    const hide = ids.filter(settled);
    for (const id of ids) if (!hide.includes(id)) ui.pendingHide.delete(id);
    render();
    const out = await Promise.all(hide.map((id) => rpc('session.hide', { session_id: id })));
    hide.forEach((id, i) => {
      const x = ui.snap.sessions.find((y) => y.id === id);
      if (out[i].error || !x || LIVE_STATES.includes(x.state)) ui.pendingHide.delete(id);
      else ui.hideDone.add(id);
    });
    render();
  }, UNDO_MS);
  toast(typeof text === 'function' ? text(ids.length) : text, false, { label: 'Undo', run: () => { clearTimeout(timer); for (const id of ids) ui.pendingHide.delete(id); render(); } });
}

const ONE_AT_A_TIME = new Set(['session.launch', 'session.resume']);

async function rpc(method, params, quiet = false) {
  if (!ONE_AT_A_TIME.has(method)) return rpcOnce(method, params, quiet);
  if ((ui.inFlight ||= {})[method]) { toast('Still working on the last click.'); return { error: { message: 'busy' } }; }
  ui.inFlight[method] = true;
  try { return await rpcOnce(method, params, quiet); } finally { delete ui.inFlight[method]; }
}

async function rpcOnce(method, params, quiet) {
  const out = await api.call(method, params);
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
  if (r.result && r.result.notice) toast(r.result.notice);
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
  for (const d of el.querySelectorAll('[data-key]')) if (d.dataset.key in ui.drafts) d[d.type === 'checkbox' ? 'checked' : 'value'] = ui.drafts[d.dataset.key];
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



function hostOf(url) {
  try { return new URL(url).host || url; } catch { return url || 'blank'; }
}

function renderBrowser() {
  const s = ui.snap;
  if (ui.paneId && !s.panes.some((p) => p.id === ui.paneId)) ui.paneId = null;
  if (!ui.paneId && s.panes[0]) ui.paneId = s.panes[0].id;
  // the rows are one pane's; whatever selected another pane (an agent opening one, a close) shows that one live
  if (ui.browserMode === 'timeline' && ui.auditPane !== ui.paneId) ui.browserMode = 'live';
  const ownerOf = (sid) => { const x = s.sessions.find((y) => y.id === sid); return x ? sessionLabel(x) : 'closed session'; };
  const dotOf = (p) => {
    const owner = p.session_id && s.sessions.find((y) => y.id === p.session_id);
    if (owner) return owner.state === 'waiting_for_you' ? 'waiting_for_you' : owner.state === 'working' || owner.state === 'starting' ? 'working' : 'idle';
    return (ui.paneState[p.id] || {}).loading ? 'working' : 'idle';
  };
  const tabs = browserChrome.tabs(s.panes.map((p) => ({
    id: p.id, url: (ui.paneState[p.id] || {}).url || p.url || '', title: paneTitle(p), full: ((ui.paneState[p.id] || {}).title || '').trim(), dot: dotOf(p),
    tag: p.session_id ? ownerOf(p.session_id) : '',
  })), ui.paneId);
  const pane = s.panes.find((p) => p.id === ui.paneId);
  let body;
  if (ui.comment) body = renderCommentForm();
  else if (!pane) body = '<p class="empty">No browser pane. <button class="btn" data-action="pane-new">Open a browser pane</button></p>';
  else if (ui.browserMode === 'compare') body = renderCompare(pane);
  else if (ui.browserMode === 'timeline') body = renderTimeline();
  else body = '<div id="pane-host" class="pane-host"></div>';
  const st = (pane && ui.paneState[pane.id]) || {};
  const perms = pane ? ui.perms.filter((x) => x.pane_id === pane.id) : [];
  const controls = pane && !ui.comment ? `<div class="baddr">
      <button class="ib" data-action="pane-act" data-act="back" title="Back (Alt+Left)" aria-label="Back" ${st.can_back ? '' : 'disabled'}>&larr;</button>
      <button class="ib" data-action="pane-act" data-act="forward" title="Forward (Alt+Right)" aria-label="Forward" ${st.can_forward ? '' : 'disabled'}>&rarr;</button>
      ${st.loading ? '<button class="ib" data-action="pane-act" data-act="stop" title="Stop" aria-label="Stop loading">&times;</button>' : '<button class="ib" data-action="pane-act" data-act="reload" title="Reload (Ctrl+R)" aria-label="Reload">&#8635;</button>'}
      ${browserChrome.urlField(st.url || pane.url || '', ui.urlDraft, st.zoom)}
      <button class="tb" data-action="pane-comment" title="Point at an element and leave a comment for a session (C)">Comment</button>
      <button class="ib" data-action="pane-menu" title="Before, After, Compare, Find, Driven by, Close" aria-label="Pane menu">&#8943;</button>
    </div>` : '';
  const find = pane && ui.find && !ui.comment ? `<div class="toolbar findbar">
      <input id="pane-find" data-key="find" value="${esc(ui.find.text)}" placeholder="Find in page">
      <span class="label">${ui.find.matches ? `${ui.find.active} of ${ui.find.matches}` : ui.find.text ? 'no matches' : ''}</span>
      <button data-action="find-step" data-dir="back" title="Previous (Shift+Enter)" aria-label="Previous match">&uarr;</button>
      <button data-action="find-step" data-dir="next" title="Next (Enter)" aria-label="Next match">&darr;</button>
      <button data-action="find-close" title="Close (Esc)">Close</button>
    </div>` : '';
  const handed = st.handoff ? `<div class="toolbar permbar"><span>The agent handed you this pane: <b>${esc(st.handoff)}</b></span>
      <button class="primary" data-action="give-back">Give back</button></div>` : '';
  const asks = perms.map((x) => `<div class="toolbar permbar"><span><b>${esc(x.origin)}</b> wants ${esc(x.permission)}</span>
      <button class="primary" data-action="perm" data-id="${esc(x.id)}" data-allow="1">Allow</button><button data-action="perm" data-id="${esc(x.id)}" data-allow="0">Block</button></div>`).join('');
  return `<div class="browser">
    ${tabs}
    ${controls}
    <div class="loadbar ${st.loading ? 'on' : ''}"></div>
    ${handed}${asks}${find}
    ${body}
  </div>`;
}

/** Reads a pane's Timeline rows; a read that a later one replaced while it was in flight is dropped. */
async function loadTimeline(id) {
  const ask = (ui.auditAsk = (ui.auditAsk || 0) + 1);
  ui.audit = [];
  ui.auditPane = id;
  const rows = await api.paneAudit(id);
  if (ui.auditAsk === ask) ui.audit = rows;
}

/** The pane's browser tool calls, newest first: time, tool, origin and result. */
function renderTimeline() {
  const rows = (ui.audit || []).map((r) => `<tr><td class="meta">${esc(new Date(r.at).toLocaleString())}</td><td>${esc(r.tool)}</td><td>${esc(r.origin || '')}</td><td class="${r.status === 'ok' ? '' : 'meta'}">${esc(r.status)}</td></tr>`).join('');
  return rows ? `<div class="panel timeline"><table><tr><th>When</th><th>Tool</th><th>Origin</th><th>Result</th></tr>${rows}</table></div>` : '<p class="empty">No agent browser actions in the last 30 days.</p>';
}

function renderCommentForm() {
  const c = ui.comment;
  const s = ui.snap;
  return `<div class="panel comment-form">
    <h3>Comment on ${esc(c.selector || 'element')}</h3>
    <img class="crop" src="data:image/png;base64,${esc(c.crop)}" alt="The element you picked">
    <p class="meta">Up arrow picks the parent element, Down arrow goes back${c.depth ? ` (${c.depth} up from the one you clicked)` : ''}.</p>
    <div class="form">
      <label>For</label><select id="comment-session" data-key="comment-session">${s.sessions.map((x) => `<option value="${esc(x.id)}">${esc(sessionLabel(x))} (${esc(STATE_WORDS[x.state] || x.state)})</option>`).join('')}</select>
      <label>Note</label><textarea id="comment-note" data-key="comment-note" rows="4" placeholder="What should change here?"></textarea>
      <span></span><div class="toolbar"><button class="primary" data-action="comment-send" ${s.sessions.length ? '' : 'disabled'}>Send</button><button data-action="comment-cancel">Cancel</button></div>
    </div>
  </div>`;
}

function shotSrc(file) {
  if (!file) return '';
  if (ui.images[file] === undefined) {
    ui.images[file] = null;
    void api.snapshotImage(file).then((d) => { ui.images[file] = d || ''; render(); });
  }
  return ui.images[file];
}

function renderCompare(pane) {
  const listed = new Set(ui.snap.snapshots.flatMap((x) => [x.w390_path, x.w1280_path]));
  for (const f of Object.keys(ui.images)) if (!listed.has(f)) delete ui.images[f];
  const shots = ui.snap.snapshots.filter((x) => x.pane_id === pane.id);
  const before = shots.find((x) => x.label === 'before');
  const after = shots.find((x) => x.label === 'after');
  if (!before || !after) return '<p class="empty">Take a Before and an After capture to compare them.</p>';
  const img = (file) => {
    const src = shotSrc(file);
    return src ? `<img src="${esc(src)}" alt="">` : file ? '<p class="empty">loading</p>' : '';
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
  const pick = { pane: ui.paneId };
  ui.picking = pick;
  try { await api.panePick(pick.pane); } finally { if (ui.picking === pick) ui.picking = null; }
}


function loadHandback() {
  if (ui.handback !== undefined || !ui.projectId) return;
  ui.handback = null;
  const id = ui.projectId;
  void api.handback(id).then((r) => { if (ui.projectId === id) { ui.handback = r; render(); } });
}

function renderHandback() {
  loadHandback();
  const h = ui.handback;
  const bar = `<div class="toolbar"><h3 style="margin:0">Staged changes</h3><button data-action="handback-refresh">Refresh</button></div>`;
  if (!h) return `<div class="panel">${bar}<p class="empty">Loading.</p></div>`;
  if (h.error) return `<div class="panel">${bar}<p class="empty">${esc(h.error)}</p></div>`;
  const byName = h.files.filter((f) => f.kind !== 'text').map((f) => `<li>${esc(f.path)} <span class="meta">${esc(f.kind)}</span></li>`).join('');
  const texts = h.files.filter((f) => f.kind === 'text').map((f) => `<button class="chip ${ui.hbFile === f.path ? 'on' : ''}" data-action="hb-file" data-file="${esc(f.path)}">${esc(f.path)} <span class="meta">+${f.added} -${f.deleted}</span></button>`).join('');
  return `<div class="panel">${bar}
    ${h.files.length ? `<div class="log">${esc(h.stat)}</div>` : '<p class="empty">Nothing staged.</p>'}
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
      <label>Session</label><select id="hb-session" data-key="hb-session">${sessions.map((x) => `<option value="${esc(x.id)}">${esc(sessionLabel(x))}</option>`).join('')}</select>
      <span></span><div><button class="primary" data-action="hb-send" ${sessions.length ? '' : 'disabled'}>Send</button> ${sessions.length ? '' : '<span class="meta">No live session to send to.</span>'}</div>
    </div>` : '';
  return `<div class="diff">${rows}</div>${form}`;
}

async function gitDo(op, arg) {
  const id = ui.projectId;
  if (!id) { ui.gitBusy = null; return; }
  ui.gitBusy = op;
  render();
  let r;
  try { r = await api.git(id, op, arg); } catch (e) { r = { error: e.message }; } finally { ui.gitBusy = null; }
  if (ui.projectId !== id) return render();
  if (r && r.error) { if (op === 'view') ui.git = { project: id, at: Date.now(), error: r.error }; else toast(r.error, true); }
  if (r && r.branch) ui.git = { ...r, project: id, at: Date.now() };
  if (op === 'commit' && r && !r.error) { ui.gitMsg = ''; toast('Committed.'); }
  if (op === 'push' && r && !r.error) toast('Pushed.');
  if (op === 'pull' && r && !r.error) toast('Pulled.');
  render();
}

function ownerGroupsHtml(groups, row, busy) {
  return groups.map((x) => `<div class="git-group${x.stage ? '' : ' shared'}" data-group="${esc(x.key)}"><div class="toolbar"><b class="grow">${esc(x.title)}${x.state ? `<span class="meta"> · ${esc(x.state)}</span>` : ''}</b>
    ${x.stage ? `<button data-action="git-stage-group" data-files="${esc(JSON.stringify(x.files.map((f) => f.path)))}" ${busy}>Stage this group</button>` : ''}</div>
    ${x.files.map((f) => row(f, false)).join('')}</div>`).join('');
}

function renderGit() {
  const g = ui.git && ui.git.project === ui.projectId ? ui.git : null;
  if (ui.projectId && !ui.gitBusy && (!g || g.at < Date.now() - 5000)) { ui.gitBusy = 'view'; setTimeout(() => void gitDo('view')); }
  if (!g) return '<div class="panel"><p class="empty">Loading.</p></div>';
  if (g.error) return `<div class="panel"><p class="empty">No git here: ${esc(g.error)}</p></div>`;
  const busy = ui.gitBusy && ui.gitBusy !== 'view' ? 'disabled' : '';
  const row = (f, staged) => `<div class="git-row"><button class="link grow ${ui.hbFile === f.path ? 'on' : ''}" data-action="git-file" data-file="${esc(f.path)}" data-staged="${staged ? 1 : ''}"><b>${esc(f.code)}</b> ${esc(f.path)}</button>
    <span class="meta">${f.added === null ? '' : `+${f.added} -${f.deleted}`}</span>
    <button class="btn sm" data-action="${staged ? 'git-unstage' : 'git-stage'}" data-file="${esc(f.path)}" ${busy}>${staged ? 'Unstage' : 'Stage'}</button></div>`;
  const n = g.staged.length;
  const history = (g.log || '').split('\n').filter(Boolean).map((l) => { const [subject, when] = l.split('\t'); return `<div class="git-hist"><span class="grow">${esc(subject)}</span><span class="meta">${esc(when || '')}</span></div>`; }).join('');
  return `<div class="panel">
    <div class="git-sync"><div class="toolbar"><h3 style="margin:0" class="grow">${esc(g.branch)}</h3><span class="meta">${g.ahead || g.behind ? 'origin' : 'up to date with origin'}</span></div>
      <div class="actions"><button class="btn${g.ahead ? ' acc' : ''}" data-action="git-push" ${busy || (g.ahead ? '' : 'disabled')}>${ui.gitBusy === 'push' ? 'Pushing' : `Push${g.ahead ? ` ${g.ahead} commit${g.ahead === 1 ? '' : 's'}` : ''}`}</button>
        <button class="btn" data-action="git-pull" ${busy || (g.behind ? '' : 'disabled')} title="Bring in commits from origin">${ui.gitBusy === 'pull' ? 'Pulling' : `Pull${g.behind ? ` ${g.behind} commit${g.behind === 1 ? '' : 's'}` : ''}`}</button></div></div>
    <div class="toolbar"><h3 style="margin:0" class="grow">Changes (${g.changes.length})</h3>${g.changes.length ? `<button class="btn sm" data-action="git-stage" data-file="" ${busy}>Stage all</button>` : ''}</div>
    ${g.groups && g.groups.some((x) => x.key !== 'unclaimed') ? ownerGroupsHtml(g.groups, row, busy) : g.changes.map((f) => row(f, false)).join('') || '<p class="empty">Nothing changed.</p>'}
    <div class="toolbar" style="margin-top:12px"><h3 style="margin:0" class="grow">Staged (${n})</h3>${n ? `<button class="btn sm" data-action="git-unstage" data-file="" ${busy}>Unstage all</button>` : ''}</div>
    ${g.staged.map((f) => row(f, true)).join('') || '<p class="empty">Stage a file above to commit it.</p>'}
    <textarea rows="3" id="git-msg" data-key="git-msg" placeholder="Commit message (commits to ${esc(g.branch)})">${esc(ui.gitMsg || '')}</textarea>
    <div class="actions"><button class="primary" data-action="git-commit" ${busy || (n ? '' : 'disabled')}>${ui.gitBusy === 'commit' ? 'Committing' : n ? `Commit ${n} file${n === 1 ? '' : 's'}` : 'Commit'}</button></div>
    ${ui.hbFile && ui.gitFile ? renderDiff() : ''}
    <h3 style="margin-top:14px">History</h3><div class="git-history">${history || '<p class="empty">No commits yet.</p>'}</div>
  </div>`;
}

function refreshHandback() {
  ui.handback = undefined;
  ui.hbFile = null;
  ui.hbLine = null;
  render();
}


const TABS = [['diff', 'Diff'], ['git', 'Git'], ['handback', 'Hand-back'], ['browser', 'Browser']];
const THEME_VARS = {
  bg: ['--canvas-deep'], panel: ['--canvas'], panel2: ['--canvas-soft'], line: ['--hairline', '--hairline-strong'], line_strong: ['--hairline-strong'],
  text: ['--ink', '--body-strong', '--body'], body_strong: ['--body-strong'], body: ['--body'], muted: ['--mute', '--faint'], faint: ['--faint'],
  accent: ['--primary'], on_accent: ['--on-primary'], ok: ['--work'], warn: ['--wait'], bad: ['--del'], grey: ['--done'], unseen: ['--unseen'],
  term_bg: ['--pane'], term_fg: ['--term-fg'], add_bg: ['--add-bg'], add_fg: ['--add'], del_bg: ['--del-bg'], del_fg: ['--del'], font_ui: ['--sans'], font_mono: ['--mono'],
};
const MONO_STACK = "'Geist Mono', ui-monospace, Consolas, monospace";
function applyLook(look) {
  ui.look = look;
  const root = document.documentElement;
  for (const vars of Object.values(THEME_VARS)) for (const v of vars) root.style.removeProperty(v);
  for (const [k, vars] of Object.entries(THEME_VARS)) if (look.theme[k]) for (const v of vars) root.style.setProperty(v, look.theme[k]);
  root.dataset.look = look.theme.look || 'plain';
  root.style.colorScheme = look.theme.scheme || 'dark';
  termView.setLook(look);
}

async function setLook(id) {
  const theme = await api.setTheme(id);
  if (!theme || theme.error) { if (theme) toast(theme.error, true); return; }
  applyLook({ ...ui.settingsLook, theme });
  render();
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
  return x.step_id || openedIn(x);
}

function openedIn(x) {
  const folder = (x.cwd || '').split(/[\\/]/).filter(Boolean).pop();
  const t = Date.parse(x.started_at);
  const when = Number.isNaN(t) ? '' : new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
  return [folder && `in ${folder}`, when && `opened ${when}`].filter(Boolean).join(', ') || 'new session';
}

function sessionLabel(x) {
  return `${x.engine_id} · ${taskOf(x)}`;
}

function unseen(x) {
  return x.state === 'done';
}

function liveSessions() {
  return ui.snap.sessions.filter((x) => x.state !== 'exited');
}

function shellRows() {
  return ui.shells.filter((x) => x.project_id === ui.projectId).map((x) => ({ id: x.id, engine_id: x.label, state: x.exited ? 'exited' : 'idle', task: x.cwd, title: x.cwd, shell: true, from: x.from }));
}

/** Once per project, after the core is up: hands the saved wall layout to the wall and opens its saved shells again. */
function seedLayout() {
  if (!ui.settingsLook || !ui.projectId || ui.seeded === ui.projectId || !ui.snap.core.online) return;
  ui.seeded = ui.projectId;
  ui.corePid = ui.snap.core.pid;
  const saved = (ui.settingsLook.ui.layout || {})[ui.projectId];
  wall.restore(saved);
  const shells = saved && Array.isArray(saved.shells) ? saved.shells : [];
  for (const sh of shells) {
    if (!sh || typeof sh.id !== 'string' || typeof sh.kind !== 'string' || ui.shells.some((x) => x.id === sh.id || x.from === sh.id)) continue;
    const kind = ui.shellKinds.find((k) => k.kind === sh.kind);
    const row = { id: sh.id, label: kind ? kind.label : sh.kind, cwd: '', project_id: ui.projectId, kind: sh.kind, exited: true };
    ui.shells.push(row);
    if (saved.big?.[0] === sh.id) ui.shellSel = sh.id;
    void reopenShell(row);
  }
}

/** After a core restart: the wall keeps its layout for the resumed sessions, and the shells of every project that died with the core open again. */
function coreRestarted() {
  if (!ui.snap.core.online || !ui.corePid || ui.snap.core.pid === ui.corePid) return;
  ui.corePid = ui.snap.core.pid;
  if (ui.seeded === ui.projectId) wall.restore(wall.state());
  for (const sh of ui.shells.filter((x) => x.kind)) void reopenShell(sh);
}

async function reopenShell(sh) {
  const projectId = sh.project_id;
  const r = await rpc('shell.open', { project_id: projectId, kind: sh.kind }, true);
  if (!r.result) return;
  ui.shells = ui.shells.filter((x) => x.id !== sh.id);
  ui.shells.push({ id: r.result.shell_id, label: r.result.label, cwd: r.result.cwd, project_id: projectId, kind: sh.kind, from: sh.id });
  if (ui.shellSel === sh.id) ui.shellSel = r.result.shell_id;
  render();
}

let layoutSent = '';
const layoutTimers = {};
/** Saves the wall layout and the project's shells through settings.set, 500 ms after the last change. */
function saveLayout() {
  const projectId = ui.projectId;
  if (!projectId || ui.seeded !== projectId || !ui.settingsLook) return;
  const layout = { ...wall.state(), shells: ui.shells.filter((x) => x.project_id === projectId && x.kind).map((x) => ({ id: x.id, kind: x.kind })) };
  const text = projectId + JSON.stringify(layout);
  if (text === layoutSent) return;
  layoutSent = text;
  ui.settingsLook.ui.layout = { ...(ui.settingsLook.ui.layout || {}), [projectId]: layout };
  clearTimeout(layoutTimers[projectId]);
  layoutTimers[projectId] = setTimeout(() => void api.saveLayout(projectId, layout), 500);
}
wall.onChange(saveLayout);

function selectedSession() {
  const big = wall.big();
  const onWall = big && [...ui.snap.sessions, ...shellRows()].find((x) => x.id === big);
  if (onWall) return onWall;
  if (ui.shellSel) { const sh = shellRows().find((x) => x.id === ui.shellSel); if (sh) return sh; }
  const s = ui.snap.sessions;
  return s.find((x) => x.id === ui.snap.selected) || s.find((x) => x.id === ui.localSel) || liveSessions()[0] || null;
}

function approvalCard(a, i) {
  const x = ui.snap.sessions.find((y) => y.id === a.session_id);
  return `<div class="gate${i === 0 ? ' cur' : ''}" data-approval="${esc(a.id)}">
    <div class="gt"><span class="dm"></span><b>${esc(x ? taskOf(x) : a.session_id)}</b><span data-short="${esc(a.created_at)}">${esc(short(a.created_at))}</span></div>
    <div class="gs">${esc(a.summary)}</div>
    <div class="gd">${esc(a.reason)}</div>
    <div class="ga"><button class="btn acc" data-action="approval" data-id="${esc(a.id)}" data-decision="approve" data-scope="once">Approve once</button><button class="btn" data-action="approval" data-id="${esc(a.id)}" data-decision="approve" data-scope="session">Approve for this session</button><button class="btn" data-action="approval" data-id="${esc(a.id)}" data-decision="reject">Reject</button></div>
  </div>`;
}

function renderSheet() {
  const list = ui.snap.approvals || [];
  wall.roll(document.getElementById('sheetN'), list.length);
  document.getElementById('sheetT').textContent = list.length ? `${list.length === 1 ? 'An agent action waits' : `${list.length} agent actions wait`} for you` : 'No agent actions waiting';
  setHtml('sheetRuns', '');
  setHtml('sheetAct', '');
  setHtml('gates', list.length ? list.map(approvalCard).join('') : '<div class="gate" style="grid-column:1/3;justify-content:center;align-items:center;color:var(--work);font-weight:600">No agent actions waiting</div>');
}

function resumeButton(x) {
  const e = ui.snap.engines.find((y) => y.id === x.engine_id);
  return e && e.resumable && x.native_id
    ? `<button data-action="resume" data-id="${esc(x.id)}" title="Start ${esc(x.engine_id)} again with this conversation">Resume</button>`
    : `<button data-action="resume" data-id="${esc(x.id)}" title="Start ${esc(x.engine_id)} in the same folder">Start new here</button>`;
}

const STATE_ORDER = ['waiting_for_you', 'working', 'starting', 'unknown', 'done', 'idle', 'exited'];

/** False for a live or unknown session, so no click hides an agent that may still need you. */
function canHide(id) {
  const x = ui.snap.sessions.find((y) => y.id === id);
  return Boolean(x) && !LIVE_STATES.includes(x.state);
}

function rowHtml(x, sel) {
  const g = (ui.snap.git || {})[x.id];
  const m = [x.engine_id, STATE_WORDS[x.state] || x.state, g && g.branch ? `${g.branch} +${g.added} -${g.deleted}` : '', x.last_line || ''].filter(Boolean).join(' · ');
  return `<div class="li srow${sel ? ' sel' : ''}" role="option" tabindex="0" aria-selected="${Boolean(sel)}" data-action="pick" data-id="${esc(x.id)}" data-drop-session="${esc(x.id)}" title="${esc(taskOf(x))}&#10;Click: big slot. Shift+click: pair. Drop files to send their paths.">
    <span class="dot ${esc(x.state)}${unseen(x) ? ' unseen' : ''}"></span><span class="t">${esc(taskOf(x))}</span><span class="a"><span data-short="${esc(x.state_at)}">${esc(short(x.state_at))}</span>${LIVE_STATES.includes(x.state) ? '' : `<button class="link hide" data-action="hide" data-id="${esc(x.id)}" title="Hide this session" aria-label="Hide this session">x</button>`}</span>
    <span class="m">${esc(m)}</span>${x.state === 'exited' ? `<span class="m">${resumeButton(x)}</span>` : ''}</div>`;
}

function limitGroups() {
  const by = new Map();
  for (const r of ui.snap.limits || []) by.set(r.provider, [...(by.get(r.provider) || []), r]);
  return [...by].map(([provider, list]) => ({ provider, ok: list.filter((r) => r.status === 'ok' && r.used_pct !== null) }));
}

function limitRows(cls) {
  const groups = limitGroups();
  if (!groups.length) return `<div class="${cls} na"><span class="e">usage</span><span class="nav">No local usage readings yet.</span></div>`;
  return groups.map((u) => !u.ok.length
    ? `<div class="${cls} na"><span class="e">${esc(u.provider)}</span><span class="nav">No local source for this provider's limits</span></div>`
    : `<div class="${cls}"><span class="e">${esc(u.provider)}</span>${u.ok.map((r) => `<div class="${cls === 'u' ? 'r' : 'ul'}"><span>${esc(r.window === 'weekly' ? 'wk' : r.window)}</span><div class="bar"><i style="width:${Math.round(r.used_pct)}%"></i></div><span class="v">${Math.round(r.used_pct)}%${cls === 'u' && r.resets_at ? ` · ${esc(untilText(r.resets_at).replace('resets in ', ''))}` : ''}</span>${cls === 'u' ? '' : `<span class="rs">${r.resets_at ? esc(untilText(r.resets_at).replace('resets in ', '')) : ''}</span>`}</div>`).join('')}</div>`).join('');
}

function renderTitle() {
  const s = ui.snap;
  const age = s.core.heartbeat_age_ms;
  const warn = [
    s.settings_error ? `<span class="badge offline" title="The core runs on defaults and will not overwrite the file">${esc(s.settings_error)}</span>` : '',
    s.core_mismatch ? `<span class="badge offline">${esc(s.core_mismatch)}</span> <button class="link" data-action="restart-core">Restart core</button>` : '',
    s.core_log ? `<span class="badge offline" title="${esc(s.core_log.join('\n'))}">core stopped 3 times in 60 s; hover for the log</span> <button class="link" data-action="open-logs">Open logs</button>` : '',
  ].filter(Boolean).join(' ');
  setHtml('core', (s.core.online ? '<span class="dot" style="background:var(--work)" title="Core online"></span>core online'
    : `<span class="badge offline" title="${age !== null ? `last seen ${Math.round(age / 1000)}s ago` : ''}">core offline</span>`) + (warn ? ` ${warn}` : ''));
  const cur = s.projects.find((p) => p.id === ui.projectId);
  setHtml('project-pick', `${esc(cur ? cur.name : s.projects.length ? 'Pick a project' : 'No project')}${cur ? `<span class="meta">${esc(liveCounts(cur.id))}</span>` : ''} <svg width="9" height="9" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`);
  wall.roll(document.getElementById('needsN'), needsCount());
  const groups = limitGroups();
  const hot = groups.some((u) => u.ok.some((r) => r.used_pct >= 80));
  const live = groups.filter((u) => u.ok.length);
  setHtml('usage', live.length ? `<button class="chip uchip${hot ? ' warn' : ''}" data-action="usage" title="Usage">${live.map((u) => {
    const r = u.ok[0];
    return `<span>${esc(u.provider)} <span class="mini"><i style="width:${Math.round(r.used_pct)}%"></i></span>${Math.round(r.used_pct)}%</span>`;
  }).join('')}</button>
    <div class="pop" role="tooltip"><h4><span>Usage</span><span>% used · resets in</span></h4>${limitRows('urow')}</div>` : '');
  setHtml('newagent', project() ? '<button class="btn acc" data-action="launch-menu" title="Start an agent or a terminal">+ New</button>' : '');
  const g = ui.git && ui.git.project === ui.projectId ? ui.git : null;
  if (ui.projectId && !ui.gitBusy && (!g || g.at < Date.now() - 15000)) { ui.gitBusy = 'view'; setTimeout(() => void gitDo('view')); }
  setHtml('branch', g && g.branch ? `<span class="s">/</span><svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="3" cy="2.5" r="1.4"/><circle cx="3" cy="9.5" r="1.4"/><circle cx="9" cy="4" r="1.4"/><path d="M3 4v4M9 5.4c0 2-6 1.5-6 2.7"/></svg> ${esc(g.branch)}${g.ahead ? ` <span class="meta">&#8593;${g.ahead}</span>` : ''}${g.behind ? ` <span class="meta">&#8595;${g.behind}</span>` : ''}` : '');
}

const INFO_KINDS = ['gate', 'approval', 'handoff', 'done', 'uncommitted', 'other', 'spool-too-large'];

function needsCount() {
  const s = ui.snap;
  return waitingAll().length + (s.approvals || []).length + s.needs_you.filter((n) => !n.read_at && !INFO_KINDS.includes(n.kind)).length;
}

function waitingAll() {
  return (ui.snap.live || []).filter((x) => x.state === 'waiting_for_you');
}

function liveCounts(projectId) {
  const mine = (ui.snap.live || []).filter((x) => x.project_id === projectId);
  const working = mine.filter((x) => x.state === 'working').length;
  const waiting = mine.length - working;
  const parts = [working && `${working} working`, waiting && `${waiting} waiting`].filter(Boolean);
  return parts.length ? ` · ${parts.join(', ')}` : '';
}

function renderList(sel) {
  const s = ui.snap;
  const shells = shellRows();
  const sessions = s.sessions.filter((x) => !ui.pendingHide.has(x.id)).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
  setHtml('list', `<div class="lh"><h2>Agents</h2><span class="n">${sessions.length} sessions</span>${project() ? '<button class="link" data-action="clear-all" title="Hide every finished session in this project">Clear</button>' : ''}<button class="ib" data-action="list" title="Close (Ctrl+B)" aria-label="Close the agent list">x</button></div>
    <div class="lnew" id="launch">${project() ? `${s.engines.map((e) => `<button class="btn" data-action="launch" data-engine="${esc(e.id)}" ${e.light === 'red' ? 'disabled' : ''} title="${esc(engineTip(e))}">+ ${esc(e.id)}</button>`).join('')}${ui.shellKinds.map((k) => `<button class="btn" data-action="shell-open" data-kind="${esc(k.kind)}" title="A plain ${esc(k.label)} tab in this project">${esc(k.label)}</button>`).join('')}` : '<button class="btn acc" data-action="open-folder">Open a project folder</button>'}</div>
    <div class="lbody" id="sessions" role="listbox" aria-label="Sessions">
      ${sessions.map((x) => rowHtml(x, sel && x.id === sel.id)).join('')}
      ${shells.length ? `<div class="lsec">Shells</div>${shells.map((x) => `<div class="li srow${sel && sel.id === x.id ? ' sel' : ''}" role="option" tabindex="0" aria-selected="${Boolean(sel && sel.id === x.id)}" data-action="pick-shell" data-id="${esc(x.id)}">
        <span class="dot ${x.state === 'exited' ? 'exited' : 'idle'}"></span><span class="t">${esc(x.engine_id)}</span><span class="a"><button class="link hide" data-action="shell-close" data-id="${esc(x.id)}" title="Close this shell" aria-label="Close this shell">x</button></span><span class="m">${esc(x.task)}</span></div>`).join('')}` : ''}
    </div>
    <div class="lfoot"><div class="lsec">Usage</div>${limitRows('u')}</div>`);
}

function engineTip(e) {
  return e.light === 'red' ? `${e.id} is not ready: ${e.fix || e.detail || 'check failed'}` : `Start ${e.id} in this project${e.fix ? ` (${e.fix})` : ''}`;
}

function renderStart() {
  const el = document.getElementById('start');
  const show = !project() || (!ui.snap.sessions.length && !shellRows().length);
  el.hidden = !show;
  document.getElementById('centre').hidden = show;
  if (!show) return;
  const p = project();
  const engines = ui.snap.engines;
  const firstRun = ui.settingsLook && ui.settingsLook.firstRun ? `<div class="firstrun"><h3>Before each tool call</h3>
    <button class="primary" data-action="first-approval" data-value="ask">Ask before each tool call (recommended)</button>
    <button data-action="first-approval" data-value="contained">Auto mode in MetaTrooper worktrees</button></div>` : '';
  const cards = !engines.length || engines.some((e) => e.light !== 'red') ? '' : `<h3>No agent is ready yet</h3><div class="ecards">${engines.filter((e) => e.install).map((e) => `<div class="ecard">
    <b>${esc(e.id)}</b>${e.fix ? `<p class="fix">${esc(e.fix)}</p>` : ''}
    <p>Install: <code>${esc(e.install)}</code></p>${e.login ? `<p>Log in: <code>${esc(e.login)}</code></p>` : ''}
    <button data-action="check-engines">Check again</button></div>`).join('')}</div>`;
  setHtml('start', `${firstRun}${cards}<h3>Start an agent</h3><ol>
    <li class="${p ? 'done' : ''}">${p ? `Folder: <b>${esc(p.name)}</b> <span class="meta">${esc(p.path)}</span>` : '<button class="primary" data-action="open-folder">Open a project folder</button>'}</li>
    <li>${p ? `Agent: ${engines.map((e) => `<button class="${ui.startEngine === e.id ? 'primary' : ''}" data-action="start-engine" data-engine="${esc(e.id)}" ${e.light === 'red' ? 'disabled' : ''} title="${esc(engineTip(e))}">${esc(e.id)}</button>`).join(' ')}` : 'Pick an agent'}</li>
    <li>${p ? `Task (optional):<textarea rows="3" id="start-task" data-key="start-task" placeholder="What should it do? Leave empty to just open it."></textarea>
      <div class="actions"><button class="primary" data-action="start-go" ${ui.startEngine ? '' : 'disabled'}>Start</button></div>` : 'Say what to do, or leave it empty'}</li>
  </ol>`);
}

function renderTabs() {
  const d = ui.sdiff && ui.sdiff.data;
  const n = d && d.files ? d.files.length + d.untracked.length : 0;
  setHtml('tabs', TABS.map(([id, label]) => `<button class="${ui.tab === id ? 'on' : ''}" data-action="tab" data-tab="${id}">${label}${id === 'diff' && n ? `<span class="n">${n}</span>` : ''}</button>`).join('')
    + '<button data-action="split-close" title="Close the side panel" aria-label="Close the side panel">x</button>');
}

function loadSessionDiff(sel) {
  const key = `${sel ? sel.id : ''}:${ui.diffScope}`;
  if (!sel || (ui.sdiff && ui.sdiff.key === key && ui.sdiff.at > Date.now() - (ui.look ? ui.look.terminal.git_every_ms : 10000))) return;
  ui.sdiff = { key, session: sel.id, at: Date.now(), data: ui.sdiff && ui.sdiff.key === key ? ui.sdiff.data : null };
  void api.sessionDiff(sel.id, ui.diffScope).then((data) => { if (ui.sdiff && ui.sdiff.key === key) { ui.sdiff.data = data; render(); } });
}

/** Every agent with changes, as chips over one file list; a file opens that agent's own diff. */
function renderAllChanges(sel) {
  const gits = ui.snap.git || {};
  const agents = ui.snap.sessions.filter((x) => gits[x.id] && (gits[x.id].added || gits[x.id].deleted));
  ui.allDiff = ui.allDiff || {};
  for (const x of agents) {
    const c = ui.allDiff[x.id];
    if (!c || c.at < Date.now() - 10000) {
      ui.allDiff[x.id] = { at: Date.now(), data: c ? c.data : null };
      void api.sessionDiff(x.id, 'uncommitted').then((data) => { ui.allDiff[x.id].data = data; render(); });
    }
  }
  const sum = agents.reduce((a, x) => [a[0] + gits[x.id].added, a[1] + gits[x.id].deleted], [0, 0]);
  const chips = `<div class="toolbar"><button class="chip ${sel && !ui.diffAll ? '' : 'on'}" data-action="diff-all">All changes <span class="meta">+${sum[0]} -${sum[1]}</span></button>${agents.map((x) => `<button class="chip ${sel && !ui.diffAll && sel.id === x.id ? 'on' : ''}" data-action="pick" data-id="${esc(x.id)}">${esc(x.engine_id)} <span class="meta">+${gits[x.id].added} -${gits[x.id].deleted}</span></button>`).join('')}<span class="grow"></span><button class="btn sm" data-action="tab" data-tab="handback">Hand back</button></div>`;
  if (sel && !ui.diffAll) return chips;
  const files = agents.flatMap((x) => {
    const d = ui.allDiff[x.id] && ui.allDiff[x.id].data;
    return d && d.files ? d.files.map((f) => ({ ...f, who: x })) : [];
  });
  const rows = files.map((f) => `<div class="git-row"><button class="link grow" data-action="diff-open" data-id="${esc(f.who.id)}" data-file="${esc(f.path)}">${esc(f.path)}</button><span class="meta">${esc(f.who.engine_id)}</span><span class="meta">+${f.added ?? '?'} -${f.deleted ?? '?'}</span></div>`).join('');
  return `${chips}${rows || (agents.length ? '<p class="empty">Loading.</p>' : '<p class="empty">No agent has changed anything yet. Your own changes are in the Git tab.</p>')}`;
}

function renderDiffTab(sel) {
  const head = renderAllChanges(sel);
  if (!sel || ui.diffAll) return head;
  loadSessionDiff(sel);
  const d = ui.sdiff && ui.sdiff.data;
  const scopes = [['turn', 'Last turn'], ['uncommitted', 'Uncommitted'], ['branch', 'Whole branch']];
  const bar = `${head}<div class="toolbar">${scopes.map(([id, label]) => `<button class="chip ${ui.diffScope === id ? 'on' : ''}" data-action="diff-scope" data-scope="${id}">${label}</button>`).join('')}</div>`;
  if (!d) return `${bar}<p class="empty">Loading.</p>`;
  if (d.error) return `${bar}<p class="empty">${esc(d.error)}</p>`;
  if (!d.files.length && !d.untracked.length) return `${bar}<p class="empty">No changes ${ui.diffScope === 'turn' ? 'in the last turn' : ui.diffScope === 'branch' ? 'on this branch' : 'since the last commit'}.</p>`;
  if (!ui.sdFile || !(d.files.some((f) => f.path === ui.sdFile) || d.untracked.includes(ui.sdFile))) ui.sdFile = d.files[0] ? d.files[0].path : null;
  const want = `${sel.id}:${ui.sdFile}:${ui.sdiff.at}:${ui.diffScope}`;
  if (ui.sdFile && ui.sdKey !== want) {
    ui.sdKey = want;
    const file = ui.sdFile;
    void api.sessionDiffFile(sel.id, file, ui.diffScope).then((text) => { if (ui.sdFile === file) { ui.hbFile = file; ui.hbDiff = text; render(); } });
  }
  const chips = d.files.map((f) => `<button class="chip ${ui.sdFile === f.path ? 'on' : ''}" data-action="sd-file" data-file="${esc(f.path)}">${esc(f.path)} <span class="meta">+${f.added ?? '?'} -${f.deleted ?? '?'}</span></button>`).join('');
  ui.hbFile = ui.sdFile;
  return `${bar}<div class="toolbar">${chips}</div>${ui.sdFile ? renderDiff() : ''}${d.untracked.length ? `<h3>New files not yet added</h3><ul>${d.untracked.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}`;
}

function renderStrip(sel) {
  const s = ui.snap;
  const needs = needsCount();
  const working = s.sessions.filter((x) => x.state === 'working').length;
  const d = ui.sdiff && ui.sdiff.data;
  const n = d && d.files ? d.files.length + d.untracked.length : 0;
  setHtml('strip-needs', needs ? `<span class="needs-l" data-action="inbox"><span class="dot waiting_for_you"></span>${needs} need${needs === 1 ? 's' : ''} you</span>` : '<span class="link" data-action="inbox">Inbox</span>');
  setHtml('strip-info', sel ? `${esc(sel.engine_id)} · ${esc(sel.task || taskOf(sel))} · ${working} working` : `${working} working`);
  document.getElementById('diffN').textContent = n ? ` ${n}` : '';
  for (const b of document.querySelectorAll('#strip [data-action="tab"]')) b.classList.toggle('on', ui.split && ui.tab === b.dataset.tab);
}

function renderInbox() {
  const el = document.getElementById('inbox');
  if (el.hidden) return;
  const s = ui.snap;
  const waiting = waitingAll();
  const away = (x) => (x.project_id === ui.projectId ? '' : `${(s.projects.find((p) => p.id === x.project_id) || {}).name || 'other project'}: `);
  const rows = s.needs_you.map((n) => `<div class="item${n.read_at ? ' read' : ''}" data-action="inbox-open" data-id="${esc(n.id)}">
      <span class="dot ${n.kind === 'done' ? 'done unseen' : n.kind === 'failed' ? 'failed' : 'waiting_for_you'}"></span>
      <span class="grow">${esc(n.text)}<span class="meta"> · ${esc(n.kind)} · <span data-ago="${esc(n.at)}">${esc(ago(n.at))}</span></span></span>
      ${n.kind === 'uncommitted' ? `<button class="link" data-action="inbox-open" data-id="${esc(n.id)}">Open Git tab</button>` : ''}<button class="link" data-action="${n.read_at ? 'inbox-unread' : 'inbox-read'}" data-id="${esc(n.id)}">${n.read_at ? 'Mark unread' : 'Mark read'}</button></div>`).join('');
  const asks = waiting.map((x) => `<div class="item" data-action="pick" data-id="${esc(x.id)}"><span class="dot waiting_for_you"></span><span class="grow">${esc(away(x))}${esc(x.engine_id)} ${esc(taskOf(x))} is asking you<span class="meta"> · ${esc(x.last_line || '')}</span></span></div>`).join('');
  setHtml('inbox-list', asks + rows || '<p class="empty" style="padding:6px 14px">Nothing here.</p>');
}

async function openNeedsYou(id, fallback = true) {
  const n = ui.snap.needs_you.find((y) => y.id === id);
  if (!n) {
    if (fallback) { document.getElementById('inbox').hidden = false; renderInbox(); }
    return;
  }
  if ((n.kind === 'done' || n.kind === 'failed') && n.ref) await pick(n.ref);
  else if (n.kind === 'uncommitted') { await rpc('needs_you.mark-read', { id }, true); await openTab('git'); }
  else { await rpc('needs_you.mark-read', { id }, true); wall.setSheet(true); }
}

const SINK_KINDS = ['ntfy', 'slack-webhook', 'discord-webhook', 'teams-workflow', 'webhook', 'command'];
const SINK_DEFAULT_KINDS = ['gate', 'handoff', 'run-failed', 'budget', 'missing-secret', 'approval'];
const SINK_ALL_KINDS = ['gate', 'interrupted-command', 'missed-schedule', 'run-failed', 'missing-secret', 'handoff', 'budget', 'done', 'failed', 'spool-too-large', 'uncommitted', 'approval', 'other'];
const SINK_DEST_HINT = {
  ntfy: 'https://ntfy.sh/your-topic',
  'slack-webhook': 'Slack incoming webhook URL',
  'discord-webhook': 'Discord webhook URL',
  'teams-workflow': 'Teams Workflows webhook URL',
  webhook: 'https:// URL that takes a JSON POST',
  command: 'JSON argv, e.g. ["apprise","-b"]',
};

async function openSinks() {
  const r = await rpc('notify.sink.list', {});
  if (!r.result) return;
  ui.sinks = r.result.sinks;
  ui.sinkEdit = ui.sinks.length ? null : { kinds: SINK_DEFAULT_KINDS, enabled: true };
  document.getElementById('sinks').hidden = false;
  renderSinks();
}

function renderSinks() {
  const rows = ui.sinks.map((s) => `<div class="item">
      <span class="dot ${s.enabled ? 'done' : 'exited'}"></span>
      <span class="grow">${esc(s.name)}<span class="meta"> · ${esc(s.kind)} · ${esc(s.kinds.join(', '))}${s.enabled ? '' : ' · off'}</span></span>
      <button class="link" data-action="sink-test" data-id="${esc(s.id)}">Test</button><button class="link" data-action="sink-edit" data-id="${esc(s.id)}">Edit</button><button class="link" data-action="sink-remove" data-id="${esc(s.id)}">Remove</button></div>`).join('');
  const e = ui.sinkEdit;
  const kind = e && e.kind ? e.kind : SINK_KINDS[0];
  const form = e ? `<div class="sink-form">
      <label>Kind <select id="sink-kind"${e.id ? ' disabled' : ''}>${SINK_KINDS.map((k) => `<option${k === kind ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
      <label>Name <input id="sink-name" value="${esc(e.name || '')}" placeholder="${esc(kind)}"></label>
      <label>Destination <input id="sink-dest" type="password" autocomplete="off" placeholder="${esc(e.id ? 'Enter it again; it is never shown' : SINK_DEST_HINT[kind])}"></label>
      <div class="sink-kinds">${SINK_ALL_KINDS.map((k) => `<label><input type="checkbox" class="sink-k" value="${k}"${e.kinds.includes(k) ? ' checked' : ''}> ${k}</label>`).join('')}</div>
      <label><input type="checkbox" id="sink-on"${e.enabled ? ' checked' : ''}> Enabled</label>
      <div><button class="primary" data-action="sink-save">Save</button> <button class="link" data-action="sink-cancel">Cancel</button></div></div>`
    : '<div style="padding:6px 14px"><button class="link" data-action="sink-new">Add a sink</button></div>';
  setHtml('sinks-list', (rows || '<p class="empty" style="padding:6px 14px">No sinks yet.</p>') + form);
}

async function saveSink() {
  const e = ui.sinkEdit;
  const params = {
    kind: e.id ? e.kind : document.getElementById('sink-kind').value,
    dest: document.getElementById('sink-dest').value.trim(),
    kinds: [...document.querySelectorAll('.sink-k:checked')].map((c) => c.value),
    enabled: document.getElementById('sink-on').checked,
  };
  const name = document.getElementById('sink-name').value.trim();
  if (name) params.name = name;
  if (e.id) params.id = e.id;
  if ((await rpc('notify.sink.set', params)).result) { toast('Sink saved.'); await openSinks(); }
}

const KEYS = [
  { keys: 'Ctrl+K', does: 'Open or close the palette and search', where: 'anywhere' },
  { keys: 'Ctrl+G', does: 'Grid on or off', where: 'anywhere' },
  { keys: 'Ctrl+B', does: 'Agent list on or off', where: 'anywhere' },
  { keys: 'Alt+J', does: 'Jump to the agent that has waited longest', where: 'anywhere' },
  { keys: 'Esc', does: 'Close the open panel or popover', where: 'anywhere' },
  { keys: 'Shift+Enter', does: 'New line without sending', where: 'agent tile' },
  { keys: 'Ctrl+C with a selection', does: 'Copy', where: 'tile' },
  { keys: 'Ctrl+V, right-click', does: 'Paste (an image if the clipboard has no text)', where: 'tile' },
  { keys: 'Ctrl+click', does: 'Open a link or file path', where: 'tile' },
  { keys: 'Ctrl+T', does: 'New browser pane', where: 'browser' },
  { keys: 'Ctrl+L', does: 'Address bar', where: 'browser' },
  { keys: 'Ctrl+F', does: 'Find in page', where: 'browser' },
  { keys: 'Ctrl+R, F5', does: 'Reload', where: 'browser' },
  { keys: 'Alt+Left, Alt+Right', does: 'Back, forward', where: 'browser' },
  { keys: 'Ctrl+=, Ctrl+-, Ctrl+0', does: 'Zoom in, out, reset', where: 'browser' },
  { keys: 'F12', does: 'Page devtools', where: 'browser' },
  { keys: 'C', does: 'Comment on an element', where: 'browser' },
  { keys: 'Up, Down', does: 'Walk the element stack while picking', where: 'browser pick' },
];

function paletteItems() {
  const s = ui.snap;
  if (!s) return [];
  const items = [];
  for (const x of s.sessions) items.push({ group: 'Agents', label: `${x.engine_id} ${taskOf(x)}`, meta: STATE_WORDS[x.state] || x.state, run: () => pick(x.id) });
  if (project()) for (const e of s.engines) if (e.light !== 'red') items.push({ group: 'Start', label: `New ${e.id} agent`, run: async () => { const r = await rpc('session.launch', { project_id: ui.projectId, engine_id: e.id }); if (r.result) await pick(r.result.session_id); } });
  const sel = selectedSession();
  if (sel && !sel.shell && sel.engine_id === 'claude' && sel.host !== 'external') items.push({ group: 'Actions', label: sel.limit_resume === 0 ? 'At a usage limit reset: go on in this session' : 'At a usage limit reset: wait in this session', run: () => rpc('session.limit-resume', { session_id: sel.id, on: sel.limit_resume === 0 }) });
  if (sel) items.push({ group: 'Actions', label: 'Paste the held prompt into this terminal', run: async () => { const r = await rpc('session.paste-prompt', { session_id: sel.id }); if (r.result && !r.result.written) toast(r.result.reason); } });
  for (const k of ui.shellKinds) if (project()) items.push({ group: 'Start', label: `New ${k.label} tab`, run: () => openShell(k.kind) });
  items.push({ group: 'Actions', label: ui.mode === 'grid' ? 'Show one terminal' : 'Show all agents as a grid', meta: 'Ctrl+G', run: () => setMode(ui.mode === 'grid' ? 'single' : 'grid') });
  items.push({ group: 'Actions', label: 'Open a browser pane', run: async () => { const r = await rpc('pane.open', { project_id: ui.projectId }); if (r.result) { ui.paneId = r.result.pane_id; openTab('browser'); } } });
  items.push({ group: 'Actions', label: 'Open a project folder', run: openFolder });
  for (const [id, label] of TABS) items.push({ group: 'Panels', label, run: () => openTab(id) });
  items.push({ group: 'Actions', label: 'Toggle the agent list', meta: 'Ctrl+B', run: () => wall.setList(!wall.listOpen()) });
  items.push({ group: 'Actions', label: 'Keyboard shortcuts', stay: true, run: () => { ui.keysView = true; ui.paletteAt = 0; document.getElementById('palette-input').value = ''; renderPalette(); } });
  const eq = document.body.classList.contains('ind-eq');
  items.push({ group: 'Actions', label: eq ? 'Working indicator: sparkline' : 'Working indicator: equaliser', run: () => { document.body.classList.toggle('ind-eq', !eq); document.body.classList.toggle('ind-spark', eq); save('ind', eq ? 'spark' : 'eq'); } });
  const hdr = load('hdr') || 'line';
  for (const [k, name] of [['line', 'second line tinted'], ['head', 'whole header tinted'], ['edge', 'edge bar'], ['words', 'coloured words'], ['ask', 'only when it needs you']]) {
    if (k !== hdr) items.push({ group: 'Actions', label: `Tile state colour: ${name}`, run: () => { setHdr(k); save('hdr', k); } });
  }
  const themes = (ui.settingsLook && ui.settingsLook.themes) || [];
  for (const t of themes) items.push({ group: 'Theme', label: `Theme: ${t.label}`, meta: ui.look && ui.look.theme.name === t.id ? 'current' : '', run: () => setLook(t.id) });
  const armed = ui.armed && ui.armed.key;
  items.push({ group: 'Core', confirm: 'restart', name: 'Restart core (loads new core code; open agents stop)', label: armed === 'restart' ? 'Press Enter again to restart; open agents stop' : 'Restart core (loads new core code; open agents stop)', run: async () => { toast('Restarting core'); await api.restartCore(); toast('Core restarted'); } });
  items.push({ group: 'Core', confirm: 'stop', name: 'Stop core (stops every agent)', label: armed === 'stop' ? 'Press Enter again to stop every agent' : 'Stop core (stops every agent)', run: async () => { await api.stopCore(); toast('Core stopped'); } });
  items.push({ group: 'Core', label: 'Open logs folder', run: () => api.openLogs() });
  items.push({ group: 'Core', label: 'Notification sinks (Slack, ntfy, webhooks)', run: openSinks });
  return items;
}

const ICONS = {
  Agents: '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"><rect x="1.5" y="3.5" width="11" height="8" rx="2"/><path d="M5 7h.01M9 7h.01M7 1v2.5" stroke-linecap="round" stroke-width="1.6"/></svg>',
  'Needs you': '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"><path d="M7 1.5l5.5 5.5L7 12.5 1.5 7z"/></svg>',
};
const CMD_ICON = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"><path d="M2 4l3 3-3 3M7 10.5h5"/></svg>';

function renderPalette() {
  const q = document.getElementById('palette-input').value.trim().toLowerCase();
  const keys = KEYS.map((k) => ({ group: 'Keys', label: k.does, meta: `${k.keys} · ${k.where}`, stay: true, run() {} }));
  const all = ui.keysView ? keys.filter((x) => !q || `${x.label} ${x.meta}`.toLowerCase().includes(q))
    : [...paletteItems().filter((x) => !q || `${x.group} ${x.name || x.label}`.toLowerCase().includes(q)), ...scrollbackItems(q)];
  ui.paletteItems = all;
  ui.paletteAt = Math.min(ui.paletteAt || 0, Math.max(0, all.length - 1));
  const hl = (t) => { const i = t.toLowerCase().indexOf(q); return !q || i < 0 ? esc(t) : `${esc(t.slice(0, i))}<mark>${esc(t.slice(i, i + q.length))}</mark>${esc(t.slice(i + q.length))}`; };
  let last = '';
  document.getElementById('palette-list').innerHTML = all.map((x, i) => {
    const head = x.group !== last ? `<div class="rg">${esc(x.group)}</div>` : '';
    last = x.group;
    return `${head}<button class="ri${i === ui.paletteAt ? ' cur' : ''}" data-palette="${i}"><span class="ic">${ICONS[x.group] || CMD_ICON}</span><span class="lab">${hl(x.label)}</span>${x.meta ? `<span class="sub">${esc(x.meta)}</span>` : ''}</button>`;
  }).join('') || '<div class="rg">No matches</div>';
  const cur = document.querySelector('#palette-list .ri.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
}

function scrollbackItems(q) {
  const rows = [...ui.snap.sessions, ...shellRows()];
  return (ui.scrollHits || []).flatMap((h) => {
    const x = rows.find((r) => r.id === h.session_id);
    return x && q && h.text.toLowerCase().includes(q) ? [{ group: 'Scrollback', label: h.text, meta: x.engine_id, run: () => openHit(h) }] : [];
  });
}

async function openHit(h) {
  if (h.session_id.startsWith('sh_')) selectShell(h.session_id); else await pick(h.session_id);
  await termView.reveal(h.session_id, h.line, h.text);
}

let scrollTimer = 0;
function searchScrollback() {
  clearTimeout(scrollTimer);
  const q = document.getElementById('palette-input').value.trim();
  if (q && ui.snap.core.online) scrollTimer = setTimeout(async () => {
    const r = await rpc('session.search', { query: q, session_ids: [...ui.snap.sessions, ...shellRows()].map((x) => x.id) }, true);
    if (r.result && document.getElementById('palette-input').value.trim() === q) { ui.scrollHits = r.result.hits; renderPalette(); }
  }, 100);
}

function openPalette() {
  const el = document.getElementById('palette');
  const input = document.getElementById('palette-input');
  if (el.hidden) {
    el.hidden = false;
    input.value = '';
    ui.paletteAt = 0;
    ui.scrollHits = [];
    wall.openSearch();
    renderPalette();
  }
  input.focus();
}

function closePalette() {
  disarm();
  ui.keysView = false;
  document.getElementById('palette').hidden = true;
  const input = document.getElementById('palette-input');
  input.value = '';
  input.blur();
  wall.closeSearch();
}

const ARM_MS = 3000;

/** First Enter on a confirm item arms it; a second Enter within ARM_MS runs it. */
function arm(key) {
  clearTimeout(ui.armTimer);
  ui.armed = { key, at: Date.now() };
  ui.armTimer = setTimeout(disarm, ARM_MS);
  renderPalette();
}

function disarm() {
  if (!ui.armed) return;
  clearTimeout(ui.armTimer);
  ui.armed = null;
  if (!document.getElementById('palette').hidden) renderPalette();
}

/** Closes the Inbox, the sinks popover and the usage popover; true when one was open. */
function closePopovers() {
  let closed = false;
  for (const id of ['inbox', 'sinks', 'menu']) {
    const el = document.getElementById(id);
    if (!el.hidden) { el.hidden = true; closed = true; }
  }
  const usage = document.getElementById('usage');
  if (usage.classList.contains('open')) { usage.classList.remove('open'); closed = true; }
  return closed;
}

/** True while Esc has something to close, so a focused tile keeps Esc from its agent. */
function overlayOpen() {
  return ['inbox', 'sinks', 'menu'].some((id) => !document.getElementById(id).hidden) || document.getElementById('usage').classList.contains('open')
    || wall.sheetOpen() || wall.listOpen();
}

async function runPalette(i, enter = false) {
  const item = (ui.paletteItems || [])[i];
  if (item && item.stay) { item.run(); return; }
  if (item && item.confirm && !enter) { disarm(); ui.paletteAt = i; renderPalette(); return; }
  if (item && item.confirm && !(ui.armed && ui.armed.key === item.confirm && Date.now() - ui.armed.at < ARM_MS)) { arm(item.confirm); return; }
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
  wall.promote(id);
  render(true);
}

async function openShell(kind) {
  const r = await rpc('shell.open', { project_id: ui.projectId, kind });
  if (!r.result) return;
  ui.shells.push({ id: r.result.shell_id, label: r.result.label, cwd: r.result.cwd, project_id: ui.projectId, kind });
  selectShell(r.result.shell_id);
}

async function pick(id, focus = true) {
  ui.shellSel = null;
  ui.localSel = id;
  ui.mode = 'single';
  save('mode', 'single');
  await rpc('session.focus', { session_id: id }, true);
  wall.promote(id);
  render(focus);
}

function waitReason(x) {
  return x.reason || (x.last_tool ? `permission: ${x.last_tool}` : 'question');
}

function oldestWaiting(sessions) {
  const w = sessions.filter((x) => x.state === 'waiting_for_you');
  w.sort((a, b) => Date.parse(a.state_at) - Date.parse(b.state_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return w[0] || null;
}

function onTilePick(id, e) {
  if (wall.toggleOpen(id) || wall.isBig(id)) return;
  if (e && e.shiftKey) { wall.pair(id); return; }
  if (id.startsWith('sh_')) selectShell(id); else void pick(id);
}

function tileMeta(x) {
  const g = (ui.snap.git || {})[x.id];
  const parts = [];
  if (g && g.branch) parts.push(`${g.branch} +${g.added} -${g.deleted}`);
  if (!DEMO) parts.push(costChip(x));
  return parts.join('  ');
}

function costChip(x) {
  if (x.tokens === null || x.tokens === undefined) return 'usage unknown';
  const usd = x.usd === null || x.usd === undefined ? '' : ` · $${x.usd.toFixed(2)}`;
  return `${x.tokens.toLocaleString('en-US')} tok${usd}`;
}

function changedFiles(id) {
  const g = (ui.snap.git || {})[id];
  return g && Array.isArray(g.changed) ? g.changed : [];
}

function ctxChip(x) {
  if (typeof x.ctx_pct !== 'number') return null;
  const pct = Math.round(x.ctx_pct);
  return pct >= 85 ? { text: `${pct}% context · compacts soon`, warn: true } : { text: `${pct}% context`, warn: false };
}

function render(focus = false) {
  if (!ui.snap) return;
  document.body.classList.toggle('no-split', !ui.split);
  coreRestarted();
  seedLayout();
  const shown = !project() ? [] : [...ui.snap.sessions, ...shellRows()].filter((x) => !ui.pendingHide.has(x.id) && (x.state !== 'exited' || x.id === ui.snap.selected || x.shell))
    .map((x) => ({ id: x.id, from: x.resumed_from || x.from || null, engine_id: x.driven_engine ? `${x.engine_id} > ${x.driven_engine}` : x.engine_id, state: x.state, shell: Boolean(x.shell), outside: x.host === 'external', task: x.shell ? x.task : taskOf(x), last: x.shell ? '' : x.state === 'waiting_for_you' ? waitReason(x) : x.last_line, meta: x.shell ? '' : tileMeta(x), previews: x.shell ? [] : (ui.snap.dev_servers || []).filter((d) => d.session_id === x.id), ctx: x.shell ? null : ctxChip(x), changed: x.shell ? 0 : changedFiles(x.id).length, limitResume: x.limit_resume !== 0, unseen: !x.shell && unseen(x), words: x.shell ? 'shell' : `${x.host === 'external' ? 'outside · ' : ''}${STATE_WORDS[x.state] || x.state}` }));
  const big = wall.decide(shown, ui.shellSel || ui.snap.selected);
  reportFocus(big);
  for (const x of shown) x.watchOff = !x.shell && (ui.snap.watcher_off || []).includes(x.id);
  const sel = selectedSession();
  renderTitle();
  renderList(sel);
  renderStart();
  termView.show({ mode: ui.mode, selected: big, sessions: shown, onPick: onTilePick, onOutput: wall.output, onExit: (id) => { const sh = ui.shells.find((x) => x.id === id); if (sh) { sh.exited = true; render(); } }, focus });
  wall.apply(ui.mode);
  renderSheet();
  renderTabs();
  let html;
  if (!project()) html = '<p class="empty">Open a project folder to begin.</p>';
  else if (ui.tab === 'browser') html = renderBrowser();
  else if (ui.tab === 'handback') html = renderHandback();
  else if (ui.tab === 'git') html = renderGit();
  else html = renderDiffTab(sel);
  setHtml('view', html);
  if (ui.tab === 'browser') browserChrome.after(document.getElementById('view'));
  reportPaneBounds();
  renderStrip(sel);
  renderInbox();
  if (PROBE) void api.probe({ sessions: ui.snap.sessions.map((x) => ({ id: x.id, state: x.state })), online: ui.snap.core.online, term: termView.state(), layout: { tab: ui.tab, split: ui.split, mode: ui.mode, rows: document.querySelectorAll('.srow').length, start: !document.getElementById('start').hidden }, previews: [...document.querySelectorAll('.tile [data-action="open-preview"]')].map((b) => ({ session: b.closest('.tile').dataset.id, url: b.dataset.url, text: b.textContent })) });
}

// Main suppresses toasts for this tile, so it must be the one on screen, not the last session.focus.
function reportFocus(id) {
  if (id === ui.focused) return;
  ui.focused = id;
  void api.focus(id);
}

function setView() {
  void api.view({ projectId: ui.projectId });
}

// Opens the browser split on the open run's panes: all of them when the run is opened, then each new one as it appears.
function switchProject(id) {
  ui.projectId = id;
  ui.handback = undefined;
  ui.hbFile = null;
  ui.hbDiff = undefined;
  ui.hbLine = null;
  ui.gitFile = false;
  ui.comment = null;
  if (ui.picking) { void api.panePickCancel(ui.picking.pane); ui.picking = null; }
  save('projectId', id);
  setView();
}

async function openFolder() {
  const dir = await api.pickFolder();
  if (!dir) return;
  const r = await rpc('project.open', { path: dir });
  if (r.result) switchProject(r.result.project_id);
}

/** The project menu's groups; a worktree the core's sweep marked older goes in the collapsed Older group, not Worktrees. */
function projectGroups(list) {
  const wt = (p) => /[\\/]\.(metatrooper|claude)[\\/]worktrees[\\/]/i.test(p.path);
  const scratch = (p) => !wt(p) && /[\\/](\.cache|Temp|tmp)[\\/]/i.test(p.path);
  const fresh = list.filter((p) => !p.older);
  return { projects: fresh.filter((p) => !wt(p) && !scratch(p)), worktrees: fresh.filter(wt), older: list.filter((p) => p.older), scratch: fresh.filter(scratch) };
}

/** One project menu row; the x that hides it shows only when none of its sessions is working or waiting. */
function projectMenuItem(p) {
  const live = liveCounts(p.id).replace(/^ · /, '');
  return `<div class="item" role="menuitem" tabindex="-1" data-action="project-go" data-id="${esc(p.id)}" title="${esc(p.path)}"><span class="grow">${esc(p.name)}</span><span class="meta">${esc(live)}</span>`
    + (live ? '' : `<button class="dismiss" data-action="project-hide" data-id="${esc(p.id)}" title="Remove from this menu (files stay; Open folder brings it back)" aria-label="Remove ${esc(p.name)} from this menu">&times;</button>`) + '</div>';
}

async function onClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA') return;
  const a = el.dataset.action;
  const id = el.dataset.id || (el.closest('.tile') ? el.closest('.tile').dataset.id : undefined);
  if (a !== 'seen') e.stopPropagation();
  switch (a) {
    case 'list':
      wall.setList(!wall.listOpen());
      return;
    case 'usage':
      document.getElementById('usage').classList.toggle('open');
      return;
    case 'sheet':
      wall.setSheet(!wall.sheetOpen());
      return;
    case 'open-panel':
      await openTab(el.dataset.tab);
      return;
    case 'pair':
      wall.pair(id);
      return;
    case 'unpair':
      wall.unpair();
      return;
    case 'resume-tile': {
      const r = await rpc('session.resume', { session_id: id });
      if (r.result) await pick(r.result.session_id);
      return;
    }
    case 'changed-menu': {
      const menu = document.getElementById('menu');
      const r = el.getBoundingClientRect();
      menu.innerHTML = `<div class="mh">Changed by this agent</div>${changedFiles(id).map((f) => `<div class="item" role="menuitem" tabindex="-1" data-action="changed-open" data-id="${esc(id)}" data-file="${esc(f)}">${esc(f)}</div>`).join('')}`;
      menu.style.left = `${Math.max(8, r.right - 260)}px`;
      menu.style.top = `${r.bottom + 4}px`;
      menu.hidden = false;
      menu.querySelector('[role="menuitem"]')?.focus();
      return;
    }
    case 'changed-open':
      document.getElementById('menu').hidden = true;
      ui.diffAll = false;
      ui.diffScope = 'uncommitted';
      ui.sdFile = el.dataset.file;
      ui.sdiff = null;
      ui.hbDiff = undefined;
      await pick(id);
      await openTab('diff');
      return;
    case 'launch-menu': {
      const menu = document.getElementById('menu');
      const r = el.getBoundingClientRect();
      menu.innerHTML = `<div class="mh">Agents</div>${ui.snap.engines.map((x) => `<div class="item" role="menuitem" tabindex="-1" data-action="launch" data-engine="${esc(x.id)}">${esc(x.id)}${x.light === 'red' ? ` <span class="meta">not ready: ${esc(x.fix || x.detail || 'check failed')}</span>` : ''}</div>`).join('')}`
        + (ui.shellKinds.length ? `<div class="mh">Terminals</div>${ui.shellKinds.map((k) => `<div class="item" role="menuitem" tabindex="-1" data-action="shell-open" data-kind="${esc(k.kind)}">${esc(k.label)}</div>`).join('')}` : '');
      menu.style.left = `${Math.max(8, r.right - 220)}px`;
      menu.style.top = `${r.bottom + 4}px`;
      menu.hidden = false;
      menu.querySelector('[role="menuitem"]')?.focus();
      return;
    }
    case 'project-menu': {
      const menu = document.getElementById('menu');
      const r = el.getBoundingClientRect();
      const g = projectGroups(ui.snap.projects.filter((p) => p.id !== ui.projectId));
      const sec = (title, list) => (list.length ? `<div><div class="mh">${title}</div>${list.map(projectMenuItem).join('')}</div>` : '');
      const fold = (title, list) => (list.length ? `<details><summary class="mh">${title} (${list.length})</summary>${list.map(projectMenuItem).join('')}</details>` : '');
      const cur = ui.snap.projects.find((p) => p.id === ui.projectId);
      menu.innerHTML = '<div class="kmenu">' + (cur ? `<div class="mh">This window</div><div class="item on" role="menuitem" tabindex="-1" title="${esc(cur.path)}"><span class="grow">${esc(cur.name)}</span><span class="meta">&#10003;</span></div>` : '')
        + sec('Projects', g.projects)
        + fold('Worktrees', g.worktrees)
        + fold('Older', g.older)
        + fold('Scratch and temp folders', g.scratch)
        + '<div class="sep"></div><div class="item" role="menuitem" tabindex="-1" data-action="open-folder"><span class="grow">Open folder...</span></div>' + '</div>';
      menu.style.left = `${Math.max(8, r.left)}px`;
      menu.style.top = `${r.bottom + 4}px`;
      menu.hidden = false;
      menu.querySelector('[role="menuitem"]')?.focus();
      return;
    }
    case 'project-go':
      document.getElementById('menu').hidden = true;
      if (id && id !== ui.projectId) switchProject(id);
      return;
    case 'project-hide': {
      const r = await rpc('project.hide', { project_id: id });
      if (!r.result) return;
      const row = el.closest('.item'), group = row.parentElement;
      if (!group) return;
      row.remove();
      if (!group.querySelector('.item')) group.remove();
      return;
    }
    case 'open-folder':
      document.getElementById('menu').hidden = true;
      await openFolder();
      return;
    case 'pick': {
      wall.setList(false);
      const other = (ui.snap.live || []).find((x) => x.id === id && x.project_id !== ui.projectId);
      if (other) {
        document.getElementById('inbox').hidden = true;
        ui.pendingPick = id;
        switchProject(other.project_id);
        return;
      }
      if (e.shiftKey && !wall.isBig(id)) { wall.pair(id); return; }
      await pick(id);
      return;
    }
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
    case 'inbox-open':
      document.getElementById('inbox').hidden = true;
      await openNeedsYou(id, false);
      return;
    case 'sink-new':
      ui.sinkEdit = { kinds: SINK_DEFAULT_KINDS, enabled: true };
      renderSinks();
      return;
    case 'sink-edit':
      ui.sinkEdit = ui.sinks.find((x) => x.id === id);
      renderSinks();
      return;
    case 'sink-cancel':
      ui.sinkEdit = null;
      renderSinks();
      return;
    case 'sink-save':
      await saveSink();
      return;
    case 'sink-test': {
      const r = await rpc('notify.sink.test', { id });
      if (r.result) toast(r.result.ok ? 'Test sent.' : `Test failed: ${r.result.error}`, !r.result.ok);
      return;
    }
    case 'sink-remove':
      if ((await rpc('notify.sink.remove', { id })).result) await openSinks();
      return;
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
      hideLater([id], 'Agent hidden');
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
      switchProject(id);
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
    case 'first-approval': {
      const r = await api.setApproval(el.dataset.value);
      if (r && r.ok) { ui.settingsLook.firstRun = false; render(); } else if (r) toast(r.error, true);
      return;
    }
    case 'restart-core':
      toast('Restarting core');
      await api.restartCore();
      toast('Core restarted');
      return;
    case 'open-logs':
      await api.openLogs();
      return;
    case 'launch': {
      document.getElementById('menu').hidden = true;
      wall.setList(false);
      save('engine', el.dataset.engine);
      const r = await rpc('session.launch', { project_id: ui.projectId, engine_id: el.dataset.engine });
      if (r.result && r.result.setup) toast(`Set up ${el.dataset.engine} for MetaTrooper: ${r.result.setup.join(', ')}`);
      if (r.result) await pick(r.result.session_id);
      return;
    }
    case 'shell-open':
      document.getElementById('menu').hidden = true;
      await openShell(el.dataset.kind);
      return;
    case 'pick-shell':
      wall.setList(false);
      selectShell(id);
      return;
    case 'shell-close':
      await rpc('shell.close', { shell_id: id }, true);
      ui.shells = ui.shells.filter((x) => x.id !== id);
      if (ui.shellSel === id) ui.shellSel = null;
      render();
      return;
    case 'hide':
      hideLater([id], 'Agent hidden');
      return;
    case 'limit-resume':
      await rpc('session.limit-resume', { session_id: id, on: el.ariaPressed !== 'true' });
      return;
    case 'clear-all':
      hideLater(ui.snap.sessions.map((x) => x.id), (n) => `${n} finished agent${n === 1 ? '' : 's'} cleared`);
      return;
    case 'seen': {
      const x = ui.snap.sessions.find((y) => y.id === id);
      if (x && x.state === 'done') await rpc('session.seen', { session_id: id }, true);
      return;
    }
    case 'git-stage':
    case 'git-unstage':
      await gitDo(a.slice(4), el.dataset.file);
      return;
    case 'git-stage-group':
      await gitDo('stage-group', JSON.parse(el.dataset.files || '[]'));
      return;
    case 'git-commit':
      await gitDo('commit', ui.gitMsg || '');
      return;
    case 'git-push':
      await gitDo('push');
      return;
    case 'git-pull':
      await gitDo('pull');
      return;
    case 'git-file': {
      const file = el.dataset.file;
      ui.gitFile = true;
      ui.hbFile = file;
      ui.hbDiff = undefined;
      ui.hbLine = null;
      render();
      const text = await api.git(ui.projectId, el.dataset.staged ? 'diff-staged' : 'diff', file);
      if (ui.hbFile === file) { ui.hbDiff = typeof text === 'string' ? text : null; render(); }
      return;
    }
    case 'hb-file': {
      const file = el.dataset.file;
      ui.gitFile = false;
      ui.hbFile = file;
      ui.hbDiff = undefined;
      ui.hbLine = null;
      render();
      const text = await api.handbackFile(ui.projectId, file);
      if (ui.hbFile === file) { ui.hbDiff = text; render(); }
      return;
    }
    case 'diff-scope':
      ui.diffScope = el.dataset.scope;
      save('diffScope', ui.diffScope);
      ui.sdFile = null;
      render();
      return;
    case 'diff-all':
      ui.diffAll = true;
      render();
      return;
    case 'diff-open':
      ui.diffAll = false;
      ui.diffScope = 'uncommitted';
      ui.sdFile = el.dataset.file;
      ui.hbDiff = undefined;
      await pick(id);
      return;
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
      toast(`Comment sent: in the session's next prompt for Claude.${r.copied ? ' Also on the clipboard.' : ''}`);
      ui.hbLine = null;
      render();
      return;
    }
    case 'pane':
      ui.paneId = id;
      ui.urlDraft = null;
      ui.find = null;
      ui.browserMode = 'live';
      render();
      return;
    case 'open-preview': {
      const own = ui.snap.panes.find((p) => p.session_id === id && p.id.startsWith('bp_agent_'));
      let paneId = own ? own.id : null;
      if (own) {
        const r = await api.paneNavigate(own.id, el.dataset.url);
        if (!r.ok) { toast(r.error, true); return; }
      } else {
        const r = await rpc('pane.open', { project_id: ui.projectId, session_id: id, agent: true, url: el.dataset.url });
        if (!r.result) return;
        paneId = r.result.pane_id;
      }
      ui.paneId = paneId;
      ui.urlDraft = null;
      ui.browserMode = 'live';
      ui.tab = 'browser';
      ui.split = true;
      save('tab', 'browser');
      save('split', '1');
      render();
      return;
    }
    case 'pane-new': {
      const r = await rpc('pane.open', { project_id: ui.projectId });
      if (r.result) ui.paneId = r.result.pane_id;
      return;
    }
    case 'pane-close': {
      const pid = id || ui.paneId;
      await rpc('pane.close', { pane_id: pid });
      if (pid === ui.paneId) ui.paneId = null;
      return;
    }
    case 'pane-menu': {
      const pane = ui.snap.panes.find((p) => p.id === ui.paneId);
      if (!pane) return;
      const shots = ui.snap.snapshots.filter((x) => x.pane_id === pane.id);
      const r = el.getBoundingClientRect();
      const items = browserChrome.menuItems(pane, ui.snap.sessions.map((x) => ({ id: x.id, label: sessionLabel(x) })), ui.browserMode,
        shots.some((x) => x.label === 'before') && shots.some((x) => x.label === 'after'));
      const pick = await api.paneMenu(items, Math.max(0, r.right - 200), r.bottom + 4);
      if (pick === 'before' || pick === 'after') {
        toast(`Capturing ${pick} at 390 and 1280 px`);
        await rpc('pane.capture', { pane_id: pane.id, label: pick });
      } else if (pick === 'mode') {
        ui.browserMode = ui.browserMode === 'compare' ? 'live' : 'compare';
        render();
      } else if (pick === 'timeline') {
        ui.browserMode = ui.browserMode === 'timeline' ? 'live' : 'timeline';
        if (ui.browserMode === 'timeline') await loadTimeline(pane.id);
        render();
      } else if (pick === 'find') openFind();
      else if (pick === 'close') {
        await rpc('pane.close', { pane_id: pane.id });
        ui.paneId = null;
      } else if (pick && pick.startsWith('own:')) await rpc('pane.assign', { pane_id: pane.id, session_id: pick.slice(4) || null });
      return;
    }
    case 'give-back':
      void api.paneAct(ui.paneId, 'give-back');
      return;
    case 'pane-act':
      void api.paneAct(ui.paneId, el.dataset.act);
      return;
    case 'find-step':
      findStep(el.dataset.dir !== 'back');
      return;
    case 'find-close':
      closeFind();
      return;
    case 'perm':
      ui.perms = ui.perms.filter((x) => x.id !== el.dataset.id);
      void api.paneAct(ui.paneId, 'permission', { id: el.dataset.id, allow: el.dataset.allow === '1' });
      render();
      return;
    case 'pane-comment':
      await startComment();
      return;
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
      toast(`Comment sent: in the session's next prompt for Claude.${r.copied ? ' Also on the clipboard.' : ''}`);
      ui.comment = null;
      render();
      return;
    }
    case 'dismiss':
      await rpc('needs.dismiss', { id });
      return;
    case 'approval': {
      const decision = el.dataset.decision;
      if ((await rpc('approval.resolve', { approval_id: id, decision, ...(el.dataset.scope ? { scope: el.dataset.scope } : {}) })).result) wall.verdict(el.closest('.gate'), decision === 'approve');
      return;
    }
  }
}

function onInput(e) {
  const el = e.target;
  if (el.id === 'palette-input') {
    ui.paletteAt = 0;
    disarm();
    renderPalette();
    searchScrollback();
    return;
  }
  if (el.id === 'sink-kind') {
    document.getElementById('sink-dest').placeholder = SINK_DEST_HINT[el.value];
    return;
  }
  if (el.dataset.action === 'project-pick') {
    if (e.type !== 'change' || !el.value) return;
    switchProject(el.value);
    return;
  }
  if (el.dataset.key === 'url' && e.type === 'input') {
    ui.urlDraft = el.value;
    return;
  }
  if (el.dataset.key === 'find' && e.type === 'input' && ui.find) {
    ui.find.text = el.value;
    ui.find.matches = 0;
    void api.paneAct(ui.paneId, 'find', { text: el.value });
    return;
  }
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

api.onSelectProject((id) => {
  switchProject(id);
  render();
});

api.onOpenNeedsYou((id) => {
  if (ui.snap) void openNeedsYou(id);
  else ui.pendingNeedsYou = id;
});

api.onSnapshot(async (s) => {
  ui.snap = s;
  for (const id of ui.hideDone) {
    const x = s.sessions.find((y) => y.id === id);
    if (!x || LIVE_STATES.includes(x.state)) { ui.hideDone.delete(id); ui.pendingHide.delete(id); }
  }
  if (ui.projectId && !s.projects.some((p) => p.id === ui.projectId)) {
    ui.projectId = null;
    save('projectId', null);
  }
  if (!ui.projectId && s.projects[0]) {
    ui.projectId = s.projects[0].id;
    setView();
  }
  if (ui.pendingNeedsYou) {
    const id = ui.pendingNeedsYou;
    ui.pendingNeedsYou = null;
    await openNeedsYou(id);
  }
  if (ui.pendingPick && s.sessions.some((x) => x.id === ui.pendingPick)) {
    const id = ui.pendingPick;
    ui.pendingPick = null;
    await pick(id);
    return;
  }
  render();
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'git-msg') ui.gitMsg = e.target.value;
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#usage')) document.getElementById('usage').classList.remove('open');
  const item =e.target.closest && e.target.closest('[data-palette]');
  if (item) { void runPalette(Number(item.dataset.palette)); return; }
  if (!document.getElementById('palette').hidden && !e.target.closest('#search')) closePalette();
  if (!e.target.closest('#menu')) document.getElementById('menu').hidden = true;
  if (!document.getElementById('inbox').hidden && !e.target.closest('#inbox') && !e.target.closest('[data-action="inbox"]')) document.getElementById('inbox').hidden = true;
  if (!document.getElementById('sinks').hidden && !e.target.closest('#sinks') && !e.target.closest('[data-palette]')) document.getElementById('sinks').hidden = true;
  void onClick(e);
});
document.addEventListener('contextmenu', (e) => {
  const row = e.target.closest && e.target.closest('.srow, .tile-head');
  const menu = document.getElementById('menu');
  if (row && !row.dataset.id) row.dataset.id = row.closest('.tile').dataset.id;
  if (!row || row.dataset.id.startsWith('sh_')) { menu.hidden = true; return; }
  e.preventDefault();
  const id = row.dataset.id;
  menu.innerHTML = `<div class="item" role="menuitem" tabindex="-1" data-action="clear-status" data-id="${esc(id)}">Clear status</div>${canHide(id) ? `<div class="item" role="menuitem" tabindex="-1" data-action="menu-hide" data-id="${esc(id)}">Hide</div>` : ''}`;
  menu.style.left = `${e.clientX}px`;
  menu.style.top = `${e.clientY}px`;
  menu.hidden = false;
  menu.querySelector('[role="menuitem"]')?.focus();
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
    termView.type(paths.join(' ') + ' ', onTerm.dataset.id);
    return;
  }
  for (const c of document.querySelectorAll('.srow.drop')) c.classList.remove('drop');
  const card = e.target.closest && e.target.closest('[data-drop-session]');
  if (!card || !e.dataTransfer.files.length) return;
  const r = await api.commentFiles(card.dataset.dropSession, e.dataTransfer.files);
  toast(r.ok ? `${e.dataTransfer.files.length} file path(s) sent: in the session's next prompt for Claude.${r.copied ? ' Also on the clipboard.' : ''}` : r.error, !r.ok);
});
document.addEventListener('keydown', (e) => {
  const palette = !document.getElementById('palette').hidden;
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if (palette) closePalette(); else openPalette(); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'g') { e.preventDefault(); setMode(ui.mode === 'grid' ? 'single' : 'grid'); return; }
  if (palette) {
    if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); ui.paletteAt = Math.max(0, Math.min((ui.paletteItems || []).length - 1, (ui.paletteAt || 0) + (e.key === 'ArrowDown' ? 1 : -1))); renderPalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!e.repeat) void runPalette(ui.paletteAt || 0, true); }
    return;
  }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'b') { e.preventDefault(); wall.setList(!wall.listOpen()); return; }
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 't' && ui.tab === 'browser' && project()) {
    e.preventDefault();
    void rpc('pane.open', { project_id: ui.projectId }).then((r) => { if (r.result) ui.paneId = r.result.pane_id; });
    return;
  }
  if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.metaKey && closePopovers()) { e.preventDefault(); return; }
  const active = document.activeElement;
  const inTerm = Boolean(active && active.classList && active.classList.contains('xterm-helper-textarea'));
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(active && active.tagName);
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape' && (!typing || inTerm)) {
    if (wall.sheetOpen()) wall.setSheet(false);
    else if (wall.listOpen()) wall.setList(false);
    else if (ui.split) { ui.split = false; render(); }
    return;
  }
  if (typing) return;
  const role = active && active.getAttribute && active.getAttribute('role');
  if ((e.key === 'Enter' || e.key === ' ') && ['button', 'menuitem', 'option'].includes(role)) { e.preventDefault(); active.click(); return; }
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && (role === 'menuitem' || role === 'option')) {
    e.preventDefault();
    const all = [...active.closest('#menu, #sessions').querySelectorAll(`[role="${role}"]`)].filter((x) => x.getClientRects().length);
    const next = all[all.indexOf(active) + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus();
    return;
  }
  if (ui.tab !== 'browser' || !ui.split) return;
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
document.getElementById('palette-input').addEventListener('focus', openPalette);
if (DEMO) document.body.classList.add('demo');
function setHdr(k) { for (const c of [...document.body.classList]) if (c.startsWith('hdr-')) document.body.classList.remove(c); document.body.classList.add(`hdr-${k}`); }
setHdr(load('hdr') || 'line');
if (load('ind') === 'eq') { document.body.classList.remove('ind-spark'); document.body.classList.add('ind-eq'); }
const fontsLoaded = Promise.all(['13px "Geist Mono"', '12px "Space Mono"', '12px "Geist"', '10px "Silkscreen"'].map((f) => document.fonts.load(f))).catch(() => {});
void Promise.all([api.uiSettings(), fontsLoaded]).then(([look]) => {
  ui.settingsLook = look;
  applyLook(look);
  render();
});
void rpc('shell.list', {}, true).then((r) => { if (r.result) { ui.shellKinds = r.result.shells; render(); } });
setView();

function paneTitle(p) {
  const st = ui.paneState[p.id] || {};
  const title = (st.title || '').trim();
  const base = title && title !== st.url && title !== 'about:blank' ? title.slice(0, 40) : hostOf(st.url || p.url);
  return `${st.loading ? '\u25CC ' : ''}${base}`;
}

async function paneGo() {
  const input = document.getElementById('pane-url');
  const url = (input ? input.value : ui.urlDraft || '').trim();
  if (!url || !ui.paneId) return;
  ui.urlDraft = null;
  if (input) input.blur();
  const r = await api.paneNavigate(ui.paneId, url);
  if (!r.ok) toast(r.error, true);
  render();
}

function openFind() {
  if (!ui.paneId) return;
  if (!ui.find) ui.find = { text: '', active: 0, matches: 0 };
  render();
  const input = document.getElementById('pane-find');
  if (input) { input.focus(); input.select(); }
}

function findStep(forward) {
  if (ui.find && ui.find.text) void api.paneAct(ui.paneId, 'find', { text: ui.find.text, forward, next: true });
}

function closeFind() {
  ui.find = null;
  void api.paneAct(ui.paneId, 'find-stop');
  render();
}

/** Up and Down outside a text field move the picked element to its parent or back to the child; true when it handled the key. */
function pickWalk(e) {
  if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
  if (/^(TEXTAREA|INPUT|SELECT)$/.test((e.target && e.target.tagName) || '')) return false;
  if (e.target !== document.body && !(e.target && e.target.closest && e.target.closest('.browser'))) return false;
  e.preventDefault();
  e.stopImmediatePropagation();
  void api.panePickWalk(ui.comment.pane_id, e.key === 'ArrowUp' ? 'up' : 'down');
  return true;
}

function browserKeys(e) {
  if (ui.comment && pickWalk(e)) return;
  if (ui.tab !== 'browser' || !ui.paneId || ui.comment) return;
  if (!(e.target && e.target.closest && e.target.closest('.browser'))) return;
  const id = e.target && e.target.id;
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (id === 'pane-url' && e.key === 'Enter') { e.preventDefault(); void paneGo(); return; }
  if (id === 'pane-url' && e.key === 'Escape') { e.preventDefault(); ui.urlDraft = null; e.target.blur(); render(); return; }
  if (id === 'pane-find' && e.key === 'Enter') { e.preventDefault(); findStep(!e.shiftKey); return; }
  if (id === 'pane-find' && e.key === 'Escape') { e.preventDefault(); closeFind(); return; }
  let act = null;
  if (mod && key === 'l') { e.preventDefault(); const u = document.getElementById('pane-url'); if (u) { u.focus(); u.select(); } return; }
  if (mod && key === 'f') { e.preventDefault(); openFind(); return; }
  if ((mod && key === 'r') || key === 'f5') act = 'reload';
  else if (e.altKey && key === 'arrowleft') act = 'back';
  else if (e.altKey && key === 'arrowright') act = 'forward';
  else if (mod && (key === '=' || key === '+')) act = 'zoom-in';
  else if (mod && key === '-') act = 'zoom-out';
  else if (mod && key === '0') act = 'zoom-reset';
  else if (key === 'f12') act = 'devtools';
  if (!act) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  void api.paneAct(ui.paneId, act);
}
document.addEventListener('keydown', (e) => { if (e.key !== 'Enter') disarm(); }, true);
document.addEventListener('keydown', browserKeys, true);

function wallKeys(e) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.code !== 'KeyJ' || !ui.snap) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const x = oldestWaiting(ui.snap.sessions);
  if (x) void pick(x.id);
}
document.addEventListener('keydown', wallKeys, true);
wall.onWake(() => render());

api.onPaneEvent((ev) => {
  if (!ev || typeof ev.pane_id !== 'string') return;
  if (ev.kind === 'state') ui.paneState[ev.pane_id] = ev;
  else if (ev.kind === 'found') { if (ui.find && ev.pane_id === ui.paneId) { ui.find.active = ev.active; ui.find.matches = ev.matches; } }
  else if (ev.kind === 'key') {
    if (ev.pane_id !== ui.paneId) return;
    if (ev.action === 'find') { openFind(); return; }
    const u = document.getElementById('pane-url');
    if (u) { u.focus(); u.select(); }
    return;
  } else if (ev.kind === 'download') { toast(ev.state === 'completed' ? `Downloaded to ${ev.file}` : `Download ${ev.state}: ${ev.file}`, ev.state !== 'completed'); return; }
  else if (ev.kind === 'permission') { ui.perms.push(ev); if (ev.pane_id !== ui.paneId) toast(`${ev.origin} wants ${ev.permission}; open its pane to answer.`); }
  else if (ev.kind === 'handoff') { ui.paneId = ev.pane_id; ui.tab = 'browser'; ui.split = true; ui.browserMode = 'live'; save('tab', ui.tab); toast(`An agent handed you a browser pane: ${ev.reason}`); }
  else if (ev.kind === 'opened') { ui.paneId = ev.pane_id; ui.urlDraft = null; ui.find = null; ui.tab = 'browser'; ui.split = true; save('tab', ui.tab); }
  render();
});
