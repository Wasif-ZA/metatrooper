import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const wb = fileURLToPath(new URL('../', import.meta.url));
const termSrc = fs.readFileSync(path.join(wb, 'renderer/terminal.js'), 'utf8');

function createHarness() {
  const sentInputs: Array<{ id: string; data: string }> = [];
  const createdTerms: Map<string, any> = new Map();

  class MockTerminal {
    options: any;
    element: any;
    cols = 80;
    rows = 24;
    buffer = { active: { getLine: () => ({ translateToString: () => '' }) } };
    customKeyHandler: Function | null = null;
    onDataHandler: Function | null = null;

    constructor(opts: any = {}) {
      this.options = opts;
      this.element = { querySelector: () => ({ offsetHeight: 20 }) };
    }
    loadAddon() {}
    open() {}
    onData(fn: Function) { this.onDataHandler = fn; }
    registerLinkProvider() {}
    attachCustomKeyEventHandler(fn: Function) { this.customKeyHandler = fn; }
    getSelection() { return ''; }
    clearSelection() {}
    paste() {}
    focus() {}
    dispose() {}
    write(data: string, cb?: Function) { if (cb) cb(); }
  }

  const makeElement = (tag: string = 'div', className: string = '') => {
    const classes = new Set<string>(className ? className.split(' ') : []);
    const children: any[] = [];
    const listeners: Record<string, Function[]> = {};
    const dataset: Record<string, string> = {};
    const el: any = {
      tagName: tag.toUpperCase(),
      className,
      dataset,
      style: {},
      hidden: false,
      title: '',
      textContent: '',
      innerHTML: '',
      ariaLabel: '',
      role: '',
      parentNode: null,
      isConnected: true,
      offsetWidth: 100,
      classList: {
        add: (...c: string[]) => { for (const x of c) classes.add(x); el.className = Array.from(classes).join(' '); },
        remove: (...c: string[]) => { for (const x of c) classes.delete(x); el.className = Array.from(classes).join(' '); },
        contains: (c: string) => classes.has(c),
        toggle: (c: string, force?: boolean) => {
          const v = force !== undefined ? Boolean(force) : !classes.has(c);
          if (v) classes.add(c); else classes.delete(c);
          el.className = Array.from(classes).join(' ');
          return v;
        },
      },
      addEventListener: (type: string, fn: Function) => { (listeners[type] ||= []).push(fn); },
      removeEventListener: () => {},
      append: (...nodes: any[]) => { for (const n of nodes) { n.parentNode = el; children.push(n); } },
      appendChild: (node: any) => { node.parentNode = el; children.push(node); return node; },
      removeChild: (node: any) => { node.parentNode = null; return node; },
      replaceChildren: (...nodes: any[]) => { children.length = 0; for (const n of nodes) { n.parentNode = el; children.push(n); } },
      remove: () => {},
      querySelector: (sel: string) => {
        if (sel === '.tile-body') return el._body || (el._body = makeElement('div', 'tile-body'));
        if (sel === '.tile-head') return el._head || (el._head = makeElement('div', 'tile-head'));
        if (sel.startsWith('.')) {
          const cls = sel.slice(1);
          if (!el['_' + cls]) el['_' + cls] = makeElement('span', cls);
          return el['_' + cls];
        }
        return makeElement('div');
      },
    };
    return el;
  };

  const centre = makeElement('div', 'centre');

  const doc = {
    getElementById: (id: string) => (id === 'centre' ? centre : makeElement('div')),
    createElement: (tag: string) => makeElement(tag),
  };

  const troop = {
    termInput: (id: string, data: string) => { sentInputs.push({ id, data }); },
    termAttach: async () => ({ windows_build: 0 }),
    termDetach: async () => {},
    termResize: () => {},
    termAck: () => {},
    onTerm: () => {},
    linkCheck: async () => [],
    copyText: async () => {},
    readText: async () => '',
    pasteImage: async () => null,
    openLink: async () => {},
  };

  let termCount = 0;
  const ctx: any = {
    window: {
      troop,
      Terminal: class extends MockTerminal {
        constructor(opts: any) {
          super(opts);
          createdTerms.set('term-' + (++termCount), this);
        }
      },
      FitAddon: { FitAddon: class { fit() {} } },
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    document: doc,
    ResizeObserver: class { observe() {} disconnect() {} },
    performance: { now: () => Date.now() },
    clearTimeout: () => {},
    setTimeout: () => 0,
    ui: { snap: { engines: [] as any[] } },
  };
  ctx.globalThis = ctx;
  ctx.window.window = ctx.window;
  ctx.overlayOpen = () => false;

  vm.createContext(ctx);
  const termView = vm.runInContext(termSrc + '\n; termView;', ctx);
  ctx.termView = termView;
  ctx.window.termView = termView;

  return { ctx, troop, sentInputs, createdTerms, termView };
}

test('Shift+Enter in a .shell tile sends escape carriage return', () => {
  const h = createHarness();
  h.termView.show({
    mode: 'single',
    selected: 'shell-1',
    sessions: [{ id: 'shell-1', shell: true, state: 'working', engine_id: 'bash' }],
  });

  const term = h.createdTerms.get('term-1');
  assert.ok(term);
  assert.equal(typeof term.customKeyHandler, 'function');

  let prevented = false;
  const ev = {
    type: 'keydown',
    key: 'Enter',
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault() { prevented = true; },
  };

  const res = term.customKeyHandler(ev);
  assert.equal(res, false);
  assert.equal(prevented, true);
  assert.deepEqual(h.sentInputs, [{ id: 'shell-1', data: '\x1b\r' }]);

  // Keyup swallows the event without re-sending
  prevented = false;
  h.sentInputs.length = 0;
  const keyUpEv = { ...ev, type: 'keyup', preventDefault() { prevented = true; } };
  const upRes = term.customKeyHandler(keyUpEv);
  assert.equal(upRes, false);
  assert.equal(prevented, true);
  assert.equal(h.sentInputs.length, 0);
});

test('Shift+Enter in a .shell tile sends escape carriage return even if engine shift_enter is paste', () => {
  const h = createHarness();
  h.ctx.ui.snap.engines = [{ id: 'custom-shell', shift_enter: 'paste' }];
  h.termView.show({
    mode: 'single',
    selected: 'shell-2',
    sessions: [{ id: 'shell-2', shell: true, state: 'working', engine_id: 'custom-shell' }],
  });

  const term = h.createdTerms.get('term-1');
  let prevented = false;
  const ev = {
    type: 'keydown',
    key: 'Enter',
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault() { prevented = true; },
  };

  const res = term.customKeyHandler(ev);
  assert.equal(res, false);
  assert.equal(prevented, true);
  assert.deepEqual(h.sentInputs, [{ id: 'shell-2', data: '\x1b\r' }]);
});

test('agent tiles keep their per-engine choice for Shift+Enter', () => {
  const h = createHarness();
  h.ctx.ui.snap.engines = [
    { id: 'engine-alt', shift_enter: 'alt-enter' },
    { id: 'engine-paste', shift_enter: 'paste' },
  ];

  h.termView.show({
    mode: 'grid',
    selected: 'a-alt',
    sessions: [
      { id: 'a-alt', shell: false, state: 'working', engine_id: 'engine-alt' },
      { id: 'a-paste', shell: false, state: 'working', engine_id: 'engine-paste' },
      { id: 'a-default', shell: false, state: 'working', engine_id: 'unregistered' },
      { id: 'a-compound', shell: false, state: 'working', engine_id: 'engine-alt > sub' },
    ],
  });

  const termAlt = h.createdTerms.get('term-1');
  const termPaste = h.createdTerms.get('term-2');
  const termDefault = h.createdTerms.get('term-3');
  const termCompound = h.createdTerms.get('term-4');

  // alt-enter sends \x1b\r
  let prevented = false;
  let res = termAlt.customKeyHandler({
    type: 'keydown', key: 'Enter', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false,
    preventDefault() { prevented = true; },
  });
  assert.equal(res, false);
  assert.equal(prevented, true);
  assert.deepEqual(h.sentInputs, [{ id: 'a-alt', data: '\x1b\r' }]);

  // paste sends bracketed paste newline
  h.sentInputs.length = 0;
  prevented = false;
  res = termPaste.customKeyHandler({
    type: 'keydown', key: 'Enter', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false,
    preventDefault() { prevented = true; },
  });
  assert.equal(res, false);
  assert.equal(prevented, true);
  assert.deepEqual(h.sentInputs, [{ id: 'a-paste', data: '\x1b[200~\n\x1b[201~' }]);

  // unregistered engine falls back to paste
  h.sentInputs.length = 0;
  prevented = false;
  res = termDefault.customKeyHandler({
    type: 'keydown', key: 'Enter', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false,
    preventDefault() { prevented = true; },
  });
  assert.equal(res, false);
  assert.equal(prevented, true);
  assert.deepEqual(h.sentInputs, [{ id: 'a-default', data: '\x1b[200~\n\x1b[201~' }]);

  // compound engine ID splits prefix before arrow
  h.sentInputs.length = 0;
  prevented = false;
  res = termCompound.customKeyHandler({
    type: 'keydown', key: 'Enter', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false,
    preventDefault() { prevented = true; },
  });
  assert.equal(res, false);
  assert.equal(prevented, true);
  assert.deepEqual(h.sentInputs, [{ id: 'a-compound', data: '\x1b\r' }]);
});

test('plain Enter is unchanged and propagates to terminal', () => {
  const h = createHarness();
  h.termView.show({
    mode: 'grid',
    selected: 'shell-plain',
    sessions: [
      { id: 'shell-plain', shell: true, state: 'working', engine_id: 'bash' },
      { id: 'agent-plain', shell: false, state: 'working', engine_id: 'claude' },
    ],
  });

  const termShell = h.createdTerms.get('term-1');
  const termAgent = h.createdTerms.get('term-2');

  for (const term of [termShell, termAgent]) {
    let prevented = false;
    const res = term.customKeyHandler({
      type: 'keydown',
      key: 'Enter',
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault() { prevented = true; },
    });
    assert.equal(res, true);
    assert.equal(prevented, false);
  }
  assert.equal(h.sentInputs.length, 0);
});
