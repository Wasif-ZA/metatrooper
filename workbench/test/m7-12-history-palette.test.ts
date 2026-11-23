import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const src = (f: string) => readFileSync(new URL(`../renderer/${f}`, import.meta.url), 'utf8');
const UI_METHODS: Set<string> = new Function(`${readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8').match(/^export const UI_METHODS\s*=\s*new Set\(\[[^]*?\]\);/m)![0].replace(/^export\s+/, '')}; return UI_METHODS;`)();
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
    focus: () => { (el.owner || doc).activeElement = el; }, blur() { const o = el.owner || doc; if (o && o.activeElement === el) o.activeElement = o.body; }, select() {}, scrollIntoView() {}, setSelectionRange() {},
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
      if (name === 'call') return async (method: string, params: any) => { calls.push({ method, params, at: now }); if (!UI_METHODS.has(method)) return { kind: 'reply', reply: { id: null, error: { code: -32601, message: `the workbench does not call ${method}` } } }; const r = replies[method]; return { kind: 'ok', reply: { result: (typeof r === 'function' ? await r(params) : r) ?? {} } }; };
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
  let settingsOpen = false;
  const settingsView = {
    open: () => { calls.push({ method: 'settings.open', params: [], at: now }); settingsOpen = true; },
    close: () => { calls.push({ method: 'settings.close', params: [], at: now }); const wasOpen = settingsOpen; settingsOpen = false; return wasOpen; },
    isOpen: () => settingsOpen,
  };
  class FakeDate extends Date { static now() { return now; } }
  const ctx: any = {
    window: { troop: api, addEventListener() {} }, document: doc, location: { search: '' }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    URLSearchParams, URL, wall, termView, settingsView, CSS: { escape: (s: string) => s }, matchMedia: () => ({ matches: false }), Date: FakeDate, console,
    MutationObserver: class { observe() {} },
    setTimeout: (f: () => void, ms = 0) => { const id = ++seq; timers.push({ id, at: now + ms, f }); return id; },
    clearTimeout: (id: number) => { timers = timers.filter((t) => t.id !== id); },
    setInterval: () => 0,
  };
  ctx.global = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${src('diff.js')}\n${src('browser-chrome.js')}\n${src('app.js')}\nthis.t = { ui, KEYS, onClick, render, globalThis: this };`, ctx);
  const t = (ctx as any).t;
  const fire = (type: string, e: any) => {
    let stopped = false;
    const ev = { preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() { stopped = true; }, target: d.activeElement, ...e };
    for (const capture of [true, false]) for (const l of docListeners) if (l.type === type && l.capture === capture && !stopped) l.f(ev);
  };
  return {
    t, calls, handlers, replies, rolls, wallState, settingsView, el: (id: string) => d.getElementById(id), shown: () => shown,
    now: () => now,
    global: ctx,
    globalThis: ctx,
    ctx,
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

const old = { id: 'old1', project_id: 'p1', engine_id: 'codex', state: 'exited', started_at: '2025-01-02T03:04:05.000Z', title: 'ancient\n  refactor', prompt: '', hidden: true };
const live = { id: 'b', project_id: 'p1', engine_id: 'claude', state: 'done', started_at: at, title: 'task b ancient', prompt: '', hidden: false };
const alive = { id: 'old2', project_id: 'p1', engine_id: 'claude', state: 'done', started_at: '2025-02-03T00:00:00.000Z', title: '', prompt: 'ancient prompt only', hidden: false };

async function search(w: ReturnType<typeof boot>, sessions: any[]) {
  w.replies['session.search'] = { hits: [] };
  w.replies['session.history'] = { sessions };
  w.replies['session.resume'] = { session_id: 'new1' };
  await w.snap(snapOf([session('a', 'done'), session('b', 'done')]));
  await w.key('k', { ctrlKey: true });
  await w.type('palette-input', 'ancient');
  await w.advance(150);
  return (w.t.ui.paletteItems as any[]);
}
const rows = (w: ReturnType<typeof boot>) => w.calls.map((c) => c.method).filter((m) => m === "session.resume" || m === "session.focus");

test('M7-12a the palette shows a History group of only the sessions the snapshot lacks, asking the core with the typed text', async () => {
  const w = boot();
  const items = await search(w, [old, live]);
  assert.deepEqual(JSON.parse(JSON.stringify(w.calls.find((c) => c.method === 'session.history')!.params)), { query: 'ancient', limit: 20 });
  const hist = items.filter((x) => x.group === 'History');
  assert.equal(hist.length, 1, 'b is in the snapshot, so it is not a History row');
  assert.equal(hist[0].label, 'ancient refactor', 'whitespace collapsed');
  assert.equal(hist[0].meta, 'codex · 2025-01-02 · hidden');
  assert.ok(w.el('palette-list').innerHTML.includes('History'));
});

test('M7-12a History sits after the normal items and before Scrollback, and label falls back to the prompt', async () => {
  const w = boot();
  w.replies['session.search'] = { hits: [{ session_id: 'a', line: 1, text: 'ancient scroll line' }] };
  w.replies['session.history'] = { sessions: [alive] };
  await w.snap(snapOf([session('a', 'done')]));
  await w.key('k', { ctrlKey: true });
  await w.type('palette-input', 'ancient');
  await w.advance(150);
  const groups = (w.t.ui.paletteItems as any[]).map((x) => x.group);
  const h = groups.indexOf('History'), s = groups.indexOf('Scrollback');
  assert.ok(h >= 0 && s > h, `History (${h}) before Scrollback (${s})`);
  assert.ok(groups.slice(0, h).every((g) => g !== 'Scrollback' && g !== 'History'));
  assert.equal((w.t.ui.paletteItems as any[])[h].label, 'ancient prompt only');
  assert.equal((w.t.ui.paletteItems as any[])[h].meta, 'claude · 2025-02-03');
  await w.type('palette-input', '');
  assert.equal((w.t.ui.paletteItems as any[]).some((x) => x.group === 'History'), false, 'no query, no History');
});

test('M7-12a choosing an exited History row resumes it and picks the session the core returns', async () => {
  const w = boot();
  const items = await search(w, [old]);
  await w.click({ palette: String(items.findIndex((x) => x.group === 'History')) });
  await w.advance(0);
  const resume = w.calls.find((c) => c.method === 'session.resume')!;
  assert.deepEqual(JSON.parse(JSON.stringify(resume.params)), { session_id: 'old1' });
  const focus = w.calls.filter((c) => c.method === 'session.focus');
  assert.deepEqual(focus.map((c) => c.params.session_id), ['new1']);
  assert.ok(w.calls.indexOf(resume) < w.calls.indexOf(focus[0]), 'resume first');
  assert.equal(w.el('palette').hidden, true);
});

test('M7-12a choosing a History row that is not exited picks it without resuming', async () => {
  const w = boot();
  const items = await search(w, [alive]);
  await w.click({ palette: String(items.findIndex((x) => x.group === 'History')) });
  await w.advance(0);
  assert.deepEqual(rows(w), ['session.focus']);
  assert.equal(w.calls.find((c) => c.method === 'session.focus')!.params.session_id, 'old2');
});

for (const [name, row, resumed] of [['exited', { ...old, id: 'oldp2', project_id: 'p2' }, 'new1'], ['live', { ...alive, id: 'liveP2', project_id: 'p2' }, 'liveP2']] as const) {
  test(`M7-12a choosing a ${name} History row of another project switches project with pendingPick and does not pick it directly`, async () => {
    const w = boot();
    const items = await search(w, [row]);
    await w.click({ palette: String(items.findIndex((x) => x.group === 'History')) });
    await w.advance(0);
    assert.equal(w.calls.some((c) => c.method === 'session.resume'), name === 'exited');
    assert.equal(w.t.ui.projectId, 'p2');
    assert.equal(w.t.ui.pendingPick, resumed);
    assert.equal(w.calls.some((c) => c.method === 'session.focus'), false, 'no direct pick');
  });
}
