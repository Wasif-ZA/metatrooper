import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { deleteTarget, readImage } from '../src/files.ts';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'night-r2-codex-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(wb, 'ui/package.json'));
// The CLI with inherited handles also works where Windows denies child pipe creation.
// Keep installed UI packages external, as the neighboring screen tests do.
const entry = join(temp, 'entry.jsx'), bundle = join(temp, 'screens.mjs');
writeFileSync(entry, ['inbox', 'home', 'addons'].map(name => `export * from ${JSON.stringify(join(wb, 'ui/src', name + '.jsx').replace(/\\/g, '/'))};`).join('\n') + "\nexport * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';");
const platform = process.platform === 'win32' ? 'win32-' + process.arch : process.platform + '-' + process.arch;
const binary = requireUI.resolve('@esbuild/' + platform + (process.platform === 'win32' ? '/esbuild.exe' : '/bin/esbuild'));
const built = spawnSync(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--packages=external', '--log-level=error', '--outfile=' + bundle], { stdio: 'inherit', windowsHide: true });
assert.ifError(built.error); assert.equal(built.status, 0, 'screen bundle builds');
writeFileSync(bundle, readFileSync(bundle, 'utf8').replace(/from "([^"\n]+)"/g, (all, specifier) => specifier.startsWith('.') || specifier.startsWith('node:') ? all : 'from ' + JSON.stringify(pathToFileURL(requireUI.resolve(specifier)).href)));
const { React, renderToStaticMarkup, Inbox, inboxStore, Home, Addons, addonsStore } = await import(pathToFileURL(join(temp, 'screens.mjs')).href);
const g: any = globalThis;
const calls: any[] = [];
const own = new Set(['Inbox', 'DetailAsk', 'DetailNotice', 'TerminalPreview', 'AgentHead', 'Glyph', 'NoteActions', 'Home', 'StartBox', 'Tile', 'AgentCard', 'Addons']);

// Match the neighboring screen harness, including dependency changes and effect cleanup.
function harness(Screen: any) {
  const frames = new Map<string, any[]>();
  let nodes: any[] = [];
  let effects: Function[] = [];
  function expand(value: any, path: string): any {
    if (Array.isArray(value)) return value.map((v, i) => expand(v, path + '/' + (v?.key ?? i)));
    if (!React.isValidElement(value)) return value;
    nodes.push(value);
    if (typeof value.type === 'function' && own.has(value.type.name)) {
      const key = path + '/' + value.type.name + ':' + (value.key ?? '');
      const slots = frames.get(key) || []; frames.set(key, slots);
      let cursor = 0;
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H;
      internals.H = {
        useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
        useState: (initial: any) => {
          const i = cursor++;
          if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
          return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }];
        },
        useEffect: (fn: Function, deps: any[]) => {
          const i = cursor++, old = slots[i];
          if (!old || !deps || deps.length !== old.deps.length || deps.some((d, j) => !Object.is(d, old.deps[j]))) {
            effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
          }
        },
      };
      let output;
      try { output = value.type(value.props); } finally { internals.H = previous; }
      return expand(output, key + '/render');
    }
    const props: any = { key: value.key ?? path };
    for (const [key, v] of Object.entries(value.props)) {
      if (React.isValidElement(v) || Array.isArray(v)) props[key] = expand(v, path + '/' + key);
    }
    return React.cloneElement(value, props);
  }
  const draw = () => {
    nodes = []; effects = [];
    const tree = expand(React.createElement(Screen), 'root');
    for (const effect of effects) effect();
    return tree;
  };
  return { draw, html: () => renderToStaticMarkup(draw()), all: (predicate: any) => nodes.filter(predicate) };
}
const action = (name: string) => (n: any) => n.props['data-action'] === name;
beforeEach(() => {
  calls.length = 0;
  Object.assign(g, {
    ui: { view: 'home', projectId: 'p1', pendingHide: new Set(), drafts: {}, snap: { sessions: [], live: [], approvals: [], needs_you: [], engines: [], projects: [{ id: 'p1', name: 'Alpha' }] } },
    rpc: async (...args: any[]) => { calls.push(['rpc', ...args]); return { result: { lines: ['terminal alpha', 'terminal beta'] } }; },
    toast: (...args: any[]) => calls.push(['toast', ...args]),
    project: () => g.ui.snap.projects.find((p: any) => p.id === g.ui.projectId),
    waitingAll: () => g.ui.snap.live.filter((s: any) => s.state === 'waiting_for_you'),
    needsCount: () => g.waitingAll().length, isInfo: () => false, taskOf: (s: any) => s.title,
    ago: () => '1m ago', changedFiles: () => [],
    homeView: { shown: () => g.ui.view === 'home' && Boolean(g.project()), set: (v: string) => { g.ui.view = v; } },
    STATE_ORDER: ['waiting_for_you', 'working', 'starting', 'done', 'failed', 'exited'], STATE_WORDS: {},
    document: { documentElement: { style: {} }, getElementById: () => ({ hidden: false }) },
  });
  inboxStore.set({ filter: 'all', selectedId: null });
  addonsStore.set({ rows: [] });
});
function projects(n = 3) { g.ui.snap.projects = Array.from({ length: n }, (_, i) => ({ id: 'p' + (i + 1), name: 'Project ' + (i + 1), path: 'C:/project-' + i })); }
test('Home Projects renders three project-go rows with their ids', () => {
  projects(); const h = harness(Home); const html = h.html();
  assert.deepEqual(h.all(action('project-go')).map((n: any) => [n.type, n.props['data-id']]), [['li', 'p1'], ['li', 'p2'], ['li', 'p3']]);
  for (let i = 1; i <= 3; i++) assert.ok(html.includes('Project ' + i));
});
test('Home Projects marks only the current project open now', () => {
  projects(); g.ui.projectId = 'p2'; const h = harness(Home); h.draw();
  const text = h.all(action('project-go')).map((n: any) => renderToStaticMarkup(n));
  assert.doesNotMatch(text[0], /open now/); assert.match(text[1], /open now/); assert.doesNotMatch(text[2], /open now/);
});
test('Home Projects excludes older projects before limiting the list', () => {
  projects(10); g.ui.snap.projects[0].older = true;
  const h = harness(Home); h.draw();
  assert.deepEqual(h.all(action('project-go')).map((n: any) => n.props['data-id']), ['p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9']);
});
test('Home Projects caps more than eight projects at eight rows', () => {
  projects(11); const h = harness(Home); h.draw();
  assert.deepEqual(h.all(action('project-go')).map((n: any) => n.props['data-id']), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8']);
});
test('Home Projects has exactly one open-folder button', () => {
  projects(); const html = harness(Home).html();
  assert.equal((html.match(/<button\b[^>]*data-action="open-folder"/g) || []).length, 1);
});
test('Add-ons header Check agents again uses ghost and check-engines', () => {
  g.ui.view = 'addons'; const h = harness(Addons); h.draw();
  const header = h.all((n: any) => n.type === 'header')[0];
  const controls: any[] = [];
  function visit(n: any) { if (Array.isArray(n)) n.forEach(visit); else if (React.isValidElement(n)) { if (n.props.label === 'Check agents again') controls.push(n); visit(n.props.children); } }
  visit(header);
  assert.equal(controls.length, 1); assert.equal(controls[0].props.variant, 'ghost'); assert.equal(controls[0].props['data-action'], 'check-engines');
});
test('Add-ons description CSS clamps to one line', () => {
  const css = readFileSync(join(wb, 'ui/src/ui.css'), 'utf8');
  const rule = css.match(/^\s*\.ou-acard-desc\s*\{([^}]+)\}/m);
  assert.ok(rule); assert.match(rule[1], /(?:^|;)\s*-webkit-line-clamp:\s*1\s*;/);
});

