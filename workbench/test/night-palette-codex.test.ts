import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

// Like m8-ax-screens and night-ui-r2: bundle real JSX, retain library controls,
// fake browser/API boundaries, and invoke the callbacks actually rendered.
const wb = fileURLToPath(new URL('../', import.meta.url));
const read = (p: string) => readFileSync(join(wb, p), 'utf8');
const app = read('renderer/app.js');
const main = read('ui/src/main.jsx');
const ide = read('ui/src/ide.jsx');
function extract(text: string, re: RegExp) {
  const m = text.match(re);
  assert.ok(m, 'production fragment exists: ' + re);
  return m[0];
}
const temp = mkdtempSync(join(tmpdir(), 'night-palette-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(wb, 'ui/package.json'));
const entry = join(temp, 'entry.jsx'), output = join(temp, 'palette.mjs');
const asks = extract(ide, /^function Asks\(\{ st \}\) \{[^]*?^\}/m);
const mounts = extract(main, /^const el =[^]*?^if \(document.readyState[^\n]+/m);
writeFileSync(entry, [
  'export * from ' + JSON.stringify(join(wb, 'ui/src/palette.jsx').replace(/\\/g, '/')) + ';',
  'import { Palette } from ' + JSON.stringify(join(wb, 'ui/src/palette.jsx').replace(/\\/g, '/')) + ';',
  "export * as React from 'react';",
  "export { renderToStaticMarkup } from 'react-dom/server';",
  ...['AlertDialog', 'Button', 'Dialog', 'Heading', 'TextInput'].map(n => "import { " + n + " } from '@astryxdesign/core/" + n + "';"),
  "import { Layout, LayoutContent, LayoutFooter } from '@astryxdesign/core/Layout';",
  // Only dependencies outside the delete dialog are replaced, never its JSX/callbacks.
  "const base = p => p.split('/').pop(); const under = (p, root) => p === root || p.startsWith(root + '/');",
  "const bump = () => globalThis.__deleteBump(); const deleteEntry = (...args) => globalThis.__deleteEntry(...args);",
  asks, 'export { Asks };',
  'export function mountUI(document, createRoot) {',
  "const Theme = 'theme'; const neutralTheme = {};",
  "const Settings = () => null, Inbox = Settings, Addons = Settings, Ide = Settings, Home = Settings;",
  mounts, '}',
].join('\n'));
const platform = process.platform === 'win32' ? 'win32-' + process.arch : process.platform + '-' + process.arch;
const binary = requireUI.resolve('@esbuild/' + platform + (process.platform === 'win32' ? '/esbuild.exe' : '/bin/esbuild'));
const built = spawnSync(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--packages=external', '--loader:.css=empty', '--log-level=error', '--outfile=' + output], { stdio: 'inherit', windowsHide: true });
assert.ifError(built.error);
assert.equal(built.status, 0, 'real JSX bundle builds');
writeFileSync(output, readFileSync(output, 'utf8').replace(/from "([^"\n]+)"/g, (all, specifier) =>
  specifier.startsWith('.') || specifier.startsWith('node:') ? all : 'from ' + JSON.stringify(pathToFileURL(requireUI.resolve(specifier)).href)));
const { React, renderToStaticMarkup, Palette, paletteView, paletteStore, confirmStore, Asks, mountUI } = await import(pathToFileURL(output).href);
const g: any = globalThis;
const savedGlobals = new Map<string, PropertyDescriptor | undefined>();
const globals = ['ui', 'api', 'project', 'paletteItems', 'KEYS', 'rpc', 'shellRows', 'openHit', 'toast', 'reportPaneBounds', '__deleteBump', '__deleteEntry'];
for (const key of globals) savedGlobals.set(key, Object.getOwnPropertyDescriptor(g, key));
after(() => { for (const [key, descriptor] of savedGlobals) { if (descriptor) Object.defineProperty(g, key, descriptor); else delete g[key]; } });
const calls: any[] = [];
paletteStore.use = paletteStore.get;
confirmStore.use = confirmStore.get;
function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement(value)) return [];
  return [value, ...Object.values(value.props).flatMap(nodes)];
}
function paletteControl() {
  const found = nodes(Palette()).find(n => n.props.searchSource);
  assert.ok(found, 'CommandPalette rendered');
  return found.props;
}
function confirmControl() {
  const found = nodes(Palette()).find(n => n.props.actionVariant === 'destructive');
  assert.ok(found, 'confirm AlertDialog rendered');
  return found.props;
}
const group = (items: any[], name: string) => items.filter(x => x.auxiliaryData?.group === name);
async function choose(id: string) {
  paletteControl().onValueChange(id);
  // Production defers selection with setTimeout(..., 0).
  await new Promise(resolve => setTimeout(resolve, 10));
}
function fakeDocument() {
  const elements = new Map<string, any>();
  const listeners: Record<string, Function[]> = {};
  const getElementById = (id: string) => {
    if (!elements.has(id)) elements.set(id, {
      id, hidden: true, value: '', classList: { contains: () => false },
      replaceChildren() {}, focus() {}, blur() { calls.push(['blur', id]); },
      addEventListener(name: string, fn: Function) { (listeners[id + ':' + name] ||= []).push(fn); },
    });
    return elements.get(id);
  };
  return {
    elements, listeners, readyState: 'complete', getElementById,
    createElement: () => ({}),
    body: { appendChild(node: any) { elements.set(node.id, node); }, classList: { contains: () => false } },
    addEventListener(name: string, fn: Function) { (listeners[name] ||= []).push(fn); },
  };
}
function event(key: string, shiftKey = false) {
  return { key, ctrlKey: true, shiftKey, altKey: false, defaultPrevented: false,
    target: { matches: () => false }, preventDefault() { this.defaultPrevented = true; } };
}
function renderer(extra: any = {}) {
  const document = fakeDocument();
  const c: any = vm.createContext({
    document, ui: g.ui, paletteView, settingsView: { isOpen: () => false },
    wall: { sheetOpen: () => false, listOpen: () => false, openSearch: () => calls.push(['old search']), closeSearch() {} },
    disarm() {}, renderPalette: () => calls.push(['old list']),
    ...extra,
  });
  vm.runInContext([
    extract(app, /^function openPalette\(\)[^]*?^\}/m),
    extract(app, /^function closePalette\(\)[^]*?^\}/m),
    extract(app, /^function overlayOpen\(\)[^]*?^\}/m),
    extract(app, /^const PANE_OVERLAYS =[^\n]+/m),
    'globalThis.paneOverlays = PANE_OVERLAYS;',
  ].join('\n'), c);
  return { c, document };
}
beforeEach(() => {
  calls.length = 0;
  Object.assign(g, {
    ui: { view: 'ide', projectId: 'p1', pendingHide: new Set(), shellKinds: [], mode: 'single',
      snap: { core: { online: true }, sessions: [{ id: 's1' }, { id: 's2' }], engines: [], projects: [] } },
    api: { fsFind: async () => ['zoom.txt'], restartCore: async () => calls.push(['restart']), stopCore: async () => calls.push(['stop']) },
    project: () => ({ id: 'p1' }),
    paletteItems: () => [{ group: 'Actions', label: 'zoom command', run() {} }],
    shellRows: () => [{ id: 'sh_1' }],
    rpc: async (...args: any[]) => { calls.push(['rpc', ...args]); return { result: { hits: [] } }; },
    openHit: (hit: any) => calls.push(['openHit', hit]),
    toast: (...args: any[]) => calls.push(['toast', ...args]),
    reportPaneBounds: () => calls.push(['bounds']),
    __deleteBump() {},
    __deleteEntry: (...args: any[]) => calls.push(['delete', ...args]),
  });
  paletteStore.set({ open: false }); confirmStore.set({ item: null });
});

