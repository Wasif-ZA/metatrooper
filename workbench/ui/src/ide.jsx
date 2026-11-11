import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { ContextMenu } from '@astryxdesign/core/ContextMenu';
import { Dialog } from '@astryxdesign/core/Dialog';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl';
import { Tab, TabList } from '@astryxdesign/core/TabList';
import { TreeList } from '@astryxdesign/core/TreeList';
import { TextInput } from '@astryxdesign/core/TextInput';
import { TextArea } from '@astryxdesign/core/TextArea';
import { Selector } from '@astryxdesign/core/Selector';
import { createStore } from './store.js';
import * as Ic from './icons/index.js';
import * as Sc from './icons/screens.jsx';
import { editorState, openEditor, openDiff, patchSides, preloadMonaco, onProblems } from './editor.js';
import { sendComment } from './comment.js';
import './ide-editor.css';
import { Preview, isMd } from './preview.jsx';
import { paletteView } from './palette.jsx';
import { Terminal, Problems, closeShell, countProblems } from './ide-panel.jsx';
import './ide-panel.css';
import './ide-side.css';

export const ideStore = createStore({ tick: 0 });
let sentSummary = '';
const bump = () => {
  const summary = unsavedSummary();
  if (summary !== sentSummary) { sentSummary = summary; void api.setDirty?.(Boolean(summary), summary); }
  ideStore.set({ tick: ideStore.get().tick + 1 });
};

const states = new Map();
let cur = null;
const bridge = {};

const projectName = (pid) => ((ui.snap.projects || []).find((p) => p.id === pid) || {}).name || 'another project';

export function unsavedSummary() {
  const parts = [];
  for (const [pid, st] of states) {
    const dirtyTabs = st.tabs.filter((x) => x.dirty);
    if (dirtyTabs.length > 0) {
      parts.push(`${projectName(pid)}: ${dirtyTabs.map((x) => base(x.path)).join(', ')}`);
    }
  }
  return parts.join('; ');
}

const fresh = (pid) => ({ pid, rootOpen: true, dirs: new Map(), listing: new Set(), tabs: [], active: null, side: 'files', findOpen: false, q: '', hits: [], sq: '', sres: null, searching: false, ask: null, renaming: null, closeAll: false, git: null, gitSeq: 0, commitMsg: '' });
const slashed = (f) => String(f).replace(/\\/g, '/');
const base = (p) => p.split('/').pop();
const folder = (p) => p.split('/').slice(0, -1).join('/');
const tabOf = (st, path) => st.tabs.find((x) => x.path === path);
const PIC_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp']);
const isPic = (p) => PIC_EXTS.has(p ? p.split('.').pop().toLowerCase() : '');
const under = (p, root) => { const norm = root.endsWith('/') ? root.slice(0, -1) : root; return p === norm || p.startsWith(`${norm}/`); };
const canWrite = () => typeof api.fsWrite === 'function';
const canSearch = () => typeof api.fsSearch === 'function';
const inPreview = (t) => t.mode === 'preview' && isMd(t.path);

export const ideShown = () => ui.view === 'ide' && Boolean(project());

export async function drawIde() {
  const host = document.getElementById('ide');
  if (host) host.hidden = !ideShown();
  if (!ideShown()) return;
  preloadMonaco();
  if (cur && cur.pid === ui.projectId) {
    const sig = JSON.stringify(ui.snap.git || {});
    if (cur.sig !== undefined && cur.sig !== sig) void refresh(cur, cur.gitSnap, ui.snap.git || {});
    cur.sig = sig;
    cur.gitSnap = ui.snap.git || {};
    bump();
    return;
  }
  if (cur) {
    const dirtyTabs = cur.tabs.filter((x) => x.dirty);
    if (dirtyTabs.length > 0) {
      const top3 = dirtyTabs.slice(0, 3).map((x) => base(x.path)).join(', ');
      const more = dirtyTabs.length > 3 ? ` and ${dirtyTabs.length - 3} more` : '';
      const names = `${top3}${more}`;
      toast(`Unsaved in ${projectName(cur.pid)}: ${names}. Switch back to save them.`);
    }
  }
  if (cur && !cur.tabs.some((x) => x.dirty)) states.delete(cur.pid);
  const st = states.get(ui.projectId) || fresh(ui.projectId);
  states.set(st.pid, st);
  cur = st;
  bump();
  await loadDir(st, '');
}

async function loadDir(st, rel) {
  if (st.dirs.has(rel) || st.listing.has(rel)) return;
  st.listing.add(rel);
  const list = await api.fsList(st.pid, rel || '.');
  st.listing.delete(rel);
  st.dirs.set(rel, list || []);
  bump();
}

async function refresh(st, before, after) {
  if (st.refreshing) return;
  st.refreshing = true;
  try {
    const parents = before && after
      ? new Set([...Object.values(before), ...Object.values(after)].flatMap((x) => (x?.changed || []).map((p) => folder(slashed(p)))))
      : null;
    for (const rel of [...st.dirs.keys()]) {
      if (parents && !parents.has(rel)) continue;
      const list = await api.fsList(st.pid, rel || '.');
      if (list) st.dirs.set(rel, list); else if (rel) st.dirs.delete(rel);
    }
    for (const t of [...st.tabs]) {
      if (t.dirty || t.text === undefined || t.reading) continue;
      const r = await api.fsRead(st.pid, t.path);
      if (!r || r.error || r.mtimeMs === t.mtimeMs || t.dirty || !st.tabs.includes(t)) continue;
      t.mtimeMs = r.mtimeMs;
      t.text = r.text;
      if (t.view) t.view.setState(editorState(r.text, t.path, onFor(st, t))); else { t.state?.dispose(); t.state = null; }
    }
    if (st.git) await loadGitStatus(st);
  } catch {} finally {
    st.refreshing = false;
    bump();
  }
}

function changedSet() {
  const set = new Set();
  for (const x of ui.snap.sessions) for (const f of changedFiles(x.id)) set.add(slashed(f));
  return set;
}

function ownerOf(path, preferred) {
  const has = (id) => changedFiles(id).some((f) => slashed(f) === path);
  if (preferred && has(preferred)) return preferred;
  const x = ui.snap.sessions.find((y) => has(y.id));
  return x ? x.id : null;
}

function statusLetter(index, worktree, forStaged) {
  const code = forStaged ? index : worktree;
  if (code === '?') return 'U';
  if (code === 'A') return 'A';
  if (code === 'D') return 'D';
  if (code === 'R') return 'R';
  if (code === 'M' || code === 'T') return 'M';
  return code === '.' ? '' : code;
}

function gitFiles(st) {
  if (!st.git || !st.git.files) return { staged: [], unstaged: [] };
  const staged = [];
  const unstaged = [];
  for (const f of st.git.files) {
    if (f.conflict) { unstaged.push({ path: f.path, from: f.from, letter: 'C', conflict: true }); continue; }
    if (f.index !== '.' && f.index !== '?') staged.push({ path: f.path, from: f.from, letter: statusLetter(f.index, f.worktree, true) });
    if (f.worktree !== '.') unstaged.push({ path: f.path, from: f.from, letter: statusLetter(f.index, f.worktree, false) });
  }
  return { staged, unstaged };
}

async function loadGitStatus(st) {
  const seq = ++st.gitSeq;
  const r = await api.git(st.pid, 'status');
  if (st.gitSeq !== seq) return;
  st.git = r && !r.error ? r : (r && r.error ? { error: r.error } : { error: 'Could not read git status.' });
  if (typeof rpc === 'function') void rpc('session.owners', { project_id: st.pid }, true).then((o) => {
    if (st.gitSeq !== seq || !o.result) return;
    st.owners = new Map(o.result.paths.filter((p) => p.owners.length).map((p) => [p.path, p.owners.map((w) => w.title).join(', ')]));
    bump();
  });
  bump();
}

async function gitStage(st, paths) {
  const r = await api.git(st.pid, 'stage-paths', paths);
  if (r && r.error) { toast(r.error, true); return; }
  await loadGitStatus(st);
}

async function gitUnstage(st, paths) {
  const r = await api.git(st.pid, 'unstage-paths', paths);
  if (r && r.error) { toast(r.error, true); return; }
  await loadGitStatus(st);
}

async function gitCommit(st) {
  const msg = st.commitMsg.trim();
  if (!msg) return;
  const r = await api.git(st.pid, 'commit', msg);
  if (r && r.error) { toast(r.error, true); return; }
  st.commitMsg = '';
  toast(r && r.commit ? `Committed ${r.commit}` : 'Committed');
  await loadGitStatus(st);
}

