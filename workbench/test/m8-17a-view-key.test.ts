import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = (f: string) => readFileSync(new URL(`../renderer/${f}`, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

function makeEl(id = '', tagName = 'DIV'): any {
  const classes = new Set<string>();
  const el: any = {
    id, tagName, hidden: false, innerHTML: '', textContent: '', value: '', className: '', title: '', dataset: {}, children: [] as any[], parent: null,
    style: { removeProperty() {}, setProperty() {} },
    classList: {
      [Symbol.iterator]: () => classes.values(),
      add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c),
      toggle: (c: string, force?: boolean) => { const on = force === undefined ? !classes.has(c) : force; if (on) classes.add(c); else classes.delete(c); return on; },
    },
    append: (...kids: any[]) => { for (const k of kids) if (typeof k === 'object') { k.parent = el; el.children.push(k); } },
    remove() {}, contains: () => false, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, select() {}, scrollIntoView() {}, setSelectionRange() {},
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, x: 0, y: 0, width: 0, height: 0 }),
  };
  return el;
}

/** Runs the real diff.js, browser-chrome.js and app.js against fake DOM; home.js is not loaded, so homeView is a recording stub. */
function boot() {
  const els = new Map<string, any>();
  const docListeners: Array<{ type: string; f: (e: any) => void; capture: boolean }> = [];
  const d: any = {
    body: makeEl('body'), documentElement: makeEl('html'), activeElement: null, hidden: false, fonts: { load: () => Promise.resolve() },
    getElementById: (id: string) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    createElement: (tag: string) => makeEl('', tag.toUpperCase()),
    addEventListener: (type: string, f: (e: any) => void, capture = false) => { docListeners.push({ type, f, capture: Boolean(capture) }); },
    querySelector: () => null, querySelectorAll: () => [],
  };
  d.activeElement = d.body;
  for (const id of ['palette', 'inbox', 'sinks', 'menu', 'start']) d.getElementById(id).hidden = true;
  const handlers: Record<string, (...a: any[]) => any> = {};
  const api = new Proxy({}, {
    get: (_t, name: string) => {
      if (name.startsWith('on')) return (f: (...a: any[]) => any) => { handlers[name] = f; };
      if (name === 'call') return async (method: string) => ({ kind: 'ok', reply: { result: method === 'shell.list' ? { shells: [] } : {} } });
      if (name === 'git') return async () => ({ branch: 'main', changes: [], staged: [], log: '', ahead: 0, behind: 0 });
      if (name === 'uiSettings') return async () => ({ theme: {}, ui: { toast_ms: 3500, error_toast_ms: 7000, layout: {} }, terminal: { git_every_ms: 10000, scrollback: 1000, font_size: 13 }, themes: [] });
      return async () => undefined;
    },
  });
  const loose = (o: any) => new Proxy(o, { get: (t: any, k: string) => (k in t ? t[k] : () => {}) });
  const wall: any = loose({ listOpen: () => false, sheetOpen: () => false, decide: (s: any[]) => (s[0] ? s[0].id : null), state: () => ({}), big: () => null, isBig: () => false, toggleOpen: () => false });
  const termView: any = loose({ state: () => null });
  const views: string[] = [];
  const ctx: any = {
    window: { troop: api, addEventListener() {} }, document: d, location: { search: '' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URLSearchParams, URL, wall, termView, settingsView: { open() {}, close: () => false, isOpen: () => false }, CSS: { escape: (s: string) => s },
    matchMedia: () => ({ matches: false }), console, MutationObserver: class { observe() {} },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 0,
  };
  ctx.global = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${src('diff.js')}\n${src('browser-chrome.js')}\n${src('app.js')}\nthis.t = { ui, KEYS };`, ctx);
  const t = ctx.t;
  ctx.homeView = { draw() {}, set: (v: string) => { views.push(v); t.ui.view = v; } };
  return {
    t, views,
    snap: async (s: any) => { await handlers.onSnapshot(s); await flush(); },
    /** Returns the event so a test can read defaultPrevented and whether propagation was stopped. */
    key: async (key: string, mods: any = {}) => {
      const ev: any = { defaultPrevented: false, stopped: false, key, code: `Key${key.toUpperCase()}`, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, target: d.activeElement, ...mods };
      ev.preventDefault = () => { ev.defaultPrevented = true; };
      ev.stopPropagation = () => { ev.stopped = true; };
      ev.stopImmediatePropagation = () => { ev.stopped = true; };
      for (const capture of [true, false]) for (const l of docListeners) if (l.type === 'keydown' && l.capture === capture && !ev.stopped) l.f(ev);
      await flush();
      return ev;
    },
  };
}

const snapOf = () => ({
  core: { online: true, pid: 1, heartbeat_age_ms: 0 }, projects: [{ id: 'p1', name: 'p', path: '/p' }], sessions: [], live: [],
  approvals: [], needs_you: [], engines: [], limits: [], panes: [], snapshots: [], git: {}, dev_servers: [], watcher_off: [], selected: null,
});
const V = { ctrlKey: true, altKey: true };
const start = async (view: string) => { const w = boot(); await w.snap(snapOf()); w.t.ui.view = view; w.views.length = 0; return w; };

test('M8-17a Ctrl+Alt+V goes from the Wall to the IDE and back', async () => {
  // protects=the one-key switch between the IDE and the Wall
  // fails_when=the key does nothing, only goes one way, or sets the wrong view
  const w = await start('wall');
  await w.key('v', V);
  assert.equal(w.t.ui.view, 'ide');
  await w.key('v', V);
  assert.equal(w.t.ui.view, 'wall');
});

test('M8-17a Ctrl+Alt+V from home goes to the Wall', async () => {
  // protects=the key from any non-wall view lands on the Wall
  // fails_when=home is treated as the IDE side and the key goes to ide
  const w = await start('home');
  await w.key('v', V);
  assert.equal(w.t.ui.view, 'wall');
});

test('M8-17a Ctrl+Alt+Shift+V and Ctrl+V leave the view alone', async () => {
  // protects=other chords keep their own meaning
  // fails_when=a Shift or missing Alt still switches the view
  const w = await start('wall');
  const a = await w.key('v', { ...V, shiftKey: true });
  const b = await w.key('v', { ctrlKey: true });
  const c = await w.key('v', { altKey: true });
  const m = await w.key('v', { ...V, metaKey: true });
  assert.deepEqual(w.views, []);
  assert.equal(w.t.ui.view, 'wall');
  assert.deepEqual([a, b, c, m].map((e) => e.defaultPrevented), [false, false, false, false]);
});

test('M8-17a Ctrl+Alt+W still toggles the watch layout and does not change the view', async () => {
  // protects=decision #27: W stays the watch layout
  // fails_when=W changes ui.view, or stops toggling ui.watch
  const w = await start('wall');
  const before = w.t.ui.watch;
  await w.key('w', V);
  assert.notEqual(w.t.ui.watch, before);
  assert.equal(w.t.ui.view, 'wall');
  assert.deepEqual(w.views, []);
});

test('M8-17a Ctrl+Alt+V is consumed so a terminal or editor does not also get it', async () => {
  // protects=the chord is not typed into the focused terminal or editor
  // fails_when=the default is not prevented or the event keeps propagating
  const w = await start('wall');
  const ev = await w.key('v', V);
  assert.equal(ev.defaultPrevented, true);
  assert.equal(ev.stopped, true);
});

test('M8-17a the keys sheet lists Ctrl+Alt+V right after Ctrl+Alt+W', () => {
  // protects=the key is discoverable in the keys sheet
  // fails_when=the row is missing, reworded or out of place
  const w = boot();
  const keys: any[] = w.t.KEYS;
  const i = keys.findIndex((k) => k.keys === 'Ctrl+Alt+W');
  assert.equal(keys[i + 1].keys, 'Ctrl+Alt+V');
  assert.equal(keys[i + 1].does, 'Switch between the IDE and the Wall');
});
