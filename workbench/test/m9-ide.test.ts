import test, { after, beforeEach } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { readText, writeText } from '../src/files.ts';
import { parseStatusV2 } from '../src/gitpane.ts';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm9-ide-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });

const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');

const docListeners: Record<string, Function[]> = {};
const elements = new Map<string, any>();
const calls: any[] = [];

const getEl = (id: string) => {
  if (!elements.has(id)) {
    elements.set(id, {
      id,
      hidden: true,
      focus: () => calls.push(['focus', id]),
      select: () => calls.push(['select', id]),
      replaceChildren: () => {},
      matches: () => false,
      closest: () => null,
      querySelectorAll: () => [],
      contains: () => false,
      setAttribute: () => {},
      getAttribute: () => null,
      removeAttribute: () => {},
      style: {},
      classList: { add() {}, remove() {}, contains: () => false, toggle: () => false },
    });
  }
  return elements.get(id);
};

const g: any = globalThis;
g.requestAnimationFrame = (fn: any) => setTimeout(fn, 0);
g.cancelAnimationFrame = (id: any) => clearTimeout(id);
g.document = {
  documentElement: { style: {} },
  body: { style: {} },
  readyState: 'loading',
  getElementById: getEl,
  querySelectorAll: () => [],
  addEventListener: (event: string, fn: any) => { (docListeners[event] ||= []).push(fn); },
  removeEventListener: (event: string, fn: any) => {
    if (docListeners[event]) docListeners[event] = docListeners[event].filter((f) => f !== fn);
  },
};
g.window = g;
g.addEventListener = (event: string, fn: any) => { (docListeners[event] ||= []).push(fn); };
g.removeEventListener = (event: string, fn: any) => {
  if (docListeners[event]) docListeners[event] = docListeners[event].filter((f) => f !== fn);
};

// Global stubs for bare names in bundled code.
function initGlobals() {
  const homeDraw = g.homeView?.draw;
  g.ui = {
    view: 'ide',
    projectId: 'p1',
    look: { theme: { scheme: 'dark' } },
    settingsLook: { themes: [] },
    drafts: {},
    snap: {
      sessions: [],
      live: [],
      approvals: [],
      needs_you: [],
      engines: [],
      projects: [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }],
    },
    pendingHide: new Set(),
  };
  g.project = () => g.ui.snap.projects.find((p: any) => p.id === g.ui.projectId);
  g.api = {
    fsList: async () => [],
    fsRead: async (_pid: string, _path: string) => ({ text: 'initial', mtimeMs: 100 }),
    fsWrite: async (_pid: string, _path: string, _text: string, _mtime: number | null) => ({ ok: true, mtimeMs: 200 }),
    fsCreate: async () => ({ ok: true }),
    fsSearch: async () => ({ hits: [] }),
    fsFind: async () => [],
    git: async () => ({ files: [] }),
    sessionDiffFile: async () => '',
    openInVsCode: async () => ({ ok: true }),
    fsOpenOutside: async () => ({ ok: true }),
    settingsPage: async () => ({}),
    setSetting: async () => {},
    setApproval: async () => {},
    setCheck: async () => {},
    uiSettings: async () => ({}),
    addons: async () => [],
    openLogs: () => {},
  };
  g.toast = (msg: string, isError?: boolean) => { calls.push(['toast', msg, isError]); };
  g.changedFiles = () => [];
  g.taskOf = (x: any) => x?.task || x?.title || x?.id || '';
  g.STATE_ORDER = ['waiting_for_you', 'working', 'starting', 'done', 'failed', 'exited'];
  g.STATE_WORDS = { waiting_for_you: 'Needs you', working: 'Working', done: 'Finished' };
  g.paletteItems = () => [];
  g.overlayOpen = () => false;
  g.diffLines = () => [];
  g.homeView = { shown: () => false, draw: homeDraw || (() => {}), set: () => {} };
  g.settingsView = g.settingsView || { shown: () => false, draw: () => {}, open: async () => {}, close: () => false, isOpen: () => false };
  g.frameView = { shown: () => false, draw: () => {}, close: () => false, open: () => {} };
  g.inboxView = g.inboxView || { shown: () => false, draw: () => {} };
  g.addonsView = g.addonsView || { shown: () => false, draw: async () => {} };
  g.ideView = g.ideView || { shown: () => (g.ui?.view === 'ide' && Boolean(g.project?.())), draw: async () => {} };
  g.render = () => {};
  g.waitingAll = () => [];
  g.isInfo = () => false;
  g.loopOf = () => null;
  g.lendOf = () => null;
  g.needsCount = () => 0;
  g.approvalCard = () => '';
  g.ago = () => '';
  g.load = () => null;
  g.save = () => {};
  g.pick = async () => {};
  g.rpc = async () => ({ result: {} });
  g.openSinks = () => {};
  g.applyLook = () => {};
  g.setLook = async () => {};
  g.__axCreateRoot = () => ({ render: () => {} });
}
initGlobals();

