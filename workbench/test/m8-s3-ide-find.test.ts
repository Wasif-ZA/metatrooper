import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = (name: string) => readFileSync(new URL('../renderer/' + name, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
function snapshot(extra: any = {}) {
  return {
    core: { online: true, pid: 1, heartbeat_age_ms: 0 },
    projects: [{ id: 'p1', name: 'Alpha', path: '/synthetic/alpha' }, { id: 'p2', name: 'Beta', path: '/synthetic/beta' }],
    sessions: [], live: [], approvals: [], needs_you: [], engines: [], limits: [], panes: [], snapshots: [],
    git: {}, dev_servers: [], watcher_off: [], selected: null, ...extra,
  };
}
function element(id = '', tagName = 'DIV'): any {
  const listeners: Record<string, Function[]> = {};
  const attrs: Record<string, string> = {};
  const classes = new Set<string>();
  const el: any = {
    id, tagName, hidden: false, innerHTML: '', textContent: '', value: '', dataset: {}, children: [], listeners,
    style: { removeProperty() {}, setProperty() {} },
    classList: {
      [Symbol.iterator]: () => classes.values(),
      add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c),
      toggle(c: string, force?: boolean) { const on = force ?? !classes.has(c); if (on) classes.add(c); else classes.delete(c); return on; },
    },
    setAttribute: (k: string, v: any) => { attrs[k] = String(v); }, getAttribute: (k: string) => attrs[k] ?? null,
    addEventListener: (kind: string, fn: Function) => { (listeners[kind] ||= []).push(fn); },
    append: (...children: any[]) => el.children.push(...children), remove() {}, contains: () => false,
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, select() {}, scrollIntoView() {}, setSelectionRange() {},
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, x: 0, y: 0, width: 0, height: 0 }),
  };
  return el;
}

// Events use attributes taken from controls rendered by the real scripts.
function controls(html: string, tag = 'button'): any[] {
  const matches = [...html.matchAll(new RegExp('<' + tag + '\\b([^>]*)>', 'g'))];
  return matches.map((m) => {
    const el = element('', tag.toUpperCase());
    for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) {
      const value = a[2].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      el.setAttribute(a[1], value);
      if (a[1].startsWith('data-')) el.dataset[a[1].slice(5).replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())] = value;
      else el[a[1]] = value;
    }
    el.closest = (selector: string) => selector === 'button' && tag === 'button' || selector === '[data-filter]' && 'filter' in el.dataset ? el : null;
    return el;
  });
}

