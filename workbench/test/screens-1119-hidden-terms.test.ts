import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = (file: string) => readFileSync(new URL(`../renderer/${file}`, import.meta.url), 'utf8');

// Only the DOM operations used by the tile header; parse the real TILE_HTML so
// querySelector follows document order, including after nodes move into menu.
function node(tagName = 'div'): any {
  const el: any = {
    tagName, className: '', dataset: {}, style: {}, children: [], parentNode: null,
    hidden: false, title: '', textContent: '', clientWidth: 800, offsetWidth: 0,
    isConnected: true, addEventListener() {},
    remove() {
      if (el.parentNode) el.parentNode.children = el.parentNode.children.filter((n: any) => n !== el);
      el.parentNode = null;
    },
    append(...kids: any[]) {
      for (const kid of kids) { kid.remove(); kid.parentNode = el; el.children.push(kid); }
    },
    before(...kids: any[]) {
      const parent = el.parentNode;
      for (const kid of kids) {
        kid.remove(); kid.parentNode = parent;
        parent.children.splice(parent.children.indexOf(el), 0, kid);
      }
    },
    querySelectorAll(selector: string) {
      if (selector === ':scope > :not(.tile-previews, .tile-desk, .pb)') {
        return el.children.filter((n: any) => !['tile-previews', 'tile-desk', 'pb'].some((c) => n.classList.contains(c)));
      }
      const matches: any[] = [];
      const [tag, cls] = selector.split('.');
      const visit = (parent: any) => {
        for (const kid of parent.children) {
          if ((!tag || kid.tagName === tag) && (!cls || kid.classList.contains(cls))) matches.push(kid);
          visit(kid);
        }
      };
      visit(el);
      return matches;
    },
    querySelector(selector: string) { return el.querySelectorAll(selector)[0] || null; },
  };
  el.classList = {
    contains: (c: string) => el.className.split(/\s+/).includes(c),
    toggle(c: string, force = !el.classList.contains(c)) {
      const classes = new Set<string>(el.className.split(/\s+/).filter(Boolean));
      if (force) classes.add(c); else classes.delete(c);
      el.className = [...classes].join(' ');
      return force;
    },
    add: (c: string) => el.classList.toggle(c, true),
    remove: (c: string) => el.classList.toggle(c, false),
  };
  Object.defineProperty(el, 'innerHTML', {
    set(html: string) {
      for (const kid of [...el.children]) kid.remove();
      const stack = [el];
      for (const m of html.matchAll(/<\/?([\w-]+)\b([^>]*)>/g)) {
        if (m[0].startsWith('</')) { stack.pop(); continue; }
        const kid = node(m[1]);
        for (const a of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) {
          if (a[1] === 'class') kid.className = a[2];
          else if (a[1].startsWith('data-')) kid.dataset[a[1].slice(5)] = a[2];
          else kid[a[1]] = a[2];
        }
        kid.hidden = /\bhidden\b/.test(m[2]);
        stack.at(-1).append(kid);
        if (!m[0].endsWith('/>')) stack.push(kid);
      }
    },
  });
  return el;
}

// xterm schedules animation frames a hidden page never runs, so a terminal created or disposed while hidden stays pinned
// (measured: +46 terminals and ~300 MB a minute while switching projects behind another window). While hidden, show()
// must change nothing and apply the latest request once the window is visible again.
function harness(hidden: boolean) {
  const created: string[] = [], disposed: string[] = [], renders: number[] = [];
  const listeners: Record<string, Array<() => void>> = {};
  class Terminal {
    options: any = {}; cols = 80; rows = 24; element: any = null;
    constructor() { created.push('t'); }
    loadAddon() {} open() {} onData() {} registerLinkProvider() {} attachCustomKeyEventHandler() {}
    write() {} resize() {} focus() {} dispose() { disposed.push('t'); }
  }
  const centre = node();
  const document: any = {
    hidden, getElementById: () => centre, createElement: node,
    addEventListener: (type: string, f: () => void) => { (listeners[type] ||= []).push(f); },
  };
  const ctx: any = vm.createContext({
    window: { Terminal, FitAddon: { FitAddon: class { activate() {} proposeDimensions() { return null; } fit() {} } }, troop: { onTerm() {}, termAttach: async () => ({}), termDetach() {}, termResize() {}, termAck() {} } },
    document, ResizeObserver: class { observe() {} disconnect() {} },
    setTimeout: () => 1, clearTimeout() {}, performance, ui: { snap: { core: { online: true } } },
  });
  vm.runInContext(`${readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8')}\nthis.termView = termView;`, ctx);
  const sessions = (...ids: string[]) => ids.map((id) => ({ id, engine_id: 'claude', task: id, words: 'working', state: 'working' }));
  const show = (...ids: string[]) => ctx.termView.show({ mode: 'single', selected: ids[0], sessions: sessions(...ids), onExit() {} });
  return {
    ctx, created, disposed, renders, show,
    reveal: () => { document.hidden = false; for (const f of listeners.visibilitychange || []) f(); },
    withRender: () => { ctx.render = () => renders.push(1); },
  };
}

test('while hidden, switching what the Wall shows creates and disposes no terminals', () => {
  const h = harness(false);
  h.show('a1', 'a2');
  assert.equal(h.created.length, 2);
  h.ctx.document.hidden = true;
  h.show('b1', 'b2', 'b3'); h.show('a1', 'a2'); h.show('b1', 'b2', 'b3');
  assert.equal(h.created.length, 2, 'no new terminals while hidden');
  assert.equal(h.disposed.length, 0, 'none disposed while hidden');
});

test('on return the latest request is applied once', () => {
  const h = harness(false);
  h.show('a1', 'a2');
  h.ctx.document.hidden = true;
  h.show('b1', 'b2', 'b3'); h.show('c1');
  h.reveal();
  assert.deepEqual([...h.ctx.termView.ids()], ['c1'], 'only the latest set is on the Wall');
  assert.equal(h.created.length, 3, 'a1, a2, then c1; never b1-b3');
  assert.equal(h.disposed.length, 2);
});

test('on return the app re-renders when it can, so the Wall also lays the tiles out', () => {
  const h = harness(false);
  h.withRender();
  h.show('a1');
  h.ctx.document.hidden = true;
  h.show('b1');
  h.reveal();
  assert.equal(h.renders.length, 1);
});

test('while visible, show applies at once as before', () => {
  const h = harness(false);
  h.show('a1'); h.show('b1');
  assert.deepEqual([...h.ctx.termView.ids()], ['b1']);
  assert.equal(h.disposed.length, 1);
});