test('case 1: #cmdk mounts and Ctrl+Shift+P toggles on every screen, respecting overlays', () => {
  const { c, document } = renderer();
  const mounted: string[] = [];
  mountUI(document, (el: any) => ({ render: () => mounted.push(el.id) }));
  assert.equal(mounted.filter(id => id === 'cmdk').length, 1);
  assert.ok(document.elements.has('cmdk'));
  c.ideView = { shown: () => g.ui.view === 'ide' };
  c.ideKeys = { asking: () => false };
  // Execute all real main.jsx keydown registrations; no copied shortcut logic.
  vm.runInContext(main.match(/^document\.addEventListener\('keydown', \(e\) => \{[^]*?^\}\);/gm)!.join('\n'), c);
  for (const view of ['home', 'wall', 'inbox', 'ide']) {
    g.ui.view = view;
    for (const expected of [true, false]) {
      const e = event('P', true);
      for (const handler of document.listeners.keydown) handler(e);
      assert.equal(paletteView.isOpen(), expected, view);
      assert.equal(e.defaultPrevented, true);
    }
    document.getElementById('inbox').hidden = false;
    for (const handler of document.listeners.keydown) handler(event('P', true));
    assert.equal(paletteView.isOpen(), false, view + ' blocked by overlay');
    document.getElementById('inbox').hidden = true;
  }
});

