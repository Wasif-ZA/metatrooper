import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';

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
const snapOf = (sessions: any[]) => ({
  core: { online: true, pid: 1, heartbeat_age_ms: 0 }, projects: [{ id: 'p1', name: 'p', path: '/p' }], sessions, live: [],
  approvals: [], needs_you: [], engines: [], limits: [], panes: [], snapshots: [], git: {}, dev_servers: [], watcher_off: [], selected: null,
});

const text = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
/** Source from `start` to the first `end` after it (the function's closing brace). */
function slice(src: string, start: string, end: string): string {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `found ${start}`);
  const j = src.indexOf(end, i);
  assert.ok(j >= 0, `found end of ${start}`);
  return src.slice(i, j + end.length);
}
const settingsJsx = () => text('../ui/src/settings.jsx');
const appJs = () => text('../renderer/app.js');
const termJs = () => text('../renderer/terminal.js');
const idePanel = () => text('../ui/src/ide-panel.jsx');
const methodsTs = () => text('../../core/src/methods.ts');

/** The Settings page's write(), with api, toast, applyLook and friends faked. */
function settingsWrite(reply: any, look: any) {
  const log: any[] = [];
  const fn = new Function('api', 'toast', 'ui', 'applyLook', 'render', 'reload', `${slice(settingsJsx(), 'async function write(', '\n}\n')}\nreturn write;`);
  const write = fn(
    { setSetting: async (k: string, v: unknown) => { log.push(['setSetting', k, v]); return reply; }, setApproval: async () => ({}), uiSettings: async () => look },
    (m: string, bad: boolean) => log.push(['toast', m, bad]), {}, (l: any) => log.push(['applyLook', l]), () => log.push(['render']), async () => log.push(['reload']),
  );
  return { write, log };
}

/** The core's settings.set handler, with the real DEFAULTS and setSetting writing under a throwaway home. */
async function coreSet() {
  const m = /m\.set\('settings\.set', \{\s*handler: (\(p\) => \{[\s\S]*?\n    \}),\n  \}\);/.exec(methodsTs());
  assert.ok(m, 'settings.set handler found');
  const { DEFAULTS, setSetting, settingsFile } = await import('../../core/src/settings.ts');
  class RpcError extends Error { code: number; constructor(code: number, message: string) { super(message); this.code = code; } }
  const handler = new Function('str', 'RpcError', 'E', 'DEFAULTS', 'setSetting', `return ${stripTypeScriptTypes(m[1])};`)(
    (p: any, k: string) => p[k], RpcError, { INVALID_PARAMS: -32602, VALIDATION: -32000 }, DEFAULTS, setSetting);
  const home = mkdtempSync(join(tmpdir(), 'm7-12-'));
  process.env.METATROOPER_HOME = home;
  return { handler, file: settingsFile(), home };
}

