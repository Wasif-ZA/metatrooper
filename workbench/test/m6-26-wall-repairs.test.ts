import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = (f: string) => readFileSync(new URL(`../renderer/${f}`, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

/** A fake element: enough DOM for app.js to render into and for a test to read back. */
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
    focus: () => { (el.owner || doc).activeElement = el; }, blur() {}, select() {}, scrollIntoView() {}, setSelectionRange() {},
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, x: 0, y: 0, width: 0, height: 0 }),
  };
  return el;
}
let doc: any;

type Call = { method: string; params: any; at: number };

/** Runs the real diff.js, browser-chrome.js and app.js against fake DOM, api, wall and terminal, on a clock the test moves. */
function boot() {
  let now = 1_000_000;
  let seq = 0;
  let timers: Array<{ id: number; at: number; f: () => void }> = [];
  const els = new Map<string, any>();
  const docListeners: Array<{ type: string; f: (e: any) => void; capture: boolean }> = [];
  const own = (e: any) => { e.owner = d; return e; };
  const d: any = doc = {
    body: makeEl('body'), documentElement: makeEl('html'), activeElement: null, hidden: false,
    fonts: { load: () => Promise.resolve() },
    getElementById: (id: string) => { if (!els.has(id)) els.set(id, own(makeEl(id))); return els.get(id); },
    createElement: (tag: string) => own(makeEl('', tag.toUpperCase())),
    addEventListener: (type: string, f: (e: any) => void, capture = false) => { docListeners.push({ type, f, capture: Boolean(capture) }); },
    querySelector: () => null, querySelectorAll: () => [],
  };
  doc.activeElement = doc.body;
  for (const id of ['palette', 'inbox', 'sinks', 'menu', 'start']) doc.getElementById(id).hidden = true;
  const calls: Call[] = [];
  const handlers: Record<string, (...a: any[]) => any> = {};
  const replies: Record<string, any> = { 'shell.list': { shells: [] } };
  const api = new Proxy({}, {
    get: (_t, name: string) => {
      if (name.startsWith('on')) return (f: (...a: any[]) => any) => { handlers[name] = f; };
      if (name === 'call') return async (method: string, params: any) => { calls.push({ method, params, at: now }); return { kind: 'ok', reply: { result: replies[method] ?? {} } }; };
      if (name === 'git') return async () => ({ branch: 'main', changes: [], staged: [], log: '', ahead: 0, behind: 0 });
      if (name === 'uiSettings') return async () => ({ theme: {}, ui: { toast_ms: 3500, error_toast_ms: 7000, layout: {} }, terminal: { git_every_ms: 10000, scrollback: 1000, font_size: 13 }, themes: [] });
      return async (...args: any[]) => { calls.push({ method: `api.${name}`, params: args, at: now }); return undefined; };
    },
  });
  const wallState = { list: false, sheet: false };
  const rolls: Record<string, number> = {};
  const wall: any = new Proxy({
    setList: (v: boolean) => { wallState.list = v; }, listOpen: () => wallState.list, setSheet: (v: boolean) => { wallState.sheet = v; }, sheetOpen: () => wallState.sheet,
    roll: (el: any, n: number) => { rolls[el.id] = n; }, decide: (shown: any[]) => (shown[0] ? shown[0].id : null), state: () => ({}), big: () => null, isBig: () => false, toggleOpen: () => false,
  }, { get: (t: any, k: string) => (k in t ? t[k] : () => {}) });
  let shown: any[] = [];
  const termView: any = new Proxy({ show: (next: any) => { shown = next.sessions; }, state: () => null }, { get: (t: any, k: string) => (k in t ? t[k] : () => {}) });
  class FakeDate extends Date { static now() { return now; } }
  const ctx = vm.createContext({
    window: { troop: api, addEventListener() {} }, document: doc, location: { search: '' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URLSearchParams, URL, wall, termView, CSS: { escape: (s: string) => s }, matchMedia: () => ({ matches: false }), Date: FakeDate, console,
    setTimeout: (f: () => void, ms = 0) => { const id = ++seq; timers.push({ id, at: now + ms, f }); return id; },
    clearTimeout: (id: number) => { timers = timers.filter((t) => t.id !== id); },
    setInterval: () => 0,
  });
  vm.runInContext(`${src('diff.js')}\n${src('browser-chrome.js')}\n${src('app.js')}\nthis.t = { ui, KEYS, onClick, render, renderGit };`, ctx);
  const t = (ctx as any).t;
  const fire = (type: string, e: any) => {
    let stopped = false;
    const ev = { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { stopped = true; }, target: d.activeElement, ...e };
    for (const capture of [true, false]) for (const l of docListeners) if (l.type === type && l.capture === capture && !stopped) l.f(ev);
  };
  return {
    t, calls, handlers, rolls, wallState, el: (id: string) => doc.getElementById(id), shown: () => shown,
    now: () => now,
    advance: async (ms: number) => {
      const until = now + ms;
      for (let n = 0; ; n++) {
        assert.ok(n < 1000, 'timers keep scheduling more timers');
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
    key: async (key: string, mods: any = {}, target?: any) => { fire('keydown', { key, code: /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods, ...(target ? { target } : {}) }); await flush(); },
    click: async (dataset: any, inside: string[] = []) => {
      const target: any = makeEl('', 'BUTTON');
      Object.assign(target.dataset, dataset);
      target.closest = (sel: string) => {
        if (sel === '[data-action]') return target.dataset.action ? target : null;
        if (sel === '[data-palette]') return target.dataset.palette !== undefined ? target : null;
        const m = sel.match(/^\[data-action="([^"]+)"\]$/);
        if (m) return target.dataset.action === m[1] ? target : null;
        return inside.includes(sel) ? target : null;
      };
      fire('click', { target });
      await flush();
    },
    hides: () => calls.filter((c) => c.method === 'session.hide').map((c) => c.params.session_id),
    type: async (id: string, value: string) => { const el = d.getElementById(id); el.value = value; fire('input', { target: el }); await flush(); },
  };
}

const at = new Date(Date.UTC(2026, 9, 14)).toISOString();
const session = (id: string, state: string, extra: any = {}) => ({ id, project_id: 'p1', engine_id: 'claude', host: 'pty', state, state_at: at, started_at: at, title: `task ${id}`, cwd: '/p', last_line: '', ...extra });
const snapOf = (sessions: any[], extra: any = {}) => ({
  core: { online: true, pid: 1, heartbeat_age_ms: 0 }, projects: [{ id: 'p1', name: 'p', path: '/p' }], sessions, live: sessions.filter((x) => ['working', 'waiting_for_you'].includes(x.state)),
  approvals: [], needs_you: [], engines: [], limits: [], panes: [], snapshots: [], git: {}, dev_servers: [], watcher_off: [], selected: null, ...extra,
});
const onWall = (w: ReturnType<typeof boot>) => Array.from(w.shown(), (x: any) => x.id as string);

test('M6-26b a hide waits 7 s, Undo cancels only its own hide, and a session that went live again is not hidden', async () => {
  // protects=hide on a tile or list row: it leaves the wall at once and the core hears about it only after the undo window
  // fails_when=session.hide goes out before 7,000 ms, Undo sends it anyway or cancels another tile's hide, or a session that went live in the window is hidden
  // no_claim=that the window closing drops the timers; that is the renderer process ending, which a vm cannot show
  const w = boot();
  await w.snap(snapOf([session('a', 'done'), session('b', 'done'), session('c', 'idle')]));
  await w.click({ action: 'hide', id: 'a' });
  assert.ok(!onWall(w).includes('a'), 'the tile leaves the wall within one render');
  assert.ok(!w.el('list').innerHTML.includes('data-id="a"'), 'and the list');
  assert.match(w.el('toasts').children[0].textContent, /^Agent hidden · $/);
  assert.equal(w.el('toasts').children[0].children[0].textContent, 'Undo');
  await w.advance(6999);
  assert.deepEqual(w.hides(), []);
  await w.advance(1);
  assert.deepEqual(w.hides(), ['a']);
  assert.ok(w.t.ui.pendingHide.has('a'), 'kept out until a snapshot drops it');
  await w.snap(snapOf([session('b', 'done'), session('c', 'idle')]));
  assert.equal(w.t.ui.pendingHide.has('a'), false, 'released once the core no longer lists it');

  const away = boot();
  await away.snap(snapOf([session('a', 'done')]));
  await away.click({ action: 'hide', id: 'a' });
  await away.advance(3000);
  await away.snap(snapOf([], { projects: [{ id: 'p1', name: 'p', path: '/p' }, { id: 'p2', name: 'q', path: '/q' }] }));
  await away.advance(4000);
  assert.deepEqual(away.hides(), ['a'], 'switching projects does not cancel the timer');

  const u = boot();
  await u.snap(snapOf([session('a', 'done'), session('b', 'done')]));
  await u.click({ action: 'hide', id: 'a' });
  await u.advance(6999);
  u.el('toasts').children[0].children[0].listeners.click[0]({ stopPropagation() {} });
  await u.advance(10_000);
  assert.deepEqual(u.hides(), []);
  assert.ok(onWall(u).includes('a'), 'Undo puts the tile back');

  const two = boot();
  await two.snap(snapOf([session('a', 'done'), session('b', 'done')]));
  await two.click({ action: 'hide', id: 'a' });
  await two.click({ action: 'hide', id: 'b' });
  assert.equal(two.el('toasts').children.length, 2, 'toasts stack');
  two.el('toasts').children[0].children[0].listeners.click[0]({ stopPropagation() {} });
  await two.advance(7000);
  assert.deepEqual(two.hides(), ['b']);

  const live = boot();
  await live.snap(snapOf([session('a', 'done')]));
  await live.click({ action: 'hide', id: 'a' });
  await live.advance(3000);
  await live.snap(snapOf([session('a', 'working')]));
  assert.ok(!onWall(live).includes('a'), 'still pending while the window runs');
  await live.advance(4000);
  assert.deepEqual(live.hides(), []);
  assert.ok(onWall(live).includes('a'), 'back on the wall at expiry');

  const closed = boot();
  await closed.snap(snapOf([session('a', 'done')]));
  await closed.click({ action: 'hide', id: 'a' });
  await closed.advance(3000);
  assert.deepEqual(closed.hides(), []);
  assert.ok(!/addEventListener\('(beforeunload|unload|pagehide)'/.test(src('app.js')), 'nothing sends hides on unload');
});

test('M6-26c Clear hides the finished sessions it saw at click time, one session.hide each, and never project.clear', async () => {
  // protects=Clear: it snapshots the finished sessions, waits 7 s, then hides exactly those
  // fails_when=Clear calls project.clear, hides a session that finished after the click, or sends anything before 7,000 ms or after Undo
  // no_claim=the core's own project.clear, which the CLI still uses
  const w = boot();
  await w.snap(snapOf([session('d1', 'done'), session('d2', 'idle'), session('d3', 'exited'), session('w1', 'working')]));
  await w.click({ action: 'clear-all' });
  assert.deepEqual(onWall(w).sort(), ['w1']);
  assert.equal(w.el('toasts').children[0].textContent, '3 finished agents cleared · ');
  await w.advance(3000);
  await w.snap(snapOf([session('d1', 'done'), session('d2', 'idle'), session('d3', 'exited'), session('w1', 'done')]));
  assert.ok(!/data-id="d[123]"/.test(w.el('list').innerHTML), 'cleared rows stay out of the list');
  await w.advance(3999);
  assert.deepEqual(w.hides(), []);
  await w.advance(1);
  assert.deepEqual(w.hides().sort(), ['d1', 'd2', 'd3']);
  assert.equal(w.calls.filter((c) => c.method === 'project.clear').length, 0);

  const u = boot();
  await u.snap(snapOf([session('d1', 'done'), session('w1', 'working')]));
  await u.click({ action: 'clear-all' });
  await u.advance(6999);
  u.el('toasts').children[0].children[0].listeners.click[0]({ stopPropagation() {} });
  await u.advance(10_000);
  assert.deepEqual(u.hides(), []);
});

test('M6-26d Stop core and Restart core run only on a second Enter within 3 s', async () => {
  // protects=the two palette items that stop every agent: one Enter only arms them
  // fails_when=one Enter stops or restarts the core, a second Enter after 3,000 ms runs it, or the label does not say what a second Enter does
  // no_claim=what stopCore and restartCore do in main
  for (const [label, armed, fn] of [['Stop core', 'Press Enter again to stop every agent', 'api.stopCore'], ['Restart core', 'Press Enter again to restart; open agents stop', 'api.restartCore']]) {
    const w = boot();
    await w.snap(snapOf([]));
    const items = () => w.t.ui.paletteItems as Array<{ label: string }>;
    const selectItem = async () => {
      await w.key('k', { ctrlKey: true });
      const i = items().findIndex((x) => x.label.startsWith(label) || x.label === armed);
      w.t.ui.paletteAt = i;
      return i;
    };
    const runs = () => w.calls.filter((c) => c.method === fn).length;
    const i = await selectItem();
    await w.key('Enter');
    assert.equal(runs(), 0);
    assert.equal(items()[i].label, armed);
    assert.equal(w.el('palette').hidden, false, 'the palette stays open');
    await w.advance(2999);
    await w.key('Enter');
    assert.equal(runs(), 1);

    const late = boot();
    await late.snap(snapOf([]));
    await late.key('k', { ctrlKey: true });
    const j = (late.t.ui.paletteItems as Array<{ label: string }>).findIndex((x) => x.label.startsWith(label));
    late.t.ui.paletteAt = j;
    await late.key('Enter');
    await late.advance(3000);
    assert.ok(late.t.ui.paletteItems[j].label.startsWith(label), 'label back at 3,000 ms');
    await late.advance(1);
    await late.key('Enter');
    assert.equal(late.calls.filter((c) => c.method === fn).length, 0);
    assert.equal(late.t.ui.paletteItems[j].label, armed, 'an Enter after expiry arms again');
    await late.key('ArrowDown');
    assert.ok(late.t.ui.paletteItems[j].label.startsWith(label), 'ArrowDown disarms');

    const bypass = async (steps: (b: ReturnType<typeof boot>, at: () => number) => Promise<void>) => {
      const b = boot();
      await b.snap(snapOf([session('s_w', 'waiting_for_you')]));
      await b.key('k', { ctrlKey: true });
      const at = () => (b.t.ui.paletteItems as Array<{ label: string }>).findIndex((x) => x.label.startsWith(label) || x.label === armed);
      b.t.ui.paletteAt = at();
      await steps(b, at);
      return b.calls.filter((c) => c.method === fn).length;
    };
    assert.equal(await bypass(async (b, at) => { await b.click({ palette: String(at()) }); await b.click({ palette: String(at()) }); }), 0, 'two clicks');
    assert.equal(await bypass(async (b, at) => { await b.key('Enter'); await b.click({ palette: String(at()) }); }), 0, 'Enter then click');
    assert.equal(await bypass(async (b, at) => { await b.click({ palette: String(at()) }); await b.key('Enter'); }), 0, 'click then one Enter');
    assert.equal(await bypass(async (b) => { await b.key('Enter'); await b.key('Enter', { repeat: true }); }), 0, 'a held Enter');
    assert.equal(await bypass(async (b) => { await b.key('Enter'); await b.key('j', { altKey: true }); await b.key('Enter'); }), 0, 'Alt+J between the Enters disarms');
    const named = boot();
    await named.snap(snapOf([]));
    await named.key('k', { ctrlKey: true });
    await named.type('palette-input', label.toLowerCase());
    named.t.ui.paletteAt = 0;
    await named.key('Enter');
    assert.equal((named.t.ui.paletteItems as Array<{ label: string }>)[0].label, armed, 'a search by name keeps the armed row');
    await named.key('Enter');
    assert.equal(named.calls.filter((c) => c.method === fn).length, 1);
    assert.equal(await bypass(async (b, at) => { await b.key('Enter'); await b.type('palette-input', ''); b.t.ui.paletteAt = at(); await b.key('Enter'); }), 0, 'a pasted change to the search disarms');
  }
});

test('M6-26f the usage chip toggles its popover and leaves the agent list alone', async () => {
  // protects=the usage chip click: it opens usage, not the agent list
  // fails_when=a click on the chip opens the list, or a second click, an outside click or Esc leaves the popover open
  // no_claim=the chip's text and the cost and context chips, which m6-20 and m6-25 pin
  const w = boot();
  await w.snap(snapOf([], { limits: [{ provider: 'claude', window: '5h', status: 'ok', used_pct: 40, resets_at: null }] }));
  assert.match(w.el('usage').innerHTML, /data-action="usage"/);
  const usage = () => w.el('usage').classList.contains('open');
  await w.click({ action: 'usage' }, ['#usage']);
  assert.equal(usage(), true);
  assert.equal(w.wallState.list, false);
  await w.click({ action: 'usage' }, ['#usage']);
  assert.equal(usage(), false);
  await w.click({ action: 'usage' }, ['#usage']);
  await w.click({});
  assert.equal(usage(), false, 'an outside click closes it');
  await w.click({ action: 'usage' }, ['#usage']);
  await w.key('Escape');
  assert.equal(usage(), false, 'Esc closes it');
});

test('M6-26g with no approvals the sheet says no agent actions wait while the title chip counts the waiting sessions', async () => {
  // protects=the sheet text: it talks about approvals only, so it never contradicts the need-you chip
  // fails_when=the sheet says nothing needs you while sessions wait
  // no_claim=how needsCount weighs needs_you rows
  const w = boot();
  await w.snap(snapOf([session('a', 'waiting_for_you'), session('b', 'waiting_for_you')]));
  assert.equal(w.el('sheetT').textContent, 'No agent actions waiting');
  assert.match(w.el('gates').innerHTML, />No agent actions waiting</);
  assert.equal(w.rolls.needsN, 2);
});

test('M6-26i full text sits in the title of cut-off tile, list and pane tab text, and the controls name their keys', async () => {
  // protects=text the wall cuts with an ellipsis: hover shows all of it
  // fails_when=a tooltip holds less than the full task, last line or page title, or the list, grid or need-you control does not name its key
  // no_claim=how wide the ellipsis rules let the text run
  const task = 't'.repeat(200);
  const last = 'l'.repeat(300);
  const page = 'p'.repeat(80);
  const w = boot();
  w.t.ui.tab = 'browser';
  w.t.ui.split = true;
  await w.snap(snapOf([session('a', 'done', { title: task, last_line: last })], { panes: [{ id: 'bp1', url: 'https://x.example/' }] }));
  assert.ok(w.el('list').innerHTML.includes(`title="${task}&#10;Click: big slot.`), 'list row title starts with the full task');
  w.t.ui.paneState.bp1 = { title: page, url: 'https://x.example/' };
  w.t.render();
  assert.ok(w.el('view').innerHTML.includes(`title="${page}&#10;https://x.example/"`), 'pane tab title carries all 80 characters');

  const term = tileHarness();
  term.show({ id: 'a', state: 'done', task, last, engine_id: 'claude', words: 'done' });
  assert.equal(term.part('.tile-task').title, task);
  assert.equal(term.part('.tile-last').title, last);

  const html = src('index.html');
  assert.match(html, /data-action="list" title="Agent list \(Ctrl\+B\)"/);
  assert.match(html, /data-action="inbox" title="Jump to the longest wait: Alt\+J"/);
  assert.match(src('app.js'), /label: ui\.mode === 'grid' \? 'Show one terminal' : 'Show all agents as a grid', meta: 'Ctrl\+G'/);
});

test('M6-26j the two empty states carry the button they name', async () => {
  // protects=empty states that name an action: each has a button that does it
  // fails_when=the empty browser panel or the no-project Git panel has no working button
  // no_claim=what pane.open does in the core
  const w = boot();
  w.t.ui.tab = 'browser';
  w.t.ui.split = true;
  await w.snap(snapOf([]));
  assert.match(w.el('view').innerHTML, /<button class="btn" data-action="pane-new">Open a browser pane<\/button>/);
  await w.click({ action: 'pane-new' });
  assert.equal(w.calls.filter((c) => c.method === 'pane.open').length, 1);

  const g = boot();
  await g.snap(snapOf([], { projects: [] }));
  g.t.ui.projectId = null;
  assert.match(g.t.renderGit(), /Pick a project first\. <button class="btn" data-action="project-menu">Choose a project<\/button>/);
  assert.equal(g.el('menu').hidden, true);
  await g.click({ action: 'project-menu' });
  assert.equal(g.el('menu').hidden, false, 'the project picker opens');
  assert.match(g.el('menu').innerHTML, /Open folder/);
});

/** terminal.js with a fake xterm: one tile, its key handler, link provider and right-click listener. */
function tileHarness() {
  const parts = new Map<string, any>();
  const part = (sel: string) => { if (!parts.has(sel)) parts.set(sel, makeEl(sel)); return parts.get(sel); };
  const tile: any = makeEl('tile');
  tile.querySelector = (sel: string) => part(sel);
  const sent: string[] = [];
  const copied: string[] = [];
  const pasted: string[] = [];
  const opened: string[] = [];
  let keyHandler: (e: any) => boolean = () => true;
  let provider: any = null;
  let selection = '';
  class Terminal {
    options: any = {};
    cols = 80; rows = 24; element = null;
    buffer = { active: { getLine: () => ({ translateToString: () => 'see https://x.example/a now' }) } };
    loadAddon() {} open() {} onData() {} write() {} focus() {} clearSelection() { selection = ''; }
    registerLinkProvider(p: any) { provider = p; }
    attachCustomKeyEventHandler(f: any) { keyHandler = f; }
    getSelection() { return selection; }
    hasSelection() { return Boolean(selection); }
    paste(s: string) { pasted.push(s); }
  }
  const troop = {
    onTerm() {}, termInput: (_id: string, d: string) => { sent.push(d); }, termAttach: async () => ({}), termDetach: async () => {},
    copyText: async (s: string) => { copied.push(s); }, readText: async () => 'clip', pasteImage: async () => null,
    openLink: async (t: string) => { opened.push(t); }, linkCheck: async (_id: string, files: string[]) => files.map(() => null),
  };
  const ctx = vm.createContext({
    window: { troop, Terminal, FitAddon: { FitAddon: class { fit() {} } } },
    document: { getElementById: () => makeEl('centre'), createElement: () => tile }, ResizeObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 0, clearTimeout() {}, performance,
  });
  vm.runInContext(`${src('terminal.js')}\nthis.termView = termView;`, ctx);
  const view = (ctx as any).termView;
  return {
    sent, copied, pasted, opened, part,
    show: (x: any) => view.show({ mode: 'single', selected: x.id, sessions: [x] }),
    key: (e: any) => keyHandler({ type: 'keydown', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, preventDefault() {}, ...e }),
    select: (s: string) => { selection = s; },
    rightClick: () => { for (const f of part('.tile-body').listeners.contextmenu || []) f({ preventDefault() {}, stopPropagation() {} }); },
    links: () => new Promise<any[]>((r) => provider.provideLinks(1, (l: any[]) => r(l || []))),
  };
}

/** One driver per KEYS row: fires its keys in its context and checks that its action happened. */
const DRIVERS: Record<string, () => Promise<void>> = {
  'Ctrl+K': async () => { const w = boot(); await w.snap(snapOf([])); await w.key('k', { ctrlKey: true }); assert.equal(w.el('palette').hidden, false); },
  'Ctrl+G': async () => { const w = boot(); await w.snap(snapOf([])); const before = w.t.ui.mode; await w.key('g', { ctrlKey: true }); assert.notEqual(w.t.ui.mode, before); },
  'Ctrl+B': async () => { const w = boot(); await w.snap(snapOf([])); await w.key('b', { ctrlKey: true }); assert.equal(w.wallState.list, true); },
  'Alt+J': async () => {
    const w = boot();
    const t = (s: number) => new Date(Date.UTC(2026, 9, 14, 10, 0, s)).toISOString();
    await w.snap(snapOf([session('new', 'waiting_for_you', { state_at: t(30) }), session('old', 'waiting_for_you', { state_at: t(5) }), session('mid', 'waiting_for_you', { state_at: t(10) })]));
    await w.key('j', { altKey: true });
    assert.deepEqual(w.calls.filter((c) => c.method === 'session.focus').map((c) => c.params.session_id), ['old']);
  },
  'Esc': async () => { const w = boot(); await w.snap(snapOf([])); w.t.ui.split = true; await w.key('Escape'); assert.equal(w.t.ui.split, false); },
  'Shift+Enter': async () => { const t = tileHarness(); t.show({ id: 'a', state: 'working', task: 'x', engine_id: 'claude' }); assert.equal(t.key({ key: 'Enter', shiftKey: true }), false); assert.deepEqual(t.sent, ['\x1b[200~\n\x1b[201~']); },
  'Ctrl+C with a selection': async () => { const t = tileHarness(); t.show({ id: 'a', state: 'done', task: 'x', engine_id: 'claude' }); t.select('abc'); t.key({ key: 'c', ctrlKey: true }); assert.deepEqual(t.copied, ['abc']); },
  'Ctrl+V, right-click': async () => {
    const t = tileHarness();
    t.show({ id: 'a', state: 'done', task: 'x', engine_id: 'claude' });
    t.key({ key: 'v', ctrlKey: true });
    await flush();
    t.rightClick();
    await flush();
    assert.deepEqual(t.pasted, ['clip', 'clip']);
  },
  'Ctrl+click': async () => {
    const t = tileHarness();
    t.show({ id: 'a', state: 'done', task: 'x', engine_id: 'claude' });
    const [link] = await t.links();
    link.activate({ ctrlKey: false });
    link.activate({ ctrlKey: true });
    await flush();
    assert.deepEqual(t.opened, ['https://x.example/a']);
  },
  'Ctrl+T': async () => { const w = await browserWall(); await w.key('t', { ctrlKey: true }); assert.equal(w.calls.filter((c) => c.method === 'pane.open').length, 1); },
  'Ctrl+L': async () => { const w = await browserWall(); await w.key('l', { ctrlKey: true }, inBrowser()); assert.equal(doc.activeElement.id, 'pane-url'); },
  'Ctrl+F': async () => { const w = await browserWall(); await w.key('f', { ctrlKey: true }, inBrowser()); assert.ok(w.t.ui.find); },
  'Ctrl+R, F5': async () => { const w = await browserWall(); await w.key('r', { ctrlKey: true }, inBrowser()); await w.key('F5', {}, inBrowser()); assert.deepEqual(acts(w), ['reload', 'reload']); },
  'Alt+Left, Alt+Right': async () => { const w = await browserWall(); await w.key('ArrowLeft', { altKey: true }, inBrowser()); await w.key('ArrowRight', { altKey: true }, inBrowser()); assert.deepEqual(acts(w), ['back', 'forward']); },
  'Ctrl+=, Ctrl+-, Ctrl+0': async () => {
    const w = await browserWall();
    for (const k of ['=', '-', '0']) await w.key(k, { ctrlKey: true }, inBrowser());
    assert.deepEqual(acts(w), ['zoom-in', 'zoom-out', 'zoom-reset']);
  },
  'F12': async () => { const w = await browserWall(); await w.key('F12', {}, inBrowser()); assert.deepEqual(acts(w), ['devtools']); },
  'C': async () => { const w = await browserWall(); await w.key('c', {}, doc.body); assert.equal(w.calls.filter((c) => c.method === 'api.panePick').length, 1); },
  'Up, Down': async () => {
    const w = await browserWall();
    w.t.ui.comment = { pane_id: 'bp1' };
    await w.key('ArrowUp', {}, doc.body);
    await w.key('ArrowDown', {}, doc.body);
    assert.deepEqual(w.calls.filter((c) => c.method === 'api.panePickWalk').map((c) => c.params[1]), ['up', 'down']);
  },
};

async function browserWall() {
  const w = boot();
  w.t.ui.tab = 'browser';
  w.t.ui.split = true;
  await w.snap(snapOf([], { panes: [{ id: 'bp1', url: 'https://x.example/' }] }));
  return w;
}
function inBrowser() {
  const target: any = makeEl('', 'DIV');
  target.closest = (sel: string) => (sel === '.browser' ? target : null);
  return target;
}
const acts = (w: ReturnType<typeof boot>) => w.calls.filter((c) => c.method === 'api.paneAct').map((c) => c.params[1]);

test('M6-26h every KEYS row fires its action, and the palette lists one row per entry', async () => {
  // protects=the Keyboard shortcuts list: each row it shows is a key that works
  // fails_when=a handler named in KEYS is removed or stops doing its job, a KEYS row has no driver here, or the palette view drops a row
  // no_claim=Mac key names, which the wall does not offer
  const w = boot();
  await w.snap(snapOf([]));
  const keys = w.t.KEYS as Array<{ keys: string; does: string; where: string }>;
  assert.deepEqual(Array.from(keys, (k) => k.keys), Object.keys(DRIVERS));

  await w.key('k', { ctrlKey: true });
  w.t.ui.paletteAt = (w.t.ui.paletteItems as Array<{ label: string }>).findIndex((x) => x.label === 'Keyboard shortcuts');
  await w.key('Enter');
  assert.equal(w.el('palette').hidden, false);
  const rows = w.el('palette-list').innerHTML.match(/class="ri/g) || [];
  assert.equal(rows.length, keys.length);
  for (const k of keys) assert.ok(w.el('palette-list').innerHTML.includes(k.does.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`).replace('&#40;', '(')) || w.el('palette-list').innerHTML.includes(k.does), k.does);
  await w.key('Escape');
  assert.equal(w.el('palette').hidden, true);

  for (const row of keys) await assert.doesNotReject(DRIVERS[row.keys](), row.keys);
});

/** Key literals compared on a line within three lines of a ctrlKey, altKey or mod check, as KEYS names them. */
function modifierKeys(source: string): string[] {
  const lines = source.split('\n');
  const names: Record<string, string> = { arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down', escape: 'esc', '+': '=' };
  const out = new Set<string>();
  lines.forEach((line, i) => {
    if (!lines.slice(Math.max(0, i - 3), i + 1).some((l) => /ctrlKey|altKey|\bmod\b/.test(l))) return;
    for (const m of line.matchAll(/(?:e\.key(?:\.toLowerCase\(\))?|\bkey|\bk)\s*[!=]==\s*'([^']+)'/g)) out.add(names[m[1].toLowerCase()] ?? m[1].toLowerCase());
    for (const m of line.matchAll(/e\.code\s*[!=]==\s*'Key([A-Z])'/g)) out.add(m[1].toLowerCase());
  });
  return [...out];
}

test('M6-26h static: every key a handler checks with a modifier has a KEYS row', () => {
  // protects=KEYS staying complete when someone adds a Ctrl or Alt key
  // fails_when=app.js or terminal.js checks a key under ctrlKey, altKey or mod that no KEYS row names
  // no_claim=keys with no modifier, such as Space to swap in Compare
  const w = boot();
  const tokens = new Set((w.t.KEYS as Array<{ keys: string }>).flatMap((k) => k.keys.toLowerCase().split(/[ ,+]+/)));
  const missing = (source: string) => modifierKeys(source).filter((k) => !tokens.has(k));
  assert.deepEqual(missing(src('app.js')), []);
  assert.deepEqual(missing(src('terminal.js')), []);
  assert.deepEqual(missing(`${src('app.js')}\n  if (e.ctrlKey && key === 'q') act = 'quit';\n`), ['q'], 'the scan sees a new Ctrl key');
});

test('M6-26h sweep: every Ctrl or Alt combination a handler consumes on the wall, in the browser or in a tile has a KEYS row', async () => {
  // protects=KEYS staying complete with the modifier, not just the letter (an undocumented Alt+B next to Ctrl+B)
  // fails_when=a keydown with Ctrl or Alt is consumed (preventDefault, or false from the tile's key handler) and no KEYS row names that combination
  // no_claim=combinations with Shift or Meta, and keys that only act inside the palette
  const w = boot();
  await w.snap(snapOf([]));
  const norm: Record<string, string> = { left: 'arrowleft', right: 'arrowright', up: 'arrowup', down: 'arrowdown', '+': '=' };
  const listed = new Set(Array.from(w.t.KEYS as Array<{ keys: string }>).flatMap((k) => k.keys.split(',').map((c) => c.trim().split(' ')[0].toLowerCase().split('+').map((p, i, a) => (i === a.length - 1 && p === '' ? '+' : norm[p] ?? p)).filter(Boolean).join('+'))));
  const names = [...'abcdefghijklmnopqrstuvwxyz0123456789', '=', '+', '-', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)];
  const consumed: string[] = [];
  for (const mod of ['ctrl', 'alt']) {
    for (const key of names) {
      const combo = `${mod}+${norm[key.toLowerCase()] ?? key.toLowerCase()}`;
      const mods = { ctrlKey: mod === 'ctrl', altKey: mod === 'alt' };
      for (const where of ['wall', 'browser']) {
        const b = where === 'wall' ? boot() : await browserWall();
        if (where === 'wall') await b.snap(snapOf([session('s_w', 'waiting_for_you')]));
        let prevented = false;
        const target = where === 'browser' ? inBrowser() : doc.body;
        await b.key(key, { ...mods, preventDefault() { prevented = true; } }, target);
        if (prevented) consumed.push(combo);
      }
      const tile = tileHarness();
      tile.show({ id: 'a', state: 'done', task: 'x', engine_id: 'claude' });
      tile.select('sel');
      if (tile.key({ key, ...mods }) === false) consumed.push(combo);
    }
  }
  assert.deepEqual([...new Set(consumed)].filter((c) => !listed.has(c) && !listed.has(c.split('+').pop()!)), []);
  assert.ok(consumed.includes('ctrl+k') && consumed.includes('alt+j') && consumed.includes('ctrl+v'), 'the sweep sees real handlers');
});

test('M6-26k icon and symbol buttons carry an aria-label, the popovers are dialogs, and Esc closes them from their inputs', async () => {
  // protects=controls a screen reader would read as nothing or as x
  // fails_when=a rendered button with empty, x or one-symbol text has no aria-label, Inbox or sinks lacks role=dialog, or Esc in their inputs leaves them open
  // no_claim=focus traps, which the issue leaves out
  const w = boot();
  w.t.ui.tab = 'browser';
  w.t.ui.split = true;
  w.t.ui.find = { text: 'x', active: 0, matches: 0 };
  w.t.ui.shells.push({ id: 'sh_1', label: 'pwsh', cwd: '/p', project_id: 'p1', kind: 'pwsh' });
  await w.snap(snapOf([session('a', 'done'), session('b', 'exited')], { panes: [{ id: 'bp1', url: 'https://x.example/' }] }));
  w.t.ui.paneState.bp1 = { loading: true };
  w.t.render();
  const tileHtml = src('terminal.js').match(/const TILE_HTML = `([^`]*)`/)![1];
  const html = [src('index.html'), tileHtml, w.el('list').innerHTML, w.el('view').innerHTML, w.el('tabs').innerHTML, w.el('usage').innerHTML].join('\n');
  const decode = (s: string) => s.replace(/<[^>]*>/g, '').replace(/&times;/g, 'x').replace(/&[a-z]+;|&#\d+;/g, '#').trim();
  const rendered = (attrs: string, inner: string) => { const id = attrs.match(/\bid="([^"]+)"/); return id && w.el(id[1]).innerHTML ? w.el(id[1]).innerHTML : inner; };
  const bad = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    .filter(([, attrs]) => !/\shidden(\s|$)/.test(attrs))
    .filter(([, attrs, inner]) => { const t = decode(rendered(attrs, inner)); return (t === '' || t.toLowerCase() === 'x' || /^[^\p{L}]$/u.test(t)) && !/aria-label="[^"]+"/.test(attrs); })
    .map(([b]) => b.slice(0, 120));
  assert.deepEqual(bad, []);
  assert.ok(html.includes('data-action="pane-act" data-act="stop"'), 'the loading pane shows its Stop button');
  assert.ok(html.includes('data-action="shell-close"'), 'a shell row is in the list');

  const index = src('index.html');
  assert.match(index, /id="inbox" class="inbox" role="dialog" aria-label="Inbox"/);
  assert.match(index, /id="sinks" class="inbox" role="dialog" aria-label="Notification sinks"/);
  const input = makeEl('sink-name', 'INPUT');
  w.el('sinks').hidden = false;
  w.el('sinks').append(input);
  input.focus();
  await w.key('Escape', {}, input);
  assert.equal(w.el('sinks').hidden, true, 'Esc in a sinks input closes it');
  const row = makeEl('', 'DIV');
  w.el('inbox').hidden = false;
  w.el('inbox').append(row);
  doc.activeElement = row;
  await w.key('Escape', {}, row);
  assert.equal(w.el('inbox').hidden, true, 'Esc in the Inbox closes it');
});
