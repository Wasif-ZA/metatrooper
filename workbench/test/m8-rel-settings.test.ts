import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { schemaFile } from '../../core/src/paths.ts';
import { settings, setSetting, DEFAULTS } from '../../core/src/settings.ts';

const source = (name: string) => readFileSync(new URL('../renderer/' + name, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const at = '2026-11-10T00:00:00.000Z';
const attack = '<img src=x onerror=1>';
const encoded = '&lt;img src=x onerror=1&gt;';
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
    if (/\bdata-check(?:\s|$)/.test(m[1])) el.dataset.check = '';
    el.closest = (selector: string) => selector === '[data-action]' && 'action' in el.dataset ? el : selector === 'button' && tag === 'button' || selector === '[data-filter]' && 'filter' in el.dataset ? el : null;
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
  for (const name of ['diff.js', 'browser-chrome.js', 'app.js', 'home.js', 'inbox.js', 'ide.js', 'settings.js']) vm.runInContext(source(name), context, { filename: name });
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


const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const PAGE_KEYS = new Set<string>(vm.runInNewContext(/const PAGE_KEYS = new Set\((\[[\s\S]*?\])\)/.exec(main)![1]));
const plain = (value: any) => JSON.parse(JSON.stringify(value));
function handler(name: string, globals: any) {
  const start = main.indexOf("on('" + name + "', ");
  assert.ok(start >= 0, name + ' IPC exists');
  const body = main.slice(start + name.length + 7).split('\n  });')[0];
  return vm.runInNewContext(stripTypeScriptTypes('(' + body + '\n  })'), { PAGE_KEYS, DEFAULTS, ...globals });
}
function ipcFixture(t: any) {
  const home = mkdtempSync(join(tmpdir(), 'rel-settings-'));
  const previous = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = home;
  setSetting('reliability', 'checks', { p2: 'keep this command' });
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(schemaFile, 'utf8'));
  const writes: any[] = [];
  const globals = { settings, DEFAULTS, PAGE_KEYS, db: () => db, projectRoot: (id: string) => id === 'p1' || id === 'p2' ? home : null,
    writeSetting: async (key: string, value: any) => { writes.push([key, plain(value)]); const [section, name] = key.split('.'); setSetting(section, name, plain(value)); return null; } };
  t.after(() => { db.close(); if (previous === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = previous; rmSync(home, { recursive: true, force: true }); });
  return { db, writes, globals };
}

test('Settings exposes five reliability keys and loop.choose is allowed through the UI', () => {
  const keys = vm.runInNewContext(/const PAGE_KEYS = new Set\((\[[\s\S]*?\])\)/.exec(main)![1]);
  assert.deepEqual(Array.from(keys).filter((k: any) => k.startsWith('reliability.')).sort(), ['reliability.done_needs_check', 'reliability.loop_alarm', 'reliability.loop_nudge_at', 'reliability.loop_stop_at', 'reliability.token_limit']);
  const methods = vm.runInNewContext(/const UI_METHODS = new Set\((\[[\s\S]*?\])\)/.exec(main)![1]);
  assert.ok(methods.includes('loop.choose'));
});

test('settingsPage returns reliability settings and persisted false alarms, defaulting to zero', (t) => {
  const h = ipcFixture(t), page = handler('settingsPage', h.globals);
  assert.deepEqual(plain(page().reliability), { loop_alarm: true, loop_nudge_at: 3, loop_stop_at: 5, token_limit: 0, done_needs_check: true, checks: { p2: 'keep this command' }, false_alarms: 0 });
  h.db.prepare("INSERT INTO meta (key,value) VALUES ('loop_false_alarms','2')").run();
  assert.equal(page().reliability.false_alarms, 2);
  h.globals.db = () => null as any;
  assert.equal(handler('settingsPage', h.globals)().reliability.false_alarms, 0);
});

test('setCheck trims commands, retains other projects, accepts 500 characters and removes empty entries', async (t) => {
  const h = ipcFixture(t), set = handler('setCheck', h.globals);
  assert.deepEqual(plain(await set('p1', '  node check.mjs  ')), { ok: true });
  assert.deepEqual(h.writes, [['reliability.checks', { p2: 'keep this command', p1: 'node check.mjs' }]]);
  assert.equal((await set('p1', 'x'.repeat(500))).ok, true);
  assert.equal(settings().reliability.checks.p1.length, 500);
  assert.equal((await set('p1', '   ')).ok, true);
  assert.deepEqual(settings().reliability.checks, { p2: 'keep this command' });
});

test('setCheck rejects unknown projects, nonstrings and overlong commands without writing', async (t) => {
  const h = ipcFixture(t), set = handler('setCheck', h.globals);
  for (const [pid, command] of [['missing', 'node check.mjs'], [undefined, 'check'], [42, 'check'], ['p1', undefined], ['p1', null], ['p1', 42], ['p1', {}], ['p1', []], ['p1', 'x'.repeat(501)]]) {
    assert.deepEqual(plain(await set(pid, command)), { error: 'bad check command' });
  }
  assert.deepEqual(h.writes, []);
  assert.deepEqual(settings().reliability.checks, { p2: 'keep this command' });
});

test('setCheck propagates a settings write error', async (t) => {
  const h = ipcFixture(t);
  const set = handler('setCheck', { ...h.globals, writeSetting: async () => 'synthetic write failure' });
  assert.deepEqual(plain(await set('p1', 'check')), { error: 'synthetic write failure' });
  assert.deepEqual(settings().reliability.checks, { p2: 'keep this command' });
});

test('preload setCheck invokes IPC with the project and command unchanged', async () => {
  const calls: any[] = [];
  let api: any;
  const preload = readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(preload, { require: (name: string) => { assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld: (_name: string, value: any) => { api = value; } }, ipcRenderer: { invoke: (...args: any[]) => { calls.push(args); return Promise.resolve({ ok: true }); }, on() {} } }; } });
  await api.setCheck('p1', 'node check.mjs');
  assert.deepEqual(calls, [['setCheck', 'p1', 'node check.mjs']]);
});

