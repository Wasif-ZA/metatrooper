import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

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
// The VM and fake DOM harness is copied from m8-s3-views.test.ts.
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
    if (/\bdata-home-start(?:\s|$)/.test(m[1])) el.setAttribute('data-home-start', '');
    el.closest = (selector: string) => selector === '[data-home-start]' && el.getAttribute('data-home-start') !== null ? el : selector === 'button' && tag === 'button' || selector === '[data-filter]' && 'filter' in el.dataset ? el : null;
    return el;
  });
}

async function boot(t: any, overrides: Record<string, Function> = {}) {
  const els = new Map<string, any>();
  const domReady: Function[] = [];
  const el = (id: string) => { if (!els.has(id)) els.set(id, element(id)); return els.get(id); };
  const document = {
    body: element('body'), documentElement: element('html'), activeElement: null,
    fonts: { load: async () => [] }, getElementById: el, createElement: (tag: string) => element('', tag.toUpperCase()),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (kind: string, fn: Function) => { if (kind === 'DOMContentLoaded') domReady.push(fn); },
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
  const fire = async (id: string, kind: string, target: any) => {
    assert.ok(target, 'rendered event target exists');
    for (const fn of el(id).listeners[kind] || []) await fn({ target, preventDefault() {} });
    await flush();
  };
  t.after(() => { w.state.snap = null; });
  return { w, ui: w.state, el, calls, fire };
}
function control(h: any, id: string, key: string, value: string, tag = 'button') {
  const found = controls(h.el(id).innerHTML, tag).find((b) => b.dataset[key] === value);
  assert.ok(found, 'rendered ' + tag + ' with ' + key + '=' + value);
  return found;
}

function homeFields(h: any) {
  const task = control(h, 'home', 'key', 'home-task', 'textarea');
  const engine = control(h, 'home', 'key', 'home-engine', 'select');
  const start = controls(h.el('home').innerHTML).find((b) => b.getAttribute('data-home-start') !== null);
  assert.ok(start, 'rendered start button');
  h.el('home').querySelector = (selector: string) => {
    if (selector === '[data-key="home-task"]') return task;
    if (selector === '[data-key="home-engine"]') return engine;
    return null;
  };
  return { task, engine, start };
}

async function home(t: any, reply: any = { result: { session_id: 'launched-7' } }) {
  const h = await boot(t, { call: (method: string) => ({ kind: 'ok', reply: method === 'session.launch' ? reply : { result: { shells: [] } } }) });
  h.calls.length = 0;
  h.ui.snap.engines = [{ id: 'green-engine', light: 'green' }, { id: 'red-engine', light: 'red' }, { id: 'yellow-engine', light: 'yellow' }];
  h.ui.view = 'home';
  h.w.homeView.draw();
  h.w.picks = [];
  h.w.saves = [];
  vm.runInContext('pick = async (id) => { picks.push(id); }; const originalSave = save; save = (key, value) => { saves.push([key, value]); originalSave(key, value); };', h.w);
  return { ...h, ...homeFields(h) };
}

const plain = (value: any) => JSON.parse(JSON.stringify(value));

test('Home renders the task, ready engines and start button inside home', async (t) => {
  const h = await home(t);
  assert.equal(h.el('home').hidden, false);
  assert.equal(h.task.tagName, 'TEXTAREA');
  assert.equal(h.task.dataset.key, 'home-task');
  assert.equal(h.engine.tagName, 'SELECT');
  assert.equal(h.engine.dataset.key, 'home-engine');
  const select = h.el('home').innerHTML.match(/<select\b[^>]*data-key="home-engine"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(select);
  assert.deepEqual([...select[1].matchAll(/<option\b[^>]*value="([^"]*)"/g)].map((m) => m[1]), ['green-engine', 'yellow-engine']);
  assert.equal(h.start.tagName, 'BUTTON');
  assert.equal(h.start.getAttribute('data-home-start'), '');
});

for (const engines of [[], [{ id: 'blocked-engine', light: 'red' }]]) {
  test('Home has no start box with ' + (engines.length ? 'only red engines' : 'no engines'), async (t) => {
    const h = await boot(t);
    h.ui.view = 'home';
    h.ui.snap.engines = engines;
    h.w.homeView.draw();
    assert.equal(h.el('home').hidden, false);
    assert.doesNotMatch(h.el('home').innerHTML, /data-key="home-task"|data-key="home-engine"|data-home-start/);
  });
}

test('Home start box is hidden outside the home view', async (t) => {
  const h = await home(t);
  h.ui.view = 'wall';
  h.w.homeView.draw();
  assert.equal(h.el('home').hidden, true);
});

test('Home start uses the current project and selected engine with a trimmed prompt', async (t) => {
  const h = await home(t);
  h.ui.projectId = 'p2';
  h.task.value = ' \n  Review the synthetic patch. \t\n';
  h.engine.value = 'yellow-engine';
  h.ui.drafts['home-task'] = 'saved task';
  h.ui.drafts['other-task'] = 'keep me';
  await h.fire('home', 'click', h.start);
  assert.deepEqual(plain(h.calls.filter((c) => c[0] === 'call')), [
    ['call', 'session.launch', { project_id: 'p2', engine_id: 'yellow-engine', prompt: 'Review the synthetic patch.' }],
  ]);
  assert.equal(Object.hasOwn(h.ui.drafts, 'home-task'), false);
  assert.equal(h.ui.drafts['other-task'], 'keep me');
  assert.deepEqual(plain(h.w.saves.filter((c: any[]) => c[0] === 'engine')), [['engine', 'yellow-engine']]);
  assert.equal(h.ui.view, 'wall');
  assert.deepEqual(h.w.picks, ['launched-7']);
});

for (const [label, text] of [['empty', ''], ['whitespace', ' \t\r\n  ']]) {
  test('Home start omits prompt for ' + label + ' task text', async (t) => {
    const h = await home(t);
    h.task.value = text;
    h.engine.value = 'green-engine';
    h.ui.drafts['home-task'] = text;
    await h.fire('home', 'click', h.start);
    assert.deepEqual(plain(h.calls.filter((c) => c[0] === 'call')), [
      ['call', 'session.launch', { project_id: 'p1', engine_id: 'green-engine' }],
    ]);
    assert.equal(Object.hasOwn(h.ui.drafts, 'home-task'), false);
    assert.deepEqual(plain(h.w.saves.filter((c: any[]) => c[0] === 'engine')), [['engine', 'green-engine']]);
    assert.equal(h.ui.view, 'wall');
    assert.deepEqual(h.w.picks, ['launched-7']);
  });
}

for (const [label, reply] of [['missing', {}], ['null', { result: null }], ['error', { error: { message: 'Synthetic launch failure' } }]] as const) {
  test('Home stays home and does not pick with ' + label + ' result', async (t) => {
    const h = await home(t, reply);
    h.task.value = 'Keep this task';
    h.engine.value = 'yellow-engine';
    h.ui.drafts['home-task'] = 'Keep this task';
    await h.fire('home', 'click', h.start);
    assert.deepEqual(plain(h.calls.filter((c) => c[0] === 'call')), [
      ['call', 'session.launch', { project_id: 'p1', engine_id: 'yellow-engine', prompt: 'Keep this task' }],
    ]);
    assert.equal(h.ui.view, 'home');
    assert.deepEqual(h.w.picks, []);
    assert.equal(h.ui.drafts['home-task'], 'Keep this task');
    assert.deepEqual(h.w.saves.filter((c: any[]) => c[0] === 'engine'), []);
  });
}

for (const view of ['home', 'ide', 'inbox', 'addons', 'synthetic-view']) {
  test('Leaving wall for ' + view + ' blurs the focused element', async (t) => {
    const h = await boot(t);
    let blurs = 0;
    const focused = element('focused', 'TEXTAREA');
    focused.blur = () => { blurs++; };
    h.w.document.activeElement = focused;
    h.ui.view = 'wall';
    h.w.homeView.set(view);
    await flush();
    assert.equal(blurs, 1);
    assert.equal(h.ui.view, view);
  });
}

test('Setting wall does not blur the focused element', async (t) => {
  const h = await boot(t);
  let blurs = 0;
  const focused = element('focused', 'TEXTAREA');
  focused.blur = () => { blurs++; };
  h.w.document.activeElement = focused;
  h.ui.view = 'home';
  h.w.homeView.set('wall');
  await flush();
  assert.equal(blurs, 0);
  assert.equal(h.ui.view, 'wall');
});