async function boot(t: any, overrides: Record<string, Function> = {}) {
  const els = new Map<string, any>();
  const domReady: Function[] = [];
  const docListeners: Record<string, Function[]> = {};
  const el = (id: string) => {
    if (!els.has(id)) {
      const node = element(id);
      node.focus = () => { document.activeElement = node; };
      if (id === 'ide') {
        let html = '';
        Object.defineProperty(node, 'innerHTML', {
          get: () => html,
          set: (value: string) => {
            html = value;
            const old = els.get('ide-find');
            if (document.activeElement === old) document.activeElement = null;
            els.delete('ide-find');
            const input = controls(html, 'input').find((x) => x.id === 'ide-find');
            if (input) {
              input.focus = () => { document.activeElement = input; };
              els.set('ide-find', input);
            }
          },
        });
      }
      els.set(id, node);
    }
    return els.get(id);
  };
  const document = {
    body: element('body'), documentElement: element('html'), activeElement: null as any,
    fonts: { load: async () => [] }, getElementById: (id: string) => id === 'ide-find' ? els.get(id) || null : el(id), createElement: (tag: string) => element('', tag.toUpperCase()),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (kind: string, fn: Function) => { if (kind === 'DOMContentLoaded') domReady.push(fn); else (docListeners[kind] ||= []).push(fn); },
  };
  for (const id of ['palette', 'inbox', 'sinks', 'menu', 'start', 'settings']) el(id).hidden = true;
  const calls: any[] = [];
  const settings = { sessions: { approval: 'ask', metarouter: false }, terminal: { font_size: 13, scrollback: 10000 }, agent_cursor: { show_caption: true } };
  const api = new Proxy({}, { get(_target, name: string) {
    if (name.startsWith('on')) return () => {};
    if (name === 'uiSettings') return () => new Promise(() => {});
    return async (...args: any[]) => {
      calls.push([name, ...args]);
      if (name in overrides) return overrides[name](...args);
      if (name === 'call') return { kind: 'ok', reply: { result: { shells: [] } } };
      if (name === 'settingsPage') return settings;
      if (name === 'fsList') return [];
      if (name === 'fsRead') return { text: 'first\nsecond\n' };
      return {};
    };
  } });
  const wall = new Proxy({ decide: () => null, state: () => ({}), big: () => null, isBig: () => false }, { get: (o: any, k: string) => o[k] || (() => {}) });
  const termView = new Proxy({}, { get: () => () => {} });
  const context = vm.createContext({
    window: { troop: api, addEventListener() {} }, document, location: { search: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URLSearchParams, URL, console, wall, termView, CSS: { escape: (s: string) => s }, matchMedia: () => ({ matches: false }),
    MutationObserver: class { observe() {} }, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
  });
  for (const name of ['diff.js', 'browser-chrome.js', 'app.js', 'home.js', 'inbox.js', 'ide.js', 'settings.js']) vm.runInContext(source(name), context, { filename: name });
  vm.runInContext('globalThis.state = ui;', context);
  for (const fn of domReady) fn();
  await flush();
  const w: any = context;
  w.state.snap = snapshot();
  w.state.projectId = 'p1';
  const fire = async (id: string, kind: string, target: any, extra: any = {}) => {
    assert.ok(target, 'rendered event target exists');
    const event = { target, preventDefault() {}, stopPropagation() {}, ...extra };
    for (const fn of (id === 'document' ? docListeners[kind] : el(id).listeners[kind]) || []) await fn(event);
    await flush();
  };
  t.after(() => { w.state.snap = null; });
  return { w, ui: w.state, el, calls, fire, document }; 
}

function input(h: any) {
  const field = h.document.getElementById('ide-find');
  assert.ok(field, 'rendered finder input exists');
  assert.equal(field.tagName, 'INPUT');
  return field;
}
function rows(h: any) {
  return controls(h.el('ide').innerHTML).filter((b) => 'file' in b.dataset).map((b) => b.dataset.file);
}
async function type(h: any, value: string) {
  const field = input(h);
  field.focus();
  field.value = value;
  await h.fire('ide', 'input', field);
}
async function show(t: any, overrides: Record<string, Function> = {}) {
  const h = await boot(t, { fsList: () => [{ name: 'tree.txt', dir: false }], fsFind: () => [], ...overrides });
  h.ui.view = 'ide';
  await h.w.ideView.draw();
  assert.equal(h.el('ide').hidden, false);
  input(h);
  return h;
}

test('finder sends the project and exact typed text and replaces the tree with ordered rows', async (t) => {
  const h = await show(t, { fsFind: () => ['src/cart/total.js', 'test/total.test.js'] });
  assert.deepEqual(rows(h), ['tree.txt']);
  await type(h, ' ToTaL cart ');
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsFind'), [['fsFind', 'p1', ' ToTaL cart ']]);
  assert.deepEqual(rows(h), ['src/cart/total.js', 'test/total.test.js']);
  assert.match(h.el('ide').innerHTML, /<span>total.js<em>src\/cart<\/em><\/span>/);
  assert.match(h.el('ide').innerHTML, /<span>total.test.js<em>test<\/em><\/span>/);
});

test('no search results shows the literal empty message', async (t) => {
  const h = await show(t);
  await type(h, 'absent');
  assert.deepEqual(rows(h), []);
  assert.match(h.el('ide').innerHTML, />No file matches\.<\/p>/);
});

test('clearing the finder restores the tree without another search', async (t) => {
  const h = await show(t, { fsFind: () => ['src/total.js'] });
  await type(h, 'total');
  await type(h, '');
  assert.deepEqual(rows(h), ['tree.txt']);
  assert.equal(input(h).value, '');
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsFind'), [['fsFind', 'p1', 'total']]);
  assert.doesNotMatch(h.el('ide').innerHTML, /No file matches/);
});

test('an older slow answer cannot replace a newer search', async (t) => {
  let release: any;
  const old = new Promise((resolve) => { release = resolve; });
  const h = await show(t, { fsFind: (_pid: string, q: string) => q === 'old' ? old : ['src/new.js'] });
  const pending = type(h, 'old');
  await type(h, 'new');
  assert.deepEqual(rows(h), ['src/new.js']);
  release(['src/old.js']);
  await pending;
  assert.deepEqual(rows(h), ['src/new.js']);
  assert.equal(input(h).value, 'new');
});

test('a pending answer cannot restore results after clearing the input', async (t) => {
  let release: any;
  const response = new Promise((resolve) => { release = resolve; });
  const h = await show(t, { fsFind: () => response });
  const pending = type(h, 'old');
  await type(h, '');
  release(['src/old.js']);
  await pending;
  assert.deepEqual(rows(h), ['tree.txt']);
  assert.equal(input(h).value, '');
});

test('Enter opens only the first search result in the current project', async (t) => {
  const h = await show(t, { fsFind: () => ['src/first.js', 'src/second.js'] });
  await type(h, 'src');
  await h.fire('ide', 'keydown', input(h), { key: 'Enter' });
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsRead'), [['fsRead', 'p1', 'src/first.js']]);
});

test('Enter with no results does not read a file', async (t) => {
  const h = await show(t);
  await type(h, 'absent');
  await h.fire('ide', 'keydown', input(h), { key: 'Enter' });
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsRead'), []);
});

test('Escape clears text and restores the tree without another search', async (t) => {
  const h = await show(t, { fsFind: () => ['src/total.js'] });
  await type(h, 'total');
  await h.fire('ide', 'keydown', input(h), { key: 'Escape' });
  assert.equal(input(h).value, '');
  assert.deepEqual(rows(h), ['tree.txt']);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsFind'), [['fsFind', 'p1', 'total']]);
});

test('Ctrl+P focuses the finder and prevents default while the IDE is shown', async (t) => {
  const h = await show(t);
  let prevented = 0;
  await h.fire('document', 'keydown', h.document.body, { key: 'p', ctrlKey: true, preventDefault() { prevented++; } });
  assert.equal(prevented, 1);
  assert.equal(h.document.activeElement, input(h));
});

test('Ctrl+P does nothing in another view or without an open project', async (t) => {
  const h = await show(t);
  let prevented = 0;
  h.ui.view = 'home';
  await h.w.ideView.draw();
  h.document.body.focus = () => { h.document.activeElement = h.document.body; };
  h.document.body.focus();
  await h.fire('document', 'keydown', h.document.body, { key: 'p', ctrlKey: true, preventDefault() { prevented++; } });
  assert.equal(h.el('ide').hidden, true);
  assert.equal(prevented, 0);
  assert.equal(h.document.activeElement, h.document.body);
  h.ui.view = 'ide';
  h.ui.projectId = 'missing';
  await h.w.ideView.draw();
  await h.fire('document', 'keydown', h.document.body, { key: 'p', ctrlKey: true, preventDefault() { prevented++; } });
  assert.equal(h.el('ide').hidden, true);
  assert.equal(prevented, 0);
  assert.equal(h.document.activeElement, h.document.body);
});

test('typing keeps focus on the replacement input after every result redraw', async (t) => {
  const h = await show(t, { fsFind: () => ['src/total.js'] });
  const before = input(h);
  await type(h, 't');
  assert.notEqual(input(h), before);
  assert.equal(h.document.activeElement, input(h));
  assert.equal(input(h).value, 't');
  const second = input(h);
  await type(h, 'to');
  assert.notEqual(input(h), second);
  assert.equal(h.document.activeElement, input(h));
  assert.equal(input(h).value, 'to');
});

test('result paths escape HTML in attributes file names and folders', async (t) => {
  const h = await show(t, { fsFind: () => ['dir<&/file">&\'.js', 'src/<img src=x onerror=1>.js'] });
  await type(h, 'file');
  const html = h.el('ide').innerHTML;
  assert.deepEqual(rows(h), ['dir<&/file">&\'.js', 'src/<img src=x onerror=1>.js']);
  assert.ok(html.includes('data-file="dir&lt;&amp;/file&quot;&gt;&amp;&#39;.js"'));
  assert.ok(html.includes('<span>file&quot;&gt;&amp;&#39;.js<em>dir&lt;&amp;</em></span>'));
  assert.ok(html.includes('data-file="src/&lt;img src=x onerror=1&gt;.js"'));
  assert.ok(html.includes('<span>&lt;img src=x onerror=1&gt;.js<em>src</em></span>'));
  assert.doesNotMatch(html, /<img\b|data-file="dir<&/);
});
