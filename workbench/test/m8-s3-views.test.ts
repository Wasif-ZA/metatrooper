import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = (name: string) => readFileSync(new URL('../renderer/' + name, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const at = '2026-11-10T00:00:00.000Z';
const attack = '<img src=x onerror=1>';
const encoded = '&lt;img src=x onerror=1&gt;';
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
  const el = (id: string) => { if (!els.has(id)) els.set(id, element(id)); return els.get(id); };
  const document = {
    body: element('body'), documentElement: element('html'), activeElement: null,
    fonts: { load: async () => [] }, getElementById: el, createElement: (tag: string) => element('', tag.toUpperCase()),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener: (kind: string, fn: Function) => { if (kind === 'DOMContentLoaded') domReady.push(fn); },
  };
  for (const id of ['palette', 'inbox', 'sinks', 'menu', 'start', 'settings']) el(id).hidden = true;
  const calls: any[] = [];
  const settings = { reliability: { loop_alarm: true, loop_nudge_at: 3, loop_stop_at: 5, token_limit: 0, done_needs_check: true, checks: {}, false_alarms: 0 }, sessions: { approval: 'ask', metarouter: false }, terminal: { font_size: 13, scrollback: 10000 }, agent_cursor: { show_caption: true } };
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
  for (const name of ['diff.js', 'browser-chrome.js', 'app.js', 'home.js', 'ide.js']) vm.runInContext(source(name), context, { filename: name });
  vm.runInContext('globalThis.state = ui;', context);
  for (const fn of domReady) fn();
  await flush();
  ready = true;
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
function safe(html: string) {
  assert.ok(html.includes(encoded), 'untrusted text is escaped');
  assert.doesNotMatch(html, /<img\b/i);
  assert.ok(!html.includes(attack));
}

test('IDE loads the root once, draws each entry and opens nested files with line numbers', async (t) => {
  const h = await boot(t, { fsList: (_pid: string, rel: string) => rel === '.' ? [{ name: 'src', dir: true }, { name: 'README.txt', dir: false }] : [{ name: 'main.ts', dir: false }] });
  h.ui.view = 'ide';
  await h.w.ideView.draw();
  await h.w.ideView.draw();
  assert.equal(h.el('ide').hidden, false);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsList'), [['fsList', 'p1', '.']]);
  assert.deepEqual(controls(h.el('ide').innerHTML).filter((b) => b.dataset.dir !== undefined || b.dataset.file !== undefined).map((b) => b.dataset.dir ?? b.dataset.file), ['src', 'README.txt']);
  await h.fire('ide', 'click', control(h, 'ide', 'dir', 'src'));
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsList'), [['fsList', 'p1', '.'], ['fsList', 'p1', 'src']]);
  await h.fire('ide', 'click', control(h, 'ide', 'file', 'src/main.ts'));
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsRead'), [['fsRead', 'p1', 'src/main.ts']]);
  assert.match(h.el('ide').innerHTML, /<pre class="ln" aria-hidden="true">1\n2\n3<\/pre>/);
  assert.match(h.el('ide').innerHTML, /<pre class="tx">first\nsecond\n<\/pre>/);
  h.ui.view = 'wall';
  await h.w.ideView.draw();
  assert.equal(h.el('ide').hidden, true);
});

test('IDE shows escaped file errors instead of code or line numbers', async (t) => {
  const h = await boot(t, { fsList: () => [{ name: 'blocked.txt', dir: false }], fsRead: () => ({ error: 'Denied ' + attack }) });
  h.ui.view = 'ide';
  await h.w.ideView.draw();
  await h.fire('ide', 'click', control(h, 'ide', 'file', 'blocked.txt'));
  assert.match(h.el('ide').innerHTML, /Denied &lt;img src=x onerror=1&gt;/);
  assert.doesNotMatch(h.el('ide').innerHTML, /<pre\b/);
  safe(h.el('ide').innerHTML);
});

test('IDE escapes project names, agent titles, disk names and file text', async (t) => {
  const h = await boot(t, { fsList: () => [{ name: attack, dir: false }], fsRead: () => ({ text: attack + '\n&"\'' }) });
  h.ui.snap = snapshot({ projects: [{ id: 'p1', name: attack }], sessions: [session('bad', 'working', { title: attack })] });
  h.ui.view = 'ide';
  await h.w.ideView.draw();
  safe(h.el('ide').innerHTML);
  assert.match(h.el('ide').innerHTML, /aria-label="&lt;img src=x onerror=1&gt; files"/);
  await h.fire('ide', 'click', control(h, 'ide', 'file', attack));
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsRead'), [['fsRead', 'p1', attack]]);
  assert.match(h.el('ide').innerHTML, /<pre class="tx">&lt;img src=x onerror=1&gt;\n&amp;&quot;&#39;<\/pre>/);
  safe(h.el('ide').innerHTML);
});

test('switching project resets IDE tree and tabs and reloads files on return', async (t) => {
  const h = await boot(t, { fsList: (pid: string) => [{ name: pid === 'p1' ? 'old.txt' : 'new.txt', dir: false }], fsRead: (pid: string) => ({ text: pid === 'p1' ? 'old content' : 'new content' }) });
  h.ui.view = 'ide';
  await h.w.ideView.draw();
  await h.fire('ide', 'click', control(h, 'ide', 'file', 'old.txt'));
  h.ui.projectId = 'p2';
  await h.w.ideView.draw();
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsList'), [['fsList', 'p1', '.'], ['fsList', 'p2', '.']]);
  assert.match(h.el('ide').innerHTML, /data-file="new.txt"/);
  assert.doesNotMatch(h.el('ide').innerHTML, /old.txt|old content|role="tab"/);
  await h.fire('ide', 'click', control(h, 'ide', 'file', 'new.txt'));
  assert.match(h.el('ide').innerHTML, /<pre class="tx">new content<\/pre>/);
  h.ui.projectId = 'p1';
  await h.w.ideView.draw();
  await h.fire('ide', 'click', control(h, 'ide', 'file', 'old.txt'));
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsRead'), [['fsRead', 'p1', 'old.txt'], ['fsRead', 'p2', 'new.txt'], ['fsRead', 'p1', 'old.txt']]);
});

test('a late root response from the previous project cannot replace the new IDE tree', async (t) => {
  let release: Function = () => {};
  const oldRoot = new Promise((resolve) => { release = resolve; });
  const h = await boot(t, { fsList: (pid: string) => pid === 'p1' ? oldRoot : [{ name: 'new.txt', dir: false }] });
  h.ui.view = 'ide';
  const pending = h.w.ideView.draw();
  h.ui.projectId = 'p2';
  await h.w.ideView.draw();
  release([{ name: 'old.txt', dir: false }]);
  await pending;
  assert.deepEqual(controls(h.el('ide').innerHTML).filter((b) => 'file' in b.dataset).map((b) => b.dataset.file), ['new.txt']);
});

test('IDE requests the root only once while its first request is pending', async (t) => {
  let release: Function = () => {};
  const root = new Promise((resolve) => { release = resolve; });
  const h = await boot(t, { fsList: () => root });
  h.ui.view = 'ide';
  const pending = h.w.ideView.draw();
  await h.w.ideView.draw();
  release([{ name: 'ready.txt', dir: false }]);
  await pending;
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsList'), [['fsList', 'p1', '.']]);
  assert.deepEqual(controls(h.el('ide').innerHTML).filter((b) => 'file' in b.dataset).map((b) => b.dataset.file), ['ready.txt']);
});

test('IDE clears a shared file path and expanded folders when the project changes', async (t) => {
  const h = await boot(t, {
    fsList: (_pid: string, rel: string) => rel === '.' ? [{ name: 'dir', dir: true }, { name: 'shared.txt', dir: false }] : [{ name: 'child.txt', dir: false }],
    fsRead: (pid: string) => ({ text: pid === 'p1' ? 'Alpha secret' : 'Beta content' }),
  });
  h.ui.view = 'ide';
  await h.w.ideView.draw();
  await h.fire('ide', 'click', control(h, 'ide', 'dir', 'dir'));
  await h.fire('ide', 'click', control(h, 'ide', 'file', 'shared.txt'));
  assert.match(h.el('ide').innerHTML, /data-file="dir\/child.txt"/);
  assert.match(h.el('ide').innerHTML, /Alpha secret/);
  h.ui.projectId = 'p2';
  await h.w.ideView.draw();
  assert.doesNotMatch(h.el('ide').innerHTML, /child.txt|Alpha secret|role="tab"/);
  assert.match(h.el('ide').innerHTML, /data-dir="dir"[^>]*aria-expanded="false"/);
  await h.fire('ide', 'click', control(h, 'ide', 'file', 'shared.txt'));
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsRead'), [['fsRead', 'p1', 'shared.txt'], ['fsRead', 'p2', 'shared.txt']]);
  assert.match(h.el('ide').innerHTML, /<pre class="tx">Beta content<\/pre>/);
  assert.doesNotMatch(h.el('ide').innerHTML, /Alpha secret/);
});

test('IDE numbers an empty file and a single line, and makes no request without a project', async (t) => {
  const h = await boot(t, {
    fsList: () => [{ name: 'empty.txt', dir: false }, { name: 'single.txt', dir: false }],
    fsRead: (_pid: string, rel: string) => ({ text: rel === 'empty.txt' ? '' : 'one line' }),
  });
  h.ui.view = 'ide';
  h.ui.projectId = 'missing';
  await h.w.ideView.draw();
  assert.equal(h.el('ide').hidden, true);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsList'), []);
  h.ui.projectId = 'p1';
  await h.w.ideView.draw();
  await h.fire('ide', 'click', control(h, 'ide', 'file', 'empty.txt'));
  assert.match(h.el('ide').innerHTML, /<pre class="ln" aria-hidden="true">1<\/pre><pre class="tx"><\/pre>/);
  await h.fire('ide', 'click', control(h, 'ide', 'file', 'single.txt'));
  assert.match(h.el('ide').innerHTML, /<pre class="ln" aria-hidden="true">1<\/pre><pre class="tx">one line<\/pre>/);
});

test('IDE escapes quotes and ampersands in disk names and project attributes', async (t) => {
  const payload = '\"><img src=x onerror=1>&\'';
  const h = await boot(t, { fsList: () => [{ name: payload, dir: false }], fsRead: () => ({ text: 'safe text' }) });
  h.ui.snap.projects[0].name = payload;
  h.ui.view = 'ide';
  await h.w.ideView.draw();
  const html = h.el('ide').innerHTML;
  assert.match(html, /aria-label="&quot;&gt;&lt;img src=x onerror=1&gt;&amp;&#39; files"/);
  assert.match(html, /data-file="&quot;&gt;&lt;img src=x onerror=1&gt;&amp;&#39;"/);
  safe(html);
  await h.fire('ide', 'click', control(h, 'ide', 'file', payload));
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsRead'), [['fsRead', 'p1', payload]]);
  safe(h.el('ide').innerHTML);
});