async function openGitDiff(st, path, staged) {
  let t = tabOf(st, path);
  const isDeleted = staged
    ? st.git.files.some((f) => f.path === path && f.index === 'D')
    : st.git.files.some((f) => f.path === path && f.worktree === 'D');
  if (!t) {
    t = { path, mode: isDeleted ? 'changes' : 'file', dirty: false };
    st.tabs.push(t);
  }
  st.active = path;
  t.gitDiff = true;
  t.staged = Boolean(staged);
  if (isDeleted && t.text === undefined) t.error = 'This file was deleted. Changes shows what was removed.';
  t.mode = 'changes';
  t.diff = undefined;
  const seq = (t.diffSeq || 0) + 1;
  t.diffSeq = seq;
  bump();
  const text = await api.git(st.pid, staged ? 'diff-staged' : 'diff', path);
  if (t.diffSeq !== seq) return;
  t.diff = typeof text === 'string' ? text : '';
  bump();
  if (!isDeleted) await readTab(st, t, path);
}

// ref is a tab or a path; a tab keeps working after a rename
const onFor = (st, ref) => {
  const tab = () => (typeof ref === 'string' ? tabOf(st, ref) : ref);
  return {
    change() { const t = tab(); if (t && !t.dirty) { t.dirty = true; bump(); } },
    save() { const t = tab(); if (t) void saveTab(st, t.path); },
    selection({ line, col }) {
      const t = tab();
      if (t && (t.line !== line || t.col !== col)) {
        t.line = line;
        t.col = col;
        bump();
      }
    },
  };
};

function goto(t) {
  if (!t.view || !t.gotoLine) return;
  t.view.goto(t.gotoLine);
  t.gotoLine = null;
}

async function readTab(st, t, path) {
  if (t.text === undefined && !t.image && !t.error && !t.reading) {
    t.reading = true;
    if (isPic(path)) {
      const r = typeof api.fsImage === 'function' ? await api.fsImage(st.pid, path) : null;
      t.reading = false;
      if (!r || r.error) t.error = (r && r.error) || 'Could not read the file.';
      else t.image = r.url;
      bump();
    } else {
      const r = await api.fsRead(st.pid, path);
      t.reading = false;
      if (!r || r.error) t.error = (r && r.error) || 'Could not read the file.';
      else { t.text = r.text; t.mtimeMs = r.mtimeMs; }
      bump();
    }
  }
}

async function openFile(st, path, { owner, changes, line } = {}) {
  let t = tabOf(st, path);
  if (!t) { t = { path, mode: isMd(path) ? 'preview' : 'file', dirty: false }; st.tabs.push(t); }
  st.active = path;
  if (owner) { t.owner = owner; t.gitDiff = false; }
  if (line) { t.gotoLine = line; t.mode = 'file'; }
  bump();
  if (changes) void showChanges(st, path);
  if (t.text === undefined && !t.image && !t.error && !t.reading) await readTab(st, t, path);
  else setTimeout(() => goto(t), 0);
}

export async function openAt(rel, line) {
  await drawIde();
  if (cur && cur.pid === ui.projectId) await openFile(cur, slashed(rel), { line });
}

async function newFile(st, ask) {
  if (!ask.path.trim() || ask.busy) return;
  ask.busy = true;
  bump();
  try {
    const rel = ask.folder ? slashed(ask.path).replace(/\/+$/, '') : slashed(ask.path);
    const parts = (ask.folder ? rel : folder(rel)).split('/');
    let created = null;
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/');
      if (!prefix || st.dirs.has(prefix) || st.listing.has(prefix) || (st.dirs.get(folder(prefix)) || []).some((e) => e.dir && e.name === base(prefix))) continue;
      const r = await api.fsCreate(st.pid, prefix, 'dir');
      if (r && (r.error === 'cannot create that here' || r.error?.startsWith('could not create: EEXIST:'))) continue;
      if (!r || r.error) { toast((r && r.error) || 'Could not create the folder.', true); return; }
      if (created === null) created = prefix;
    }
    if (ask.folder) {
      if (created === null) { toast('Nothing created: that folder already exists or the name is not allowed.', true); return; }
    } else {
      const r = await api.fsCreate(st.pid, rel, 'file');
      if (!r || r.error) { toast((r && r.error) || 'Could not create the file.', true); return; }
    }
    if (st.ask === ask) st.ask = null;
    const refresh = new Set(ask.folder ? [] : [folder(rel)]);
    if (created !== null) refresh.add(folder(created));
    for (const path of refresh) st.dirs.delete(path);
    if (!ask.folder) await openFile(st, rel, { line: 1 });
    for (const path of refresh) await loadDir(st, path);
    if (st.git) await loadGitStatus(st);
  } catch (e) {
    toast(String(e), true);
  } finally {
    ask.busy = false;
    bump();
  }
}

function startNew(st, dir, isFolder) {
  st.ask = { kind: 'new', path: dir ? `${dir}/` : '', ...(isFolder ? { folder: true } : {}) };
  bump();
}

// Files / Search / Git join cc's app rail under the Editor icon; without the frame they stay in the side
function railHost() {
  const ide = globalThis.document?.querySelector?.('#frame .fnav [data-view="ide"]');
  if (!ide) return null;
  let host = ide.nextElementSibling;
  if (!host?.classList.contains('ou-ide-railviews')) {
    host = document.createElement('div');
    host.className = 'ou-ide-railviews';
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', 'Editor views');
    ide.after(host);
  }
  return host;
}

const focusRow = (path) => setTimeout(() => document.querySelector(`#ide-tree-menu [data-tree-id="${CSS.escape(path)}"]`)?.focus(), 0);

// TreeList keeps user toggles in internal state, so a reveal remounts it with the open folders as props
async function reveal(st, path) {
  const open = [...document.querySelectorAll('#ide-tree-menu [data-tree-id][aria-expanded="true"]')].map((e) => e.dataset.treeId);
  const parts = path.split('/');
  const up = parts.slice(1).map((_, i) => parts.slice(0, i + 1).join('/'));
  st.open = new Set([...open, ...up]);
  st.treeKey = (st.treeKey || 0) + 1;
  Object.assign(st, { side: 'files', rootOpen: true, q: '', hits: [], findOpen: false });
  bump();
  for (const rel of up) await loadDir(st, rel);
  focusRow(path);
}

function collapseAll(st) {
  st.open = new Set();
  st.treeKey = (st.treeKey || 0) + 1;
  bump();
}

function endRename(st, path) {
  if (st.renaming !== path) return;
  st.renaming = null;
  bump();
}

async function renameEntry(st, from, name) {
  const dir = folder(from);
  const to = dir ? `${dir}/${name}` : name;
  if (!name || to === from) { endRename(st, from); focusRow(from); return; }
  if (/[\\/]/.test(name)) { toast('A name cannot contain a slash.', true); return; }
  if ((st.dirs.get(dir) || []).some((e) => e.name === name)) { toast(`${name} already exists here.`, true); return; }
  if (st.tabs.some((t) => t.path === to || t.path.startsWith(`${to}/`))) { toast(`Close the open tab for ${name} first.`, true); return; }
  endRename(st, from);
  try {
    const r = await api.fsRename(st.pid, from, to);
    if (!r || r.error) { toast((r && r.error) || 'Could not rename.', true); return; }
    const moved = (p) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
    // ponytail: a tab keeps its old language colours after an extension change, until it is reopened
    for (const t of st.tabs) t.path = moved(t.path);
    if (st.active) st.active = moved(st.active);
    for (const k of [...st.dirs.keys()]) if (k === from || k.startsWith(`${from}/`)) st.dirs.delete(k);
    bump();
    st.dirs.set(dir, (await api.fsList(st.pid, dir || '.')) || []);
    bump();
    focusRow(to);
    if (st.git) await loadGitStatus(st);
  } catch (e) {
    toast(String(e), true);
  }
}

async function deleteEntry(st, path) {
  st.ask = null;
  bump();
  const r = typeof api.fsDelete === 'function' ? await api.fsDelete(st.pid, path) : null;
  if (!r || r.error) {
    toast((r && r.error) || 'Could not delete.', true);
    return;
  }
  st.tabs = st.tabs.filter((t) => !under(t.path, path));
  if (st.active && under(st.active, path)) {
    st.active = st.tabs.length ? st.tabs[st.tabs.length - 1].path : null;
  }
  const parent = folder(path);
  st.dirs.delete(parent);
  for (const k of [...st.dirs.keys()]) {
    if (under(k, path)) st.dirs.delete(k);
  }
  bump();
  await loadDir(st, parent);
  if (st.git) await loadGitStatus(st);
  toast('Moved to the Recycle Bin');
}

