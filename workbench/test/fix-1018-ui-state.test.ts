import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = (f: string) => readFileSync(new URL(`../renderer/${f}`, import.meta.url), 'utf8');
const UI_METHODS: Set<string> = new Function(`${readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').match(/^export const UI_METHODS\s*=\s*new Set\(\[[^]*?\]\);/m)![0].replace(/^export\s+/, '')}; return UI_METHODS;`)();
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

function makeEl(id = '', tagName = 'DIV'): any {
  const listeners: Record<string, Array<(e: any) => void>> = {};
  const classes = new Set<string>();
  const el: any = {
    id, tagName, hidden: false, innerHTML: '', textContent: '', value: '', className: '', title: '', dataset: {}, children: [] as any[], parent: null, listeners,
    style: { removeProperty() {}, setProperty() {} },
    classList: {
      [Symbol.iterator]: () => classes.values(),
      add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c),
      toggle: (c: string, force?: boolean) => { const on = force === undefined ? !classes.has(c) : force; if (on) classes.add(c); else classes.delete(c); return on; },
    },
    append: (...kids: any[]) => { for (const k of kids) if (typeof k === 'object') { k.parent = el; el.children.push(k); } },
    remove: () => { if (el.parent) el.parent.children = el.parent.children.filter((k: any) => k !== el); el.parent = null; },
    contains: (x: any) => { for (let n = x; n; n = n.parent) if (n === el) return true; return false; },
    addEventListener: (t: string, f: (e: any) => void) => { (listeners[t] ||= []).push(f); },
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus: () => { doc.activeElement = el; }, blur() {}, select() {}, scrollIntoView() {}, setSelectionRange() {},
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, x: 0, y: 0, width: 0, height: 0 }),
  };
  return el;
}
let doc: any;

