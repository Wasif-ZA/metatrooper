import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = (f: string) => readFileSync(new URL(`../renderer/${f}`, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

function makeEl(id = '', tagName = 'DIV', attrs: Record<string, string> = {}): any {
  const classes = new Set<string>();
  const el: any = {
    id, tagName, hidden: false, innerHTML: '', textContent: '', value: '', dataset: {}, style: { removeProperty() {}, setProperty() {} }, clicks: 0,
    classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c), toggle: (c: string, f?: boolean) => { const on = f ?? !classes.has(c); if (on) classes.add(c); else classes.delete(c); return on; }, [Symbol.iterator]: () => classes.values() },
    addEventListener() {}, append() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, getAttribute: (k: string) => attrs[k] ?? null,
    getClientRects: () => [{}], focus: () => { doc.activeElement = el; }, click: () => { el.clicks++; }, blur() {}, select() {}, scrollIntoView() {},
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, x: 0, y: 0, width: 0, height: 0 }),
  };
  return el;
}
let doc: any;

/** The real app.js against a fake DOM, api, wall and terminal; returns its globals and a keydown driver. */
function boot() {
  const els = new Map<string, any>();
  const listeners: Array<{ type: string; f: (e: any) => void; capture: boolean }> = [];
  doc = {
    body: makeEl('body'), documentElement: makeEl('html'), activeElement: null, hidden: false, fonts: { load: () => Promise.resolve() },
    getElementById: (id: string) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    createElement: (tag: string) => makeEl('', tag.toUpperCase()),
    addEventListener: (type: string, f: (e: any) => void, capture = false) => { listeners.push({ type, f, capture: Boolean(capture) }); },
    querySelector: () => null, querySelectorAll: () => [],
  };
  doc.activeElement = doc.body;
  for (const id of ['palette', 'inbox', 'sinks', 'menu', 'start']) doc.getElementById(id).hidden = true;
  const api = new Proxy({}, {
    get: (_t, name: string) => {
      if (name.startsWith('on')) return () => {};
      if (name === 'call' || name === 'uiSettings') return () => new Promise(() => {});
      return async () => undefined;
    },
  });
  const state = { list: false, sheet: false };
  const wall: any = new Proxy({ setList: (v: boolean) => { state.list = v; }, listOpen: () => state.list, setSheet: (v: boolean) => { state.sheet = v; }, sheetOpen: () => state.sheet, decide: () => null, state: () => ({}) }, { get: (t: any, k: string) => (k in t ? t[k] : () => {}) });
  const termView: any = new Proxy({ state: () => null }, { get: (t: any, k: string) => (k in t ? t[k] : () => {}) });
  const ctx: any = vm.createContext({
    window: { troop: api, addEventListener() {} }, document: doc, location: { search: '' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URLSearchParams, URL, wall, termView, CSS: { escape: (s: string) => s }, matchMedia: () => ({ matches: false }), Date, console,
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
  });
  vm.runInContext(`${src('diff.js')}\n${src('browser-chrome.js')}\n${src('app.js')}\nthis.ui = ui; this.browserChrome = browserChrome;`, ctx);
  const key = async (k: string, mods: any = {}) => {
    let prevented = false;
    const ev = { key: k, code: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, preventDefault() { prevented = true; }, stopPropagation() {}, stopImmediatePropagation() {}, target: doc.activeElement, ...mods };
    for (const capture of [true, false]) for (const l of listeners) if (l.type === 'keydown' && l.capture === capture) l.f(ev);
    await flush();
    return prevented;
  };
  return { ctx, state, key, el: (id: string) => doc.getElementById(id) };
}

/** terminal.js with a fake xterm; `overlay` stands in for app.js's overlayOpen(). */
function tile(overlay: () => boolean) {
  let handler: (e: any) => boolean = () => true;
  const sent: string[] = [];
  const part = makeEl('part');
  const el = makeEl('tile');
  el.querySelector = () => part;
  class Terminal { options: any = {}; cols = 80; rows = 24; loadAddon() {} open() {} onData() {} write() {} focus() {} registerLinkProvider() {} attachCustomKeyEventHandler(f: any) { handler = f; } hasSelection() { return false; } }
  const troop = { onTerm() {}, termInput: (_id: string, d: string) => { sent.push(d); }, termAttach: async () => ({}), termDetach: async () => {}, readText: async () => '' };
  const ctx = vm.createContext({
    window: { troop, Terminal, FitAddon: { FitAddon: class { fit() {} } } }, overlayOpen: overlay,
    document: { getElementById: () => makeEl('centre'), createElement: () => el }, ResizeObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 0, clearTimeout() {}, performance,
  });
  vm.runInContext(`${src('terminal.js')}\nthis.termView = termView;`, ctx);
  (ctx as any).termView.show({ mode: 'single', selected: 'a', sessions: [{ id: 'a', state: 'done', task: 'x', engine_id: 'claude' }] });
  return (e: any) => handler({ type: 'keydown', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, preventDefault() {}, ...e });
}

test('UI-01: Esc in a tile stays out of the agent while an overlay is open, and the overlay closes', async () => {
  let open = true;
  const key = tile(() => open);
  assert.equal(key({ key: 'Escape' }), false);
  open = false;
  assert.equal(key({ key: 'Escape' }), true, 'with nothing open Esc reaches the agent');

  const w = boot();
  const term = makeEl('', 'TEXTAREA');
  term.classList.add('xterm-helper-textarea');
  assert.equal(w.ctx.overlayOpen(), false);
  w.state.sheet = true; w.state.list = true;
  assert.equal(w.ctx.overlayOpen(), true);
  doc.activeElement = term;
  await w.key('Escape');
  assert.equal(w.state.sheet, false, 'sheet closes first');
  await w.key('Escape');
  assert.equal(w.state.list, false, 'then the list');
  w.ctx.ui.split = true;
  assert.equal(w.ctx.overlayOpen(), false, 'a side panel, which an agent can open, keeps Esc for the agent');

  w.state.list = true;
  doc.activeElement = makeEl('', 'TEXTAREA');
  await w.key('Escape');
  assert.equal(w.state.list, true, 'Esc in a real text box leaves the list alone');
});

test('UI-06: the approval sheet tab is a focusable button that Enter and Space press', async () => {
  assert.match(src('index.html'), /id="sheet-tab" data-action="sheet" role="button" tabindex="0"/);
  const w = boot();
  const tab = makeEl('sheet-tab', 'DIV', { role: 'button' });
  doc.activeElement = tab;
  assert.equal(await w.key('Enter'), true);
  assert.equal(await w.key(' '), true);
  assert.equal(tab.clicks, 2);
});

test('UI-07: menu items and list rows take focus, arrows move between them, Enter picks, Esc closes the menu', async () => {
  const w = boot();
  w.ctx.ui.snap = { engines: [{ id: 'claude' }], projects: [], sessions: [] };
  w.ctx.ui.shellKinds = [{ kind: 'pwsh', label: 'pwsh' }];
  await w.ctx.onClick({ target: Object.assign(makeEl('', 'BUTTON'), { closest: (s: string) => (s === '[data-action]' ? { dataset: { action: 'launch-menu' }, closest: () => null, getBoundingClientRect: () => ({ right: 300, bottom: 20 }) } : null) }), stopPropagation() {} });
  const items = w.el('menu').innerHTML.match(/<div class="item"[^>]*>/g)!;
  assert.equal(items.length, 2);
  for (const i of items) assert.match(i, /role="menuitem" tabindex="-1"/);
  assert.match(w.ctx.rowHtml({ id: 's1', engine_id: 'claude', state: 'done', state_at: new Date().toISOString(), title: 't' }, true), /class="li srow sel" role="option" tabindex="0" aria-selected="true"/);
  assert.match(src('style.css'), /\.alist \.li:focus-within \.hide \{ visibility: visible; \}|\.alist \.li:focus-within \.hide[,\s]/);

  const box = makeEl('menu');
  const [a, b, c] = ['a', 'b', 'c'].map(() => makeEl('', 'DIV', { role: 'menuitem' }));
  c.getClientRects = () => [];
  box.querySelectorAll = () => [a, b, c];
  for (const x of [a, b, c]) x.closest = () => box;
  doc.activeElement = a;
  await w.key('ArrowDown');
  assert.equal(doc.activeElement, b);
  await w.key('ArrowDown');
  assert.equal(doc.activeElement, b, 'a hidden item is skipped');
  await w.key('ArrowUp');
  assert.equal(doc.activeElement, a);
  await w.key('Enter');
  assert.equal(a.clicks, 1);

  w.el('menu').hidden = false;
  assert.equal(w.ctx.overlayOpen(), true);
  await w.key('Escape');
  assert.equal(w.el('menu').hidden, true);
});

test('UI-08: the project remove and browser tab close are real buttons with labels, none nested in another button', () => {
  const w = boot();
  w.ctx.ui.snap = { live: [] };
  assert.match(w.ctx.projectMenuItem({ id: 'p1', name: 'proj', path: 'C:/p' }), /<button class="dismiss" data-action="project-hide" data-id="p1" [^>]*aria-label="Remove proj from this menu">/);
  const html: string = w.ctx.browserChrome.tabs([{ id: 'a', title: 'A', url: 'u', dot: 'ok' }, { id: 'b', title: 'B', url: 'u', dot: 'ok' }], 'a', 0);
  assert.match(html, /<button class="x" data-action="pane-close" data-id="a" title="Close pane" aria-label="Close pane">/);
  let depth = 0;
  for (const m of html.matchAll(/<(\/?)button\b/g)) { depth += m[1] ? -1 : 1; assert.ok(depth <= 1, 'a button inside a button'); }
});

test('UI-09: footer tabs and the project picker get a focus ring that beats all: unset', () => {
  assert.match(src('style.css'), /\.strip \.stab:focus-visible, \.title \.kpick:focus-visible \{ outline: 2px solid var\(--ink\)/);
});