async function copyPath(rel, absolute) {
  const root = project()?.path || '';
  const sep = root.includes('\\') ? '\\' : '/';
  try {
    await api.copyText(absolute ? `${root.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}` : rel);
    toast('Path copied');
  } catch (e) { toast(String(e), true); }
}

async function openOutside(st, path) {
  try {
    const r = await api.fsOpenOutside(st.pid, path);
    if (r && r.error) toast(r.error, true);
  } catch (e) { toast(String(e), true); }
}

async function openInVsCode(st, path) {
  try {
    const r = await api.openInVsCode(st.pid, path);
    if (r && r.error) toast(r.error, true);
  } catch (e) { toast(String(e), true); }
}

async function showChanges(st, path) {
  const t = tabOf(st, path);
  if (!t) return;
  t.mode = 'changes';
  t.diff = undefined;
  const seq = (t.diffSeq || 0) + 1;
  t.diffSeq = seq;
  bump();
  const owner = ownerOf(path, t.owner);
  const text = t.gitDiff ? await api.git(st.pid, t.staged ? 'diff-staged' : 'diff', path) : owner ? await api.sessionDiffFile(owner, path, 'uncommitted') : null;
  if (t.diffSeq !== seq) return;
  t.diff = text || '';
  bump();
}

function showFile(st, path) {
  const t = tabOf(st, path);
  if (!t) return;
  t.mode = 'file';
  bump();
}

function showPreview(st, path) {
  const t = tabOf(st, path);
  if (!t) return;
  t.mode = 'preview';
  bump();
}

function showSource(st, path) {
  flushSync(() => showFile(st, path));
  tabOf(st, path)?.view?.focus();
}

async function saveTab(st, path, force = false) {
  if (!canWrite()) { toast('Saving is not built yet.'); return false; }
  const t = tabOf(st, path);
  if (!t || !t.dirty) return false;
  const state = t.view ? t.view.state : t.state;
  if (!state) return false;
  if (t.saving) return false;
  t.saving = true;
  let r;
  const text = state.sliceDoc();
  try { r = await api.fsWrite(st.pid, path, text, force ? null : (t.mtimeMs ?? null)); } finally { t.saving = false; }
  if (r && r.ok) {
    t.mtimeMs = r.mtimeMs;
    const now = t.view ? t.view.state : t.state;
    if (now && now.sliceDoc() === text) t.dirty = false;
    bump();
    if (st.git) await loadGitStatus(st);
    return true;
  }
  if (r && r.conflict) { st.ask = { kind: 'conflict', path }; bump(); return false; }
  if (r && r.missing) { st.ask = { kind: 'gone', path }; bump(); return false; }
  toast((r && r.error) || 'Could not save the file.', true);
  return false;
}

async function reloadTab(st, path) {
  const t = tabOf(st, path);
  if (!t) return;
  const r = await api.fsRead(st.pid, path);
  if (!r || r.error) { toast((r && r.error) || 'Could not read the file.', true); return; }
  t.mtimeMs = r.mtimeMs;
  t.error = undefined;
  t.dirty = false;
  if (t.view) t.view.setState(editorState(r.text, path, onFor(st, t)));
  else { t.text = r.text; t.state?.dispose(); t.state = null; }
  bump();
}

function askReload(st, path) {
  const t = tabOf(st, path);
  if (!t) return;
  if (t.dirty) { st.ask = { kind: 'discard', path }; bump(); } else void reloadTab(st, path);
}

function dropTab(st, path) {
  st.tabs = st.tabs.filter((x) => x.path !== path);
  if (st.active === path) st.active = st.tabs.length ? st.tabs[st.tabs.length - 1].path : null;
  bump();
}

function closeTab(st, path) {
  const t = tabOf(st, path);
  if (!t) return;
  if (t.dirty) { st.ask = { kind: 'close', path }; bump(); } else dropTab(st, path);
}

function nextClose(st) {
  st.ask = null;
  if (st.closeAll) {
    for (const t of st.tabs.filter((x) => !x.dirty)) dropTab(st, t.path);
    const dirty = st.tabs.find((x) => x.dirty);
    if (dirty) st.ask = { kind: 'close', path: dirty.path }; else st.closeAll = false;
  }
  bump();
}

function closeAll(st) {
  st.closeAll = true;
  nextClose(st);
}

globalThis.addEventListener?.('beforeunload', (e) => {
  if (!canWrite() || ![...states.values()].some((st) => st.tabs.some((x) => x.dirty))) return;
  e.preventDefault();
  e.returnValue = '';
});

async function runFind(st, q) {
  st.q = q;
  if (!q.trim()) { st.hits = []; bump(); return; }
  bump();
  const hits = (await api.fsFind(st.pid, q)) || [];
  if (st.q !== q || cur !== st || ui.projectId !== st.pid) return;
  st.hits = hits.map(slashed);
  bump();
}

async function runSearch(st) {
  const q = st.sq;
  if (!canSearch() || q.length < 2) return;
  const seq = (st.sseq || 0) + 1;
  st.sseq = seq;
  st.searching = true;
  bump();
  const r = await api.fsSearch(st.pid, q);
  if (st.sseq !== seq) return;
  st.searching = false;
  st.sres = { q, hits: ((r && r.hits) || []).map((h) => ({ ...h, path: slashed(h.path) })), more: Boolean(r && r.more) };
  bump();
}

function focusInput(side, id) {
  if (!cur) return;
  flushSync(() => { cur.side = side; bump(); });
  const el = document.getElementById(id);
  el?.focus();
  if (id === 'ide-find') el?.select();
}

export const dirtyIn = (pid) => (states.get(pid)?.tabs || []).filter((x) => x.dirty).map((x) => x.path);
export const dropProject = (pid) => { closeShell(pid); if (cur && cur.pid === pid) cur = null; if (states.delete(pid)) bump(); };

export const ideKeys = {
  find: () => { if (cur) cur.findOpen = true; focusInput('files', 'ide-find'); },
  search: () => focusInput('search', 'ide-search'),
  changes: () => { if (!cur) return; cur.side = 'changes'; bump(); void loadGitStatus(cur); },
  palette: (open) => (open === undefined ? paletteView.toggle() : open ? paletteView.open() : paletteView.close()),
  paletteOpen: () => paletteView.isOpen(),
  closeTab: () => { if (cur && cur.active) closeTab(cur, cur.active); },
  save: () => { if (cur && cur.active && tabOf(cur, cur.active)?.dirty) void saveTab(cur, cur.active); },
  asking: () => Boolean(cur && cur.ask),
  preview: () => {
    const t = cur && cur.active ? tabOf(cur, cur.active) : null;
    if (!t || !isMd(t.path)) return false;
    if (inPreview(t)) showSource(cur, t.path); else showPreview(cur, t.path);
    return true;
  },
};

const LANGS = {
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  ts: 'TypeScript', tsx: 'TypeScript', json: 'JSON',
  md: 'Markdown', markdown: 'Markdown', css: 'CSS', scss: 'SCSS', less: 'LESS',
  html: 'HTML', htm: 'HTML', svg: 'SVG', xml: 'XML', py: 'Python', rb: 'Ruby',
  rs: 'Rust', go: 'Go', sh: 'Shell', bash: 'Shell', zsh: 'Shell', yml: 'YAML', yaml: 'YAML', toml: 'TOML',
};
const langOf = (path) => {
  if (!path) return '';
  const ext = path.split('.').pop().toLowerCase();
  return LANGS[ext] || ext.toUpperCase();
};

const KINDS = [
  ['ts', Sc.TsIcon, 'ts tsx mts cts'], ['js', Sc.JsIcon, 'js jsx mjs cjs'], ['json', Sc.JsonIcon, 'json jsonc'],
  ['md', Sc.MarkdownIcon, 'md markdown mdx'], ['css', Sc.CssIcon, 'css scss less'], ['html', Sc.HtmlIcon, 'html htm xml'],
  ['py', Sc.PyIcon, 'py'], ['image', Sc.ImageIcon, 'png jpg jpeg gif svg webp ico bmp avif'], ['text', Sc.TextIcon, 'txt log csv'],
  ['code', Ic.CodeIcon, 'sh bash zsh rb rs go c cpp h java astro vue svelte yml yaml toml'],
];
const KIND = new Map(KINDS.flatMap(([k, I, exts]) => exts.split(' ').map((e) => [e, [k, I]])));