/** Runs the real diff.js, browser-chrome.js and app.js against a fake DOM, api and wall, on a clock the test moves. */
function boot(opts: { storage?: Record<string, string>; api?: Record<string, (...a: any[]) => any> } = {}) {
  let now = 1_000_000;
  let seq = 0;
  let timers: Array<{ id: number; at: number; f: () => void }> = [];
  const els = new Map<string, any>();
  const docListeners: Array<{ type: string; f: (e: any) => void; capture: boolean }> = [];
  const d: any = doc = {
    body: makeEl('body'), documentElement: makeEl('html'), activeElement: null, hidden: false,
    fonts: { load: () => Promise.resolve() },
    getElementById: (id: string) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    createElement: (tag: string) => makeEl('', tag.toUpperCase()),
    addEventListener: (type: string, f: (e: any) => void, capture = false) => { docListeners.push({ type, f, capture: Boolean(capture) }); },
    querySelector: () => null, querySelectorAll: () => [],
  };
  doc.activeElement = doc.body;
  for (const id of ['palette', 'inbox', 'sinks', 'menu', 'start']) doc.getElementById(id).hidden = true;
  const calls: Array<{ method: string; params: any }> = [];
  const handlers: Record<string, (...a: any[]) => any> = {};
  const replies: Record<string, any> = { 'shell.list': { shells: [] } };
  const api = new Proxy({}, {
    get: (_t, name: string) => {
      if (name.startsWith('on')) return (f: (...a: any[]) => any) => { handlers[name] = f; };
      if (name === 'call') return async (method: string, params: any) => { calls.push({ method, params }); if (!UI_METHODS.has(method)) return { kind: 'reply', reply: { id: null, error: { code: -32601, message: method } } }; return { kind: 'ok', reply: { result: replies[method] ?? {} } }; };
      if (opts.api && name in opts.api) return async (...args: any[]) => { calls.push({ method: `api.${name}`, params: args }); return opts.api![name](...args); };
      if (name === 'git') return async () => ({ branch: 'main', changes: [], staged: [], log: '', ahead: 0, behind: 0 });
      if (name === 'uiSettings') return async () => ({ theme: {}, ui: { toast_ms: 3500, error_toast_ms: 7000, layout: {} }, terminal: { git_every_ms: 10000, scrollback: 1000, font_size: 13 }, themes: [] });
      return async (...args: any[]) => { calls.push({ method: `api.${name}`, params: args }); return undefined; };
    },
  });
  const wallState = { list: false, sheet: false };
  const rolls: Record<string, number> = {};
  const wall: any = new Proxy({
    setList: (v: boolean) => { wallState.list = v; }, listOpen: () => wallState.list, setSheet: (v: boolean) => { wallState.sheet = v; }, sheetOpen: () => wallState.sheet,
    roll: (el: any, n: number) => { rolls[el.id] = n; }, decide: (shown: any[]) => (shown[0] ? shown[0].id : null), state: () => ({}), big: () => null, isBig: () => false, toggleOpen: () => false,
  }, { get: (t: any, k: string) => (k in t ? t[k] : () => {}) });
  const termView: any = new Proxy({ state: () => null }, { get: (t: any, k: string) => (k in t ? t[k] : () => {}) });
  class FakeDate extends Date { static now() { return now; } }
  const store = opts.storage || {};
  const ctx = vm.createContext({
    window: { troop: api, addEventListener() {} }, document: doc, location: { search: '' },
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } },
    URLSearchParams, URL, wall, termView, CSS: { escape: (s: string) => s }, matchMedia: () => ({ matches: false }), Date: FakeDate, console,
    setTimeout: (f: () => void, ms = 0) => { const id = ++seq; timers.push({ id, at: now + ms, f }); return id; },
    clearTimeout: (id: number) => { timers = timers.filter((t) => t.id !== id); },
    setInterval: () => 0,
  });
  vm.runInContext(`${src('diff.js')}\n${src('browser-chrome.js')}\n${src('app.js')}\nthis.t = { ui, render, paletteItems };`, ctx);
  const t = (ctx as any).t;
  const fire = (type: string, e: any) => {
    let stopped = false;
    const ev = { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { stopped = true; }, target: d.activeElement, ...e };
    for (const capture of [true, false]) for (const l of docListeners) if (l.type === type && l.capture === capture && !stopped) l.f(ev);
  };
  return {
    t, calls, handlers, replies, rolls, store, el: (id: string) => d.getElementById(id),
    advance: async (ms: number) => {
      const until = now + ms;
      for (;;) {
        const due = timers.filter((x) => x.at <= until).sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        timers = timers.filter((x) => x !== due);
        now = due.at;
        due.f();
        await flush();
      }
      now = until;
      await flush();
    },
    snap: async (s: any) => { await handlers.onSnapshot(s); await flush(); },
    key: async (key: string, mods: any = {}) => { fire('keydown', { key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods }); await flush(); },
    click: async (dataset: any) => {
      const target: any = makeEl('', 'BUTTON');
      Object.assign(target.dataset, dataset);
      target.closest = (sel: string) => {
        if (sel === '[data-action]') return target.dataset.action ? target : null;
        const m = sel.match(/^\[data-action="([^"]+)"\]$/);
        if (m) return target.dataset.action === m[1] ? target : null;
        return null;
      };
      fire('click', { target });
      await flush();
    },
  };
}

const at = (s = 0) => new Date(Date.UTC(2026, 9, 14, 10, 0, s)).toISOString();
const session = (id: string, state: string, extra: any = {}) => ({ id, project_id: 'p1', engine_id: 'claude', host: 'pty', state, state_at: at(), started_at: at(), title: `task ${id}`, cwd: '/p', last_line: '', ...extra });
const PROJECTS = [{ id: 'p1', name: 'alpha', path: '/p' }, { id: 'p2', name: 'beta', path: '/q' }];
const snapOf = (sessions: any[], extra: any = {}) => ({
  core: { online: true, pid: 1, heartbeat_age_ms: 0 }, projects: PROJECTS, sessions, live: sessions.filter((x) => ['working', 'waiting_for_you'].includes(x.state)),
  approvals: [], needs_you: [], engines: [], limits: [], panes: [], snapshots: [], git: {}, dev_servers: [], watcher_off: [], selected: null, ...extra,
});

test('UI-17 a hide waiting on its undo leaves the palette Agents group', async () => {
  const w = boot();
  await w.snap(snapOf([session('a', 'done'), session('b', 'done')]));
  await w.click({ action: 'hide', id: 'a' });
  const agents = Array.from(w.t.paletteItems() as Array<{ group: string; label: string }>).filter((x) => x.group === 'Agents').map((x) => x.label);
  assert.deepEqual(agents, ['claude task b']);
});