async function bundle(contents: string, output: string) {
  await build({
    absWorkingDir: join(wb, 'ui'), tsconfigRaw: {},
    stdin: { contents, resolveDir: join(wb, 'ui'), loader: 'jsx' },
    plugins: [{ name: 'installed-ui-modules', setup(b: any) {
      b.onResolve({ filter: /.*/ }, (args: any) => {
        if (args.path.endsWith('.css')) return { path: args.path, namespace: 'empty-css' };
        if (args.path === 'react-dom/client') return { path: args.path, namespace: 'mount-spy' };
        if (!args.path.startsWith('.')) return { path: pathToFileURL(requireUI.resolve(args.path)).href, external: true };
        return { path: resolve(args.namespace === 'screen' ? dirname(args.importer) : join(wb, 'ui'), args.path), namespace: 'screen' };
      });
      b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'mount-spy' }, () => ({ contents: 'export const createRoot = globalThis.__axCreateRoot;', loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'screen' }, (args: any) => {
        let code = readFileSync(args.path, 'utf8');
        if (args.path.endsWith('ide.jsx')) {
          code += '\nexport { states as __states, onFor as __onFor, saveTab as __saveTab, reloadTab as __reloadTab, openFile as __openFile, closeTab as __closeTab, dropTab as __dropTab, tabOf as __tabOf, SourceControl as __SourceControl, gitFiles as __gitFiles }; export const __getCur = () => cur; export const __resetCur = () => { cur = null; };\n';
        }
        return {
          contents: `import { createElement as __create, Fragment as __fragment } from 'react'; function __element(...args) { const node = __create(...args); globalThis.__axCapture?.(node); return node; }\n` + code,
          loader: args.path.endsWith('.jsx') ? 'jsx' : 'js',
        };
      });
    } }],
    bundle: true, platform: 'node', format: 'esm', jsx: 'transform', jsxFactory: '__element', jsxFragment: '__fragment',
    loader: { '.css': 'empty' }, outfile: join(temp, output),
  });
}

await bundle(`
  import './src/main.jsx';
  export * from './src/ide.jsx';
  export * from './src/editor.js';
  export * as React from 'react';
  export { renderToStaticMarkup } from 'react-dom/server';
`, 'ide-bundle.mjs');

const ideModule = await import(pathToFileURL(join(temp, 'ide-bundle.mjs')).href);
const {
  React,
  renderToStaticMarkup,
  Ide,
  drawIde,
  ideShown,
  ideKeys,
  ideStore,
  editorState,
  __states,
  __onFor,
  __saveTab,
  __reloadTab,
  __openFile,
  __closeTab,
  __dropTab,
  __tabOf,
  __getCur,
  __resetCur,
} = ideModule;

ideStore.use = () => React.useSyncExternalStore(() => () => {}, ideStore.get, ideStore.get);

function harness(Screen: any) {
  let nodes: any[] = [];
  const draw = () => {
    nodes = [];
    g.__axCapture = (node: any) => nodes.push(node);
    try {
      return renderToStaticMarkup(React.createElement(Screen));
    } finally {
      delete g.__axCapture;
    }
  };
  return {
    draw,
    html: draw,
    all: (predicate: any) => nodes.filter(predicate),
    one: (predicate: any) => {
      const found = nodes.find(predicate);
      assert.ok(found, 'rendered control exists');
      return found;
    },
  };
}

function triggerKey(e: any) {
  for (const fn of docListeners['keydown'] || []) fn(e);
}

