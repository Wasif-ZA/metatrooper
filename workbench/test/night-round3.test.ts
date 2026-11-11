import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'night-round3-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');

// Bundle real screen sources and retain installed React and library controls.
const entry = "export * from './src/inbox.jsx'; export * from './src/home.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';";
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
  const source = entry.replaceAll("'./src/", "'" + join(wb, 'ui/src/').replaceAll('\\', '/') );
  const entryPath = join(temp, 'entry.jsx');
  writeFileSync(entryPath, source.replace("'react';", JSON.stringify(requireUI.resolve('react')) + ';').replace("'react-dom/server';", JSON.stringify(requireUI.resolve('react-dom/server')) + ';'));
  const binary = join(dirname(requireUI.resolve('esbuild/package.json')), '../@esbuild/win32-x64/esbuild.exe');
  await new Promise<void>((resolveBuild, reject) => {
    const child = spawn(binary, [entryPath, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--loader:.css=empty', '--banner:js=import { createRequire as __nightCreateRequire } from "node:module"; const require = __nightCreateRequire(import.meta.url);', '--outfile=' + join(temp, 'panes.mjs')], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolveBuild() : reject(new Error('esbuild exited ' + code)));
  });
}
const { React, renderToStaticMarkup, Inbox, inboxStore, Home } = await import(pathToFileURL(join(temp, 'panes.mjs')).href);
const source = (name: string) => readFileSync(join(wb, 'renderer', name), 'utf8');
const app = source('app.js');
const terminal = source('terminal.js');
const fn = (name: string, code = app, indent = '') => {
  const match = code.match(new RegExp(`^${indent}(?:async )?function ${name}\\([^]*?\\r?\\n${indent}}`, 'm'));
  assert.ok(match, 'real renderer function exists: ' + name);
  return match[0];
};
const cssRule = (css: string, selector: string) => {
  const body = css.slice(css.indexOf(selector) + selector.length).match(/^\s*\{([^}]+)\}/);
  assert.ok(css.includes(selector) && body, 'CSS rule exists: ' + selector);
  return body[1];
};

// Inspect real screen output with only its top-level hooks supplied by the harness.
function screen(Component: any) {
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  internals.H = { useSyncExternalStore: (_: any, get: any) => get(), useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, () => {}], useEffect: () => {} };
  try { return Component(); } finally { internals.H = previous; }
}
const children = (node: any): any[] => [node?.props?.children].flat(Infinity).filter(n => n != null && typeof n !== 'boolean');
const hasClass = (node: any, name: string) => node?.props?.className?.split(' ').includes(name);
const descendants = (node: any): any[] => [node, ...children(node).flatMap(descendants)];
const oneClass = (node: any, name: string) => {
  const found = descendants(node).filter(n => hasClass(n, name));
  assert.equal(found.length, 1, 'one ' + name);
  return found[0];
};
function globals(t: any, values: any) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete (globalThis as any)[key]);
  }
}
function uiGlobals(t: any) {
  const ui = { view: 'inbox', projectId: 'p1', pendingHide: new Set(), snap: { sessions: [], live: [] as any[], approvals: [], needs_you: [] as any[], engines: [], projects: [{ id: 'p1', name: 'Test project' }] } };
  globals(t, { ui, homeView: { shown: () => true }, project: () => ui.snap.projects[0], waitingAll: () => ui.snap.live,
    needsCount: () => ui.snap.live.length, isInfo: () => true, changedFiles: () => [], STATE_ORDER: [], ago: () => '1m ago',
    taskOf: (x: any) => x.title, loopOf: () => null, lendOf: () => null, STATE_WORDS: {} });
  return ui;
}