function FileIcon({ path, isDir }) {
  const [k, F] = isDir ? ['folder', Ic.FolderIcon] : KIND.get(path ? path.split('.').pop().toLowerCase() : '') || ['file', Sc.FileIcon];
  return <span className={`ou-ide-ficon ou-ide-lang-${k}`}><F size={16} /></span>;
}

const Ring = () => <span className="ou-ide-ring" title="Changed by an agent" />;

function gitStatusOf(st, path) {
  if (!st.git || !st.git.files) return null;
  const f = st.git.files.find((x) => x.path === path);
  if (!f) return null;
  if (f.worktree && f.worktree !== '.') return statusLetter(f.index, f.worktree, false);
  if (f.index && f.index !== '.' && f.index !== '?') return statusLetter(f.index, f.worktree, true);
  return null;
}

function TreeDecorations({ st, path, isChanged }) {
  const gitLetter = gitStatusOf(st, path);
  const t = tabOf(st, path);
  const isDirty = Boolean(t && t.dirty);
  if (!gitLetter && !isDirty && !isChanged) return null;
  return (
    <span className="ou-ide-tree-decorations">
      {isDirty ? <span className="ou-ide-dirty" title="Unsaved" /> : null}
      {gitLetter ? <span className={`ou-ide-gitletter ou-ide-git-${gitLetter.toLowerCase()}`} title={`Git: ${gitLetter}`}>{gitLetter}</span> : null}
      {isChanged ? <Ring /> : null}
    </span>
  );
}

function LoadDir({ st, rel }) {
  useEffect(() => { void loadDir(st, rel); }, [st, rel]);
  return 'Loading.';
}

function RenameInput({ st, path }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    const dot = el.value.lastIndexOf('.');
    el.focus();
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length);
  }, []);
  return (
    <input ref={ref} className="ou-ide-input ou-ide-rename" defaultValue={base(path)} aria-label={`Rename ${base(path)}`} autoComplete="off" spellCheck="false"
      onClick={(e) => e.stopPropagation()}
      onBlur={() => endRename(st, path)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); void renameEntry(st, path, e.target.value.trim()); }
        else if (e.key === 'Escape') { e.preventDefault(); endRename(st, path); focusRow(path); }
      }} />
  );
}

function rowTarget(st, el) {
  const id = el.closest?.('[data-tree-id]')?.dataset.treeId;
  if (!id) return null;
  const path = id.split('//')[0];
  return { path, dir: id !== path || Boolean((st.dirs.get(folder(path)) || []).find((e) => e.name === base(path))?.dir) };
}

function gitDirs(st) {
  const out = new Set();
  for (const f of (st.git && st.git.files) || []) {
    const parts = slashed(f.path).split('/');
    for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/'));
  }
  return out;
}

function treeItems(st, rel, changed, dirty = gitDirs(st)) {
  return (st.dirs.get(rel) || []).map((e) => {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (st.renaming === path) {
      const children = e.dir ? (st.dirs.get(path)?.length ? treeItems(st, path, changed, dirty) : [{ id: `${path}//empty`, label: 'Empty', isDisabled: true }]) : undefined;
      return { id: path, label: <RenameInput st={st} path={path} />, children, startContent: <FileIcon path={path} isDir={e.dir} /> };
    }
    if (e.dir) {
      const kids = st.dirs.get(path);
      const children = !kids ? [{ id: `${path}//loading`, label: <LoadDir st={st} rel={path} />, isDisabled: true }]
        : kids.length ? treeItems(st, path, changed, dirty) : [{ id: `${path}//empty`, label: 'Empty', isDisabled: true }];
      const has = dirty.has(path);
      return { id: path, label: e.name, children, isExpanded: Boolean(st.open && st.open.has(path)), className: has ? 'ou-ide-row-dirty' : undefined, startContent: <FileIcon isDir />, endContent: has ? <span className="ou-ide-folderdot" title="Contains changes" /> : undefined };
    }
    const letter = gitStatusOf(st, path);
    return {
      id: path,
      label: e.name,
      className: letter ? `ou-ide-row-${letter.toLowerCase()}` : undefined,
      isSelected: st.active === path,
      onClick: () => void openFile(st, path),
      startContent: <FileIcon path={path} />,
      endContent: <TreeDecorations st={st} path={path} isChanged={changed.has(path)} />,
    };
  });
}

const NotBuilt = () => <Badge label="Not built yet" />;

function Files({ st, changed }) {
  const p = project();
  const [target, setTarget] = useState(null);
  const pending = useRef(null);
  const later = (run) => () => { pending.current = run; };
  const here = target ? (target.dir ? target.path : folder(target.path)) : '';
  const create = [
    { label: 'New file here', onClick: later(() => startNew(st, here, false)) },
    { label: 'New folder here', onClick: later(() => startNew(st, here, true)) },
  ];
  const items = !target ? create : [
    { label: 'Rename', endContent: <span className="ou-ide-key">F2</span>, onClick: later(() => { st.renaming = target.path; bump(); }) },
    { type: 'divider' },
    ...create,
    { type: 'divider' },
    { label: 'Copy path', onClick: () => void copyPath(target.path, true) },
    { label: 'Copy relative path', onClick: () => void copyPath(target.path, false) },
    { type: 'divider' },
    { label: 'Delete', onClick: later(() => { st.ask = { kind: 'delete', path: target.path }; bump(); }) },
  ];
  return (
    <>
      {(st.q || st.findOpen) ? (
        <div className="ou-ide-findrow">
          <input id="ide-find" className="ou-ide-input" value={st.q} placeholder="Find a file (Ctrl+P)" aria-label="Find a file by name" autoComplete="off" spellCheck="false"
            onChange={(e) => void runFind(st, e.target.value)}
            onBlur={() => { if (!st.q) { st.findOpen = false; bump(); } }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && st.hits.length) { e.preventDefault(); void openFile(st, st.hits[0]); }
              else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (st.q) { st.q = ''; st.hits = []; bump(); }
                else { st.findOpen = false; bump(); }
              }
            }} />
        </div>
      ) : null}
      <div className="ou-ide-tree">
        {st.q.trim() ? (st.hits.length ? st.hits.map((h) => (
          <button key={h} className={st.active === h ? 'ou-ide-hit ou-ide-cur' : 'ou-ide-hit'} title={h} onClick={() => void openFile(st, h)}>
            <FileIcon path={h} /><span className="ou-ide-name">{base(h)}</span><span className="ou-ide-dir">{folder(h)}</span><TreeDecorations st={st} path={h} isChanged={changed.has(h)} />
          </button>
        )) : <p className="ou-ide-muted">No file matches.</p>) : (
          <ContextMenu id="ide-tree-menu" size="sm" label="File actions" items={items}
            onContextMenu={(e) => setTarget(rowTarget(st, e.target))}
            onOpenChange={(open) => { const run = pending.current; pending.current = null; if (!open && run) setTimeout(run, 0); }}>
            <TreeList key={`${ui.projectId}:${st.treeKey || 0}`} density="compact" aria-label={`${p.name} files`} header={<button type="button" className="ou-ide-root" aria-expanded={st.rootOpen} onClick={() => { st.rootOpen = !st.rootOpen; bump(); }}><span aria-hidden="true">{st.rootOpen ? '\u25be' : '\u25b8'}</span><span aria-hidden="true"><FileIcon isDir /></span>{p.name}</button>} items={st.rootOpen ? treeItems(st, '', changed) : []}
              onKeyDown={(e) => {
                const t = e.key === 'F2' ? rowTarget(st, e.target) : null;
                if (t) { e.preventDefault(); st.renaming = t.path; bump(); }
              }} />
          </ContextMenu>
        )}
      </div>
    </>
  );
}

function Marked({ text, q }) {
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (!q || at < 0) return text;
  return <>{text.slice(0, at)}<b>{text.slice(at, at + q.length)}</b><Marked text={text.slice(at + q.length)} q={q} /></>;
}

