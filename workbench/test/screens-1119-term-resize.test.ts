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

// Resize ordering for live terminals: attach at the settled size, no pty resizes mid-animation, pty before xterm, snapshot size first.
function harness() {
  const timers: Array<() => void> = [];
  let ro = () => {};
  let onTerm = (_id: string, _m: any) => {};
  const log: string[] = [];
  const st = { tweening: false, dims: { cols: 80, rows: 24 } };
  class Terminal {
    options: any = {}; cols = 80; rows = 24; element: any = null;
    loadAddon(a: any) { a.activate?.(this); } open() {} onData() {} registerLinkProvider() {} attachCustomKeyEventHandler() {}
    write(_s: string, cb?: () => void) { log.push('write'); cb?.(); }
    resize(c: number, r: number) { log.push(`term ${c}x${r}`); this.cols = c; this.rows = r; }
    focus() {}
  }
  class FitAddon {
    t: any;
    activate(t: any) { this.t = t; }
    proposeDimensions() { return { ...st.dims }; }
    fit() { const d = st.dims; if (d.cols !== this.t.cols || d.rows !== this.t.rows) this.t.resize(d.cols, d.rows); }
  }
  const centre = node();
  const ctx = vm.createContext({
    window: {
      Terminal, FitAddon: { FitAddon },
      troop: {
        onTerm: (f: typeof onTerm) => { onTerm = f; },
        termAttach: async (_id: string, c: number, r: number) => { log.push(`attach ${c}x${r}`); return {}; },
        termResize: (_id: string, c: number, r: number) => { log.push(`pty ${c}x${r}`); },
        termAck() {}, termDetach() {},
      },
    },
    gsap: { isTweening: () => st.tweening, killTweensOf() {} },
    document: { getElementById: () => centre, createElement: node },
    ResizeObserver: class { constructor(f: () => void) { ro = f; } observe() {} disconnect() {} },
    setTimeout: (f: () => void) => { timers.push(f); return timers.length; }, clearTimeout() {}, performance,
    ui: { snap: { core: { online: true } } },
  });
  vm.runInContext(`${readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8')}\nthis.termView = termView;`, ctx);
  ctx.termView.show({ mode: 'single', selected: 's1', sessions: [{ id: 's1', engine_id: 'claude', task: 't', words: 'working', state: 'working' }], onExit() {} });
  const tile = ctx.termView.tile('s1');
  tile.offsetWidth = 600;
  tile.querySelector('.tile-body').clientHeight = 400;
  const drain = () => { for (let i = 0; i < 20 && timers.length; i++) timers.splice(0).forEach((f) => f()); };
  return { st, log, ro: () => ro(), drain, term: (m: any) => onTerm('s1', m) };
}

test('a new tile attaches only once its layout animation has ended, at the settled size', () => {
  const h = harness();
  h.st.tweening = true;
  h.ro(); h.drain();
  assert.deepEqual(h.log.filter((l) => l.startsWith('attach')), [], 'no attach mid-animation');
  h.st.dims = { cols: 100, rows: 30 };
  h.st.tweening = false;
  h.ro(); h.drain();
  assert.deepEqual(h.log.filter((l) => l.startsWith('attach')), ['attach 100x30']);
});

test('an attached tile sends no pty resize while it animates, then exactly one at the end', () => {
  const h = harness();
  h.ro(); h.drain();
  h.log.length = 0;
  h.st.tweening = true;
  for (const cols of [90, 100, 110, 120]) { h.st.dims = { cols, rows: 30 }; h.ro(); h.drain(); }
  assert.deepEqual(h.log.filter((l) => l.startsWith('pty')), [], 'no pty resize mid-animation');
  h.st.tweening = false;
  h.ro(); h.drain();
  assert.deepEqual(h.log.filter((l) => l.startsWith('pty')), ['pty 120x30']);
});

test('the pty is told the new size before xterm redraws at it, and a same-size refit sends nothing', () => {
  const h = harness();
  h.ro(); h.drain();
  h.log.length = 0;
  h.st.dims = { cols: 110, rows: 28 };
  h.ro(); h.drain();
  const pty = h.log.indexOf('pty 110x28'), term = h.log.indexOf('term 110x28');
  assert.ok(pty >= 0 && term >= 0, h.log.join(' | '));
  assert.ok(pty < term, `pty first: ${h.log.join(' | ')}`);
  h.log.length = 0;
  h.ro(); h.drain();
  assert.deepEqual(h.log.filter((l) => /^(pty|term) /.test(l)), [], 'same size: no resize either side');
});

test('a snapshot drawn at another size resizes xterm to that size before it is written', () => {
  const h = harness();
  h.ro(); h.drain();
  h.log.length = 0;
  h.term({ op: 'snapshot', seq: 0, data: 'X', cols: 132, rows: 40 });
  assert.deepEqual(h.log.slice(0, 2), ['term 132x40', 'write']);
  h.log.length = 0;
  h.term({ op: 'snapshot', seq: 1, data: 'Y' });
  assert.deepEqual(h.log.filter((l) => l.startsWith('term')), [], 'no size: no resize');
});