test('Reliability renders two switches, three numbers, a check command and a readonly false alarm count', async (t) => {
  const h = await boot(t);
  await h.w.settingsView.open('reliability');
  const html = h.el('settings').innerHTML;
  assert.deepEqual(controls(html).filter((b) => b.role === 'switch').map((b) => [b.dataset.key, b.getAttribute('aria-checked')]), [['reliability.done_needs_check', 'true'], ['reliability.loop_alarm', 'true']]);
  assert.deepEqual(controls(html, 'input').filter((b) => b.type === 'number').map((b) => [b.dataset.key, b.value]), [['reliability.loop_nudge_at', '3'], ['reliability.loop_stop_at', '5'], ['reliability.token_limit', '0']]);
  assert.match(html, /False alarms so far[\s\S]*?<span class="sval">0<\/span>/);
  const check = controls(html, 'input').find((b) => 'check' in b.dataset)!;
  assert.equal(check.type, 'text'); assert.equal(check.value, ''); assert.equal(check.maxlength, '500');
  assert.equal((html.match(/class="srw soon"/g) || []).length, 6);
});

test('reliability switches and number changes write the literal keys and values', async (t) => {
  const h = await boot(t);
  await h.w.settingsView.open('reliability');
  for (const key of ['reliability.done_needs_check', 'reliability.loop_alarm']) await h.fire('settings', 'click', control(h, 'settings', 'key', key));
  for (const [key, value] of [['reliability.loop_nudge_at', '4'], ['reliability.loop_stop_at', '8'], ['reliability.token_limit', '200000']]) {
    const input = control(h, 'settings', 'key', key, 'input'); input.value = value; await h.fire('settings', 'change', input);
  }
  assert.deepEqual(h.calls.filter((c) => c[0] === 'setSetting'), [['setSetting', 'reliability.done_needs_check', false], ['setSetting', 'reliability.loop_alarm', false], ['setSetting', 'reliability.loop_nudge_at', 4], ['setSetting', 'reliability.loop_stop_at', 8], ['setSetting', 'reliability.token_limit', 200000]]);
});