function Search({ st }) {
  const ok = canSearch();
  const groups = new Map();
  for (const h of (st.sres && st.sres.hits) || []) { if (!groups.has(h.path)) groups.set(h.path, []); groups.get(h.path).push(h); }
  return (
    <>
      <div className="ou-ide-findrow">
        <input id="ide-search" className="ou-ide-input" value={st.sq} placeholder="Search in files (Ctrl+Shift+F)" aria-label="Search in files" autoComplete="off" spellCheck="false" disabled={!ok}
          onChange={(e) => { st.sq = e.target.value; bump(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void runSearch(st); } else if (e.key === 'Escape' && st.sq) { e.preventDefault(); e.stopPropagation(); st.sq = ''; st.sres = null; st.searching = false; st.sseq = (st.sseq || 0) + 1; bump(); } }} />
        {ok ? null : <div className="ou-ide-badge"><NotBuilt /></div>}
      </div>
      <div className="ou-ide-tree">
        {st.searching ? <p className="ou-ide-muted">Searching.</p> : st.sres ? (groups.size ? (
          <>
            <p className="ou-ide-muted ou-ide-ssum">{`${st.sres.hits.length} ${st.sres.hits.length === 1 ? 'result' : 'results'} in ${groups.size} ${groups.size === 1 ? 'file' : 'files'}`}</p>
            {[...groups].map(([path, hits]) => (
              <div key={path}>
                <button type="button" className="ou-ide-sfile" title={path} aria-expanded={!st.sfold?.has(path)}
                  onClick={() => { st.sfold = st.sfold || new Set(); if (!st.sfold.delete(path)) st.sfold.add(path); bump(); }}>
                  <span className="ou-ide-chev" aria-hidden="true"><Ic.ChevronRightIcon size={12} /></span><FileIcon path={path} /><span className="ou-ide-name">{base(path)}</span><span className="ou-ide-dir">{folder(path)}</span><span className="ou-ide-count">{hits.length}</span>
                </button>
                {st.sfold?.has(path) ? null : hits.map((h, i) => (
                  <button key={i} className="ou-ide-match" onClick={() => void openFile(st, path, { line: h.line })}>
                    <span className="ou-ide-ln">{h.line}</span><span className="ou-ide-mtext"><Marked text={String(h.text).trim()} q={st.sres.q} /></span>
                  </button>
                ))}
              </div>
            ))}
            {st.sres.more ? <p className="ou-ide-muted">Showing the first 200 matches.</p> : null}
          </>
        ) : <p className="ou-ide-muted">No matches.</p>) : null}
      </div>
    </>
  );
}

function ScRow({ st, file, staged }) {
  return (
    <div className="ou-ide-scrow" role="button" tabIndex={0} title={file.path}
      onClick={() => void openGitDiff(st, file.path, staged)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void openGitDiff(st, file.path, staged);
        }
      }}>
      <FileIcon path={file.path} />
      <span className={`ou-ide-name ou-ide-scname-${file.letter.toLowerCase()}`}>{base(file.path)}</span>
      <span className="ou-ide-dir">{folder(file.path)}</span>
      {st.owners && st.owners.get(file.path) ? <span className="ou-ide-engine" title={`Changed by ${st.owners.get(file.path)}`}>{st.owners.get(file.path)}</span> : null}
      <IconButton size="sm" variant="ghost" label={staged ? `Unstage ${file.path}` : `Stage ${file.path}`} icon={staged ? <Sc.MinusIcon size={12} /> : <Ic.PlusIcon size={12} />}
        onClick={(e) => { e.stopPropagation(); void (staged ? gitUnstage(st, [file.path, file.from].filter(Boolean)) : gitStage(st, [file.path])); }} />
      <span className={`ou-ide-scletter ou-ide-git-${file.letter.toLowerCase()}`}>{file.letter}</span>
    </div>
  );
}

function SourceControl({ st }) {
  useEffect(() => { void loadGitStatus(st); }, [st]);

  if (st.git && st.git.error) {
    const isNotRepo = /not a git repository/i.test(st.git.error);
    return <div className="ou-ide-tree"><p className="ou-ide-muted">{isNotRepo ? 'This folder is not a git repository.' : st.git.error}</p></div>;
  }

  const { staged, unstaged } = gitFiles(st);
  const canCommit = st.commitMsg.trim().length > 0 && staged.length > 0;
  const fold = st.scFold || (st.scFold = {});
  const toggle = (k) => { fold[k] = !fold[k]; bump(); };

  return (
    <>
      <div className="ou-ide-sccommit">
        <textarea className="ou-ide-scmsg" rows={3} placeholder="Commit message" value={st.commitMsg}
          onChange={(e) => { st.commitMsg = e.target.value; bump(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canCommit) { e.preventDefault(); void gitCommit(st); } }} />
        <div className="ou-ide-scactions">
          <Button size="sm" variant="primary" label="Commit" icon={<Ic.CommitIcon size={14} />} isDisabled={!canCommit} onClick={() => void gitCommit(st)} />
          <IconButton size="sm" variant="ghost" label="Refresh" tooltip="Refresh" icon={<Sc.ReloadIcon size={14} />} onClick={() => void loadGitStatus(st)} />
        </div>
      </div>
      <div className="ou-ide-tree">
        {!st.git ? <p className="ou-ide-muted">Loading.</p> : (
          <>
            {staged.length ? (
              <>
                <div className="ou-ide-schead">
                  <button type="button" className="ou-ide-scfold" aria-expanded={!fold.staged} onClick={() => toggle('staged')}><span className="ou-ide-chev" aria-hidden="true"><Ic.ChevronRightIcon size={12} /></span><span>Staged Changes</span></button>
                  <span className="ou-ide-count">{staged.length}</span>
                </div>
                {fold.staged ? null : staged.map((f) => <ScRow key={`s:${f.path}`} st={st} file={f} staged />)}
              </>
            ) : null}
            <div className="ou-ide-schead">
              <button type="button" className="ou-ide-scfold" aria-expanded={!fold.changes} onClick={() => toggle('changes')}><span className="ou-ide-chev" aria-hidden="true"><Ic.ChevronRightIcon size={12} /></span><span>Changes</span></button>
              {unstaged.length ? <IconButton size="sm" variant="ghost" label="Stage all" tooltip="Stage all" icon={<Ic.PlusIcon size={12} />}
                onClick={() => void gitStage(st, unstaged.filter((f) => !f.conflict).map((f) => f.path))} /> : null}
              <span className="ou-ide-count">{unstaged.length}</span>
            </div>
            {fold.changes ? null : unstaged.map((f) => <ScRow key={`u:${f.path}`} st={st} file={f} staged={false} />)}
            {!unstaged.length && !staged.length ? <p className="ou-ide-muted">No changes.</p> : null}
          </>
        )}
      </div>
    </>
  );
}

function EditorHost({ st, tab, hidden }) {
  const ref = useRef(null);
  const ready = tab.text !== undefined;
  useEffect(() => {
    if (!ready) return undefined;
    const view = openEditor(ref.current, tab.state || tab.text, tab.path, onFor(st, tab));
    tab.view = view;
    tab.state = null;
    const p = view.pos();
    tab.line = p.line;
    tab.col = p.col;
    goto(tab);
    bump();
    return () => { tab.state = view.state; tab.view = null; view.destroy(); if (!st.tabs.includes(tab)) tab.state.dispose(); };
  }, [ready, st, tab]);
  return <div ref={ref} className="ou-ide-ed" hidden={hidden} onKeyDown={(e) => { if (!e.ctrlKey && !e.altKey && !e.metaKey) e.stopPropagation(); }} />;
}

const crlf = (s) => (typeof s === 'string' ? s.replace(/\r\n?/g, '\n') : s);

// Base from git: unstaged = index vs file, staged = HEAD vs index, agent = session base vs file; else rebuilt from the patch.
async function diffSides(st, t) {
  const show = (rev, extra) => Promise.resolve(api.git(st.pid, 'show', { path: t.path, rev, ...extra })).catch(() => null);
  const owner = t.gitDiff ? null : ownerOf(t.path, t.owner);
  let original = null, modified = null;
  if (t.gitDiff && t.staged) [original, modified] = await Promise.all([show('HEAD'), show(':')]);
  else if (t.gitDiff || owner) { original = await (t.gitDiff ? show(':') : show('base', { session_id: owner, scope: 'uncommitted' })); modified = t.text ?? ''; }
  [original, modified] = [crlf(original), crlf(modified)];
  if (typeof original === 'string' && typeof modified === 'string') return original === modified ? null : { original, modified };
  return patchSides(t.diff, t.text);
}