test('case 2: Ctrl+K, input focus and palette action use paletteView; legacy fallback remains', () => {
  const { c, document } = renderer();
  // Extract the entire renderer key handler and the actual action case.
  vm.runInContext(extract(app, /^document\.addEventListener\('keydown', \(e\) => \{[^]*?^\}\);/m), c);
  vm.runInContext(extract(app, /^document\.getElementById\('palette-input'\)\.addEventListener\('focus'[^\n]+/m), c);
  vm.runInContext('globalThis.action = () => { switch ("palette") {\n' +
    extract(app, /    case 'palette':[^]*?      return;/) + '\n} };', c);
  let toggles = 0, opens = 0;
  c.paletteView = { toggle() { toggles++; }, open() { opens++; } };
  const key = event('k');
  document.listeners.keydown[0](key);
  assert.equal(toggles, 1); assert.equal(key.defaultPrevented, true);
  assert.equal(document.getElementById('palette').hidden, true);
  document.listeners['palette-input:focus'][0]({ target: document.getElementById('palette-input') });
  assert.equal(opens, 1); assert.deepEqual(calls, [['blur', 'palette-input']]);
  c.action(); assert.equal(opens, 2);
  assert.equal(calls.some(x => x[0] === 'old list'), false);
  delete c.paletteView;
  for (const trigger of [
    () => document.listeners.keydown[0](event('k')),
    () => document.listeners['palette-input:focus'][0]({ target: document.getElementById('palette-input') }),
    () => c.action(),
  ]) {
    document.getElementById('palette').hidden = true; calls.length = 0;
    trigger();
    assert.equal(document.getElementById('palette').hidden, false);
    assert.deepEqual(calls, [['old search'], ['old list']]);
  }
  document.listeners.keydown[0](event('k'));
  assert.equal(document.getElementById('palette').hidden, true, 'legacy Ctrl+K also closes');
});

test('case 3: open palette blocks overlays and native panes include the cmdk dialog', () => {
  const { c } = renderer();
  assert.equal(c.overlayOpen(), false);
  paletteView.open(); assert.equal(c.overlayOpen(), true);
  paletteView.close(); assert.equal(c.overlayOpen(), false);
  assert.ok(c.paneOverlays.split(', ').includes('#cmdk dialog[open]'));
  delete c.paletteView; assert.equal(c.overlayOpen(), false);
});

test('case 4: online scrollback search passes all session ids, caps hits and opens the selected hit', async () => {
  const hits = Array.from({ length: 25 }, (_, i) => ({ session_id: i % 2 ? 'sh_1' : 's1', line: i, text: 'zoom ' + i }));
  g.rpc = async (...args: any[]) => { calls.push(['rpc', ...args]); return { result: { hits } }; };
  const results = await paletteControl().searchSource.search('zoom');
  assert.deepEqual(calls.filter(x => x[0] === 'rpc'), [['rpc', 'session.search', { query: 'zoom', session_ids: ['s1', 's2', 'sh_1'] }, true]]);
  assert.equal(group(results, 'Scrollback').length, 20);
  assert.deepEqual(group(results, 'Scrollback').map(x => x.label), hits.slice(0, 20).map(x => x.text));
  assert.equal(new Set(group(results, 'Scrollback').map(x => x.id)).size, 20);
  assert.ok(group(results, 'Files').length); assert.ok(group(results, 'Actions').length);
  await choose(group(results, 'Scrollback')[7].id);
  assert.equal(calls.find(x => x[0] === 'openHit')?.[1], hits[7], 'passes the original hit object');
  // Exercise real openHit as well, including shell and agent navigation.
  const c: any = vm.createContext({ pick: async (id: string) => calls.push(['pick', id]),
    selectShell: (id: string) => calls.push(['shell', id]), termView: { reveal: async (...args: any[]) => calls.push(['reveal', ...args]) } });
  vm.runInContext(extract(app, /^async function openHit\(h\)[^]*?^\}/m), c);
  calls.length = 0; await c.openHit(hits[0]); await c.openHit(hits[1]);
  assert.deepEqual(calls, [['pick', 's1'], ['reveal', 's1', 0, 'zoom 0'], ['shell', 'sh_1'], ['reveal', 'sh_1', 1, 'zoom 1']]);
});

test('case 4: rpc error and rejection preserve files and commands without toast; empty/offline skip rpc', async () => {
  for (const response of ['error', 'reject']) {
    calls.length = 0;
    g.rpc = async () => { calls.push(['rpc']); if (response === 'reject') throw Error('offline'); return { error: { message: 'offline' } }; };
    const results = await paletteControl().searchSource.search('zoom');
    assert.ok(group(results, 'Files').length, response);
    assert.ok(group(results, 'Actions').some(x => x.label === 'zoom command'), response);
    assert.equal(group(results, 'Scrollback').length, 0);
    assert.equal(calls.filter(x => x[0] === 'rpc').length, 1);
    assert.equal(calls.some(x => x[0] === 'toast'), false);
  }
  calls.length = 0;
  await paletteControl().searchSource.search('');
  g.ui.snap.core.online = false;
  await paletteControl().searchSource.search('zoom');
  assert.equal(calls.some(x => x[0] === 'rpc'), false);
});

