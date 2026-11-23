import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseJsonc, readVsCode, themeFor, importSummary } from '../src/vscode-import.ts';

const wb = fileURLToPath(new URL('../', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'm8-20-'));
process.on('exit', () => { try { rmSync(tmp, { recursive: true, force: true }); } catch {} });

// ---- pure parts -------------------------------------------------------------
test('M8-20 parseJsonc reads comments, trailing commas and // inside strings', () => {
  assert.deepEqual(parseJsonc('{ // c\n "a": "http://x//y", /* b */ "b": [1, 2,], }'), { a: 'http://x//y', b: [1, 2] });
  assert.equal(parseJsonc('{ nope'), null);
});

test('M8-20 parseJsonc keeps ",]" and ",}" inside strings, ignores a leading BOM, still drops trailing commas outside strings', () => {
  assert.deepEqual(parseJsonc('{"t": "a,] b,}", "k": [1,\n],}'), { t: 'a,] b,}', k: [1] });
  assert.deepEqual(parseJsonc('\ufeff{"a": 1,}'), { a: 1 });
  assert.deepEqual(parseJsonc('[1,2,]'), [1, 2]);
});

const ESC_CR = '\u001b\r';
function writeVs(appData: string) {
  const u = join(appData, 'Code', 'User'); mkdirSync(u, { recursive: true });
  writeFileSync(join(u, 'settings.json'), '{\n // look\n "workbench.colorTheme": "Solarized Light",\n "workbench.sideBar.location": "right",\n}');
  writeFileSync(join(u, 'keybindings.json'), `[
 { "key": "Shift+Enter", "command": "workbench.action.terminal.sendSequence", "args": { "text": ${JSON.stringify(ESC_CR)} } },
 { "key": "ctrl+alt+q", "command": "editor.action.quickFix" },
 { "key": "ctrl+b", "command": "-workbench.action.toggleSidebarVisibility" },
 { "key": "alt+j", "command": "workbench.action.nextEditor" },
 { "key": "ctrl+k ctrl+s", "command": "workbench.action.openGlobalKeybindings" },
]`);
}

test('M8-20 readVsCode reads a temp appData and returns null when VS Code has no folder', () => {
  const appData = join(tmp, 'a'); writeVs(appData);
  const f = readVsCode(appData)!;
  assert.equal(f.theme, 'Solarized Light'); assert.equal(f.sidebar, 'right');
  assert.deepEqual(f.keys.map((k) => k.key), ['shift+enter', 'ctrl+alt+q', 'alt+j']);
  assert.equal(f.keys[0].text, ESC_CR);
  assert.deepEqual(f.chords.map((k) => k.key), ['ctrl+k ctrl+s']);
  assert.equal(readVsCode(join(tmp, 'none')), null);
});

test('M8-20 themeFor maps light to Crisp light and keeps dark and high contrast', () => {
  assert.equal(themeFor('Solarized Light'), 'light');
  assert.equal(themeFor('Default Light Modern'), 'light');
  assert.equal(themeFor('Dark Modern'), null);
  assert.equal(themeFor('Default High Contrast Light'), null);
  assert.equal(themeFor(null), null);
});

test('M8-20a,b importSummary lists the applied theme and every skipped item with its reason', () => {
  const appData = join(tmp, 'b'); writeVs(appData);
  const s = importSummary(readVsCode(appData)!, { theme: 'light' });
  assert.deepEqual(s.applied, ['theme "Solarized Light" as Crisp light', 'shift+enter: cc already sends Esc then Enter in terminals']);
  assert.deepEqual(s.skipped, [
    "side bar on the right: cc's side bar is fixed on the left",
    'ctrl+alt+q (editor.action.quickFix): cc cannot rebind keys yet',
    'alt+j (workbench.action.nextEditor): cc cannot rebind keys yet',
    'ctrl+k ctrl+s (workbench.action.openGlobalKeybindings): cc cannot rebind keys yet',
  ]);
  const dark = importSummary({ theme: 'Dark Modern', sidebar: 'left', keys: [], chords: [] }, { theme: null });
  assert.deepEqual(dark, { applied: [], skipped: ['theme "Dark Modern": cc keeps its dark look'] });
});