const agentsIn = (pid) => ui.snap.sessions.filter((x) => x.project_id === pid && x.state !== 'exited' && !ui.pendingHide.has(x.id))
  .sort((a, b) => String(b.state_at || '').localeCompare(String(a.state_at || '')));
const agentName = (id) => ui.snap.sessions.find((x) => x.id === id)?.engine_id || 'the agent';

function DiffView({ st, tab }) {
  const ref = useRef(null);
  const view = useRef(null);
  const [sides, setSides] = useState(undefined);
  const [draft, setDraft] = useState(null);
  const [places, setPlaces] = useState(new Map());
  const [moved, setMoved] = useState(0);
  tab.sent ||= [];
  const needsText = !(tab.gitDiff && tab.staged) && tab.text === undefined && !tab.error;
  useEffect(() => {
    let live = true;
    setSides(undefined);
    setDraft(null);
    if (tab.diff === '') setSides(null);
    else if (tab.diff !== undefined && !needsText) void diffSides(st, tab).then((s) => { if (live) setSides(s); });
    return () => { live = false; };
  }, [st, tab, tab.diff, tab.text, needsText]);
  useEffect(() => {
    if (!sides) return undefined;
    const h = openDiff(ref.current, sides, tab.path, {
      onLine: (at) => setDraft({ ...at, text: '', error: null, busy: false, to: (!tab.gitDiff && ownerOf(tab.path, tab.owner)) || ownerOf(tab.path) || agentsIn(st.pid)[0]?.id || null }),
      onMove: () => setMoved((n) => n + 1),
    });
    view.current = h;
    return () => { view.current = null; h.dispose(); };
  }, [st, tab, sides]);
  useLayoutEffect(() => {
    if (!view.current || !ref.current) return;
    const list = [...tab.sent.map((x) => ({ key: `sent:${x.side}:${x.line}`, side: x.side, line: x.line, height: 26 })), ...(draft ? [{ key: 'draft', side: draft.side, line: draft.line, height: 150 }] : [])];
    const box = ref.current.getBoundingClientRect();
    const next = new Map();
    for (const [key, node] of view.current.zones(list)) {
      const r = node.getBoundingClientRect();
      if (r.height) next.set(key, { top: r.top - box.top, left: r.left - box.left, width: Math.min(r.width, box.right - r.left), height: r.height });
    }
    if (JSON.stringify([...next]) !== JSON.stringify([...places])) setPlaces(next);
  });
  if (tab.diff === undefined || sides === undefined) return <p className="ou-ide-muted ou-ide-pad">Loading.</p>;
  if (!sides) return <p className="ou-ide-muted ou-ide-pad">No changes to show for this file.</p>;
  const at = (key) => places.get(key);
  async function send() {
    const d = draft;
    setDraft({ ...d, busy: true, error: null });
    const r = d.to ? await sendComment(d.to, { path: tab.path, line: d.line, side: d.side, excerpt: d.excerpt, text: d.text }) : { ok: false, error: 'No running agent in this project.' };
    if (!r.ok) { setDraft({ ...d, busy: false, error: r.error }); return; }
    tab.sent.push({ side: d.side, line: d.line, agent: agentName(d.to), text: d.text.trim() });
    setDraft(null);
  }
  return (
    <div className="ou-ide-mdiffwrap" data-moved={moved}>
      <div ref={ref} className="ou-ide-mdiff" />
      {tab.sent.map((x) => {
        const p = at(`sent:${x.side}:${x.line}`);
        return p ? <div key={`${x.side}:${x.line}`} className="ou-ide-csent" style={p} title={x.text}>Sent to {x.agent}: {x.text}</div> : null;
      })}
      {draft && at('draft') ? <CommentBox st={st} tab={tab} draft={draft} setDraft={setDraft} place={at('draft')} send={send} /> : null}
    </div>
  );
}

function CommentBox({ st, tab, draft, setDraft, place, send }) {
  const agents = agentsIn(st.pid);
  const pick = !tab.owner || tab.gitDiff;
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); if (!draft.busy) void send(); }
    else if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
    if (!e.ctrlKey && !e.altKey && !e.metaKey) e.stopPropagation();
  };
  return (
    <div className="ou-ide-cbox" style={place} onKeyDown={onKeyDown}>
      <div className="ou-ide-chead">
        <span>Comment on line {draft.line} ({draft.side === 'old' ? 'before' : 'after'})</span>
        {pick ? (agents.length
          ? <Selector size="sm" variant="ghost" label="Send to" isLabelHidden value={draft.to || ''} onChange={(v) => setDraft({ ...draft, to: v })} options={agents.map((x) => ({ value: x.id, label: `${x.engine_id}: ${taskOf(x)}`.slice(0, 60) }))} />
          : <span className="ou-ide-muted">No running agent in this project.</span>)
          : <span className="ou-ide-muted">to {agentName(draft.to)}</span>}
      </div>
      <TextArea label="Comment" isLabelHidden rows={2} hasAutoFocus value={draft.text} placeholder="What should change here? Ctrl+Enter sends." onChange={(v) => setDraft({ ...draft, text: v })} status={draft.error ? { type: 'error', message: draft.error } : undefined} />
      <div className="ou-ide-cfoot">
        <Button size="sm" variant="ghost" label="Cancel" onClick={() => setDraft(null)} />
        <Button size="sm" variant="primary" label={draft.busy ? 'Sending' : 'Send'} isDisabled={draft.busy || !draft.text.trim() || !draft.to} onClick={() => void send()} />
      </div>
    </div>
  );
}

function OpenInVsCodeButton({ st, tab }) {
  return <Button size="sm" variant="ghost" className="ou-ide-open-vscode" label="Open in VS Code" icon={<Sc.ExternalLinkIcon size={12} />} onClick={() => void openInVsCode(st, tab?.path)} />;
}

function Crumb({ st, tab, changed }) {
  const isChanged = tab && (changed.has(tab.path) || Boolean(tab.gitDiff));
  const md = Boolean(tab) && isMd(tab.path);
  const mode = isChanged && tab.mode === 'changes' ? 'changes' : tab && inPreview(tab) ? 'preview' : 'file';
  const parts = tab ? tab.path.split('/') : [];
  const lines = mode === 'changes' && tab.diff ? diffLines(tab.diff) : [];
  return (
    <div className="ou-ide-crumb">
      <nav className="ou-ide-path" aria-label="Breadcrumb">{parts.map((x, i) => (
        <span key={i} className="ou-ide-segw">
          {i ? <span className="ou-ide-sep" aria-hidden="true"><Ic.ChevronRightIcon size={12} /></span> : null}
          <button type="button" className="ou-ide-seg" title={`Reveal ${parts.slice(0, i + 1).join('/')} in Files`} onClick={() => void reveal(st, parts.slice(0, i + 1).join('/'))}>
            {i === parts.length - 1 ? <><FileIcon path={tab.path} /><b>{x}</b></> : x}
          </button>
        </span>
      ))}</nav>
      <span className="ou-ide-crumbr">
        {mode === 'changes' ? <><span className="ou-ide-add">+{lines.filter((l) => l.kind === 'add').length}</span><span className="ou-ide-del">-{lines.filter((l) => l.kind === 'del').length}</span></> : null}
        {isChanged || md ? (
          <SegmentedControl label="View" size="sm" value={mode} onChange={(v) => (v === 'changes' ? void showChanges(st, tab.path) : v === 'preview' ? showPreview(st, tab.path) : showFile(st, tab.path))}>
            {md ? <SegmentedControlItem value="preview" label="Preview" /> : null}
            <SegmentedControlItem value="file" label="File" />
            {isChanged ? <SegmentedControlItem value="changes" label="Changes" /> : null}
          </SegmentedControl>
        ) : null}
      </span>
    </div>
  );
}

