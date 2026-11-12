import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function readSrc(name: string): string {
  const candidates = [
    path.join(process.cwd(), 'renderer', name),
    path.join(process.cwd(), name),
    path.join(process.cwd(), 'wt/workbench/renderer', name),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return fs.readFileSync(c, 'utf8');
  }
  return fs.readFileSync(candidates[0], 'utf8');
}

function createFrameHarness(initialStorage: Record<string, string> = {}) {
  const storage: Record<string, string> = { ...initialStorage };
  const saved: Array<{ key: string; value: string }> = [];
  const events: Array<any> = [];
  const classListSet = new Set<string>();

  const classList = {
    contains: (c: string) => classListSet.has(c),
    toggle: (c: string, force?: boolean) => {
      const state = force !== undefined ? Boolean(force) : !classListSet.has(c);
      if (state) classListSet.add(c); else classListSet.delete(c);
      return state;
    },
    add: (c: string) => classListSet.add(c),
    remove: (c: string) => classListSet.delete(c),
  };

  const frameTog = {
    title: '',
    attrs: new Map<string, string>(),
    listeners: {} as Record<string, Function[]>,
    setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); },
    getAttribute(k: string) { return this.attrs.get(k) ?? null; },
    removeAttribute(k: string) { this.attrs.delete(k); },
    addEventListener(ev: string, fn: Function) {
      (this.listeners[ev] ||= []).push(fn);
    },
    click() {
      for (const fn of this.listeners['click'] || []) fn({ type: 'click' });
    },
  };

  const frameNeeds = {
    hidden: false,
    textContent: '',
  };

  const frameAgents = {
    innerHTML: '',
    listeners: {} as Record<string, Function[]>,
    addEventListener(ev: string, fn: Function) {
      (this.listeners[ev] ||= []).push(fn);
    },
    click(target: any) {
      const ev = {
        type: 'click',
        target,
      };
      for (const fn of this.listeners['click'] || []) fn(ev);
    },
  };

  const viewButtons = ['home', 'ide', 'wall', 'inbox', 'addons'].map((view) => ({
    dataset: { view, action: 'view' },
    attrs: new Map<string, string>(),
    setAttribute(k: string, v: string) { this.attrs.set(k, String(v)); },
    getAttribute(k: string) { return this.attrs.get(k) ?? null; },
    removeAttribute(k: string) { this.attrs.delete(k); },
  }));

  const docListeners: Record<string, Function[]> = {};
  const winListeners: Record<string, Function[]> = {};

  const doc = {
    documentElement: { classList },
    getElementById(id: string) {
      if (id === 'frameTog') return frameTog;
      if (id === 'frameNeeds') return frameNeeds;
      if (id === 'frame-agents') return frameAgents;
      return null;
    },
    querySelectorAll(sel: string) {
      if (sel === '[data-action="view"]') return viewButtons;
      return [];
    },
    addEventListener(ev: string, fn: Function) {
      (docListeners[ev] ||= []).push(fn);
    },
  };

  const homeViewSetCalls: string[] = [];

  const ctx: any = {
    document: doc,
    window: {
      addEventListener(ev: string, fn: Function) {
        (winListeners[ev] ||= []).push(fn);
      },
      dispatchEvent(e: any) {
        events.push(e);
        for (const fn of winListeners[e.type] || []) fn(e);
      },
    },
    dispatchEvent(e: any) {
      ctx.window.dispatchEvent(e);
    },
    Event: class {
      type: string;
      constructor(type: string) { this.type = type; }
    },
    load: (key: string) => storage[key] ?? null,
    save: (key: string, value: string) => {
      storage[key] = value;
      saved.push({ key, value });
    },
    esc: (v: any) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    taskOf: (x: any) => x.task || x.prompt || x.id,
    setHtml: (id: string, html: string) => {
      if (id === 'frame-agents') frameAgents.innerHTML = html;
    },
    needsCount: () => 0,
    project: () => ({ id: 'p1' }),
    STATE_ORDER: ['waiting_for_you', 'working', 'starting', 'idle', 'done', 'unknown', 'exited'],
    STATE_WORDS: { starting: 'starting', working: 'working', waiting_for_you: 'waiting for you', done: 'done', idle: 'idle', unknown: 'state unknown', exited: 'exited' },
    ui: {
      view: 'wall',
      snap: { sessions: [] as any[] },
      pendingHide: new Set<string>(),
    },
    homeView: {
      set: (v: string) => { homeViewSetCalls.push(v); },
    },
  };
  ctx.globalThis = ctx;

  vm.createContext(ctx);
  const frameSrc = readSrc('frame.js');
  vm.runInContext(frameSrc, ctx);

  const triggerDomContentLoaded = () => {
    for (const fn of docListeners['DOMContentLoaded'] || []) fn();
  };

  return {
    ctx,
    doc,
    storage,
    saved,
    events,
    classListSet,
    frameTog,
    frameNeeds,
    frameAgents,
    viewButtons,
    homeViewSetCalls,
    triggerDomContentLoaded,
    frameView: ctx.globalThis.frameView,
  };
}

