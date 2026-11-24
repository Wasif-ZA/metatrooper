import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// M8-F13e: the waiting row on Home (frame sidebar 'Needs you' pill) matches the inbox count (M8-17c).
const rd = (n: string) => fs.readFileSync(new URL('../renderer/' + n, import.meta.url), 'utf8');
const appText = rd('app.js');

// F13E_MUT lets a mutation run patch the frame source in memory (string 'from=>to').
function frameSrc(): string {
  const m = process.env.F13E_MUT;
  if (!m) return rd('frame.js');
  const [from, to] = m.split('=>');
  const src = rd('frame.js');
  assert.ok(src.includes(from), 'mutation target present');
  return src.replace(from, to);
}

function realCounters(ui: any) {
  const helpers = appText.slice(appText.indexOf('const INFO_KINDS'), appText.indexOf('const NEEDS_COUNTS')).replace(/\bconst\b/g, 'var');
  const decl = (name: string) => {
    const s = appText.indexOf('function ' + name + '(');
    assert.notEqual(s, -1, name);
    return appText.slice(s, appText.indexOf('\n}', s) + 2);
  };
  const ctx: any = { ui };
  vm.runInNewContext(helpers + '\n' + decl('needsCount') + '\n' + decl('waitingAll') + '\nglobalThis.needsCount = needsCount; globalThis.waitingAll = waitingAll;', ctx);
  return ctx;
}

function harness() {
  const pill = { hidden: false, textContent: '' };
  const ui: any = { view: 'home', snap: { sessions: [], live: [], approvals: [], needs_you: [] }, pendingHide: new Set() };
  const real = realCounters(ui);
  const el = { classList: { contains: () => false, toggle() {}, add() {}, remove() {} } };
  const ctx: any = {
    document: {
      documentElement: el,
      getElementById: (id: string) => (id === 'frameNeeds' ? pill : null),
      querySelectorAll: () => [],
      addEventListener() {},
    },
    window: { addEventListener() {}, dispatchEvent() {} },
    Event: class { type: string; constructor(t: string) { this.type = t; } },
    dispatchEvent() {},
    load: () => null, save() {}, esc: (v: any) => String(v ?? ''), taskOf: (x: any) => x.id, setHtml() {},
    project: () => ({ id: 'p1' }), STATE_ORDER: [], STATE_WORDS: {},
    ui, waitingAll: real.waitingAll, needsCount: real.needsCount,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(frameSrc(), ctx);
  return { ui, pill, real, draw: () => ctx.frameView.draw() };
}

function busySnap(ui: any) {
  ui.snap.live = [
    { id: 'a1', project_id: 'p1', state: 'waiting_for_you' },
    { id: 'a2', project_id: 'p2', state: 'waiting_for_you' },
    { id: 'a3', project_id: 'p1', state: 'working' },
  ];
  ui.snap.approvals = [{ id: 'ap1' }];
  ui.snap.needs_you = [
    { id: 'n1', kind: 'question', read_at: null },
    { id: 'n2', kind: 'question', read_at: '2026-11-10T00:00:00Z' },
    { id: 'n3', kind: 'done', read_at: null },
  ];
}

test('the frameNeeds pill sits inside the frame Needs you nav button that opens the inbox', () => {
  const html = rd('index.html');
  const m = html.match(/<button data-action="view" data-view="inbox"[^>]*>((?:(?!<\/button>)[\s\S])*)<\/button>/);
  assert.ok(m, 'inbox nav button exists');
  assert.match(m![0], /aria-label="Needs you"/);
  assert.match(m![1], /<span class="fl">Needs you<\/span>/);
  assert.match(m![1], /<span class="fpill" id="frameNeeds" hidden><\/span>/);
  assert.equal(html.split('id="frameNeeds"').length - 1, 1, 'one pill');
});

test('on Home the pill shows 4 (2 waiting agents across projects + 1 approval + 1 unread non-info), equal to needsCount, and hides at 0', () => {
  const h = harness();
  h.ui.view = 'home';
  busySnap(h.ui);
  h.draw();
  assert.equal(h.real.needsCount(), 4);
  assert.equal(h.pill.hidden, false);
  assert.equal(h.pill.textContent, '4');
  assert.equal(h.pill.textContent, String(h.real.needsCount()));

  h.ui.snap.live = []; h.ui.snap.approvals = []; h.ui.snap.needs_you = [];
  h.draw();
  assert.equal(h.pill.hidden, true);
  assert.equal(h.pill.textContent, '');
});

test('the pill shows the same number on home, ide and wall views', () => {
  const h = harness();
  busySnap(h.ui);
  for (const view of ['home', 'ide', 'wall']) {
    h.ui.view = view;
    h.draw();
    assert.equal(h.pill.hidden, false, view);
    assert.equal(h.pill.textContent, '4', view);
  }
});