beforeEach(() => {
  calls.length = 0;
  elements.clear();
  __states.clear();
  __resetCur?.();
  initGlobals();
});

test('save calls fsWrite with the tab baseMtimeMs and updates mtimeMs on ok', async () => {
  await drawIde();
  const cur = __getCur();
  g.api.fsRead = async () => ({ text: 'content alpha', mtimeMs: 1700000000123 });
  await __openFile(cur, 'src/app.ts');

  const tab = __tabOf(cur, 'src/app.ts');
  assert.equal(tab.mtimeMs, 1700000000123);
  assert.equal(tab.dirty, false);

  tab.state = editorState('content alpha edited', 'src/app.ts', __onFor(cur, 'src/app.ts'));
  __onFor(cur, 'src/app.ts').change();
  assert.equal(tab.dirty, true);

  const h = harness(Ide);
  h.draw();
  const saveBtn = h.one((n: any) => n.props?.label === 'Save');
  assert.equal(saveBtn.props.isDisabled, false);

  g.api.fsWrite = async (...args: any[]) => {
    calls.push(['fsWrite', ...args]);
    return { ok: true, mtimeMs: 1700000000456 };
  };

  await saveBtn.props.onClick();

  const writeCall = calls.find((c) => c[0] === 'fsWrite');
  assert.ok(writeCall);
  assert.equal(writeCall[1], 'p1');
  assert.equal(writeCall[2], 'src/app.ts');
  assert.equal(writeCall[3], 'content alpha edited');
  assert.equal(writeCall[4], 1700000000123);
  assert.equal(tab.mtimeMs, 1700000000456);
  assert.equal(tab.dirty, false);
});

test('conflict reply shows question and Overwrite resends with null', async () => {
  await drawIde();
  const cur = __getCur();
  g.api.fsRead = async () => ({ text: 'base line', mtimeMs: 1700000000888 });
  await __openFile(cur, 'src/model.ts');

  const tab = __tabOf(cur, 'src/model.ts');
  tab.dirty = true;
  tab.state = editorState('conflicting change', 'src/model.ts', __onFor(cur, 'src/model.ts'));

  g.api.fsWrite = async (...args: any[]) => {
    calls.push(['fsWrite', ...args]);
    return { conflict: true, error: 'changed on disk' };
  };

  const initialSave = await __saveTab(cur, 'src/model.ts');
  assert.equal(initialSave, false);
  assert.deepEqual(cur.ask, { kind: 'conflict', path: 'src/model.ts' });

  const h = harness(Ide);
  h.draw();
  const askDialog = h.one((n: any) => typeof n.props?.title === 'string' && n.props.title.includes('changed on disk'));
  assert.equal(askDialog.props.title, 'model.ts changed on disk since you opened it.');

  const overwriteAction = askDialog.props.actions.find((a: any) => a.label === 'Overwrite');
  assert.ok(overwriteAction);
  assert.equal(overwriteAction.variant, 'destructive');

  calls.length = 0;
  g.api.fsWrite = async (...args: any[]) => {
    calls.push(['fsWrite', ...args]);
    return { ok: true, mtimeMs: 1700000000999 };
  };

  await overwriteAction.run();

  const overwriteCall = calls.find((c) => c[0] === 'fsWrite');
  assert.ok(overwriteCall);
  assert.equal(overwriteCall[1], 'p1');
  assert.equal(overwriteCall[2], 'src/model.ts');
  assert.equal(overwriteCall[3], 'conflicting change');
  assert.equal(overwriteCall[4], null);
  assert.equal(cur.ask, null);
  assert.equal(tab.dirty, false);
  assert.equal(tab.mtimeMs, 1700000000999);
});