test('case 5: real restart/stop palette items wait for confirmation and cancel does nothing', async () => {
  const document = fakeDocument();
  const c: any = vm.createContext({ ui: g.ui, api: g.api, toast: g.toast, document, project: () => null,
    selectedSession: () => null, taskOf: () => '', STATE_WORDS: {}, TABS: [],
    openFolder() {}, reportIssue() {}, openSinks() {} });
  vm.runInContext(extract(app, /^function paletteItems\(\)[^]*?^\}/m), c);
  const items = c.paletteItems().filter((x: any) => x.confirm);
  assert.deepEqual(Array.from(items, (x: any) => x.confirm), ['restart', 'stop']);
  g.paletteItems = () => items;
  for (const item of items) {
    calls.length = 0;
    const options = paletteControl().searchSource.bootstrap();
    const option = options.find((x: any) => x.label === item.label);
    assert.ok(option);
    await choose(option.id);
    assert.deepEqual(calls, [], 'picking must not run ' + item.confirm);
    let dialog = confirmControl();
    assert.equal(dialog.isOpen, true);
    assert.equal(dialog.title, item.name);
    assert.equal(dialog.description, 'Open agents stop.');
    assert.equal(dialog.actionLabel, item.confirm === 'stop' ? 'Stop core' : 'Restart core');
    dialog.onOpenChange(false);
    assert.equal(confirmStore.get().item, null);
    assert.deepEqual(calls, [], 'Cancel must not run');
    await choose(option.id);
    dialog = confirmControl();
    await dialog.onAction();
    assert.equal(confirmStore.get().item, null);
    assert.equal(calls.filter(x => x[0] === item.confirm).length, 1);
    assert.equal(calls.filter(x => ['restart', 'stop'].includes(x[0])).length, 1);
  }
});

test('case 6: nonempty queries search real KEYS and all six IDE shortcuts; bootstrap has no Keys', async () => {
  const c: any = vm.createContext({});
  vm.runInContext(extract(app, /^const KEYS = \[[^]*?^\];/m) + '\nglobalThis.keys = KEYS;', c);
  g.KEYS = c.keys;
  const source = paletteControl().searchSource;
  const zoom = group(await source.search('zoom'), 'Keys');
  const expected = Array.from(c.keys).filter((x: any) => x.does.toLowerCase().includes('zoom'));
  assert.ok(expected.length);
  assert.deepEqual(zoom.map(x => x.label), expected.map((x: any) => x.does + ' · ' + x.keys + ' · ' + x.where));
  const ideKeys = group(await source.search('IDE'), 'Keys').filter(x => x.label.endsWith(' · IDE'));
  for (const key of ['Ctrl+P', 'Ctrl+Shift+F', 'Ctrl+Shift+G', 'Ctrl+S', 'Ctrl+W', 'Ctrl+Shift+P']) {
    assert.equal(ideKeys.filter(x => x.label.endsWith(' · ' + key + ' · IDE')).length, 1, key);
  }
  assert.equal(ideKeys.length, 6);
  assert.equal(group(source.bootstrap(), 'Keys').length, 0);
  assert.equal(group(await source.search(''), 'Keys').length, 0);
});

test('case 7: IDE file/folder delete defaults to Cancel and deletes only on explicit confirm', () => {
  for (const path of ['notes.txt', 'notes/']) {
    const make = () => ({ pid: 'p1', tabs: [], closeAll: true, ask: { kind: 'delete', path } });
    let st = make();
    let tree = Asks({ st });
    const cancel = nodes(tree).find(n => n.props.label === 'Cancel');
    const destroy = nodes(tree).find(n => n.props.variant === 'destructive');
    assert.ok(cancel); assert.ok(destroy);
    assert.equal(tree.props.role, 'alertdialog');
    assert.equal(cancel.props['data-autofocus'], true);
    assert.equal(cancel.props.autoFocus, true, 'Cancel owns actual default focus');
    assert.equal(destroy.props.autoFocus, undefined);
    // Verify the real library Button passes autofocus to the browser button.
    const cancelHTML = renderToStaticMarkup(cancel);
    assert.match(cancelHTML, /<button\b[^>]*autofocus=""/i);
    assert.deepEqual(calls, [], 'render never deletes');
    cancel.props.onClick();
    assert.equal(st.ask, null); assert.equal(st.closeAll, false);
    assert.deepEqual(calls, [], 'Cancel never deletes');
    st = make(); tree = Asks({ st });
    tree.props.onOpenChange(false);
    assert.equal(st.ask, null); assert.deepEqual(calls, [], 'dismiss never deletes');
    st = make(); tree = Asks({ st });
    nodes(tree).find(n => n.props.variant === 'destructive').props.onClick();
    assert.deepEqual(calls, [['delete', st, path]], 'explicit destructive click deletes exactly once');
    calls.length = 0;
  }
});