test('aria-current follows the view', () => {
  const h = createFrameHarness();
  for (const view of ['wall', 'home', 'ide', 'inbox', 'addons']) {
    h.ctx.ui.view = view;
    h.frameView.draw();
    for (const b of h.viewButtons) {
      if (b.dataset.view === view) {
        assert.equal(b.getAttribute('aria-current'), 'page', `aria-current page on ${view}`);
      } else {
        assert.equal(b.getAttribute('aria-current'), null, `aria-current absent on ${b.dataset.view}`);
      }
    }
  }

  // defaults to wall view when ui.view is null or undefined
  h.ctx.ui.view = undefined;
  h.frameView.draw();
  const wallBtn = h.viewButtons.find((b) => b.dataset.view === 'wall');
  assert.equal(wallBtn?.getAttribute('aria-current'), 'page');
});

test('the Needs you pill shows the count and is hidden at 0', () => {
  const h = createFrameHarness();

  h.ctx.needsCount = () => 0;
  h.frameView.draw();
  assert.equal(h.frameNeeds.hidden, true);
  assert.equal(h.frameNeeds.textContent, '');

  h.ctx.needsCount = () => 4;
  h.frameView.draw();
  assert.equal(h.frameNeeds.hidden, false);
  assert.equal(h.frameNeeds.textContent, '4');

  h.ctx.needsCount = () => 0;
  h.frameView.draw();
  assert.equal(h.frameNeeds.hidden, true);
  assert.equal(h.frameNeeds.textContent, '');
});

test('agent rows use Home filter and sort', () => {
  const h = createFrameHarness();

  // empty when project returns null
  h.ctx.project = () => null;
  h.frameView.draw();
  assert.equal(h.frameAgents.innerHTML, '<p class="fempty">No agents running</p>');

  h.ctx.project = () => ({ id: 'p1' });
  h.ctx.ui.snap.sessions = [
    { id: 's-exited', state: 'exited', task: 'exited task', engine_id: 'claude' },
    { id: 's-work', state: 'working', task: 'working task', engine_id: 'claude' },
    { id: 's-wait', state: 'waiting_for_you', task: 'waiting task', engine_id: 'gpt-4' },
    { id: 's-done', state: 'done', task: 'done task', engine_id: 'gemini' },
    { id: 's-hide', state: 'working', task: 'hidden task', engine_id: 'claude' },
  ];
  h.ctx.ui.pendingHide.add('s-hide');

  h.frameView.draw();

  // exited and pendingHide excluded
  assert.equal(h.frameAgents.innerHTML.includes('s-exited'), false);
  assert.equal(h.frameAgents.innerHTML.includes('s-hide'), false);

  // included rows sorted by STATE_ORDER: waiting_for_you before working before done
  const waitIdx = h.frameAgents.innerHTML.indexOf('data-id="s-wait"');
  const workIdx = h.frameAgents.innerHTML.indexOf('data-id="s-work"');
  const doneIdx = h.frameAgents.innerHTML.indexOf('data-id="s-done"');
  assert.ok(waitIdx !== -1 && workIdx !== -1 && doneIdx !== -1);
  assert.ok(waitIdx < workIdx, 'wait before work');
  assert.ok(workIdx < doneIdx, 'work before done');

  // status dot class checks
  assert.match(h.frameAgents.innerHTML, /<button class="fagent"[^>]*data-id="s-wait"[^>]*><span class="fdot wait"><\/span>/);
  assert.match(h.frameAgents.innerHTML, /<button class="fagent"[^>]*data-id="s-work"[^>]*><span class="fdot work"><\/span>/);
  assert.match(h.frameAgents.innerHTML, /<button class="fagent"[^>]*data-id="s-done"[^>]*><span class="fdot "><\/span>/);
});