test('dirty dot appears on edit and is cleared on save', async () => {
  await drawIde();
  const cur = __getCur();
  g.api.fsRead = async () => ({ text: 'clean text', mtimeMs: 50 });
  await __openFile(cur, 'src/view.ts');

  const tab = __tabOf(cur, 'src/view.ts');
  tab.state = editorState('clean text', 'src/view.ts', __onFor(cur, 'src/view.ts'));

  const h = harness(Ide);
  h.draw();
  assert.equal(h.all((n: any) => n.props?.className === 'ou-ide-dirty').length, 0);

  __onFor(cur, 'src/view.ts').change();
  assert.equal(tab.dirty, true);

  h.draw();
  const dirtyDot = h.one((n: any) => n.props?.className === 'ou-ide-dirty');
  assert.equal(dirtyDot.props.title, 'Unsaved');

  g.api.fsWrite = async () => ({ ok: true, mtimeMs: 60 });
  await __saveTab(cur, 'src/view.ts');
  assert.equal(tab.dirty, false);

  h.draw();
  assert.equal(h.all((n: any) => n.props?.className === 'ou-ide-dirty').length, 0);
});

test('closing a dirty tab asks while closing a clean tab does not', async () => {
  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'src/clean.ts');
  assert.equal(cur.tabs.length, 1);

  __closeTab(cur, 'src/clean.ts');
  assert.equal(cur.tabs.length, 0);
  assert.equal(cur.ask, null);

  await __openFile(cur, 'src/dirty.ts');
  const dirtyTab = __tabOf(cur, 'src/dirty.ts');
  dirtyTab.dirty = true;
  dirtyTab.state = editorState('dirty content', 'src/dirty.ts', __onFor(cur, 'src/dirty.ts'));

  __closeTab(cur, 'src/dirty.ts');
  assert.equal(cur.tabs.length, 1);
  assert.deepEqual(cur.ask, { kind: 'close', path: 'src/dirty.ts' });

  const h = harness(Ide);
  h.draw();
  const closeDialog = h.one((n: any) => typeof n.props?.title === 'string' && n.props.title.includes('Save changes to'));
  assert.equal(closeDialog.props.title, 'Save changes to dirty.ts?');

  const dontSave = closeDialog.props.actions.find((a: any) => a.label === "Don't save");
  const save = closeDialog.props.actions.find((a: any) => a.label === 'Save');
  assert.ok(dontSave);
  assert.ok(save);

  closeDialog.props.onCancel();
  assert.equal(cur.ask, null);
  assert.equal(cur.tabs.length, 1);

  __closeTab(cur, 'src/dirty.ts');
  h.draw();
  const closeDialog2 = h.one((n: any) => typeof n.props?.title === 'string' && n.props.title.includes('Save changes to'));
  closeDialog2.props.actions.find((a: any) => a.label === "Don't save").run();
  assert.equal(cur.tabs.length, 0);
  assert.equal(cur.ask, null);
});

test('CRLF files save as CRLF and LF files save as LF', async () => {
  const crlfState = editorState('row1\r\nrow2\r\n', 'crlf.txt', { change() {}, save() {} });
  assert.equal(crlfState.sliceDoc(), 'row1\nrow2\n');

  const edited = editorState('row1\r\nmiddle\r\nrow2\r\n', 'crlf.txt', { change() {}, save() {} });
  assert.equal(edited.sliceDoc(), 'row1\nmiddle\nrow2\n');

  const lfState = editorState('row1\nrow2\n', 'lf.txt', { change() {}, save() {} });
  assert.equal(lfState.sliceDoc().includes('\r'), false);

  await drawIde();
  const cur = __getCur();

  await __openFile(cur, 'crlf.txt');
  const crlfTab = __tabOf(cur, 'crlf.txt');
  crlfTab.dirty = true;
  crlfTab.state = edited;

  calls.length = 0;
  g.api.fsWrite = async (...args: any[]) => {
    calls.push(['fsWrite', ...args]);
    return { ok: true, mtimeMs: 12 };
  };

  await __saveTab(cur, 'crlf.txt');
  const writeCall = calls.find((c) => c[0] === 'fsWrite');
  // editorState normalizes line endings; files.writeText restores the disk style.
  assert.equal(writeCall[3], 'row1\nmiddle\nrow2\n');
  assert.equal(writeCall[3].includes('\r'), false);
});