test('check change sends current project and value, renders escaped project commands and disables without a project', async (t) => {
  const h = await boot(t, { settingsPage: () => ({ reliability: { loop_alarm: true, done_needs_check: true, loop_nudge_at: 3, loop_stop_at: 5, token_limit: 0, false_alarms: 2, checks: { p1: attack, p2: 'other check' } } }) });
  await h.w.settingsView.open('reliability');
  safe(h.el('settings').innerHTML);
  let input = controls(h.el('settings').innerHTML, 'input').find((b) => 'check' in b.dataset)!;
  assert.equal(input.value, attack); input.value = 'node local-check.mjs';
  await h.fire('settings', 'change', input);
  assert.deepEqual(h.calls.filter((c) => c[0] === 'setCheck'), [['setCheck', 'p1', 'node local-check.mjs']]);
  assert.match(h.el('settings').innerHTML, /False alarms so far[\s\S]*?<span class="sval">2<\/span>/);
  h.ui.projectId = 'p2'; await h.w.settingsView.open('reliability');
  input = controls(h.el('settings').innerHTML, 'input').find((b) => 'check' in b.dataset)!;
  assert.equal(input.value, 'other check');
  h.ui.projectId = null; await h.w.settingsView.open('reliability');
  assert.match(h.el('settings').innerHTML, /data-check[^>]* disabled>/);
});

test('loop rows need attention and render three choices, ordinary other rows stay informational', async (t) => {
  const h = await boot(t);
  h.ui.snap = snapshot({ needs_you: [{ id: 'loop-row', kind: 'other', ref: 'loop:s1', text: 'Loop detected', at }, { id: 'ordinary', kind: 'other', ref: 'ordinary:s2', text: 'Ordinary information', at }] });
  assert.equal(h.w.needsCount(), 1);
  h.ui.view = 'inbox'; h.w.inboxView.draw();
  const html = h.el('needsview').innerHTML;
  const buttons = controls(html).filter((b) => b.dataset.action === 'loop-choose');
  assert.deepEqual(buttons.map((b) => [b.dataset.id, b.dataset.choice]), [['s1', 'pause'], ['s1', 'try-another-way'], ['s1', 'not-a-loop']]);
  const ordinary = html.slice(html.indexOf('data-id="ordinary"'));
  assert.doesNotMatch(ordinary, /loop-choose/);
  await h.fire('needsview', 'click', control(h, 'needsview', 'filter', 'needs'));
  assert.match(h.el('needsview').innerHTML, /Loop detected/);
  assert.doesNotMatch(h.el('needsview').innerHTML, /Ordinary information/);
  for (const button of buttons) await h.w.onClick({ target: button, preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(plain(h.calls.filter((c) => c[0] === 'call' && c[1] === 'loop.choose')), [['call', 'loop.choose', { session_id: 's1', choice: 'pause' }], ['call', 'loop.choose', { session_id: 's1', choice: 'try-another-way' }], ['call', 'loop.choose', { session_id: 's1', choice: 'not-a-loop' }]]);
});

test('ordinary other rows render no loop buttons and no Needs you count', async (t) => {
  const h = await boot(t);
  h.ui.snap = snapshot({ needs_you: [{ id: 'ordinary', kind: 'other', ref: 's1', text: 'Information', at }] });
  h.ui.view = 'inbox'; h.w.inboxView.draw();
  assert.doesNotMatch(h.el('needsview').innerHTML, /loop-choose/);
  assert.match(h.el('needsview').innerHTML, /Nothing is waiting on you/);
});

test('Home counts an unread loop alarm as needing you', async (t) => {
  const h = await boot(t);
  h.ui.snap = snapshot({ needs_you: [{ id: 'loop-row', kind: 'other', ref: 'loop:s1', text: 'Loop detected', at }] });
  h.ui.view = 'home'; h.w.homeView.draw();
  assert.match(h.el('home').innerHTML, /<span>Needs you<\/span><b>1<\/b>/);
});