test('d8c614e8 Wall header keeps Diff, Hand back and More in one row and toggles the info line', () => {
  // Pin the header structure and the real label updates without measuring pixels.
  const markup = terminal.match(/const TILE_HTML = `([^`]+)`/)![1];
  const row = markup.match(/<div class="ou-ah r1"[^>]*>([^]*?)<\/div>\s*<div class="r2">/)![1];
  assert.equal((markup.match(/class="ou-ah r1"/g) || []).length, 1);
  assert.match(row, /<span class="ou-ah-acts"><span class="act"><button class="btn" data-action="open-panel" data-tab="diff"[^>]*>Diff<\/button><button class="btn" data-action="open-panel" data-tab="handback"[^>]*>Hand back<\/button><\/span>/);
  assert.match(row, /<details class="tile-more"><summary class="tx" aria-label="More actions" title="More actions">\.\.\.<\/summary><menu><span class="tile-previews"><\/span><span class="tile-desk"><\/span><button class="pb" data-action="pair"[^>]*>Pair<\/button><\/menu><\/details>/);
  const label = new Function('selected', [fn('escapeAttr', terminal, '  '), fn('deskHtml', terminal, '  '), fn('label', terminal, '  '), 'return label;'].join('\n'))(null);
  const parts = new Map<string, any>();
  const get = (selector: string) => {
    if (!parts.has(selector)) parts.set(selector, { textContent: '', innerHTML: '', dataset: {}, style: {}, classList: { toggle() {} } });
    return parts.get(selector);
  };
  const tile = { el: { dataset: {}, querySelector: get, classList: { toggle() {}, add() {} } }, term: { options: {}, write() {} } };
  const session = { id: 's1', state: 'done', engine_id: 'claude', task: 'Header test', words: 'done', desk: { grants: [] }, previews: [{ url: 'http://localhost:3000', port: 3000 }] };
  label(tile, session);
  assert.equal(get('.r2').hidden, true);
  assert.equal(get('.tile-desk').innerHTML, '<button class="btn" data-action="grant-give" title="Give this agent one of your windows">Give window</button>');
  assert.equal(get('.tile-previews').innerHTML, '<button class="btn" data-action="open-preview" data-url="http://localhost:3000" title="Open http://localhost:3000 in this agent\'s browser pane">Open preview</button>');
  for (const [info, selector, expected] of [
    [{ last: 'Ready for review' }, '.tile-last', 'Ready for review'],
    [{ meta: '2 files' }, '.tile-meta', '2 files'],
    [{ changed: 2 }, '.tile-changed', '2 changed'],
    [{ ctx: { text: '50%' } }, '.tile-ctx', '50%'],
  ] as const) {
    label(tile, { ...session, ...info });
    assert.equal(get('.r2').hidden, false);
    assert.equal(get(selector).textContent, expected);
    label(tile, { ...session, last: '  ', meta: '  ' });
    assert.equal(get('.r2').hidden, true);
  }
  label(tile, { ...session, watchOff: true });
  assert.equal(get('.r2').hidden, false); assert.equal(get('.tile-watch').hidden, false);
  label(tile, session); assert.equal(get('.r2').hidden, true);
  assert.match(cssRule(source('wall.css'), '.ph .r1, .ph .r2'), /display:\s*flex;/);
  assert.match(cssRule(source('wall.css'), '.ou-ah-acts'), /display:\s*inline-flex;/);
  for (const file of ['wall.css', 'wall-plain.css']) assert.match(source(file), /\.ph \.r2\[hidden\]/);
});

test('38dabe15 Wall strip tabs and links retain pill styling and data-action targets', () => {
  // Pin the existing pill classes, shared CSS and live strip action markup.
  const strip = source('index.html').match(/<footer id="strip" class="strip">([^]*?)<\/footer>/)![1];
  assert.deepEqual([...strip.matchAll(/<button class="([^"]+)" data-action="([^"]+)" data-tab="([^"]+)">([^<]+)/g)].map(m => m.slice(1)), [
    ['stab', 'tab', 'diff', 'Diff'], ['stab', 'tab', 'git', 'Git'], ['stab', 'tab', 'handback', 'Hand back'], ['stab', 'tab', 'browser', 'Browser'],
  ]);
  const html = new Map<string, string>();
  const elements = new Map(['strip-info', 'diffN'].map(id => [id, { title: '', textContent: '' }]));
  const tabs = ['diff', 'git', 'handback', 'browser'].map(tab => ({ dataset: { tab }, on: false, classList: { toggle(_: string, on: boolean) { tabs.find(b => b.dataset.tab === tab)!.on = on; } } }));
  const ui = { snap: { sessions: [] }, split: true, tab: 'handback' };
  const renderStrip = new Function('ui', 'document', 'setHtml', fn('esc') + '\n' + fn('renderStrip') + '\nreturn renderStrip;')(
    ui, { getElementById: (id: string) => elements.get(id), querySelectorAll: (selector: string) => { assert.equal(selector, '#strip [data-action="tab"]'); return tabs; } },
    (id: string, value: string) => html.set(id, value));
  renderStrip(null);
  assert.equal(html.get('strip-needs'), '<span class="link" data-action="inbox">Inbox</span>');
  assert.deepEqual(tabs.map(b => [b.dataset.tab, b.on]), [['diff', false], ['git', false], ['handback', true], ['browser', false]]);
  for (const [file, selector] of [
    ['style.css', '.strip .stab, .strip .link'],
    ['wall-plain.css', ':root:not([data-look="dither"]) :is(.strip .stab, .strip .link)'],
  ]) {
    const css = source(file); const rule = cssRule(css, selector);
    assert.match(rule, /border-radius:\s*[^;]+;/); assert.match(rule, /display:\s*inline-flex;/);
    const hover = cssRule(css, file === 'style.css' ? '.strip .stab:hover, .strip .link:hover' : selector + ':hover');
    assert.match(hover, /background:\s*var\(--canvas-soft\);/);
  }
});

test('cd33aaec Needs you puts the step and action bar first in the detail pane and keeps the list free of footers', (t) => {
  const ui = uiGlobals(t);
  for (const kind of ['ask', 'notice']) {
    ui.snap.live = kind === 'ask' ? [{ id: 's1', project_id: 'p1', engine_id: 'claude', title: 'Question', state: 'waiting_for_you' }] : [];
    ui.snap.needs_you = kind === 'notice' ? [{ id: 'n1', kind: 'done', text: 'Finished' }] : [];
    inboxStore.set({ filter: 'all', selectedId: kind === 'ask' ? 's1' : 'n1', collapsed: [] });
    const tree = screen(Inbox); const pane = oneClass(tree, 'ou-ipane');
    const classed = descendants(pane).filter(n => typeof n?.props?.className === 'string');
    assert.equal(classed[0], pane); assert.equal(hasClass(classed[1], 'ou-ny-bar'), true);
    assert.deepEqual(children(classed[1]).slice(0, 2).map(n => n.props.label), ['Previous item', 'Next item']);
    const list = oneClass(tree, 'ou-inbox-list');
    assert.equal(descendants(list).filter(n => n.type === 'footer').length, 0);
    assert.equal(descendants(list).filter(n => hasClass(n, 'ou-irow')).length, 1);
  }
});

test('2f5f7cb9 Home start page Import projects carries its folder icon and the open-folder action', async (t) => {
  // Render the real start action and send its action through the real delegated click handler.
  const ui = uiGlobals(t); ui.view = 'home'; (ui as any).homeSel = '';
  const start = descendants(screen(Home)).find((n: any) => n?.type?.name === 'StartState');
  assert.ok(start);
  const html = renderToStaticMarkup(start);
  const rendered = html.match(/<button\b[^>]*data-action="open-folder"[^>]*>[^]*?<\/button>/);
  assert.ok(rendered); assert.match(rendered[0], /<svg\b/); assert.match(rendered[0], /Import projects/);
  const calls: string[] = [];
  const onClick = new Function('hideMenu', 'openFolder', fn('onClick') + '\nreturn onClick;')(() => calls.push('hideMenu'), async () => { calls.push('openFolder'); });
  const el = { tagName: 'BUTTON', dataset: { action: 'open-folder' }, closest: () => null };
  await onClick({ target: { closest: (selector: string) => { assert.equal(selector, '[data-action]'); return el; } }, stopPropagation() {} });
  assert.deepEqual(calls, ['hideMenu', 'openFolder']);
});
