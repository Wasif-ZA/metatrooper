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

const literalDiff = '@@ -1,3 +1,3 @@\n const a = 1;\n-const b = 2;\n+const b = 3;\n const c = 4;';
const fileText = 'const a = 1;\nconst b = 3;\nconst c = 4;';

async function ide(t: any, diff: any = literalDiff, changed = ['src/a.js']) {
  const h = await boot(t, {
    fsList: (_pid: string, rel: string) => rel === '.'
      ? [{ name: 'src', dir: true }, { name: 'README.txt', dir: false }]
      : [{ name: 'a.js', dir: false }, { name: 'b.js', dir: false }],
    fsRead: () => ({ text: fileText }),
    sessionDiffFile: () => diff,
  });
  h.ui.snap.sessions = [session('unrelated-session', 'working'), session('changed-session', 'working')];
  h.ui.snap.git = {
    'unrelated-session': { changed: ['src/b.js'] },
    'changed-session': { changed },
  };
  h.ui.view = 'ide';
  await h.w.ideView.draw();
  await h.fire('ide', 'click', control(h, 'ide', 'dir', 'src'));
  await h.fire('ide', 'click', control(h, 'ide', 'file', 'src/a.js'));
  return h;
}

function crumb(h: any) {
  const match = h.el('ide').innerHTML.match(/<div class="icrumb">([\s\S]*?)<\/div>/);
  assert.ok(match, 'file breadcrumb is rendered');
  return match[1];
}

function rows(h: any) {
  return [...h.el('ide').innerHTML.matchAll(/<div class="dl ([^"]+)"><span class="n">([^<]*)<\/span><span class="t">([\s\S]*?)<\/span><\/div>/g)]
    .map((m) => [m[1], m[2], m[3]]);
}

test('IDE shows file and diff buttons above a file changed by a session', async (t) => {
  const h = await ide(t);
  assert.equal(h.el('ide').hidden, false);
  assert.match(crumb(h), /^src \/ a.js/);
  assert.deepEqual(controls(crumb(h)).map((b) => b.dataset.mode), ['file', 'diff']);
  assert.doesNotMatch(crumb(h), /Read only/);
  assert.match(h.el('ide').innerHTML, /<pre class="tx">const a = 1;\nconst b = 3;\nconst c = 4;<\/pre>/);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'sessionDiffFile'), []);
});

test('IDE normalizes backslash changed paths and requests the owning session with a forward slash path', async (t) => {
  const h = await ide(t, literalDiff, ['src\\a.js']);
  assert.deepEqual(controls(crumb(h)).map((b) => b.dataset.mode), ['file', 'diff']);
  await h.fire('ide', 'click', control(h, 'ide', 'mode', 'diff'));
  assert.deepEqual(h.calls.filter((c) => c[0] === 'sessionDiffFile'), [
    ['sessionDiffFile', 'changed-session', 'src/a.js', 'uncommitted'],
  ]);
  assert.deepEqual(rows(h), [
    ['hunk', '', '@@ -1,3 +1,3 @@'],
    ['ctx', '1', ' const a = 1;'],
    ['del', '2', '-const b = 2;'],
    ['add', '2', '+const b = 3;'],
    ['ctx', '3', ' const c = 4;'],
  ]);
});

test('IDE shows Read only and no mode buttons for a file no session changed', async (t) => {
  const h = await ide(t);
  await h.fire('ide', 'click', control(h, 'ide', 'file', 'README.txt'));
  assert.match(crumb(h), /Read only/);
  assert.deepEqual(controls(crumb(h)).map((b) => b.dataset.mode), []);
  assert.doesNotMatch(h.el('ide').innerHTML, /data-mode=/);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'sessionDiffFile'), []);
});