test('per-project tab state survives a project switch', async () => {
  g.ui.projectId = 'p1';
  await drawIde();
  const cur1 = __getCur();
  assert.equal(cur1.pid, 'p1');

  await __openFile(cur1, 'p1-only.ts');
  const tab1 = __tabOf(cur1, 'p1-only.ts');
  tab1.dirty = true;
  tab1.state = editorState('p1 text modified', 'p1-only.ts', __onFor(cur1, 'p1-only.ts'));

  g.ui.projectId = 'p2';
  await drawIde();
  const cur2 = __getCur();
  assert.equal(cur2.pid, 'p2');
  assert.equal(__tabOf(cur2, 'p1-only.ts'), undefined);

  await __openFile(cur2, 'p2-clean.ts');
  assert.equal(__tabOf(cur2, 'p2-clean.ts')?.dirty, false);

  g.ui.projectId = 'p1';
  await drawIde();
  const curBack = __getCur();
  assert.equal(curBack.pid, 'p1');

  const restored = __tabOf(curBack, 'p1-only.ts');
  assert.ok(restored);
  assert.equal(restored.dirty, true);
  assert.equal(restored.state.sliceDoc(), 'p1 text modified');

  assert.equal(__states.has('p2'), false);
  assert.equal(__states.has('p1'), true);
});

test('the editor host stops plain keys reaching app.js while modifiers pass', async () => {
  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'keys.txt');
  const tab = __tabOf(cur, 'keys.txt');
  tab.text = 'hello';

  const h = harness(Ide);
  h.draw();
  const host = h.one((n: any) => n.props?.className === 'ou-ide-ed');

  let stopped = false;
  host.props.onKeyDown({ key: 'c', ctrlKey: false, altKey: false, metaKey: false, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);

  stopped = false;
  host.props.onKeyDown({ key: 'Escape', ctrlKey: false, altKey: false, metaKey: false, stopPropagation() { stopped = true; } });
  assert.equal(stopped, true);

  stopped = false;
  host.props.onKeyDown({ key: 'g', ctrlKey: true, altKey: false, metaKey: false, stopPropagation() { stopped = true; } });
  assert.equal(stopped, false);

  stopped = false;
  host.props.onKeyDown({ key: 'f', ctrlKey: false, altKey: true, metaKey: false, stopPropagation() { stopped = true; } });
  assert.equal(stopped, false);

  stopped = false;
  host.props.onKeyDown({ key: 'x', ctrlKey: false, altKey: false, metaKey: true, stopPropagation() { stopped = true; } });
  assert.equal(stopped, false);
});