test('M7-12b settings.set writes terminal.font_size to settings.json and keeps the other keys', async () => {
  const { handler, file, home } = await coreSet();
  try {
    writeFileSync(file, JSON.stringify({ sessions: { approval: 'contained' }, terminal: { scrollback: 777 } }));
    assert.deepEqual(handler({ key: 'terminal.font_size', value: 20 }), {});
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { sessions: { approval: 'contained' }, terminal: { scrollback: 777, font_size: 20 } });
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('M7-12b a Settings change reaches open tiles and Editor terminals without a restart', async () => {
  const look = { theme: { font_mono: 'mono', scheme: 'dark' }, terminal: { font_size: 20, scrollback: 1000 } };
  const { write, log } = settingsWrite({ ok: true }, look);
  await write('terminal.font_size', 20);
  assert.deepEqual(log.map((x) => x[0]), ['setSetting', 'applyLook', 'render', 'reload']);
  assert.deepEqual(log[0], ['setSetting', 'terminal.font_size', 20]);
  assert.equal(log[1][1], look, 'the look read back after the write is applied');

  // terminal.js setLook sets fontSize on every open xterm
  const terms = new Map([['a', { term: { options: {} as any } }], ['b', { term: { options: {} as any } }]]);
  const setLook = new Function('terms', 'resize', `let look; const xtermTheme = () => ({}); const contrast = () => 1;\n${slice(termJs(), 'function setLook(next) {', '\n  }\n')}\nreturn setLook;`)(terms, () => {});
  // ide-panel.jsx ideTermLook updates each Editor shell's xterm
  const shells = new Map([['s', { term: { options: {} as any } }]]);
  const g: any = { setUiScheme() {} };
  new Function('shells', 'ui', 'globalThis', `${slice(idePanel(), 'function look() {', '\n}\n')}\n${slice(idePanel(), 'globalThis.ideTermLook =', '\n')}`)(shells, { look }, g);
  // app.js applyLook hands the look to both
  const doc = { documentElement: { style: { removeProperty() {}, setProperty() {} }, dataset: {} } };
  const ui: any = {};
  new Function('ui', 'document', 'termView', 'THEME_VARS', 'globalThis', `${slice(appJs(), 'function applyLook(look) {', '\n}\n')}\napplyLook(arguments[5]);`)(ui, doc, { setLook }, {}, g, look);
  assert.equal(ui.look, look);
  for (const t of terms.values()) assert.equal(t.term.options.fontSize, 20, 'open wall tile');
  assert.equal(shells.get('s')!.term.options.fontSize, 20, 'open Editor terminal');
});

test('M7-12c a value that is not a number is refused with a message and settings.json is unchanged', async () => {
  const { handler, file, home } = await coreSet();
  try {
    const before = JSON.stringify({ sessions: { approval: 'contained' }, terminal: { font_size: 13 } });
    writeFileSync(file, before);
    for (const value of ['20', null, [20], {}, true, undefined]) {
      assert.throws(() => handler({ key: 'terminal.font_size', value }), /terminal\.font_size must be a number/);
      assert.equal(readFileSync(file, 'utf8'), before);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
  // the page shows the core's message as an error toast and does not touch terminals
  const { write, log } = settingsWrite({ error: 'terminal.font_size must be a number' }, {});
  await write('terminal.font_size', '20');
  assert.deepEqual(log.find((x) => x[0] === 'toast'), ['toast', 'terminal.font_size must be a number', true]);
  assert.equal(log.some((x) => x[0] === 'applyLook'), false);
});

test('M7-12c a number outside 8 to 28 or a fraction is not written and the field shows the message', () => {
  const src = settingsJsx();
  assert.match(src, /key: 'terminal\.font_size', label: 'Font size', min: 8, max: 28/);
  const sent: unknown[] = [];
  let bad = false;
  let props: any;
  // NumberRow returns JSX, so its hooks and onChange run as written and the NumberInput status prop is read back from the source
  const fn = slice(src, 'function NumberRow(', '\n}\n');
  const status = /status=\{(.*)\} onChange=\{onChange\}/.exec(fn);
  assert.ok(status, 'NumberInput status prop found');
  const NumberRow = new Function('useState', 'write', `${fn.slice(0, fn.indexOf('return <NumberInput'))}\nreturn { status: ${status[1]}, onChange };\n}\nreturn NumberRow;`)(
    () => [bad, (b: boolean) => { bad = b; }], (_k: string, n: number) => sent.push(n));
  const draw = () => { props = NumberRow({ row: { key: 'terminal.font_size', label: 'Font size', min: 8, max: 28 }, v: 13 }); return props.status; };
  const message = { type: 'error', message: 'Use a whole number from 8 to 28; not saved.' };
  for (const n of [7, 29, 8.5]) {
    draw();
    props.onChange(n);
    assert.deepEqual(draw(), message, `${n} shows the message`);
  }
  assert.deepEqual(sent, [], 'nothing is written');
  draw();
  props.onChange(20);
  assert.deepEqual(sent, [20]);
  assert.equal(draw(), undefined, 'a valid value clears the error');
});

test('M7-12e Esc closes the Ctrl+K palette with its History group showing, and closes Settings', async () => {
  const w = boot();
  w.replies['session.search'] = { hits: [] };
  w.replies['session.history'] = { sessions: [{ id: 'old1', project_id: 'p1', engine_id: 'claude', state: 'exited', started_at: at, title: 'ancient refactor', prompt: '', hidden: false }] };
  await w.snap(snapOf([session('a', 'done')]));
  await w.key('k', { ctrlKey: true });
  assert.equal(w.el('palette').hidden, false);
  await w.type('palette-input', 'ancient');
  await w.advance(150);
  assert.ok((w.t.ui.paletteItems as any[]).some((x) => x.group === 'History' && x.label === 'ancient refactor'), 'History group is showing');
  await w.key('Escape');
  assert.equal(w.el('palette').hidden, true, 'Esc closes the palette');

  await w.key(',', { ctrlKey: true });
  assert.equal(w.settingsView.isOpen(), true);
  await w.key('Escape');
  assert.equal(w.settingsView.isOpen(), false, 'Esc closes Settings');
});