test('toggle flips side-rail, saves rail or wide, restores on load, and fires resize', () => {
  // restores rail on load
  const hRail = createFrameHarness({ sidebar: 'rail' });
  hRail.triggerDomContentLoaded();
  assert.equal(hRail.classListSet.has('side-rail'), true);
  assert.equal(hRail.frameTog.title, 'Expand sidebar (Ctrl+B)');
  assert.equal(hRail.frameTog.getAttribute('aria-expanded'), 'false');
  assert.equal(hRail.frameTog.getAttribute('aria-label'), 'Expand sidebar');

  // restores wide on load
  const hWide = createFrameHarness({ sidebar: 'wide' });
  hWide.triggerDomContentLoaded();
  assert.equal(hWide.classListSet.has('side-rail'), false);
  assert.equal(hWide.frameTog.title, 'Collapse sidebar (Ctrl+B)');
  assert.equal(hWide.frameTog.getAttribute('aria-expanded'), 'true');
  assert.equal(hWide.frameTog.getAttribute('aria-label'), 'Collapse sidebar');

  // toggle flips from wide to rail and saves rail
  let resizeCount = 0;
  hWide.ctx.window.addEventListener('resize', () => { resizeCount++; });
  hWide.frameView.toggle();
  assert.equal(hWide.classListSet.has('side-rail'), true);
  assert.equal(hWide.storage['sidebar'], 'rail');
  assert.equal(hWide.frameTog.title, 'Expand sidebar (Ctrl+B)');
  assert.equal(hWide.frameTog.getAttribute('aria-expanded'), 'false');
  assert.equal(resizeCount, 1);

  // toggle flips from rail to wide and saves wide
  hWide.frameView.toggle();
  assert.equal(hWide.classListSet.has('side-rail'), false);
  assert.equal(hWide.storage['sidebar'], 'wide');
  assert.equal(hWide.frameTog.title, 'Collapse sidebar (Ctrl+B)');
  assert.equal(hWide.frameTog.getAttribute('aria-expanded'), 'true');
  assert.equal(resizeCount, 2);

  // frameTog click handler triggers toggle
  hWide.frameTog.click();
  assert.equal(hWide.classListSet.has('side-rail'), true);
  assert.equal(hWide.storage['sidebar'], 'rail');
  assert.equal(resizeCount, 3);
});