function StatusBar({ st, active, problems, onProblems }) {
  useEffect(() => {
    if (st.git === null) void loadGitStatus(st);
  }, [st]);
  const branch = st.git && st.git.branch;
  const nc = typeof needsCount === 'function' ? needsCount() : null;
  const line = active ? (active.line ?? 1) : null;
  const col = active ? (active.col ?? 1) : null;
  const lang = active ? langOf(active.path) : '';
  const { errors, warnings } = countProblems(problems);

  return (
    <footer className="ou-ide-status">
      <div className="ou-ide-status-left">
        {branch ? (
          <span className="ou-ide-status-item" title={`Branch: ${branch}`}>
            <Ic.Branch size={12} />
            <span>{branch}</span>
          </span>
        ) : null}
        <button type="button" className="ou-ide-status-item ou-ip-sprob" title={`Errors: ${errors}, Warnings: ${warnings}`} aria-label={`${errors} errors, ${warnings} warnings. Show Problems`} onClick={onProblems}>
          <Ic.Failed size={12} /><span>{errors}</span>
          <Ic.Urgent size={12} /><span>{warnings}</span>
        </button>
        {nc ? (
          <span className="ou-ide-status-item ou-ide-status-needs">
            <span className="ou-dot ou-dot-wait" />
            <span>{typeof nc === 'number' ? `${nc} needs you` : 'needs you'}</span>
          </span>
        ) : null}
      </div>
      <div className="ou-ide-status-right">
        {active ? (
          <>
            <span className="ou-ide-status-item">Ln {line}, Col {col}</span>
            <span className="ou-ide-status-item">UTF-8</span>
            {lang ? <span className="ou-ide-status-item">{lang}</span> : null}
          </>
        ) : null}
      </div>
    </footer>
  );
}

// astryx AlertDialog has one action plus Cancel; the three-way questions use the same parts with a third button.
function Ask3({ title, actions, onCancel }) {
  return (
    <Dialog isOpen onOpenChange={(open) => { if (!open) onCancel(); }} width={420} purpose="form" role="alertdialog" aria-label={title}>
      <Layout
        content={<LayoutContent><Heading level={2}>{title}</Heading></LayoutContent>}
        footer={<LayoutFooter><span className="ou-ide-askrow"><Button variant="ghost" label="Cancel" onClick={onCancel} data-autofocus />{actions.map((a) => <Button key={a.label} variant={a.variant || 'secondary'} label={a.label} onClick={a.run} />)}</span></LayoutFooter>}
      />
    </Dialog>
  );
}

function Asks({ st }) {
  const a = st.ask;
  if (!a) return null;
  const name = base(a.path);
  const cancel = () => { st.closeAll = false; st.ask = null; bump(); };
  if (a.kind === 'new') {
    return (
      <Dialog isOpen onOpenChange={(open) => { if (!open) cancel(); }} width={420} purpose="form" aria-label={a.folder ? 'New folder' : 'New file'}>
        <form onSubmit={(e) => { e.preventDefault(); void newFile(st, a); }}>
          <Layout
            content={<LayoutContent><Heading level={2}>{a.folder ? 'New folder' : 'New file'}</Heading><TextInput label="Path inside the project" placeholder={a.folder ? 'notes/drafts' : 'notes/todo.md'} value={a.path} onChange={(path) => { a.path = path; bump(); }} hasAutoFocus isDisabled={a.busy} /></LayoutContent>}
            footer={<LayoutFooter><span className="ou-ide-askrow"><Button variant="ghost" label="Cancel" onClick={cancel} /><Button type="submit" label={a.folder ? 'Create folder' : 'Create file'} isDisabled={!a.path.trim() || a.busy} /></span></LayoutFooter>}
          />
        </form>
      </Dialog>
    );
  }
  if (a.kind === 'discard') {
    return <AlertDialog isOpen onOpenChange={(open) => { if (!open) cancel(); }} title={`Discard your changes to ${name}?`} description="The file is read again from disk." actionLabel="Discard" onAction={() => { st.ask = null; bump(); void reloadTab(st, a.path); }} />;
  }
  if (a.kind === 'gone') {
    return <Ask3 title={`${name} is no longer on disk.`} onCancel={cancel} actions={[
      { label: 'Save as a new file', variant: 'primary', run: async () => {
        st.ask = null;
        bump();
        const c = await api.fsCreate(st.pid, a.path, 'file');
        if (!c || c.error) { toast(c && c.error === 'cannot create that here' ? 'Its folder is gone too. Make the file again with New file, then save.' : (c && c.error) || 'Could not create the file.', true); return; }
        st.dirs.delete(folder(a.path));
        if (await saveTab(st, a.path, true)) await loadDir(st, folder(a.path));
      } },
    ]} />;
  }
  if (a.kind === 'delete') {
    const hasDirty = st.tabs.some((t) => t.dirty && under(t.path, a.path));
    return (
      <Dialog isOpen onOpenChange={(open) => { if (!open) cancel(); }} width={420} purpose="form" role="alertdialog" aria-label={`Move ${a.path} to the Recycle Bin?`}>
        <Layout
          content={
            <LayoutContent>
              <Heading level={2}>{`Move ${a.path} to the Recycle Bin?`}</Heading>
              {hasDirty ? <p style={{ margin: '8px 0 0' }}>It has unsaved changes. They will be lost.</p> : null}
            </LayoutContent>
          }
          footer={
            <LayoutFooter>
              <span className="ou-ide-askrow">
                <Button variant="ghost" label="Cancel" onClick={cancel} data-autofocus autoFocus />
                <Button variant="destructive" label="Move to Recycle Bin" onClick={() => void deleteEntry(st, a.path)} />
              </span>
            </LayoutFooter>
          }
        />
      </Dialog>
    );
  }
  if (a.kind === 'conflict') {
    return <Ask3 title={`${name} changed on disk since you opened it.`} onCancel={cancel} actions={[
      { label: 'Reload from disk', run: () => { st.ask = null; bump(); void reloadTab(st, a.path); } },
      { label: 'Overwrite', variant: 'destructive', run: () => { st.ask = null; bump(); void saveTab(st, a.path, true); } },
    ]} />;
  }
  return <Ask3 title={`Save changes to ${name}?`} onCancel={cancel} actions={[
    { label: "Don't save", run: () => { dropTab(st, a.path); nextClose(st); } },
    { label: 'Save', variant: 'primary', run: async () => { st.ask = null; bump(); if (await saveTab(st, a.path)) { dropTab(st, a.path); nextClose(st); } else st.closeAll = false; } },
  ]} />;
}

export function openPath(rel) {
  if (cur) void openFile(cur, rel);
}

const defaultCmd = (group, label, run) => ({ id: `cmd:${group}:${label}`, label, auxiliaryData: { group }, run });

export function ideCommands(cmd = defaultCmd) {
  if (!ideShown()) return [];
  const st = cur;
  if (!st) return [];
  const out = [];
  const t = st.active ? tabOf(st, st.active) : null;
  if (t) out.push(cmd('IDE', 'Save', () => void saveTab(st, t.path)));
  out.push(cmd('IDE', 'New file', () => { st.ask = { kind: 'new', path: '' }; bump(); }), cmd('IDE', 'Open in VS Code', () => void openInVsCode(st, t?.path)));
  if (t) out.push(cmd('IDE', 'Delete file', () => { st.ask = { kind: 'delete', path: t.path }; bump(); }));
  out.push(cmd('IDE', 'Find a file', ideKeys.find), cmd('IDE', 'Search in files', ideKeys.search));
  if (t && changedSet().has(t.path)) out.push(t.mode === 'changes' ? cmd('IDE', 'Show file', () => showFile(st, t.path)) : cmd('IDE', 'Show changes', () => void showChanges(st, t.path)));
  if (t && isMd(t.path)) out.push(inPreview(t) ? cmd('IDE', 'Show source', () => showSource(st, t.path)) : cmd('IDE', 'Show preview', () => showPreview(st, t.path)));
  if (t) out.push(cmd('IDE', 'Reload file from disk', () => askReload(st, t.path)), cmd('IDE', 'Close tab', () => closeTab(st, t.path)));
  if (st.tabs.length) out.push(cmd('IDE', 'Close all tabs', () => closeAll(st)));
  out.push(cmd('IDE', 'Show or hide the panel', () => bridge.togglePanel?.()), cmd('IDE', 'Restart the terminal', () => bridge.restartTerminal?.()));
  return out;
}

const defaultFile = (path, group) => ({ id: path, label: path, auxiliaryData: { group } });

export function ideFiles(file = defaultFile) {
  if (!ideShown() || !cur) return [];
  const open = cur.tabs.map((t) => file(t.path, 'Open files'));
  const changed = [...changedSet()].filter((p) => !tabOf(cur, p)).map((p) => file(p, 'Changed by agents'));
  return [...open, ...changed];
}