test('UI-20 the git sync label says how far ahead and behind origin the branch is', async () => {
  const w = boot();
  w.t.ui.tab = 'git';
  w.t.ui.split = true;
  await w.snap(snapOf([]));
  const label = (ahead: number, behind: number) => {
    w.t.ui.git = { project: 'p1', at: 1_000_000, branch: 'main', changes: [], staged: [], log: '', ahead, behind };
    w.t.render();
    return (w.el('view').innerHTML.match(/<span class="meta">([^<]*origin)<\/span>/) || [])[1];
  };
  assert.equal(label(3, 1), '3 ahead, 1 behind origin');
  assert.equal(label(2, 0), '2 ahead origin');
  assert.equal(label(0, 4), '4 behind origin');
  assert.equal(label(0, 0), 'up to date with origin');
});

test('UI-21 the empty Hand-back says how to stage and that MetaTrooper never commits', async () => {
  const w = boot({ api: { handback: () => ({ files: [], untracked: [], stat: '', command: '' }) } });
  w.t.ui.tab = 'handback';
  w.t.ui.split = true;
  await w.snap(snapOf([]));
  await w.snap(snapOf([]));
  assert.match(w.el('view').innerHTML, /Nothing staged\. Stage files in the <button class="link" data-action="tab" data-tab="git">Git tab<\/button> or with git add\. MetaTrooper never commits/);
});

test('UI-11 the need-you chip is neutral at 0 and coloured when something needs you', async () => {
  const w = boot();
  await w.snap(snapOf([session('a', 'done')]));
  assert.equal(w.el('needs').classList.contains('zero'), true);
  await w.snap(snapOf([session('a', 'waiting_for_you')]));
  assert.equal(w.el('needs').classList.contains('zero'), false);
  assert.match(src('index.html'), /class="chip needs" id="needs"/);
});

test('UI-05 the title chip, footer and sheet tab each say what they count', async () => {
  const w = boot();
  await w.snap(snapOf([session('a', 'waiting_for_you')]));
  assert.match(w.el('needs').title, /^Counts agents waiting in every project, agent actions waiting for approval and unread Inbox alerts\./);
  assert.match(w.el('strip-needs').innerHTML, /title="Counts agents waiting in every project, agent actions waiting for approval and unread Inbox alerts"/);
  assert.equal(w.el('sheet-tab').title, 'Counts agent actions waiting for approval, in every project');
});

test('UI-03 Alt+J jumps to the longest wait in any project, switching project first', async () => {
  const w = boot();
  const away = session('far', 'waiting_for_you', { project_id: 'p2', state_at: at(1) });
  await w.snap(snapOf([session('near', 'waiting_for_you', { state_at: at(20) })], { live: [session('near', 'waiting_for_you', { state_at: at(20) }), away] }));
  assert.equal(w.t.ui.projectId, 'p1');
  await w.key('j', { altKey: true });
  assert.equal(w.t.ui.projectId, 'p2');
  assert.equal(w.t.ui.pendingPick, 'far');
  await w.snap(snapOf([away], { live: [away] }));
  assert.deepEqual(w.calls.filter((c) => c.method === 'session.focus').map((c) => c.params.session_id), ['far']);

  const here = boot();
  await here.snap(snapOf([session('old', 'waiting_for_you', { state_at: at(1) }), session('new', 'waiting_for_you', { state_at: at(9) })]));
  await here.key('j', { altKey: true });
  assert.equal(here.t.ui.projectId, 'p1');
  assert.deepEqual(here.calls.filter((c) => c.method === 'session.focus').map((c) => c.params.session_id), ['old']);
});