test('Ctrl+P, Ctrl+Shift+F, and Ctrl+W trigger actions only when IDE is shown', async () => {
  g.ui.view = 'wall';
  let prevented = false;
  triggerKey({ key: 'p', ctrlKey: true, shiftKey: false, altKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(calls.length, 0);

  g.ui.view = 'ide';
  g.ui.projectId = 'p1';
  await drawIde();

  // Ctrl+P focuses ide-find and selects text
  prevented = false;
  calls.length = 0;
  triggerKey({ key: 'p', ctrlKey: true, shiftKey: false, altKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(__getCur().side, 'files');
  assert.ok(calls.some((c) => c[0] === 'focus' && c[1] === 'ide-find'));
  assert.ok(calls.some((c) => c[0] === 'select' && c[1] === 'ide-find'));

  // Ctrl+P skipped when overlayOpen is true
  g.overlayOpen = () => true;
  prevented = false;
  calls.length = 0;
  triggerKey({ key: 'p', ctrlKey: true, shiftKey: false, altKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(calls.length, 0);
  g.overlayOpen = () => false;

  // Ctrl+Shift+F focuses ide-search
  prevented = false;
  calls.length = 0;
  triggerKey({ key: 'f', ctrlKey: true, shiftKey: true, altKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(__getCur().side, 'search');
  assert.ok(calls.some((c) => c[0] === 'focus' && c[1] === 'ide-search'));

  // Ctrl+W closes active tab
  const cur = __getCur();
  await __openFile(cur, 'closeme.txt');
  assert.equal(cur.active, 'closeme.txt');
  prevented = false;
  triggerKey({ key: 'w', ctrlKey: true, shiftKey: false, altKey: false, preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(__tabOf(cur, 'closeme.txt'), undefined);
});

test('Not built yet is displayed and save is prevented when api.fsWrite is missing', async () => {
  delete g.api.fsWrite;
  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'nowrite.txt');

  const tab = __tabOf(cur, 'nowrite.txt');
  tab.dirty = true;
  tab.state = editorState('needs save', 'nowrite.txt', __onFor(cur, 'nowrite.txt'));

  const h = harness(Ide);
  h.draw();

  const saveBtn = h.one((n: any) => n.props?.label === 'Save');
  assert.equal(saveBtn.props.isDisabled, true);

  const badge = h.one((n: any) => n.props?.label === 'Not built yet');
  assert.ok(badge);

  calls.length = 0;
  const res = await __saveTab(cur, 'nowrite.txt');
  assert.equal(res, false);
  assert.deepEqual(calls, [['toast', 'Saving is not built yet.', undefined]]);
});

// Protects ide.jsx:124 and :815: conflicts appear once as C and are omitted only by Stage all.
test('fix-05 a real unmerged row stays out of Stage all but retains its own plus action', async () => {
  const repo = join(temp, 'merge-fixture'); mkdirSync(repo);
  const git = (...a: string[]) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  writeFileSync(join(repo, 'conflict.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'base');
  git('checkout', '-b', 'other'); writeFileSync(join(repo, 'conflict.txt'), 'other\n'); git('commit', '-am', 'other');
  git('checkout', 'main'); writeFileSync(join(repo, 'conflict.txt'), 'main\n'); git('commit', '-am', 'main');
  assert.throws(() => git('merge', 'other'));
  writeFileSync(join(repo, 'safe.txt'), 'safe');
  const status = parseStatusV2(git('status', '--porcelain=v2', '--branch', '-z'));
  const st = { pid: 'p1', git: status, commitMsg: '', owners: null };
  const rows = ideModule.__gitFiles(st);
  assert.equal(rows.staged.filter((f: any) => f.path === 'conflict.txt').length, 0);
  assert.deepEqual(rows.unstaged.filter((f: any) => f.path === 'conflict.txt'), [{ path: 'conflict.txt', from: undefined, letter: 'C', conflict: true }]);
  g.api.git = async (...args: any[]) => { calls.push(args); return args[1] === 'stage-paths' ? {} : status; };
  const h = harness(() => React.createElement(ideModule.__SourceControl, { st })); h.draw(); calls.length = 0;
  h.one((n: any) => n.props.label === 'Stage all').props.onClick();
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  assert.deepEqual(calls.filter(c => c[1] === 'stage-paths'), [['p1', 'stage-paths', ['safe.txt']]]);
  h.draw(); calls.length = 0;
  h.one((n: any) => n.props.label === 'Stage conflict.txt').props.onClick({ stopPropagation() {} });
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  assert.deepEqual(calls.filter(c => c[1] === 'stage-paths'), [['p1', 'stage-paths', ['conflict.txt']]]);
});
// Protects editor.js:87-91 and files.ts:125: normalized editor text restores original disk line endings.
test('fix-04 normalized edits save back with the original CRLF or LF bytes', () => {
  for (const newline of ['\r\n', '\n']) {
    const name = newline === '\n' ? 'lf-disk.txt' : 'crlf-disk.txt';
    writeFileSync(join(temp, name), 'café' + newline + 'two' + newline);
    const opened = readText(temp, name) as { text: string; mtimeMs: number };
    const state = editorState(opened.text, name, { change() {}, save() {} });
    assert.equal((writeText(temp, name, state.sliceDoc() + 'three\n', opened.mtimeMs) as { ok: boolean }).ok, true);
    assert.equal(readFileSync(join(temp, name), 'utf8'), 'café' + newline + 'two' + newline + 'three' + newline);
  }
});

// Protects ide.jsx:23-27 and preload.cjs:14 setDirty: tab dirtiness reaches the main-process close gate.
test('fix-01 editing and saving a tab reports dirty transitions to main', async () => {
  const dirty: boolean[] = []; g.api.setDirty = async (value: boolean) => dirty.push(value);
  await drawIde(); const cur = __getCur(); await __openFile(cur, 'dirty-report.txt');
  const tab = __tabOf(cur, 'dirty-report.txt');
  tab.state = editorState('changed', tab.path, __onFor(cur, tab.path));
  __onFor(cur, tab.path).change(); assert.equal(dirty.at(-1), true);
  await __saveTab(cur, tab.path); assert.equal(dirty.at(-1), false);
});
