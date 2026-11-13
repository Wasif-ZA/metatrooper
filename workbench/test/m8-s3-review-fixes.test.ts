import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The VM and finder harness is reused from m8-s3-ide-find.test.ts.
const source = (name: string) => readFileSync(new URL('../renderer/' + name, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const at = '2026-11-10T00:00:00.000Z';
const session = (id: string, state: string, extra: any = {}) => ({
  id, state, project_id: 'p1', engine_id: 'synthetic', host: 'pty', title: 'Task ' + id,
  cwd: '/synthetic', state_at: at, started_at: at, last_line: '', ...extra,
});
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
  let ready = false;
  const api = new Proxy({}, { get(_target, name: string) {
    if (name.startsWith('on')) return () => {};
    if (name === 'uiSettings' && (!ready || !(name in overrides))) return () => new Promise(() => {});
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
  for (const name of ['diff.js', 'browser-chrome.js', 'app.js', 'home.js']) vm.runInContext(source(name), context, { filename: name });
  vm.runInContext('globalThis.state = ui;', context);
  for (const fn of domReady) fn();
  await flush();
  ready = true;
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


function control(h: any, id: string, key: string, value: string, tag = 'button') {
  const found = controls(h.el(id).innerHTML, tag).find((b) => b.dataset[key] === value);
  assert.ok(found, 'rendered ' + tag + ' with ' + key + '=' + value);
  return found;
}


const plain = (value: any) => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve: (value: any) => void = () => {};
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

// Home and inbox controls are replaced on each innerHTML assignment.
function mountControls(h: any, id: string) {
  const host = h.el(id);
  let html = host.innerHTML;
  let nodes: any[] = [];
  Object.defineProperty(host, 'innerHTML', {
    get: () => html,
    set(value: string) {
      if (nodes.includes(h.document.activeElement)) h.document.activeElement = null;
      html = value;
      nodes = ['button', 'input', 'textarea', 'select', 'div'].flatMap((tag) => controls(html, tag));
      for (const node of nodes) {
        node.focus = () => { h.document.activeElement = node; };
        node.closest = (selector: string) => selector === 'input, textarea, select'
          ? (['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName) ? node : null)
          : selector === 'button' && node.tagName === 'BUTTON' ? node : null;
        if (node.tagName === 'SELECT') {
          const body = html.match(new RegExp('<select[^>]*data-key="' + node.dataset.key + '"[^>]*>([\\s\\S]*?)</select>'))?.[1] || '';
          const options = [...body.matchAll(/<option\b([^>]*)>/g)];
          const chosen = options.find((o) => /\bselected\b/.test(o[1])) || options[0];
          node.value = chosen?.[1].match(/value="([^"]*)"/)?.[1] || '';
        }
      }
    },
  });
  host.contains = (node: any) => nodes.includes(node);
  host.querySelectorAll = (selector: string) => selector === '[data-key]' ? nodes.filter((n) => n.dataset.key)
    : selector === '.irow' ? nodes.filter((n) => (n.class || '').split(' ').includes('irow')) : [];
  host.querySelector = (selector: string) => nodes.find((n) => n.dataset.key === selector.match(/^\[data-key="([^"]+)"\]$/)?.[1]) || null;
  host.innerHTML = html;
  return host;
}

for (const action of ['pick', 'selectShell']) {
  for (const view of ['home', 'ide', 'inbox', 'addons']) {
    test(action + ' saves wall before rendering from ' + view, async (t) => {
      const h = await boot(t);
      h.ui.view = view;
      h.w.trace = [];
      vm.runInContext("const originalSave = save; save = (key, value) => { if (key === 'view') trace.push(['save', key, value, ui.view]); originalSave(key, value); }; render = () => trace.push(['render', ui.view]);", h.w);
      await h.w[action]('synthetic-id');
      assert.equal(h.ui.view, 'wall');
      assert.deepEqual(plain(h.w.trace), [['save', 'view', 'wall', 'wall'], ['render', 'wall']]);
      if (action === 'pick') assert.equal(h.ui.localSel, 'synthetic-id');
      else assert.equal(h.ui.shellSel, 'synthetic-id');
    });
  }
  test(action + ' does not save view when already on wall', async (t) => {
    const h = await boot(t);
    h.ui.view = 'wall';
    h.w.trace = [];
    vm.runInContext("const originalSave = save; save = (key, value) => { if (key === 'view') trace.push(['save', key, value]); originalSave(key, value); }; render = () => trace.push(['render', ui.view]);", h.w);
    await h.w[action]('synthetic-id');
    assert.equal(h.ui.view, 'wall');
    assert.deepEqual(plain(h.w.trace), [['render', 'wall']]);
  });
}

test('Home task and engine drafts survive a snapshot redraw as replacement control values', async (t) => {
  const h = await boot(t);
  const host = mountControls(h, 'home');
  h.ui.snap = snapshot({
    engines: [{ id: 'green-engine', light: 'green' }, { id: 'yellow-engine', light: 'yellow' }],
    sessions: [session('other-agent', 'working', { last_line: 'Initial line' })],
  });
  h.ui.view = 'home';
  h.w.homeView.draw();
  const task = host.querySelector('[data-key="home-task"]');
  const engine = host.querySelector('[data-key="home-engine"]');
  assert.equal(task.tagName, 'TEXTAREA');
  assert.equal(engine.tagName, 'SELECT');
  task.value = '  Keep this synthetic task.\nSecond line.  ';
  await h.fire('home', 'input', task);
  assert.equal(h.ui.drafts['home-task'], '  Keep this synthetic task.\nSecond line.  ');
  engine.value = 'yellow-engine';
  await h.fire('home', 'change', engine);
  assert.equal(h.ui.drafts['home-engine'], 'yellow-engine');
  h.ui.snap = { ...h.ui.snap, sessions: [session('other-agent', 'working', { last_line: 'New snapshot line' })] };
  h.w.homeView.draw();
  assert.match(host.innerHTML, /New snapshot line/);
  assert.notEqual(host.querySelector('[data-key="home-task"]'), task);
  assert.notEqual(host.querySelector('[data-key="home-engine"]'), engine);
  assert.equal(host.querySelector('[data-key="home-task"]').value, '  Keep this synthetic task.\nSecond line.  ');
  assert.equal(host.querySelector('[data-key="home-engine"]').value, 'yellow-engine');
});