test('UI-04 an approval for another project names the project and agent and jumps there on click', async () => {
  const w = boot();
  const away = session('far', 'waiting_for_you', { project_id: 'p2', title: 'fix login' });
  await w.snap(snapOf([], { live: [away], approvals: [{ id: 'ap1', session_id: 'far', summary: 'run rm', reason: 'shell', created_at: at() }] }));
  const html = w.el('gates').innerHTML;
  assert.match(html, /<button class="link" data-action="pick" data-id="far" title="Jump to this agent">beta: claude · fix login<\/button>/);
  await w.click({ action: 'pick', id: 'far' });
  assert.equal(w.t.ui.projectId, 'p2');
  assert.equal(w.t.ui.pendingPick, 'far');

  const gone = boot();
  await gone.snap(snapOf([], { approvals: [{ id: 'ap1', session_id: 's_raw', summary: 'x', reason: 'y', created_at: at() }] }));
  assert.ok(!gone.el('gates').innerHTML.includes('s_raw'), 'no raw session id');
});

test('UI-10 cut-off text carries its full text in a title: Inbox rows, palette labels, git and diff paths, footer task, list meta', async () => {
  const long = 'x'.repeat(150);
  const path = `src/${'deep/'.repeat(20)}file.ts`;
  const w = boot();
  w.el('inbox').hidden = false;
  const a = session('a', 'waiting_for_you', { title: long, last_line: 'Allow edit?' });
  await w.snap(snapOf([a], { needs_you: [{ id: 'n1', kind: 'failed', text: long, at: at() }] }));
  const inbox = w.el('inbox-list').innerHTML;
  assert.ok(inbox.includes(`title="claude ${long} is asking you`), 'ask row');
  assert.ok(inbox.includes(`title="${long}`), 'needs-you row');
  assert.ok(w.el('list').innerHTML.includes(`<span class="m" title="claude`), 'list meta');
  assert.equal(w.el('strip-info').title, `claude \u00b7 ${long} \u00b7 0 working`);
  await w.key('k', { ctrlKey: true });
  assert.ok(w.el('palette-list').innerHTML.includes(`<span class="lab" title="claude ${long}">`), 'palette label');

  w.t.ui.tab = 'git';
  w.t.ui.split = true;
  w.t.ui.git = { project: 'p1', at: 1_000_000, branch: 'main', changes: [{ code: 'M', path, added: 1, deleted: 0 }], staged: [], log: '', ahead: 0, behind: 0 };
  w.t.render();
  assert.ok(w.el('view').innerHTML.includes(`data-action="git-file" data-file="${path}" title="${path}"`), 'git path');
  assert.match(src('app.js'), /data-action="diff-open" data-id="\$\{esc\(f\.who\.id\)\}" data-file="\$\{esc\(f\.path\)\}" title="\$\{esc\(f\.path\)\}"/);
});

test('UI-13 a blank browser pane shows a New tab title and an empty address bar so its placeholder shows', async () => {
  const w = boot();
  w.t.ui.tab = 'browser';
  w.t.ui.split = true;
  await w.snap(snapOf([], { panes: [{ id: 'bp1', url: 'about:blank' }] }));
  w.t.ui.paneState.bp1 = { kind: 'state', url: 'about:blank', title: 'about:blank' };
  w.t.render();
  const html = w.el('view').innerHTML;
  assert.ok(!html.includes('about:blank'), 'about:blank is never shown');
  assert.match(html, /<span class="nm">New tab<\/span>/);
  assert.match(html, /<input data-key="url" id="pane-url" value="" placeholder="Search, or type a URL/);
});

test('UI-16 the title-bar Restart core runs only on a second click within 3 s', async () => {
  const w = boot();
  await w.snap(snapOf([], { core_mismatch: 'core is older than the app' }));
  const runs = () => w.calls.filter((c) => c.method === 'api.restartCore').length;
  assert.match(w.el('core').innerHTML, />Restart core<\/button>/);
  await w.click({ action: 'restart-core' });
  assert.equal(runs(), 0);
  assert.match(w.el('core').innerHTML, />Click again to restart; open agents stop<\/button>/);
  await w.advance(2999);
  await w.click({ action: 'restart-core' });
  assert.equal(runs(), 1);

  const late = boot();
  await late.snap(snapOf([], { core_mismatch: 'core is older than the app' }));
  await late.click({ action: 'restart-core' });
  await late.advance(3000);
  assert.match(late.el('core').innerHTML, />Restart core<\/button>/, 'label back at 3,000 ms');
  await late.click({ action: 'restart-core' });
  assert.equal(late.calls.filter((c) => c.method === 'api.restartCore').length, 0);
});
