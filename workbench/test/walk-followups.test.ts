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

function terminalTile(online = false, withUi = true) {
  const timers: Array<{ f: () => void; ms: number }> = [];
  let resized = () => {};
  let onTerm = (_id: string, _m: any) => {};
  const attaches: string[] = [], exited: string[] = [];
  let written = '';
  const centre = node();
  class Terminal {
    options = {}; cols = 80; rows = 24;
    loadAddon() {} open() {} onData() {} registerLinkProvider() {} attachCustomKeyEventHandler() {}
    write(s: string) { written += s; }
  }
  const ctx = vm.createContext({
    window: {
      Terminal, FitAddon: { FitAddon: class { fit() {} } },
      troop: {
        onTerm: (f: typeof onTerm) => { onTerm = f; },
        termAttach: async (id: string) => { attaches.push(id); },
      },
    },
    document: { getElementById: () => centre, createElement: node },
    ResizeObserver: class { constructor(f: () => void) { resized = f; } observe() {} },
    setTimeout: (f: () => void, ms: number) => timers.push({ f, ms }), clearTimeout() {}, performance,
    ...(withUi ? { ui: { snap: { core: { online } } } } : {}),
  });
  vm.runInContext(`${source('terminal.js')}\nthis.termView = termView;`, ctx);
  const show = (state = 'working', shell = false) => ctx.termView.show({
    mode: 'single', selected: 's1',
    sessions: [{ id: 's1', engine_id: 'claude', task: 'test task', words: state, state, shell }],
    onExit: (id: string) => exited.push(id),
  });
  show();
  const tile = ctx.termView.tile('s1');
  const row = tile.querySelector('.r1');
  let neededWidth = 600;
  Object.defineProperty(row, 'scrollWidth', { get: () => {
    assert.equal(tile.classList.contains('compact-head'), false, 'measure the expanded header');
    assert.equal(tile.querySelector('.act').parentNode, tile.querySelector('.ou-ah-acts'), 'restore actions before measuring');
    return Math.max(row.clientWidth, neededWidth);
  } });
  return {
    tile, show, attaches, exited, written: () => written,
    resize: (width: number, needed = neededWidth) => { neededWidth = needed; tile.clientWidth = row.clientWidth = width; resized(); },
    close: () => onTerm('s1', { op: 'closed' }),
    retry() {
      assert.equal(timers.length, 1);
      const timer = timers.shift()!;
      assert.equal(timer.ms, 500);
      timer.f();
    },
  };
}

test('narrow headers move actions into More and restore their order when they fit, tolerating missing containers', () => {
  const t = terminalTile();
  const acts = t.tile.querySelector('.ou-ah-acts');
  const more = acts.querySelector('.tile-more');
  const menu = more.querySelector('menu');
  const original = [...acts.children], fixed = [...menu.children];
  const moved = original.filter((n) => n !== more);
  t.resize(600);
  assert.deepEqual(acts.children, original);
  for (let cycle = 0; cycle < 2; cycle++) {
    t.resize(599);
    assert.equal(t.tile.classList.contains('compact-head'), true);
    assert.deepEqual(acts.children, [more]);
    assert.deepEqual(menu.children, [...fixed, ...moved]);
    t.resize(400);
    assert.deepEqual(menu.children, [...fixed, ...moved], 'repeated narrow resize must not duplicate actions');
    t.resize(600);
    assert.equal(t.tile.classList.contains('compact-head'), false);
    assert.deepEqual(acts.children, original);
    assert.deepEqual(menu.children, fixed, 'preview, desktop and Pair entries stay in the menu');
  }
  for (const selector of ['.r1', '.ou-ah-acts', '.tile-more', 'menu']) {
    const missing = terminalTile();
    missing.tile.querySelector(selector).remove();
    assert.doesNotThrow(() => missing.resize(599), `missing ${selector}`);
    assert.doesNotThrow(() => missing.resize(800), `missing ${selector}`);
  }
});

test('header collapse follows measured overflow rather than a fixed pane width', () => {
  const t = terminalTile();
  const acts = t.tile.querySelector('.ou-ah-acts'), more = acts.querySelector('.tile-more');
  const original = [...acts.children];
  for (const [available, needed, compact] of [[580, 560, false], [580, 581, true], [580, 580, false], [800, 820, true], [800, 790, false]] as const) {
    t.resize(available, needed);
    assert.equal(t.tile.classList.contains('compact-head'), compact, `${needed} px needed in ${available} px`);
    assert.deepEqual(acts.children, compact ? [more] : original);
  }
});

const inboxSource = () => readFileSync(new URL('../ui/src/inbox.jsx', import.meta.url), 'utf8');