test('Ctrl+B ignored inside input, textarea, and select fields', () => {
  const appSrc = readSrc('app.js');
  const start = appSrc.indexOf("document.addEventListener('keydown', (e) => {");
  assert.notEqual(start, -1, 'keydown listener found in app.js');
  const end = appSrc.indexOf("\n});\ndocument.addEventListener('keyup'", start);
  assert.notEqual(end, -1, 'end of keydown listener found');
  const listenerSrc = appSrc.slice(start, end + 4);

  const listeners: Record<string, Function[]> = {};
  let toggled = false;
  let prevented = false;

  const doc = {
    activeElement: null as any,
    getElementById: (id: string) => ({ hidden: true }),
    addEventListener: (ev: string, fn: Function) => {
      (listeners[ev] ||= []).push(fn);
    },
  };

  const ctx: any = {
    document: doc,
    globalThis: {
      frameView: {
        toggle: () => { toggled = true; },
      },
    },
    ui: { mode: 'single', tab: 'diff' },
  };
  ctx.globalThis.globalThis = ctx.globalThis;
  vm.createContext(ctx);
  vm.runInContext(listenerSrc, ctx);

  const triggerKey = (tagName: string | null) => {
    toggled = false;
    prevented = false;
    doc.activeElement = tagName ? { tagName } : null;
    const ev = {
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
      key: 'b',
      preventDefault() { prevented = true; },
    };
    for (const fn of listeners['keydown'] || []) fn(ev);
  };

  // ignored when typing in text fields
  triggerKey('INPUT');
  assert.equal(toggled, false, 'ignored in INPUT');
  assert.equal(prevented, false);

  triggerKey('TEXTAREA');
  assert.equal(toggled, false, 'ignored in TEXTAREA');
  assert.equal(prevented, false);

  triggerKey('SELECT');
  assert.equal(toggled, false, 'ignored in SELECT');
  assert.equal(prevented, false);

  // fires toggle outside text fields
  triggerKey(null);
  assert.equal(toggled, true, 'fires when activeElement is null');
  assert.equal(prevented, true);

  triggerKey('BUTTON');
  assert.equal(toggled, true, 'fires when activeElement is BUTTON');
  assert.equal(prevented, true);

  triggerKey('DIV');
  assert.equal(toggled, true, 'fires when activeElement is DIV');
  assert.equal(prevented, true);
});

test('clicking an agent row while not on the Wall switches to the Wall', () => {
  const h = createFrameHarness();
  h.triggerDomContentLoaded();

  const pickBtn = {
    dataset: { action: 'pick', id: 's1' },
    closest: (sel: string) => (sel === '[data-action="pick"]' ? pickBtn : null),
  };
  const emptyEl = {
    dataset: {},
    closest: () => null,
  };

  // switches from home to wall
  h.ctx.ui.view = 'home';
  h.homeViewSetCalls.length = 0;
  h.frameAgents.click(pickBtn);
  assert.deepEqual(h.homeViewSetCalls, ['wall']);

  // switches from ide to wall
  h.ctx.ui.view = 'ide';
  h.homeViewSetCalls.length = 0;
  h.frameAgents.click(pickBtn);
  assert.deepEqual(h.homeViewSetCalls, ['wall']);

  // does not switch when already on wall
  h.ctx.ui.view = 'wall';
  h.homeViewSetCalls.length = 0;
  h.frameAgents.click(pickBtn);
  assert.deepEqual(h.homeViewSetCalls, []);

  // click outside pick button does not switch
  h.ctx.ui.view = 'home';
  h.homeViewSetCalls.length = 0;
  h.frameAgents.click(emptyEl);
  assert.deepEqual(h.homeViewSetCalls, []);
});