test('IDE renders the literal diff with all five row classes and line numbers', async (t) => {
  const h = await ide(t);
  await h.fire('ide', 'click', control(h, 'ide', 'mode', 'diff'));
  assert.deepEqual(h.calls.filter((c) => c[0] === 'sessionDiffFile'), [
    ['sessionDiffFile', 'changed-session', 'src/a.js', 'uncommitted'],
  ]);
  assert.deepEqual(rows(h), [
    ['hunk', '', '@@ -1,3 +1,3 @@'],
    ['ctx', '1', ' const a = 1;'],
    ['del', '2', '-const b = 2;'],
    ['add', '2', '+const b = 3;'],
    ['ctx', '3', ' const c = 4;'],
  ]);
  assert.equal((h.el('ide').innerHTML.match(/class="dl /g) || []).length, 5);
  assert.doesNotMatch(h.el('ide').innerHTML, /<pre class="tx">/);
});

test('IDE numbers context and additions from the new file and deletions from the old file', async (t) => {
  const h = await ide(t, '@@ -7,3 +11,3 @@\n keep before\n-old value\n+new value\n keep after');
  await h.fire('ide', 'click', control(h, 'ide', 'mode', 'diff'));
  assert.deepEqual(rows(h), [
    ['hunk', '', '@@ -7,3 +11,3 @@'],
    ['ctx', '11', ' keep before'],
    ['del', '8', '-old value'],
    ['add', '12', '+new value'],
    ['ctx', '13', ' keep after'],
  ]);
});

test('IDE returns to cached file text without a second fsRead or diff request', async (t) => {
  const h = await ide(t);
  await h.fire('ide', 'click', control(h, 'ide', 'mode', 'diff'));
  await h.fire('ide', 'click', control(h, 'ide', 'mode', 'file'));
  assert.match(h.el('ide').innerHTML, /<pre class="tx">const a = 1;\nconst b = 3;\nconst c = 4;<\/pre>/);
  assert.deepEqual(rows(h), []);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsRead'), [['fsRead', 'p1', 'src/a.js']]);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'sessionDiffFile'), [
    ['sessionDiffFile', 'changed-session', 'src/a.js', 'uncommitted'],
  ]);
  await h.fire('ide', 'click', control(h, 'ide', 'mode', 'diff'));
  assert.equal(rows(h).length, 5);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'fsRead'), [['fsRead', 'p1', 'src/a.js']]);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'sessionDiffFile'), [
    ['sessionDiffFile', 'changed-session', 'src/a.js', 'uncommitted'],
  ]);
});

for (const [label, response] of [['empty', ''], ['undefined', undefined], ['null', null]] as const) {
  test('IDE shows the no changes message for ' + label + ' diff', async (t) => {
    const empty = await boot(t, {
      fsList: () => [{ name: 'a.js', dir: false }],
      fsRead: () => ({ text: 'synthetic file' }),
      sessionDiffFile: () => response,
    });
    empty.ui.snap.sessions = [session('owner-session', 'working')];
    empty.ui.snap.git = { 'owner-session': { changed: ['a.js'] } };
    empty.ui.view = 'ide';
    await empty.w.ideView.draw();
    await empty.fire('ide', 'click', control(empty, 'ide', 'file', 'a.js'));
    await empty.fire('ide', 'click', control(empty, 'ide', 'mode', 'diff'));
    assert.deepEqual(empty.calls.filter((c) => c[0] === 'sessionDiffFile'), [
      ['sessionDiffFile', 'owner-session', 'a.js', 'uncommitted'],
    ]);
    assert.match(empty.el('ide').innerHTML, />No changes to show for this file\.<\/p>/);
    assert.deepEqual(rows(empty), []);
    assert.doesNotMatch(empty.el('ide').innerHTML, /Loading\.|<pre class="tx">/);
  });
}

test('IDE escapes HTML in added, removed, context and hunk diff text', async (t) => {
  const h = await ide(t, '@@ -1,2 +1,2 @@ <img src=x onerror=1>\n <img src=x onerror=1>\n-<img src=x onerror=1>\n+<img src=x onerror=1>');
  await h.fire('ide', 'click', control(h, 'ide', 'mode', 'diff'));
  assert.deepEqual(rows(h), [
    ['hunk', '', '@@ -1,2 +1,2 @@ &lt;img src=x onerror=1&gt;'],
    ['ctx', '1', ' &lt;img src=x onerror=1&gt;'],
    ['del', '2', '-&lt;img src=x onerror=1&gt;'],
    ['add', '2', '+&lt;img src=x onerror=1&gt;'],
  ]);
  assert.doesNotMatch(h.el('ide').innerHTML, /<img\b/i);
});

test('IDE selects the session that changed each file', async (t) => {
  const h = await ide(t);
  await h.fire('ide', 'click', control(h, 'ide', 'mode', 'diff'));
  await h.fire('ide', 'click', control(h, 'ide', 'file', 'src/b.js'));
  await h.fire('ide', 'click', control(h, 'ide', 'mode', 'diff'));
  assert.deepEqual(h.calls.filter((c) => c[0] === 'sessionDiffFile'), [
    ['sessionDiffFile', 'changed-session', 'src/a.js', 'uncommitted'],
    ['sessionDiffFile', 'unrelated-session', 'src/b.js', 'uncommitted'],
  ]);
});

test('mode buttons appear when an open file becomes changed in a snapshot', async (t) => {
  const h = await ide(t, literalDiff, []);
  assert.match(crumb(h), /Read only/);
  h.ui.snap.git['changed-session'].changed = ['src/a.js'];
  await h.w.ideView.draw();
  assert.deepEqual(controls(crumb(h)).map((b) => b.dataset.mode), ['file', 'diff']);
});

test('mode buttons go when no session still lists the open file as changed', async (t) => {
  const h = await ide(t);
  assert.deepEqual(controls(crumb(h)).map((b) => b.dataset.mode), ['file', 'diff']);
  h.ui.snap.git['changed-session'].changed = [];
  await h.w.ideView.draw();
  assert.match(crumb(h), /Read only/);
  assert.deepEqual(controls(crumb(h)).map((b) => b.dataset.mode), []);
});