test('Escape dismisses each expanded Needs you filter before closing the selected item', () => {
  const handler = inboxSource().match(/className="ou-inbox"\s+onKeyDown=\{\(e\) => \{([^]*?)\n      \}\}/)![1];
  for (const label of ['Kinds', 'Agents', 'Projects']) {
    let selected = 's1', open = true, stopped = false, focused = false;
    const trigger = { click: () => { open = false; }, focus: () => { focused = true; } };
    const ctx = vm.createContext({ close: () => { selected = ''; } });
    const key = vm.runInContext(`(e) => {${handler}}`, ctx);
    const escape = () => key({
      key: 'Escape', defaultPrevented: false,
      preventDefault() {}, stopPropagation() { stopped = true; },
      target: { closest: () => null },
      currentTarget: { querySelector: (selector: string) => {
        assert.match(selector, /\[aria-expanded="true"\]/);
        return open ? trigger : null;
      } },
    });
    escape();
    assert.equal(open, false, `${label} menu closes`);
    assert.equal(selected, 's1', `${label} preserves the selected item`);
    assert.equal(stopped, true);
    assert.equal(focused, true);
    escape();
    assert.equal(selected, '', 'the second Escape closes the item');
  }
});

test('the sub-task status box is omitted when there are no children', () => {
  const state = inboxSource().split(/\r?\n/).find((line) => line.includes('className="ou-ny-sub-state"'))!;
  assert.match(state, /\{children\.length\s*\?\s*<div className="ou-ny-sub-state">[^]*<\/div>\s*:\s*null\}/);
  assert.match(state, /subDone === children\.length\s*\?\s*'All sub-tasks done'/);
  assert.match(state, /plural\(children\.length - subDone, 'sub-task'\)/);
});

test('updates target the hide button inside More, preserving the summary visibility and title', () => {
  const t = terminalTile();
  const acts = t.tile.querySelector('.ou-ah-acts');
  const more = acts.querySelector('.tile-more');
  const menu = more.querySelector('menu'), summary = more.querySelector('summary');
  const hide = acts.querySelector('button.tx');
  // Set up the compact DOM independently so this regression also fails before compactHead existed.
  menu.append(...acts.children.filter((n: any) => n !== more));
  for (const [state, shell, hidden, action, title] of [
    ['done', false, false, 'hide', 'Hide this tile'],
    ['working', false, true, undefined, 'Hide this tile'],
    ['idle', true, false, 'shell-close', 'Close this shell'],
  ] as const) {
    t.show(state, shell);
    assert.equal(summary.hidden, false);
    assert.equal(summary.title, 'More actions');
    assert.equal(summary['aria-label'], 'More actions');
    assert.equal(summary.dataset.action, undefined);
    assert.equal(hide.parentNode, menu);
    assert.equal(hide.hidden, hidden);
    assert.equal(hide.dataset.action, action);
    assert.equal(hide.title, title);
    assert.equal(hide.ariaLabel, title);
  }
});

for (const [state, online] of [['done', false], ['exited', false], ['working', true]] as const) {
  test(`a second close reports session ended for ${state}, core online=${online}`, () => {
    const t = terminalTile(online);
    t.show(state);
    t.close();
    assert.equal(t.written(), '', 'the first close waits for a re-attach');
    assert.deepEqual(t.exited, []);
    t.retry();
    assert.deepEqual(t.attaches, ['s1']);
    t.close();
    assert.equal(t.written(), '\r\n[session ended]\r\n');
    assert.equal(t.tile.classList.contains('closed'), true);
    assert.deepEqual(t.exited, ['s1']);
    t.close();
    assert.deepEqual(t.exited, ['s1'], 'duplicate close does not report exit again');

    // A genuinely offline core, including a context without ui, keeps the disconnect message.
    for (const withUi of [true, false]) {
      const offline = terminalTile(false, withUi);
      offline.close(); offline.retry(); offline.close();
      assert.equal(offline.written(), '\r\n[disconnected from the core]\r\n');
      assert.deepEqual(offline.exited, ['s1']);
    }
  });
}

test('Git says no remote only for null upstream and preserves origin sync counts otherwise', () => {
  const app = source('app.js');
  const renderGit = app.match(/^function renderGit\([^]*?\n}\r?\n/m)![0];
  const ui: any = { projectId: 'p1', gitBusy: null };
  const ctx = vm.createContext({ ui, esc: String });
  vm.runInContext(`${renderGit}\nthis.renderGit = renderGit;`, ctx);
  const label = (upstream: any, ahead: number, behind: number) => {
    ui.git = { project: 'p1', at: Date.now(), branch: 'main', upstream, ahead, behind, changes: [], staged: [], log: '' };
    return ctx.renderGit().match(/<span class="meta">([^<]*)<\/span>/)![1];
  };
  assert.equal(label(null, 0, 0), 'no remote');
  assert.equal(label(null, 3, 2), 'no remote');
  for (const upstream of ['origin/main', undefined, '']) {
    assert.equal(label(upstream, 0, 0), 'up to date with origin');
    assert.equal(label(upstream, 3, 2), '3 ahead, 2 behind origin');
    assert.equal(label(upstream, 3, 0), '3 ahead origin');
    assert.equal(label(upstream, 0, 2), '2 behind origin');
  }
});
