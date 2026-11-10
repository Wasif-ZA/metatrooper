import { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { AlertDialog } from '@astryxdesign/core/AlertDialog';
import { Badge } from '@astryxdesign/core/Badge';
import { Button } from '@astryxdesign/core/Button';
import { CommandPalette } from '@astryxdesign/core/CommandPalette';
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
import { createStore } from './store.js';
import { editorState, openEditor } from './editor.js';
import { Preview, isMd } from './preview.jsx';

export const ideStore = createStore({ tick: 0 });
let sentDirty = false;
const bump = () => {
  const dirty = [...states.values()].some((st) => st.tabs.some((x) => x.dirty));
  if (dirty !== sentDirty) { sentDirty = dirty; void api.setDirty?.(dirty); }
  ideStore.set({ tick: ideStore.get().tick + 1 });
};

const states = new Map();
let cur = null;
const bridge = {};

const fresh = (pid) => ({ pid, dirs: new Map(), listing: new Set(), tabs: [], active: null, side: 'files', q: '', hits: [], sq: '', sres: null, searching: false, ask: null, renaming: null, closeAll: false, git: null, gitSeq: 0, commitMsg: '' });
const slashed = (f) => String(f).replace(/\\/g, '/');
const base = (p) => p.split('/').pop();
const folder = (p) => p.split('/').slice(0, -1).join('/');
const tabOf = (st, path) => st.tabs.find((x) => x.path === path);
const canWrite = () => typeof api.fsWrite === 'function';
const canSearch = () => typeof api.fsSearch === 'function';
const inPreview = (t) => t.mode === 'preview' && isMd(t.path);

export const ideShown = () => ui.view === 'ide' && Boolean(project());

export async function drawIde() {
  const host = document.getElementById('ide');
  if (host) host.hidden = !ideShown();
  if (!ideShown()) return;
  if (cur && cur.pid === ui.projectId) {
    const sig = JSON.stringify(ui.snap.git || {});
    if (cur.sig !== undefined && cur.sig !== sig) void refresh(cur);
    cur.sig = sig;
    bump();
    return;
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

// ponytail: re-lists every open folder on each git snapshot change; watch single folders if this gets slow
async function refresh(st) {
  if (st.refreshing) return;
  st.refreshing = true;
  try {
    for (const rel of [...st.dirs.keys()]) {
      const list = await api.fsList(st.pid, rel || '.');
      if (list) st.dirs.set(rel, list); else if (rel) st.dirs.delete(rel);
    }
    for (const t of [...st.tabs]) {
      if (t.dirty || t.text === undefined || t.reading) continue;
      const r = await api.fsRead(st.pid, t.path);
      if (!r || r.error || r.mtimeMs === t.mtimeMs || t.dirty || !st.tabs.includes(t)) continue;
      t.mtimeMs = r.mtimeMs;
      t.text = r.text;
      if (t.view) t.view.setState(editorState(r.text, t.path, onFor(st, t))); else t.state = null;
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
  toast('Committed');
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
  if (!isDeleted && t.text === undefined && !t.error && !t.reading) {
    t.reading = true;
    const r = await api.fsRead(st.pid, path);
    t.reading = false;
    if (!r || r.error) t.error = (r && r.error) || 'Could not read the file.';
    else { t.text = r.text; t.mtimeMs = r.mtimeMs; }
    bump();
  }
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
  const doc = t.view.state.doc;
  const line = doc.line(Math.max(1, Math.min(t.gotoLine, doc.lines)));
  t.gotoLine = null;
  t.view.dispatch({ selection: { anchor: line.from }, scrollIntoView: true });
  t.view.focus();
}

async function openFile(st, path, { owner, changes, line } = {}) {
  let t = tabOf(st, path);
  if (!t) { t = { path, mode: isMd(path) ? 'preview' : 'file', dirty: false }; st.tabs.push(t); }
  st.active = path;
  if (owner) { t.owner = owner; t.gitDiff = false; }
  if (line) { t.gotoLine = line; t.mode = 'file'; }
  bump();
  if (changes) void showChanges(st, path);
  if (t.text === undefined && !t.error && !t.reading) {
    t.reading = true;
    const r = await api.fsRead(st.pid, path);
    t.reading = false;
    if (!r || r.error) t.error = (r && r.error) || 'Could not read the file.';
    else { t.text = r.text; t.mtimeMs = r.mtimeMs; }
    bump();
  } else setTimeout(() => goto(t), 0);
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
    if (!ask.folder) await openFile(st, rel);
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

const focusRow = (path) => setTimeout(() => document.querySelector(`#ide-tree-menu [data-tree-id="${CSS.escape(path)}"]`)?.focus(), 0);

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
  try { r = await api.fsWrite(st.pid, path, state.sliceDoc(), force ? null : (t.mtimeMs ?? null)); } finally { t.saving = false; }
  if (r && r.ok) {
    t.mtimeMs = r.mtimeMs;
    const now = t.view ? t.view.state : t.state;
    if (now && now.doc === state.doc) t.dirty = false;
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
  else { t.text = r.text; t.state = null; }
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

export const ideKeys = {
  find: () => focusInput('files', 'ide-find'),
  search: () => focusInput('search', 'ide-search'),
  changes: () => { if (!cur) return; cur.side = 'changes'; bump(); void loadGitStatus(cur); },
  palette: (open) => bridge.setPalette?.(open),
  paletteOpen: () => Boolean(bridge.palette),
  closeTab: () => { if (cur && cur.active) closeTab(cur, cur.active); },
  asking: () => Boolean(cur && cur.ask),
  preview: () => {
    const t = cur && cur.active ? tabOf(cur, cur.active) : null;
    if (!t || !isMd(t.path)) return false;
    if (inPreview(t)) showSource(cur, t.path); else showPreview(cur, t.path);
    return true;
  },
};

const svg = (d, size = 14) => <svg width={size} height={size} viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const svg24 = (d) => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
const FILE = 'M3.5 1.5h4.5l2.5 2.5v8.5h-7zM8 1.5V4h2.5';
const CODE = 'M4.5 4.5L2 7l2.5 2.5M9.5 4.5L12 7l-2.5 2.5M8 3l-2 8';
const JSON_ICON = 'M4.5 2.5a1 1 0 00-1 1v2a1 1 0 01-1 1 1 1 0 011 1v2a1 1 0 001 1M9.5 2.5a1 1 0 011 1v2a1 1 0 001 1 1 1 0 00-1 1v2a1 1 0 01-1 1';
const MD_ICON = 'M2 3.5h10v7H2zM4 8.5V5.5l1.5 1.8 1.5-1.8v3M9.5 6.5v2m-1-1l1 1 1-1';
const CSS_ICON = 'M4.5 2.5l-1 9M10.5 2.5l-1 9M2.5 5.5h9M1.5 8.5h9';
const HTML_ICON = 'M4 4.5L1.5 7 4 9.5M10 4.5l2.5 2.5-2.5 2.5M8 3.5l-2 7';
const IMG_ICON = 'M2 2.5h10v9H2zM2 9.5l3-3 2.5 2.5 2-2 2.5 2.5M5 5.5a1 1 0 100-2 1 1 0 000 2';
const FOLDER_ICON = 'M1.5 3.5a1 1 0 011-1h3l1.5 1.5h4.5a1 1 0 011 1v6a1 1 0 01-1 1h-9a1 1 0 01-1-1z';
const CLOSE = 'M4 4l6 6M10 4l-6 6';
const RELOAD = 'M11.5 7a4.5 4.5 0 11-1.3-3.2M11.5 2v2.5H9';
const CMD = 'M2.5 4.5l3 2.5-3 2.5M7 10h4.5';
const FOLD = 'M3.5 5.5L7 9l3.5-3.5';
const UNFOLD = 'M3.5 8.5L7 5l3.5 3.5';
const PLUS = 'M7 3v8M3 7h8';
const MINUS = 'M3 7h8';
const BRANCH = 'M3.5 2a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm0 3v4m0 0a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm0 1.5c1.5 0 3.5 0 5-1.5s1.5-2 1.5-3.5m0 0a1.5 1.5 0 100-3 1.5 1.5 0 000 3z';
const CHECK_CIRCLE = 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z';

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

const CODE_EXTS = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'py', 'sh', 'bash', 'zsh', 'rb', 'rs', 'go', 'c', 'cpp', 'h', 'java', 'astro', 'vue', 'svelte']);
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif']);

const TINT = {
  js: 'fn', jsx: 'fn', ts: 'fn', tsx: 'fn', mjs: 'fn', cjs: 'fn',
  json: 'type',
  css: 'keyword', scss: 'keyword', less: 'keyword',
  html: 'number', htm: 'number',
  md: 'string', markdown: 'string',
  png: 'type', jpg: 'type', jpeg: 'type', gif: 'type', svg: 'type', webp: 'type', ico: 'type',
};

function fileShape(path, isDir) {
  if (isDir) return 'folder';
  if (!path) return 'file';
  const ext = path.split('.').pop().toLowerCase();
  if (ext === 'json') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (ext === 'css' || ext === 'scss' || ext === 'less') return 'css';
  if (ext === 'html' || ext === 'htm') return 'html';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (CODE_EXTS.has(ext)) return 'code';
  return 'file';
}

function fileIconD(shape) {
  if (shape === 'code') return CODE;
  if (shape === 'json') return JSON_ICON;
  if (shape === 'markdown') return MD_ICON;
  if (shape === 'css') return CSS_ICON;
  if (shape === 'html') return HTML_ICON;
  if (shape === 'image') return IMG_ICON;
  if (shape === 'folder') return FOLDER_ICON;
  return FILE;
}

function FileIcon({ path, isDir }) {
  const shape = fileShape(path, isDir);
  const ext = path ? path.split('.').pop().toLowerCase() : '';
  const k = isDir ? 'type' : TINT[ext];
  return <span className="ou-ide-ficon" style={{ color: k ? `var(--syn-${k})` : 'var(--mute)' }}>{svg(fileIconD(shape))}</span>;
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

function CompactEmpty({ icon, label }) {
  return (
    <div className="ou-ide-empty">
      {icon ? <span className="ou-ide-empty-icon">{icon}</span> : null}
      <span className="ou-ide-empty-label">{label}</span>
    </div>
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

function treeItems(st, rel, changed) {
  return (st.dirs.get(rel) || []).map((e) => {
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (st.renaming === path) {
      const children = e.dir ? (st.dirs.get(path)?.length ? treeItems(st, path, changed) : [{ id: `${path}//empty`, label: 'Empty', isDisabled: true }]) : undefined;
      return { id: path, label: <RenameInput st={st} path={path} />, children, startContent: <FileIcon path={path} isDir={e.dir} /> };
    }
    if (e.dir) {
      const kids = st.dirs.get(path);
      const children = !kids ? [{ id: `${path}//loading`, label: <LoadDir st={st} rel={path} />, isDisabled: true }]
        : kids.length ? treeItems(st, path, changed) : [{ id: `${path}//empty`, label: 'Empty', isDisabled: true }];
      return { id: path, label: e.name, children, startContent: <FileIcon isDir /> };
    }
    return {
      id: path,
      label: e.name,
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
    { label: 'Delete', isDisabled: true, endContent: <NotBuilt /> },
  ];
  return (
    <>
      <div className="ou-ide-findrow">
        <input id="ide-find" className="ou-ide-input" value={st.q} placeholder="Find a file (Ctrl+P)" aria-label="Find a file by name" autoComplete="off" spellCheck="false"
          onChange={(e) => void runFind(st, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && st.hits.length) { e.preventDefault(); void openFile(st, st.hits[0]); }
            else if (e.key === 'Escape' && st.q) { e.preventDefault(); e.stopPropagation(); st.q = ''; st.hits = []; bump(); }
          }} />
      </div>
      <div className="ou-ide-tree">
        {st.q.trim() ? (st.hits.length ? st.hits.map((h) => (
          <button key={h} className={st.active === h ? 'ou-ide-hit ou-ide-cur' : 'ou-ide-hit'} title={h} onClick={() => void openFile(st, h)}>
            <FileIcon path={h} /><span className="ou-ide-name">{base(h)}</span><span className="ou-ide-dir">{folder(h)}</span><TreeDecorations st={st} path={h} isChanged={changed.has(h)} />
          </button>
        )) : <p className="ou-ide-muted">No file matches.</p>) : (
          <ContextMenu id="ide-tree-menu" size="sm" label="File actions" items={items}
            onContextMenu={(e) => setTarget(rowTarget(st, e.target))}
            onOpenChange={(open) => { const run = pending.current; pending.current = null; if (!open && run) setTimeout(run, 0); }}>
            <TreeList key={ui.projectId} density="compact" aria-label={`${p.name} files`} header={<span className="ou-ide-root">{p.name}</span>} items={treeItems(st, '', changed)}
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
            {[...groups].map(([path, hits]) => (
              <div key={path}>
                <div className="ou-ide-sfile" title={path}><FileIcon path={path} /><span className="ou-ide-name">{base(path)}</span><span className="ou-ide-dir">{folder(path)}</span><span className="ou-ide-count">{hits.length}</span></div>
                {hits.map((h, i) => (
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
      <span className="ou-ide-scletter">{file.letter}</span>
      <span className="ou-ide-name">{base(file.path)}</span>
      <span className="ou-ide-dir">{folder(file.path)}</span>
      <IconButton size="sm" variant="ghost" label={staged ? `Unstage ${file.path}` : `Stage ${file.path}`} icon={svg(staged ? MINUS : PLUS, 12)}
        onClick={(e) => { e.stopPropagation(); void (staged ? gitUnstage(st, [file.path]) : gitStage(st, [file.path])); }} />
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

  return (
    <>
      <div className="ou-ide-sccommit">
        <textarea className="ou-ide-scmsg" rows={3} placeholder="Commit message" value={st.commitMsg}
          onChange={(e) => { st.commitMsg = e.target.value; bump(); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canCommit) { e.preventDefault(); void gitCommit(st); } }} />
        <div className="ou-ide-scactions">
          <Button size="sm" label="Commit" isDisabled={!canCommit} onClick={() => void gitCommit(st)} />
          <IconButton size="sm" variant="ghost" label="Refresh" tooltip="Refresh" icon={svg(RELOAD)} onClick={() => void loadGitStatus(st)} />
        </div>
      </div>
      <div className="ou-ide-tree">
        {!st.git ? <p className="ou-ide-muted">Loading.</p> : (
          <>
            <div className="ou-ide-schead">
              <span>Staged</span><span className="ou-ide-count">{staged.length}</span>
            </div>
            {staged.map((f) => <ScRow key={`s:${f.path}`} st={st} file={f} staged />)}
            {!staged.length ? <p className="ou-ide-muted">No staged files.</p> : null}
            <div className="ou-ide-schead">
              <span>Changes</span><span className="ou-ide-count">{unstaged.length}</span>
              {unstaged.length ? <IconButton size="sm" variant="ghost" label="Stage all" tooltip="Stage all" icon={svg(PLUS, 12)}
                onClick={() => void gitStage(st, unstaged.filter((f) => !f.conflict).map((f) => f.path))} /> : null}
            </div>
            {unstaged.map((f) => <ScRow key={`u:${f.path}`} st={st} file={f} staged={false} />)}
            {!unstaged.length ? <p className="ou-ide-muted">No changes.</p> : null}
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
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    tab.line = line.number;
    tab.col = head - line.from + 1;
    goto(tab);
    bump();
    return () => { tab.state = view.state; tab.view = null; view.destroy(); };
  }, [ready, st, tab]);
  return <div ref={ref} className="ou-ide-ed" hidden={hidden} onKeyDown={(e) => { if (!e.ctrlKey && !e.altKey && !e.metaKey) e.stopPropagation(); }} />;
}

function DiffView({ tab }) {
  if (tab.diff === undefined) return <p className="ou-ide-muted ou-ide-pad">Loading.</p>;
  const lines = tab.diff ? diffLines(tab.diff) : [];
  if (!lines.length) return <p className="ou-ide-muted ou-ide-pad">No changes to show for this file.</p>;
  return (
    <div className="ou-ide-diff">
      {lines.map((l, i) => (
        <div key={i} className={`ou-ide-dl ou-ide-k-${l.kind}`}>
          <span className="ou-ide-dn">{l.kind === 'del' || l.kind === 'hunk' ? '' : l.line}</span>
          <span className="ou-ide-ds">{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ''}</span>
          <span className="ou-ide-dt">{l.kind === 'hunk' ? l.text : l.text.slice(1)}</span>
        </div>
      ))}
    </div>
  );
}

function Crumb({ st, tab, changed }) {
  const isChanged = tab && (changed.has(tab.path) || Boolean(tab.gitDiff));
  const md = Boolean(tab) && isMd(tab.path);
  const mode = isChanged && tab.mode === 'changes' ? 'changes' : tab && inPreview(tab) ? 'preview' : 'file';
  const parts = tab ? tab.path.split('/') : [];
  const lines = mode === 'changes' && tab.diff ? diffLines(tab.diff) : [];
  const ok = canWrite();
  return (
    <div className="ou-ide-crumb">
      <span className="ou-ide-path">{parts.map((x, i) => <span key={i}>{i ? ' › ' : ''}{i === parts.length - 1 ? <b>{x}</b> : x}</span>)}</span>
      <span className="ou-ide-crumbr">
        <Button size="sm" variant="ghost" label="Open in VS Code" onClick={() => void openInVsCode(st, tab?.path)} />
        {mode === 'changes' ? <><span className="ou-ide-add">+{lines.filter((l) => l.kind === 'add').length}</span><span className="ou-ide-del">-{lines.filter((l) => l.kind === 'del').length}</span></> : null}
        {isChanged || md ? (
          <SegmentedControl label="View" size="sm" value={mode} onChange={(v) => (v === 'changes' ? void showChanges(st, tab.path) : v === 'preview' ? showPreview(st, tab.path) : showFile(st, tab.path))}>
            {md ? <SegmentedControlItem value="preview" label="Preview" /> : null}
            <SegmentedControlItem value="file" label="File" />
            {isChanged ? <SegmentedControlItem value="changes" label="Changes" /> : null}
          </SegmentedControl>
        ) : null}
        {!tab || tab.error ? null : (
          <>
            <IconButton size="sm" variant="ghost" label="Reload from disk" tooltip="Reload from disk" icon={svg(RELOAD)} onClick={() => askReload(st, tab.path)} />
            <Button size="sm" label="Save" tooltip="Save (Ctrl+S)" isDisabled={!ok || !tab.dirty} onClick={() => void saveTab(st, tab.path)} />
            {ok ? null : <NotBuilt />}
          </>
        )}
      </span>
    </div>
  );
}

function Agents({ st }) {
  const rows = ui.snap.sessions.filter((x) => x.state !== 'exited' && !ui.pendingHide.has(x.id)).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
  if (!rows.length) return <div id="ide-agents" className="ou-ide-agents"><CompactEmpty icon={svg24(CHECK_CIRCLE)} label="No agents running." /></div>;
  return (
    <div id="ide-agents" className="ou-ide-agents">
      {rows.map((x) => {
        const files = changedFiles(x.id).map(slashed);
        const wait = x.state === 'waiting_for_you';
        return (
          <section key={x.id} className="ou-ide-acol">
            <button className="ou-ide-ahead" data-action="pick" data-id={x.id}>
              <span className={wait ? 'ou-dot ou-dot-wait' : x.state === 'working' || x.state === 'starting' ? 'ou-dot ou-dot-work' : 'ou-dot'} />
              <span className="ou-ide-task">{taskOf(x)}</span>
              <span className="ou-ide-engine">{x.engine_id}</span>
              {wait ? <span className="ou-ide-needs">Needs you</span> : <span className="ou-ide-state">{STATE_WORDS[x.state] || x.state}</span>}
            </button>
            <div className="ou-ide-afiles">
              {files.length ? files.map((f) => (
                <button key={f} className="ou-ide-afile" title={f} onClick={() => void openFile(st, f, { owner: x.id, changes: true })}>
                  <span className="ou-ide-name">{base(f)}</span><span className="ou-ide-dir">{folder(f)}</span>
                </button>
              )) : <CompactEmpty icon={svg24(CHECK_CIRCLE)} label="No changes yet" />}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function StatusBar({ st, active, agentCount }) {
  useEffect(() => {
    if (st.git === null) void loadGitStatus(st);
  }, [st]);
  const branch = st.git && st.git.branch;
  const nc = typeof needsCount === 'function' ? needsCount() : null;
  const line = active ? (active.line ?? 1) : null;
  const col = active ? (active.col ?? 1) : null;
  const lang = active ? langOf(active.path) : '';

  return (
    <footer className="ou-ide-status">
      <div className="ou-ide-status-left">
        {branch ? (
          <span className="ou-ide-status-item" title={`Branch: ${branch}`}>
            {svg(BRANCH, 12)}
            <span>{branch}</span>
          </span>
        ) : null}
        <span className="ou-ide-status-item">
          {agentCount} {agentCount === 1 ? 'agent working' : 'agents working'}
        </span>
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

export function Ide() {
  ideStore.use();
  const [palette, setPalette] = useState(false);
  const [panel, setPanel] = useState(true);
  const [bottom, setBottom] = useState('agents');
  const runs = useRef(new Map());
  bridge.palette = palette;
  bridge.setPalette = setPalette;

  const source = useMemo(() => {
    const cmd = (group, label, run) => { const id = `cmd:${group}:${label}`; runs.current.set(id, run); return { id, label, auxiliaryData: { group } }; };
    const commands = () => {
      const st = cur;
      if (!st) return [];
      const out = [];
      const t = st.active ? tabOf(st, st.active) : null;
      if (t) out.push(cmd('IDE', 'Save', () => void saveTab(st, t.path)));
      out.push(cmd('IDE', 'New file', () => { st.ask = { kind: 'new', path: '' }; bump(); }), cmd('IDE', 'Open in VS Code', () => void openInVsCode(st, t?.path)));
      out.push(cmd('IDE', 'Find a file', ideKeys.find), cmd('IDE', 'Search in files', ideKeys.search));
      if (t && changedSet().has(t.path)) out.push(t.mode === 'changes' ? cmd('IDE', 'Show file', () => showFile(st, t.path)) : cmd('IDE', 'Show changes', () => void showChanges(st, t.path)));
      if (t && isMd(t.path)) out.push(inPreview(t) ? cmd('IDE', 'Show source', () => showSource(st, t.path)) : cmd('IDE', 'Show preview', () => showPreview(st, t.path)));
      if (t) out.push(cmd('IDE', 'Reload file from disk', () => askReload(st, t.path)), cmd('IDE', 'Close tab', () => closeTab(st, t.path)));
      if (st.tabs.length) out.push(cmd('IDE', 'Close all tabs', () => closeAll(st)));
      out.push(cmd('IDE', 'Show or hide the agents panel', () => setPanel((v) => !v)));
      const seen = new Set(out.map((x) => x.id));
      for (const x of paletteItems().filter((y) => !y.confirm && !y.stay)) {
        const item = cmd(x.group, x.label, x.run);
        if (!seen.has(item.id)) { seen.add(item.id); out.push(item); }
      }
      return out;
    };
    const file = (path, group) => ({ id: path, label: path, auxiliaryData: { group } });
    return {
      bootstrap() {
        if (!cur) return [];
        const open = cur.tabs.map((t) => file(t.path, 'Open files'));
        const changed = [...changedSet()].filter((p) => !tabOf(cur, p)).map((p) => file(p, 'Changed by agents'));
        return [...open, ...changed, ...commands()];
      },
      async search(q) {
        const files = [...new Set(((await api.fsFind(ui.projectId, q)) || []).map(slashed))].slice(0, 20).map((p) => file(p, 'Files'));
        const lq = q.toLowerCase();
        return [...files, ...commands().filter((c) => c.label.toLowerCase().includes(lq))];
      },
    };
  }, []);

  const st = cur;
  if (!st || !project()) return null;
  const changed = changedSet();
  const active = st.active ? tabOf(st, st.active) : null;
  const agentCount = ui.snap.sessions.filter((x) => x.state !== 'exited' && !ui.pendingHide.has(x.id)).length;
  const gitCount = st.git && st.git.files ? new Set(st.git.files.map((f) => f.path)).size : null;

  return (
    <div className="ou-ide" key={st.pid}>
      <aside className="ou-ide-side">
        <div className="ou-ide-head">
          <SegmentedControl label="Explorer" size="sm" value={st.side} onChange={(v) => { st.side = v; bump(); if (v === 'changes') void loadGitStatus(st); }}>
            <SegmentedControlItem value="files" label="Files" />
            <SegmentedControlItem value="search" label="Search" />
            <SegmentedControlItem value="changes" label={gitCount !== null ? `Changes ${gitCount}` : 'Changes'} />
          </SegmentedControl>
          <IconButton size="sm" variant="ghost" label="Commands" tooltip="Commands (Ctrl+Shift+P)" icon={svg(CMD)} onClick={() => setPalette(true)} />
        </div>
        {st.side === 'search' ? <Search st={st} /> : st.side === 'changes' ? <SourceControl st={st} /> : <Files st={st} changed={changed} />}
      </aside>
      <section className={panel ? 'ou-ide-main' : 'ou-ide-main ou-ide-folded'}>
        <div className="ou-ide-tabs">
          {st.tabs.length ? (
            <TabList size="sm" layout="hug" hasDivider overflow="auto" value={st.active || ''} onChange={(v) => { st.active = v; bump(); }}>
              {st.tabs.map((t) => (
                <Tab key={t.path} value={t.path} label={base(t.path)} title={t.path} icon={<FileIcon path={t.path} />} endContent={(
                  <span className="ou-ide-tabend">
                    {t.dirty ? <span className="ou-ide-dirty" title="Unsaved" /> : changed.has(t.path) ? <Ring /> : null}
                    <IconButton size="sm" variant="ghost" label={`Close ${t.path}`} icon={svg(CLOSE, 12)} onClick={(e) => { e.stopPropagation(); closeTab(st, t.path); }} />
                  </span>
                )} />
              ))}
            </TabList>
          ) : null}
        </div>
        <Crumb st={st} tab={active} changed={changed} />
        <div className="ou-ide-view">
          {st.tabs.map((t) => <EditorHost key={`${st.pid}:${t.path}`} st={st} tab={t} hidden={t !== active || t.text === undefined || ((changed.has(t.path) || t.gitDiff) && t.mode === 'changes') || inPreview(t)} />)}
          {!active ? <EmptyState isCompact title="Pick a file on the left, or press Ctrl+P." />
            : (changed.has(active.path) || active.gitDiff) && active.mode === 'changes' ? <DiffView tab={active} />
              : active.error ? <EmptyState isCompact title={active.error} actions={<><Button size="sm" label="Open outside" onClick={() => void openOutside(st, active.path)} /><Button size="sm" variant="secondary" label="Open in VS Code" onClick={() => void openInVsCode(st, active.path)} /></>} />
                : active.text === undefined ? <p className="ou-ide-muted ou-ide-pad">Loading.</p>
                  : inPreview(active) ? <Preview key={active.path} text={active.text} path={active.path} pid={st.pid} open={(rel) => void openFile(st, rel)} tab={active} /> : null}
        </div>
        <div className="ou-ide-panel">
          <div className="ou-ide-phead">
            <TabList size="sm" value={bottom} onChange={setBottom}>
              <Tab value="agents" label={`Agents ${agentCount}`} />
              <Tab value="terminal" label="Terminal" endContent={<NotBuilt />} />
            </TabList>
            <IconButton size="sm" variant="ghost" label={panel ? 'Hide the panel' : 'Show the panel'} aria-expanded={panel} icon={svg(panel ? FOLD : UNFOLD)} onClick={() => setPanel(!panel)} />
          </div>
          {panel ? (bottom === 'agents' ? <Agents st={st} /> : (
            <div className="ou-ide-term"><EmptyState isCompact title="The terminal is not built into the IDE yet. Agent terminals are on the Wall." actions={<Button size="sm" label="Open the Wall" data-action="view" data-view="wall" />} /></div>
          )) : null}
        </div>
      </section>
      <StatusBar st={st} active={active} agentCount={agentCount} />
      <Asks st={st} />
      <CommandPalette isOpen={palette} onOpenChange={setPalette} searchSource={source} label="IDE commands" emptySearchText="Nothing matches."
        onValueChange={(id) => setTimeout(() => (runs.current.get(id) ?? (() => void openFile(cur, id)))(), 0)} />
    </div>
  );
}