export function Ide() {
  ideStore.use();
  const [panel, setPanel] = useState(true);
  const [bottom, setBottom] = useState('terminal');
  const [gen, setGen] = useState(0);
  bridge.togglePanel = () => setPanel((v) => !v);
  bridge.restartTerminal = () => { if (cur) closeShell(cur.pid); setPanel(true); setBottom('terminal'); setGen((g) => g + 1); };

  const st = cur;
  useEffect(() => {
    if (!st) return;
    return onProblems((list) => { st.problems = list; bump(); });
  }, [st]);
  const rail = st && project() ? railHost() : null;
  useEffect(() => {
    rail?.querySelectorAll('[data-ide-side]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.ideSide === st.side)));
  });
  if (!st || !project()) return null;
  const changed = changedSet();
  const active = st.active ? tabOf(st, st.active) : null;
  const problems = st.problems || [];
  const showProblems = () => { setPanel(true); setBottom('problems'); };
  const gitCount = st.git && st.git.files ? new Set(st.git.files.map((f) => f.path)).size : null;
  const views = (
    <>
      <IconButton size="sm" variant="ghost" label="Files" tooltip="Files" data-ide-side="files" aria-pressed={st.side === 'files'} icon={<Sc.FileIcon size={16} />} onClick={() => { st.side = 'files'; bump(); }} />
      <IconButton size="sm" variant="ghost" label="Search" tooltip="Search (Ctrl+Shift+F)" data-ide-side="search" aria-pressed={st.side === 'search'} icon={<Ic.Search size={16} />} onClick={() => { st.side = 'search'; bump(); }} />
      <IconButton size="sm" variant="ghost" label={gitCount !== null ? `Changes ${gitCount}` : 'Changes'} tooltip="Source control" data-ide-side="changes" aria-pressed={st.side === 'changes'}
        icon={<span className="ou-ide-railicon"><Ic.Branch size={16} />{gitCount ? <span className="ou-ide-railbadge">{gitCount > 99 ? '99+' : gitCount}</span> : null}</span>}
        onClick={() => { st.side = 'changes'; bump(); void loadGitStatus(st); }} />
    </>
  );
  const tp = st.tabMenu && tabOf(st, st.tabMenu) ? st.tabMenu : st.active;
  const tt = tp ? tabOf(st, tp) : null;
  const tabMenu = !tt ? [] : [
    { label: 'Save', endContent: canWrite() ? <span className="ou-ide-key">Ctrl+S</span> : <NotBuilt />, isDisabled: !canWrite() || !tt.dirty, onClick: () => void saveTab(st, tp) },
    { label: 'Reload from disk', isDisabled: Boolean(tt.error || tt.image), onClick: () => askReload(st, tp) },
    { type: 'divider' },
    { label: 'Close', endContent: <span className="ou-ide-key">Ctrl+W</span>, onClick: () => closeTab(st, tp) },
    { label: 'Close all', onClick: () => closeAll(st) },
    { type: 'divider' },
    { label: 'Copy path', onClick: () => void copyPath(tp, true) },
    { label: 'Copy relative path', onClick: () => void copyPath(tp, false) },
    { label: 'Reveal in Files', onClick: () => void reveal(st, tp) },
  ];

  return (
    <div className="ou-ide" key={st.pid}>
      <aside className="ou-ide-side">
        {rail ? createPortal(<>{views}<span className="ou-ide-raildiv" aria-hidden="true" /></>, rail) : <nav className="ou-ide-rail" aria-label="Side views">{views}</nav>}
        <div className="ou-ide-pane">
          <div className="ou-ide-head">
            <span className="ou-ide-head-title">{st.side === 'search' ? 'Search' : st.side === 'changes' ? (gitCount !== null ? `Changes ${gitCount}` : 'Changes') : 'Explorer'}</span>
            <span className="ou-ide-head-actions">
              {st.side === 'files' ? (
                <>
                  <IconButton size="sm" variant="ghost" label="New file" tooltip="New file" icon={<Ic.PlusIcon size={14} />} onClick={() => startNew(st, '', false)} />
                  <IconButton size="sm" variant="ghost" label="New folder" tooltip="New folder" icon={<Ic.FolderAddIcon size={14} />} onClick={() => startNew(st, '', true)} />
                  <IconButton size="sm" variant="ghost" label="Collapse folders" tooltip="Collapse folders" icon={<Sc.MinusIcon size={14} />} onClick={() => collapseAll(st)} />
                </>
              ) : null}
              <IconButton size="sm" variant="ghost" label="Commands" tooltip="Commands (Ctrl+Shift+P)" icon={<Sc.TerminalIcon size={14} />} onClick={() => paletteView.open()} />
            </span>
          </div>
          {st.side === 'search' ? <Search st={st} /> : st.side === 'changes' ? <SourceControl st={st} /> : <Files st={st} changed={changed} />}
        </div>
      </aside>
      <section className={panel ? 'ou-ide-main' : 'ou-ide-main ou-ide-folded'}>
        <ContextMenu id="ide-tab-menu" size="sm" label="Tab actions" items={tabMenu} isDisabled={!tt}
          onContextMenu={(e) => { st.tabMenu = e.target.closest?.('[data-tab-value]')?.dataset.tabValue || null; bump(); }}>
        <div className="ou-ide-tabs">
          {st.tabs.length ? (
            <TabList size="sm" layout="hug" hasDivider overflow="auto" value={st.active || ''} onChange={(v) => { st.active = v; bump(); }}>
              {st.tabs.map((t) => (
                <Tab key={t.path} value={t.path} label={base(t.path)} title={t.path} icon={<FileIcon path={t.path} />} endContent={(
                  <span className={t.dirty ? 'ou-ide-tabend ou-ide-tabdirty' : 'ou-ide-tabend'}>
                    {t.dirty ? <span className="ou-ide-dirty" title="Unsaved" /> : changed.has(t.path) ? <Ring /> : null}
                    <IconButton size="sm" variant="ghost" label={`Close ${t.path}`} icon={<Sc.CloseIcon size={12} />} onClick={(e) => { e.stopPropagation(); closeTab(st, t.path); }} />
                  </span>
                )} />
              ))}
            </TabList>
          ) : null}
          <OpenInVsCodeButton st={st} tab={active} />
        </div>
        </ContextMenu>
        <Crumb st={st} tab={active} changed={changed} />
        <div className="ou-ide-view">
          {st.tabs.map((t) => <EditorHost key={`${st.pid}:${t.path}`} st={st} tab={t} hidden={t !== active || t.text === undefined || ((changed.has(t.path) || t.gitDiff) && t.mode === 'changes') || inPreview(t)} />)}
          {!active ? <EmptyState isCompact title="Pick a file on the left, or press Ctrl+P." />
            : (changed.has(active.path) || active.gitDiff) && active.mode === 'changes' ? <DiffView st={st} tab={active} />
              : active.error ? <EmptyState isCompact title={active.error} actions={<><Button size="sm" label="Open outside" onClick={() => void openOutside(st, active.path)} /><Button size="sm" variant="secondary" label="Open in VS Code" onClick={() => void openInVsCode(st, active.path)} /></>} />
                : active.image ? <div className="ou-ide-image"><img src={active.image} alt={active.path} /></div>
                  : active.text === undefined ? <p className="ou-ide-muted ou-ide-pad">Loading.</p>
                    : inPreview(active) ? <Preview key={active.path} text={active.text} path={active.path} pid={st.pid} open={(rel) => void openFile(st, rel)} tab={active} /> : null}
        </div>
        <div className="ou-ide-panel">
          <div className="ou-ide-phead">
            <TabList size="sm" value={bottom} onChange={(v) => { setBottom(v); setPanel(true); }}>
              <Tab value="problems" label="Problems" endContent={problems.length ? <Badge label={String(problems.length)} /> : null} />
              <Tab value="terminal" label="Terminal" />
            </TabList>
            <span className="ou-ip-acts">
              {bottom === 'terminal' ? <IconButton size="sm" variant="ghost" label="Restart the terminal" icon={<Sc.ReloadIcon size={14} />} onClick={() => bridge.restartTerminal()} /> : null}
              <IconButton size="sm" variant="ghost" label={panel ? 'Hide the panel' : 'Show the panel'} aria-expanded={panel} icon={panel ? <Ic.ChevronDownIcon size={14} /> : <Sc.ChevronUpIcon size={14} />} onClick={() => setPanel(!panel)} />
            </span>
          </div>
          {panel ? (bottom === 'problems'
            ? <Problems problems={problems} FileIcon={FileIcon} open={(path, line) => void openFile(st, path, { line })} />
            : <Terminal key={`${st.pid}:${gen}`} pid={st.pid} />) : null}
        </div>
      </section>
      <StatusBar st={st} active={active} problems={problems} onProblems={showProblems} />
      <Asks st={st} />
    </div>
  );
}