// ---- renderer/app.js --------------------------------------------------------
// Reuses the m6-26 boot harness (same source, patched in a temp copy) with a vscodeImport stub and a shared fake localStorage.
async function loadBoot() {
  let s = readFileSync(new URL('./m6-26-wall-repairs.test.ts', import.meta.url), 'utf8');
  s = s.slice(0, s.indexOf("\ntest('"));
  const renderer = pathToFileURL(join(wb, 'renderer')).href;
  const mainTs = pathToFileURL(join(wb, 'src/main.ts')).href;
  s = s.split('`../renderer/${f}`').join('`' + renderer + '/${f}`').split("'../src/main.ts'").join("'" + mainTs + "'")
    .replace('function boot() {', 'function boot(opts: any = {}) {')
    .replace("if (name === 'git')", "if (name === 'vscodeImport') return opts.vscode ? async () => opts.vscode() : undefined; if (name === 'git')")
    .replace("if (name === 'uiSettings') return async () => ({ theme: {}, ui: {", "if (name === 'uiSettings') return async () => ({ theme: {}, ui: { theme: opts.uiTheme(),")
    .replace('localStorage: { getItem: () => null, setItem() {}, removeItem() {} }', 'localStorage: opts.ls');
  s += '\nexport { boot, snapOf };\n';
  const file = join(tmp, 'boot.ts'); writeFileSync(file, s);
  return await import(pathToFileURL(file).href);
}
const { boot, snapOf } = await loadBoot();
const fakeLs = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, removeItem: (k: string) => { m.delete(k); } }; };
const found = { theme: 'light', summary: { applied: ['theme "Solarized Light" as Crisp light'], skipped: ['alt+j (x): cc cannot rebind keys yet'] }, keys: [{ key: 'ctrl+alt+q', command: 'editor.action.quickFix' }, { key: 'alt+j', command: 'workbench.action.nextEditor' }, { key: 'shift+enter', command: 'sendSequence' }] };
const start = async (ls: any, vscode: any = () => found, theme = 'dither') => {
  const th = { v: theme };
  const w = boot({ ls, vscode, uiTheme: () => th.v }); w.th = th;
  w.t.ui.look = { theme: { name: 'neutral', scheme: 'dark' } };
  await w.snap(snapOf([]));
  return w;
};
const told = (w: any): string[] => w.el('toasts').children.map((c: any) => c.textContent as string).filter((t: string) => t.includes('VS Code'));
const themeCalls = (w: any) => w.calls.filter((c: any) => c.method === 'api.setTheme').map((c: any) => c.params[0]);

test('M8-20a first start over the default theme (dither) applies the theme once and toasts one summary; the second start shows none', async () => {
  const ls = fakeLs();
  const w = await start(ls);
  assert.deepEqual(themeCalls(w), ['light']);
  assert.equal(told(w).length, 1);
  assert.match(told(w)[0], /^From VS Code: theme "Solarized Light" as Crisp light\. 1 skipped, listed in Settings > Learning\.$/);
  await w.snap(snapOf([]));
  assert.equal(told(w).length, 1, 'later snapshots do not ask again');
  const rec = JSON.parse(ls.m.get('cc.vscodeImport')!);
  assert.equal(rec.prev, 'dither'); assert.equal(rec.theme, 'light');
  const again = await start(ls);
  assert.deepEqual(themeCalls(again), []); assert.equal(told(again).length, 0);
  const none = fakeLs(); await start(none, () => null);
  assert.deepEqual(JSON.parse(none.m.get('cc.vscodeImport')!), { none: true });
});

test('M8-20a a theme the user already chose is not replaced: nothing applied, skipped list says so', async () => {
  const ls = fakeLs();
  const w = await start(ls, () => ({ ...found, summary: { applied: [], skipped: [...found.summary.skipped] } }), 'neutral');
  assert.deepEqual(themeCalls(w), []);
  const rec = JSON.parse(ls.m.get('cc.vscodeImport')!);
  assert.equal(rec.theme, null);
  assert.deepEqual(rec.skipped, ['theme light: you already chose a cc theme', 'alt+j (x): cc cannot rebind keys yet']);
  assert.equal(told(w).length, 1);
});

test('M8-20c a chord bound only in VS Code toasts exactly once, even across a restart; unbound and consumed ones toast nothing', async () => {
  const ls = fakeLs();
  const w = await start(ls);
  const chord = (x: any) => told(x).filter((t) => t.includes('ctrl+alt+q')).length;
  await w.key('q', { ctrlKey: true, altKey: true });
  assert.equal(chord(w), 1);
  assert.match(told(w).find((t) => t.includes('ctrl+alt+q'))!, /^ctrl\+alt\+q did "editor.action.quickFix" in VS Code\. cc has no key for it yet\.$/);
  await w.key('q', { ctrlKey: true, altKey: true });
  assert.equal(chord(w), 1, 'second press: nothing');
  const w2 = await start(ls);
  await w2.key('q', { ctrlKey: true, altKey: true });
  assert.equal(chord(w2), 0, 'after a restart: nothing');
  const w3 = await start(fakeLs());
  await w3.key('z', { ctrlKey: true, altKey: true });
  await w3.key('q', { ctrlKey: true, altKey: true, defaultPrevented: true });
  await w3.key('q', {});
  assert.equal(told(w3).filter((t) => t.includes(' did "')).length, 0);
});

