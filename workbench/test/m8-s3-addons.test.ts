import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = (name: string) => readFileSync(new URL('../renderer/' + name, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
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
  for (const name of ['diff.js', 'browser-chrome.js', 'app.js', 'addons.js']) vm.runInContext(source(name), context, { filename: name });
  vm.runInContext('globalThis.state = ui;', context);
  for (const fn of domReady) fn();
  await flush();
  const w: any = context;
  w.state.snap = { engines: [] };
  w.state.projectId = 'p1';
  t.after(() => { w.state.snap = null; });
  return { w, ui: w.state, el, calls };
}

const attack = '<img src=x onerror=1>&"\'';
const encoded = '&lt;img src=x onerror=1&gt;&amp;&quot;&#39;';
const pluginRows = (html: string) => [...html.matchAll(/<div class="hrow static top">([\s\S]*?)(?=<div class="hrow|<\/div>\s*<p class="anote)/g)].map((m) => m[1]);
const engineRows = (html: string) => html.split('<h2>Agents</h2>')[1].split('<h2>Plugins</h2>')[0];
function deferred() {
  let resolve: (value: any) => void = () => {};
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test('Add-ons is global, only visible on addons, and loads once per opening', async (t) => {
  const request = deferred();
  let requests = 0;
  const h = await boot(t, { addons: () => ++requests === 1 ? request.promise : [{ id: 'reopened-plugin', version: '2', enabled: true, permissions: [] }] });
  assert.equal(typeof h.w.addonsView.draw, 'function');
  for (const view of ['wall', 'home', 'ide', 'inbox']) {
    h.ui.view = view;
    await h.w.addonsView.draw();
    assert.equal(h.el('addons').hidden, true);
    assert.equal(h.calls.filter((c) => c[0] === 'addons').length, 0);
  }
  h.ui.view = 'addons';
  const opening = h.w.addonsView.draw();
  assert.equal(h.el('addons').hidden, false);
  await h.w.addonsView.draw();
  await h.w.addonsView.draw();
  assert.equal(h.calls.filter((c) => c[0] === 'addons').length, 1);
  request.resolve([]);
  await opening;
  await h.w.addonsView.draw();
  await h.w.addonsView.draw();
  assert.equal(h.calls.filter((c) => c[0] === 'addons').length, 1);
  assert.match(h.el('addons').innerHTML, />No plugins installed\.</);
  h.ui.view = 'home';
  await h.w.addonsView.draw();
  assert.equal(h.el('addons').hidden, true);
  h.ui.view = 'addons';
  await h.w.addonsView.draw();
  assert.equal(h.calls.filter((c) => c[0] === 'addons').length, 2);
  assert.match(h.el('addons').innerHTML, /<b>reopened-plugin<\/b>/);
  await h.w.addonsView.draw();
  assert.equal(h.calls.filter((c) => c[0] === 'addons').length, 2);
});

test('each engine has its own readiness, fallback text and install command', async (t) => {
  const h = await boot(t, { addons: () => [] });
  h.ui.snap.engines = [
    { id: 'needs-fix', light: 'red', fix: 'Repair agent', detail: 'Wrong detail', install: 'install agent-a', version: 'bad-version' },
    { id: 'needs-detail', light: 'red', fix: '', detail: 'Missing binary', install: 'install agent-b' },
    { id: 'needs-fallback', light: 'red', install: 'install agent-c' },
    { id: 'green-agent', light: 'green', version: '3.2.1', fix: 'Wrong fix', install: 'wrong install' },
    { id: 'yellow-agent', light: 'yellow', version: '4.0.0' },
    { id: 'plain-agent', light: 'unknown' },
  ];
  h.ui.view = 'addons';
  await h.w.addonsView.draw();
  const html = engineRows(h.el('addons').innerHTML);
  const rows = html.split('<div class="hrow static">').slice(1);
  assert.equal(rows.length, 6);
  assert.match(rows[0], /<b>needs-fix<\/b><span>Repair agent<\/span>[\s\S]*<code>install agent-a<\/code>/);
  assert.doesNotMatch(rows[0], /Wrong detail|bad-version|Ready/);
  assert.match(rows[1], /<b>needs-detail<\/b><span>Missing binary<\/span>[\s\S]*<code>install agent-b<\/code>/);
  assert.match(rows[2], /<b>needs-fallback<\/b><span>Not ready<\/span>[\s\S]*<code>install agent-c<\/code>/);
  assert.match(rows[3], /<b>green-agent<\/b><span>Ready · 3\.2\.1<\/span>/);
  assert.doesNotMatch(rows[3], /Wrong fix|wrong install|<code>/);
  assert.match(rows[4], /<b>yellow-agent<\/b><span>Ready · 4\.0\.0<\/span>/);
  assert.match(rows[5], /<b>plain-agent<\/b><span>Ready<\/span>/);
});

test('plugins render one row each with description, version and permission list items', async (t) => {
  const h = await boot(t, { addons: () => [
    { id: 'synthetic.reader', description: 'Reads synthetic files', version: '1.2.3', enabled: true, permissions: ['Read files', 'Contact synthetic host'] },
    { id: 'synthetic.empty', description: '', version: '2.0.0', enabled: true, permissions: [] },
    { id: 'synthetic.missing', version: '3.0.0', enabled: true, permissions: [] },
  ] });
  h.ui.view = 'addons';
  await h.w.addonsView.draw();
  const rows = pluginRows(h.el('addons').innerHTML);
  assert.equal(rows.length, 3);
  assert.match(rows[0], /<b>synthetic\.reader<\/b><span>Reads synthetic files<\/span>/);
  assert.match(rows[0], /<span class="hwhen">1\.2\.3<\/span>/);
  assert.deepEqual([...rows[0].matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1]), ['Read files', 'Contact synthetic host']);
  assert.match(rows[1], /<b>synthetic\.empty<\/b><span>No description<\/span>/);
  assert.match(rows[1], /<span class="hwhen">2\.0\.0<\/span>/);
  assert.match(rows[1], /<span>Asks for no permissions<\/span>/);
  assert.doesNotMatch(rows[1], /<li>|<ul/);
  assert.match(rows[2], /<b>synthetic\.missing<\/b><span>No description<\/span>/);
  assert.match(rows[2], /<span class="hwhen">3\.0\.0<\/span>/);
  assert.match(rows[2], /Asks for no permissions/);
  assert.doesNotMatch(h.el('addons').innerHTML, /No plugins installed\./);
});

for (const field of ['id', 'fix', 'detail', 'install', 'version', 'plugin_id']) {
  test('engine HTML escapes ' + field, async (t) => {
    const h = await boot(t, { addons: () => [] });
    h.ui.snap.engines = [{ id: 'synthetic-engine', light: field === 'version' ? 'green' : 'red', [field]: attack }];
    h.ui.view = 'addons';
    await h.w.addonsView.draw();
    const html = engineRows(h.el('addons').innerHTML);
    assert.ok(html.includes(encoded));
    assert.doesNotMatch(html, /<img\b|<script\b/i);
    assert.ok(!html.includes(attack));
  });
}
for (const field of ['id', 'description', 'version', 'permissions']) {
  test('plugin HTML escapes ' + field, async (t) => {
    const h = await boot(t, { addons: () => [{ id: 'synthetic-plugin', description: 'Synthetic', version: '1', enabled: true, permissions: [], [field]: field === 'permissions' ? [attack] : attack }] });
    h.ui.view = 'addons';
    await h.w.addonsView.draw();
    const rows = pluginRows(h.el('addons').innerHTML);
    assert.equal(rows.length, 1);
    assert.ok(rows[0].includes(encoded));
    assert.doesNotMatch(rows[0], /<img\b|<script\b/i);
    assert.ok(!rows[0].includes(attack));
    if (field === 'permissions') assert.match(rows[0], /<li>&lt;img src=x onerror=1&gt;&amp;&quot;&#39;<\/li>/);
  });
}

test('a disabled plugin shows off after its version', async (t) => {
  const h = await boot(t, { addons: () => [{ id: 'synthetic.off', description: 'Disabled', version: '5.0', enabled: false, permissions: [] }] });
  h.ui.view = 'addons';
  await h.w.addonsView.draw();
  assert.match(h.el('addons').innerHTML, /<span class="hwhen">5\.0 · off<\/span>/);
});

test('reopening during a pending load asks again and drops the stale answer', async (t) => {
  const first = deferred();
  const second = deferred();
  let count = 0;
  const h = await boot(t, { addons: () => ++count === 1 ? first.promise : second.promise });
  h.ui.view = 'addons';
  const oldOpening = h.w.addonsView.draw();
  h.ui.view = 'home';
  await h.w.addonsView.draw();
  h.ui.view = 'addons';
  const newOpening = h.w.addonsView.draw();
  await h.w.addonsView.draw();
  const calls = h.calls.filter((c) => c[0] === 'addons').length;
  second.resolve([{ id: 'fresh-plugin', version: '2', enabled: true, permissions: [] }]);
  await newOpening;
  first.resolve([{ id: 'stale-plugin', version: '1', enabled: true, permissions: [] }]);
  await oldOpening;
  assert.equal(calls, 2);
  assert.match(h.el('addons').innerHTML, /<b>fresh-plugin<\/b>/);
  assert.doesNotMatch(h.el('addons').innerHTML, /stale-plugin/);
});
