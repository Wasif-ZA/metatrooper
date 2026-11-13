import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'night-round4-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');

// Bundle real screen sources and retain installed React and library controls.
const entry = "export * from './src/inbox.jsx'; export * from './src/home.jsx'; export * from './src/addons.jsx'; export { Badge } from '@astryxdesign/core/Badge'; export { Button } from '@astryxdesign/core/Button'; export { Kbd } from '@astryxdesign/core/Kbd'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';";
try { await build({
  absWorkingDir: join(wb, 'ui'), tsconfigRaw: {},
  stdin: { contents: entry, resolveDir: join(wb, 'ui'), loader: 'jsx' },
  plugins: [{ name: 'installed-ui-modules', setup(b: any) {
    b.onResolve({ filter: /.*/ }, (args: any) => {
      if (args.path.endsWith('.css')) return { path: args.path, namespace: 'empty-css' };
      if (!args.path.startsWith('.')) return { path: pathToFileURL(requireUI.resolve(args.path)).href, external: true };
      return { path: resolve(args.namespace === 'screen' ? dirname(args.importer) : join(wb, 'ui'), args.path), namespace: 'screen' };
    });
    b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
    b.onLoad({ filter: /.*/, namespace: 'screen' }, (args: any) => ({ contents: readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.jsx') ? 'jsx' : 'js' }));
  } }],
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', outfile: join(temp, 'panes.mjs'),
}); } catch (error: any) {
  if (error.code !== 'EPERM' || process.platform !== 'win32') throw error;
  // Build real source through inherited handles when Windows denies service pipes.
  const source = entry.replace(/'(@astryxdesign\/core\/[^']+)'/g, (_, name) => JSON.stringify(requireUI.resolve(name))).replaceAll("'./src/", "'" + join(wb, 'ui/src/').replaceAll('\\', '/') );
  const entryPath = join(temp, 'entry.jsx');
  writeFileSync(entryPath, source.replace("'react';", JSON.stringify(requireUI.resolve('react')) + ';').replace("'react-dom/server';", JSON.stringify(requireUI.resolve('react-dom/server')) + ';'));
  const binary = join(dirname(requireUI.resolve('esbuild/package.json')), '../@esbuild/win32-x64/esbuild.exe');
  await new Promise<void>((resolveBuild, reject) => {
    const child = spawn(binary, [entryPath, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--loader:.css=empty', '--banner:js=import { createRequire as __nightCreateRequire } from "node:module"; const require = __nightCreateRequire(import.meta.url);', '--outfile=' + join(temp, 'panes.mjs')], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolveBuild() : reject(new Error('esbuild exited ' + code)));
  });
}
const { React, renderToStaticMarkup, Inbox, inboxStore, Home, Addons, addonsStore, Badge, Button, Kbd } = await import(pathToFileURL(join(temp, 'panes.mjs')).href);

// Evaluate app components while leaving installed design system controls intact.
function screen(Component: any, props: any = {}) {
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  internals.H = {
    useSyncExternalStore: (_: any, get: any) => get(),
    useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (initial: any) => ({ current: initial }),
  };
  try { return Component(props); } finally { internals.H = previous; }
}
const children = (node: any): any[] => [node?.props?.children].flat(Infinity).filter(n => n != null && typeof n !== 'boolean');
const descendants = (node: any): any[] => [node, ...children(node).flatMap(descendants)];
const hasClass = (node: any, name: string) => node?.props?.className?.split(' ').includes(name) === true;
function oneClass(node: any, name: string) {
  const found = descendants(node).filter(n => hasClass(n, name));
  assert.equal(found.length, 1, 'one ' + name);
  return found[0];
}
const g: any = globalThis;
beforeEach((t) => {
  const ui = { view: 'inbox', projectId: 'p1', drafts: {}, snap: { sessions: [], live: [], approvals: [], needs_you: [] as any[], engines: [{ id: 'ready', light: 'green' }], projects: [{ id: 'p1', name: 'Test project' }] } };
  const values = { ui, homeView: { shown: () => true }, project: () => ui.snap.projects[0], waitingAll: () => [],
    needsCount: () => 0, isInfo: () => true, changedFiles: () => [], STATE_ORDER: [], ago: () => '1m ago', load: () => null };
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(g, key);
    Object.defineProperty(g, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(g, key, previous) : delete g[key]);
  }
  inboxStore.set({ filter: 'all', selectedId: null });
  addonsStore.set({ rows: [] });
});

test('9bbb9fc5 Home composer has no loose key chips and its bar ends with Start carrying its shortcut tooltip', () => {
  // Keep the shortcut on Start and Start last in the composer bar.
  (g.ui as any).view = 'home'; (g.ui as any).homeSel = '';
  const start = descendants(screen(Home)).find((n: any) => n?.type?.name === 'StartState');
  assert.ok(start);
  const startBox = start.props.composer;
  assert.equal(startBox.type.name, 'StartBox');
  const box = screen(startBox.type, startBox.props);
  assert.equal(descendants(box).filter(n => n?.type === Kbd || n?.type === 'kbd' || hasClass(n, 'ou-composerhint')).length, 0);
  const controls = children(oneClass(box, 'ou-hm-cbar'));
  const last = controls[controls.length - 1];
  assert.equal(last.props.label, 'Start');
  assert.equal(last.props.tooltip ?? last.props.title, 'Start (Ctrl+Enter)');
  assert.equal(last.props['data-action'], 'home-start');
  assert.equal(descendants(box).filter(n => n?.props?.label === 'Start').length, 1);
  assert.match(readFileSync(join(wb, 'ui/src/ui.css'), 'utf8'), /\.ou-hm-cgap \{ flex: 1 1 auto; \}/);
});

test('32216b24 Add-ons Ready and Not ready use the same Badge component with their own labels', () => {
  // Render both readiness states through the installed Badge component.
  g.ui.view = 'addons';
  g.ui.snap.engines = [{ id: 'ready', light: 'green' }, { id: 'bad', light: 'red' }];
  const tree = screen(Addons);
  const ready = oneClass(tree, 'ou-acard-ready');
  const bad = oneClass(tree, 'ou-notready');
  assert.equal(ready.type, Badge);
  assert.equal(bad.type, Badge);
  assert.equal(ready.props.label, 'Ready');
  assert.equal(bad.props.label, 'Not ready');
  assert.match(renderToStaticMarkup(ready), />Ready</);
  assert.match(renderToStaticMarkup(bad), />Not ready</);
});

test('0c16ec6c Needs you renders five group heads and dims and folds only the empty ones', () => {
  const heads = () => descendants(screen(Inbox)).filter(n => n?.type?.name === 'Fold').map(n => n.props.head);
  g.ui.snap.needs_you = [{ id: 'done', kind: 'done', text: 'Finished' }];
  inboxStore.set({ collapsed: [] });
  assert.deepEqual(heads().map(n => n.props['data-group']), ['needs', 'working', 'in_review', 'failed', 'done']);
  assert.deepEqual(heads().map(n => hasClass(n, 'ou-ny-gdim')), [true, true, true, true, false]);
  assert.deepEqual(heads().map(n => n.props['aria-expanded']), [false, false, false, false, true]);
  const css = readFileSync(join(wb, 'ui/src/ui.css'), 'utf8');
  assert.match(css, /\.ou-ny-gdim\s*\{[^}]*opacity: \.55;/);
});

test('29f34ba5 Needs you detail pane asks you to pick an item, and an empty list explains what will show up', () => {
  g.ui.snap.needs_you = [{ id: 'done', kind: 'done', text: 'Finished' }];
  const pane = oneClass(screen(Inbox), 'ou-ipane');
  assert.equal(pane.props['data-state'], 'empty');
  assert.deepEqual(children(oneClass(pane, 'ou-ny-pane-empty')), ['Pick an item on the left to open it here.']);
  g.ui.snap.needs_you = [];
  const content = children(oneClass(screen(Inbox), 'ou-ny-empty'));
  assert.equal(content.length, 1);
  assert.equal(content[0].props.title, 'Nothing is waiting on you.');
  assert.equal(content[0].props.description, 'Questions from agents and finished work show up here.');
  assert.equal(content[0].props.isCompact, true);
  assert.match(renderToStaticMarkup(content[0]), />Questions from agents and finished work show up here\.</);
});

test('2b8ac71a Add-ons cards prefix only bare numeric versions and omit the trailing period', () => {
  // Render agent and plugin version lines with numeric, prefixed, named and punctuated versions.
  g.ui.view = 'addons';
  const versions = ['1.2.3', 'v2.0', 'nightly', '1.2.3.'];
  g.ui.snap.engines = versions.map((version, i) => ({ id: 'agent-' + i, light: 'green', version }));
  addonsStore.set({ rows: versions.map((version, i) => ({ id: 'plugin-' + i, enabled: true, permissions: [], version })) });
  const cards = descendants(screen(Addons)).filter(n => hasClass(n, 'ou-acard'));
  const lines = cards.map(card => children(oneClass(card, 'ou-acard-name'))[1]);
  assert.deepEqual(lines.map(line => renderToStaticMarkup(line)), [
    '<span>Agent · v1.2.3</span>',
    '<span>Agent · v2.0</span>',
    '<span>Agent · nightly</span>',
    '<span>Agent · v1.2.3</span>',
    '<span>Plugin · v1.2.3</span>',
    '<span>Plugin · v2.0</span>',
    '<span>Plugin · nightly</span>',
    '<span>Plugin · v1.2.3</span>',
  ]);
});