// Execute the actual IPC registrations, retaining the production filesystem helpers.
const main = readFileSync(join(wb, 'src/main.ts'), 'utf8');
function filesystem(t: any) {
  const dir = mkdtempSync(join(temp, 'fs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const root = join(dir, 'project'), outside = join(dir, 'outside');
  mkdirSync(root); mkdirSync(outside); mkdirSync(join(root, '.git')); mkdirSync(join(root, 'real-dir'));
  writeFileSync(join(root, 'real.txt'), 'keep me until trash');
  writeFileSync(join(root, '.git', 'config'), 'private');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
  writeFileSync(join(root, 'small.png'), png); writeFileSync(join(outside, 'outside.png'), png);
  const trashed: string[] = [], handlers: Record<string, Function> = {};
  const ctx = vm.createContext({ on: (name: string, fn: Function) => { handlers[name] = fn; }, projectRoot: (id: unknown) => id === 'p1' ? root : null, deleteTarget, readImage, shell: { trashItem: async (p: string) => { trashed.push(p); } }, console: { log() {} } });
  const image = main.match(/^  on\('fsImage'[^\n]+/m);
  const del = main.match(/^  on\('fsDelete', async[^]*?^  \}\);/m);
  assert.ok(image); assert.ok(del);
  vm.runInContext(stripTypeScriptTypes(image[0] + '\n' + del[0]), ctx);
  return { root, outside, png, trashed, del: (p: string) => handlers.fsDelete('p1', p), image: (p: string) => handlers.fsImage('p1', p) };
}
function refused(result: any) { assert.equal(typeof result?.error, 'string'); assert.ok(result.error.length); assert.equal(result.ok, undefined); assert.equal(result.url, undefined); }
function junction(t: any, link: string, target: string) {
  const quote = (s: string) => '"' + s.replace(/"/g, '""') + '"';
  const command = 'cmd /c mklink /J ' + quote(link) + ' ' + quote(target);
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], { stdio: 'inherit', windowsHide: true });
  if (result.error || result.status !== 0) { t.skip('mklink /J failed: ' + (result.error?.message || 'exit ' + result.status)); return false; }
  return true;
}
test('fsDelete refuses the project root without trashing', async t => {
  const h = filesystem(t); refused(await h.del('.')); assert.deepEqual(h.trashed, []); assert.ok(existsSync(h.root));
});
test('fsDelete refuses anything under .git without trashing', async t => {
  const h = filesystem(t);
  for (const p of ['.git', '.git/config']) refused(await h.del(p));
  assert.deepEqual(h.trashed, []); assert.equal(readFileSync(join(h.root, '.git/config'), 'utf8'), 'private');
});
test('fsDelete refuses an in-project junction without trashing its target', async t => {
  const h = filesystem(t), link = join(h.root, 'linked');
  if (!junction(t, link, join(h.root, 'real-dir'))) return;
  refused(await h.del('linked')); assert.deepEqual(h.trashed, []); assert.ok(existsSync(link));
});
test('fsDelete refuses a path outside the project without trashing', async t => {
  const h = filesystem(t); refused(await h.del('../outside/outside.png')); assert.deepEqual(h.trashed, []); assert.ok(existsSync(join(h.outside, 'outside.png')));
});
test('fsDelete refuses a missing path without trashing', async t => {
  const h = filesystem(t); refused(await h.del('missing.txt')); assert.deepEqual(h.trashed, []);
});
test('fsDelete trashes a real project file exactly once with its absolute path', async t => {
  const h = filesystem(t); const result = await h.del('real.txt');
  assert.equal(result.ok, true); assert.equal(result.error, undefined); assert.deepEqual(h.trashed, [join(h.root, 'real.txt')]);
});
test('fsImage refuses txt and exe extensions', t => {
  const h = filesystem(t);
  for (const ext of ['txt', 'exe']) { writeFileSync(join(h.root, 'image.' + ext), h.png); refused(h.image('image.' + ext)); }
});
test('fsImage refuses over 8 MiB and permits the exact size boundary', t => {
  const h = filesystem(t); writeFileSync(join(h.root, 'big.png'), Buffer.alloc(8 * 1024 * 1024 + 1));
  refused(h.image('big.png'));
  writeFileSync(join(h.root, 'big.png'), Buffer.alloc(8 * 1024 * 1024));
  assert.ok(h.image('big.png').url?.startsWith('data:image/png;base64,'));
});
test('fsImage refuses a path outside the project', t => {
  const h = filesystem(t); refused(h.image('../outside/outside.png'));
});
test('fsImage refuses an outside image reached through a junction', t => {
  const h = filesystem(t); if (!junction(t, join(h.root, 'escape'), h.outside)) return;
  refused(h.image('escape/outside.png'));
});
test('fsImage small PNG round-trips its bytes with the image/png mime type', t => {
  const h = filesystem(t); const result = h.image('small.png');
  assert.equal(result.error, undefined); assert.equal(typeof result.url, 'string');
  const match = /^data:(image\/png);base64,([A-Za-z0-9+/]+=*)$/.exec(result.url);
  assert.ok(match); assert.deepEqual(Buffer.from(match[2], 'base64'), h.png);
});
