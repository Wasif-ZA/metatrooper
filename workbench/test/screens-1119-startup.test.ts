import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (f: string) => readFileSync(new URL(`../renderer/${f}`, import.meta.url), 'utf8');

function homeCtx(projects: any[]) {
  const home: any = { hidden: true, innerHTML: '' };
  const ctx: any = {
    ui: { view: 'home', projectId: 'p1', pendingHide: new Set(), snap: { projects, sessions: [], live: [], engines: [], needs_you: [], approvals: [] } },
    document: { getElementById: (id: string) => (id === 'home' ? home : null), querySelectorAll: () => [], addEventListener: () => {} },
    esc: (s: unknown) => String(s ?? ''),
    setHtml: (id: string, html: string) => { if (id === 'home') home.innerHTML = html; },
    waitingAll: () => [], changedFiles: () => [], isInfo: () => false, taskOf: (x: any) => x.task, ago: () => '',
    STATE_ORDER: [], STATE_WORDS: {},
  };
  ctx.project = () => ctx.ui.snap.projects.find((p: any) => p.id === ctx.ui.projectId);
  ctx.globalThis = ctx;
  vm.runInNewContext(read('home.js'), ctx);
  return { ctx, home };
}

test('Home draws without throwing when the saved project is not in the snapshot yet (first render on start)', () => {
  const { ctx } = homeCtx([]);
  assert.doesNotThrow(() => ctx.homeView.draw());
});

test('Home still names the project once it has loaded', () => {
  const { ctx, home } = homeCtx([{ id: 'p1', name: 'shop-cart', path: '/s' }]);
  ctx.homeView.draw();
  assert.match(home.innerHTML, /shop-cart/);
});

test('one screen throwing in drawSections does not stop the others drawing, and the error is reported', () => {
  const app = read('app.js');
  const m = app.match(/^function drawSections\([^]*?\r?\n}/m);
  assert.ok(m, 'app.js has a drawSections() that render() calls for the per-screen draws');
  assert.match(app, /^function render\([^]*?drawSections\(\)/m, 'render() calls drawSections()');
  const drawn: string[] = [];
  const errors: unknown[] = [];
  const view = (name: string, fail = false) => ({ draw: () => { drawn.push(name); if (fail) throw new Error(`${name} broke`); } });
  const ctx: any = {
    homeView: view('home', true), frameView: view('frame'), wallSide: view('wallSide'), inboxView: view('inbox'), ideView: view('ide'), addonsView: view('addons'),
    console: { error: (...a: unknown[]) => errors.push(a) },
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(`${m[0]}\ndrawSections();`, ctx);
  assert.deepEqual(drawn, ['home', 'frame', 'wallSide', 'inbox', 'ide', 'addons']);
  assert.equal(errors.length, 1);
  assert.match(String((errors[0] as unknown[]).join(' ')), /home broke/);
});