test('thread list: recent finished tasks on top, Working and older Settled shelves below; one row per task with project, title, branch and engine marks; sub-agents behind a chevron; shelves toggle', () => {
  const h = createFrameHarness();
  h.triggerDomContentLoaded();
  h.ctx.setTimeout = () => 0;
  const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
  h.ctx.ui.snap.tree = [{ project_id: 'p1', name: 'shop', sessions: ['lead', 'kid', 'busy', 'old', 'fresh'] }];
  h.ctx.ui.snap.tree_rows = {
    lead: { id: 'lead', state: 'waiting_for_you', engine_id: 'claude', title: 'Lead task', state_at: iso(18_000), started_at: iso(60_000) },
    kid: { id: 'kid', parent_id: 'lead', state: 'working', engine_id: 'codex', title: 'Kid task', state_at: iso(5_000), started_at: iso(30_000) },
    busy: { id: 'busy', state: 'working', engine_id: 'codex', title: 'Busy task', state_at: iso(1_000), started_at: iso(120_000) },
    old: { id: 'old', state: 'exited', engine_id: 'claude', title: 'Old task', state_at: iso(3 * 86_400_000), started_at: iso(3 * 86_400_000 + 60_000) },
    fresh: { id: 'fresh', state: 'done', engine_id: 'gemini', title: 'Fresh task', state_at: iso(7 * 60_000), started_at: iso(9 * 60_000) },
  };
  h.ctx.ui.snap.git = { lead: { branch: 'feat/share' } };
  h.frameView.draw();
  const html = h.frameAgents.innerHTML;
  const ids = [...html.matchAll(/class="fth[^"]*" data-action="home-select" data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['fresh', 'busy', 'lead'], 'recent finished on top, then Working newest first; the sub-agent has no row of its own; Settled starts closed');
  assert.ok(html.indexOf('class="fthreads"') < html.indexOf('class="fshelves"'), 'recent list above the shelves');
  assert.match(html, /data-id="lead"[^]*?<span class="fthpn">shop<\/span><\/span><span class="fthtime"><span class="fthwait">Waiting 18s<\/span>/);
  assert.match(html, /data-id="lead"[^]*?<span class="ft">Lead task<\/span>[^]*?<span class="fthbr">feat\/share<\/span><span class="fthmks">(<span class="fthmk">[^]*?<\/span>){2}<\/span>/);
  assert.match(html, /data-shelf="working" aria-expanded="true"><span class="fl">Working<\/span><span class="fcount">2<\/span>/);
  assert.match(html, /data-shelf="settled" aria-expanded="false"><span class="fl">Settled<\/span><span class="fcount">1<\/span>/);
  assert.match(html, /<button class="fthx" data-kids="lead" aria-expanded="false" aria-label="Show 1 sub-agent of Lead task"/);
  assert.doesNotMatch(html, /data-id="kid"/);
  const kidsBtn = { dataset: { kids: 'lead' }, closest: (sel: string) => (sel === '[data-kids]' ? kidsBtn : null) };
  h.frameAgents.click(kidsBtn);
  assert.match(h.frameAgents.innerHTML, /data-kids="lead" aria-expanded="true"[^]*?<div class="fthkids"><button class="fthkid" data-action="home-select" data-id="kid"[^]*?<span class="ft">Kid task<\/span>/);
  h.frameAgents.click(kidsBtn);
  assert.doesNotMatch(h.frameAgents.innerHTML, /data-id="kid"/);
  const shelfBtn = (key: string) => ({ dataset: { shelf: key }, closest: (sel: string) => (sel === '[data-shelf]' ? shelfBtn(key) : null) });
  h.frameAgents.click(shelfBtn('settled'));
  const settledIds = [...h.frameAgents.innerHTML.split('data-shelf="settled"')[1].matchAll(/class="fth[^"]*" data-action="home-select" data-id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(settledIds, ['old'], 'Settled holds the finished tasks older than a day');
  h.frameAgents.click(shelfBtn('working'));
  assert.doesNotMatch(h.frameAgents.innerHTML, /data-id="busy"/);
  h.frameAgents.click(shelfBtn('working'));
  h.frameAgents.click(shelfBtn('settled'));
});

test('usage meters: one meter per engine showing its most used window, with every window in the tooltip', () => {
  const h = createFrameHarness();
  const usage: any = { hidden: true, innerHTML: '' };
  const getById = h.doc.getElementById.bind(h.doc);
  h.doc.getElementById = (id: string) => (id === 'frameUsage' ? usage : getById(id));
  h.ctx.setTimeout = () => 0;
  const soon = new Date(Date.now() + 3 * 3_600_000).toISOString();
  h.ctx.ui.snap.limits = [
    { provider: 'claude', window: '5h', status: 'ok', used_pct: 42, resets_at: soon },
    { provider: 'claude', window: 'weekly', status: 'ok', used_pct: 59, resets_at: soon },
    { provider: 'codex', window: '5h', status: 'ok', used_pct: 12, resets_at: soon },
  ];
  h.frameView.draw();
  const meters = [...usage.innerHTML.matchAll(/<div class="fuse" title="([^"]*)">/g)];
  assert.equal(meters.length, 2, 'one meter per engine');
  assert.equal((usage.innerHTML.match(/class="fbar"/g) || []).length, 2);
  assert.match(usage.innerHTML, /<b>59%<\/b>/, 'claude shows its most used window');
  assert.doesNotMatch(usage.innerHTML, /<b>42%<\/b>/);
  assert.match(meters[0][1], /5h: 42% used[^]*weekly: 59% used/, 'tooltip keeps every window');
});