test('M8-20e undo puts the previous theme back (theme still the imported one) and marks the import undone', async () => {
  const ls = fakeLs();
  const w = await start(ls);
  assert.deepEqual(themeCalls(w), ['light']);
  w.th.v = 'light';
  await w.t.globalThis.undoVscodeImport();
  assert.deepEqual(themeCalls(w), ['light', 'dither']);
  assert.equal(JSON.parse(ls.m.get('cc.vscodeImport')!).undone, true);
  await w.t.globalThis.undoVscodeImport();
  assert.deepEqual(themeCalls(w), ['light', 'dither'], 'a second undo does nothing');
});

test('M8-20e undo does nothing, keeps the record and says why when the user changed the theme afterwards', async () => {
  const ls = fakeLs();
  const w = await start(ls);
  w.th.v = 'neutral';
  await w.t.globalThis.undoVscodeImport();
  assert.deepEqual(themeCalls(w), ['light']);
  assert.notEqual(JSON.parse(ls.m.get('cc.vscodeImport')!).undone, true);
  assert.ok(w.el('toasts').children.some((c: any) => c.textContent === 'Not undone: you changed the theme after the import.'));
});

test('M8-20e undo does nothing and says why when the previous theme is unknown', async () => {
  const ls = fakeLs();
  const w = await start(ls);
  const rec = JSON.parse(ls.m.get('cc.vscodeImport')!); ls.m.set('cc.vscodeImport', JSON.stringify({ ...rec, prev: null }));
  w.th.v = 'light';
  await w.t.globalThis.undoVscodeImport();
  assert.deepEqual(themeCalls(w), ['light']);
  assert.notEqual(JSON.parse(ls.m.get('cc.vscodeImport')!).undone, true);
  assert.ok(w.el('toasts').children.some((c: any) => c.textContent === 'Not undone: the theme before the import is not known.'));
});

// ---- Settings > Learning ----------------------------------------------------
test('M8-20e Settings > Learning lists applied and skipped and an Undo that calls undoVscodeImport', async () => {
  const requireUI = createRequire(join(wb, 'ui/package.json'));
  const { build } = requireUI('esbuild');
  const out = join(tmp, 'settings.mjs');
  await build({
    absWorkingDir: join(wb, 'ui'), tsconfigRaw: {},
    stdin: { contents: "export * from './src/settings.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", resolveDir: join(wb, 'ui'), loader: 'jsx' },
    plugins: [{ name: 'p', setup(b: any) {
      b.onResolve({ filter: /.*/ }, (a: any) => {
        if (a.path.endsWith('.css')) return { path: a.path, namespace: 'css' };
        if (!a.path.startsWith('.')) return { path: pathToFileURL(requireUI.resolve(a.path)).href, external: true };
        return { path: resolve(a.namespace === 'screen' ? dirname(a.importer) : join(wb, 'ui'), a.path), namespace: 'screen' };
      });
      b.onLoad({ filter: /.*/, namespace: 'css' }, () => ({ contents: '', loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'screen' }, (a: any) => ({ contents: readFileSync(a.path, 'utf8') + (a.path.endsWith('settings.jsx') ? '\nexport { SECTIONS };\n' : ''), loader: 'jsx', resolveDir: dirname(a.path) }));
    } }],
    bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' }, outfile: out,
  });
  const m = await import(pathToFileURL(out).href);
  const g: any = globalThis; const ls = fakeLs();
  const rec = { prev: 'neutral', theme: 'light', applied: ['theme "Solarized Light" as Crisp light'], skipped: ['alt+j (workbench.action.nextEditor): cc cannot rebind keys yet'] };
  ls.m.set('cc.vscodeImport', JSON.stringify(rec));
  let undone = 0;
  Object.assign(g, { localStorage: ls, undoVscodeImport: async () => { undone++; }, settingsView: { close() {}, isOpen: () => true }, api: { settingsPage: async () => ({}) }, ui: { look: {}, snap: { projects: [] } }, homeView: { set() {} }, openSinks() {} });
  m.settingsStore.use = () => m.React.useSyncExternalStore(() => () => {}, m.settingsStore.get, m.settingsStore.get);
  m.settingsStore.set({ data: { sessions: {}, reliability: { checks: {} }, defaults: {} }, section: 'learning' });
  const html = m.renderToStaticMarkup(m.React.createElement(m.Settings));
  for (const part of ['Learning', 'Applied', 'Skipped', 'Solarized Light', 'cc cannot rebind keys yet', 'Undo the VS Code import', '>Undo<']) assert.ok(html.includes(part), part);
  const row = m.SECTIONS.find((s: any) => s.id === 'learning').groups[0].rows.find((r: any) => r.button === 'Undo');
  row.run(); await new Promise((r) => setImmediate(r));
  assert.equal(undone, 1);
  ls.m.set('cc.vscodeImport', JSON.stringify({ ...rec, undone: true }));
  assert.ok(m.renderToStaticMarkup(m.React.createElement(m.Settings)).includes('Undone'));
});
