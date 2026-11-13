import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm9-unsaved-'));
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
      projects: [
        { id: 'p1', name: 'Alpha' },
        { id: 'p2', name: 'Beta' },
        { id: 'p3', name: 'Gamma' },
      ],
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
  g.rpc = async (method: string) => ({ result: method === 'session.owners' ? { paths: [] } : {} });
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
  unsavedSummary,
  dirtyIn,
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
  __gitFiles,
  __SourceControl,
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

// -- Part B.1: unsavedSummary --

test('unsavedSummary returns empty string when no tabs are dirty', async () => {
  await drawIde();
  await __openFile(__getCur(), 'src/clean.ts');
  assert.equal(unsavedSummary(), '');
});

test('unsavedSummary lists dirty tab basenames per project', async () => {
  // open project p1 with two dirty tabs
  g.ui.projectId = 'p1';
  await drawIde();
  const cur1 = __getCur();
  await __openFile(cur1, 'src/foo.ts');
  __tabOf(cur1, 'src/foo.ts').dirty = true;
  await __openFile(cur1, 'lib/bar.js');
  __tabOf(cur1, 'lib/bar.js').dirty = true;

  assert.equal(unsavedSummary(), 'Alpha: foo.ts, bar.js');
});

test('unsavedSummary joins multiple projects with semicolon', async () => {
  // p1 with a dirty tab
  g.ui.projectId = 'p1';
  await drawIde();
  const cur1 = __getCur();
  await __openFile(cur1, 'a.ts');
  __tabOf(cur1, 'a.ts').dirty = true;

  // switch to p2 with a dirty tab
  g.ui.projectId = 'p2';
  await drawIde();
  const cur2 = __getCur();
  await __openFile(cur2, 'b.ts');
  __tabOf(cur2, 'b.ts').dirty = true;

  assert.equal(unsavedSummary(), 'Alpha: a.ts; Beta: b.ts');
});

test('unsavedSummary uses "another project" for unknown project id', async () => {
  g.ui.projectId = 'p1';
  await drawIde();
  const cur1 = __getCur();
  await __openFile(cur1, 'x.ts');
  __tabOf(cur1, 'x.ts').dirty = true;

  // remove project p1 from known projects
  g.ui.snap.projects = [{ id: 'p2', name: 'Beta' }];

  assert.equal(unsavedSummary(), 'another project: x.ts');
});

// -- Part B.2: bump calls api.setDirty only on change --

test('bump calls api.setDirty(true, summary) on first dirty tab', async () => {
  const dirtyLog: any[] = [];
  g.api.setDirty = async (value: boolean, summary: string) => { dirtyLog.push([value, summary]); };

  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'doc.ts');
  const tab = __tabOf(cur, 'doc.ts');
  tab.state = editorState('changed', tab.path, __onFor(cur, tab.path));
  dirtyLog.length = 0;

  // mark dirty
  __onFor(cur, tab.path).change();
  assert.ok(dirtyLog.length > 0);
  assert.deepEqual(dirtyLog.at(-1), [true, 'Alpha: doc.ts']);
});

test('bump does not call api.setDirty again when summary unchanged', async () => {
  const dirtyLog: any[] = [];
  g.api.setDirty = async (value: boolean, summary: string) => { dirtyLog.push([value, summary]); };

  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'doc.ts');
  const tab = __tabOf(cur, 'doc.ts');
  tab.state = editorState('changed', tab.path, __onFor(cur, tab.path));
  __onFor(cur, tab.path).change();
  dirtyLog.length = 0;

  // redraw (triggers bump) without any change to dirty state
  await drawIde();
  assert.equal(dirtyLog.length, 0);
});

test('bump calls api.setDirty(false, "") after last dirty tab is saved', async () => {
  const dirtyLog: any[] = [];
  g.api.setDirty = async (value: boolean, summary: string) => { dirtyLog.push([value, summary]); };

  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'doc.ts');
  const tab = __tabOf(cur, 'doc.ts');
  tab.state = editorState('changed', tab.path, __onFor(cur, tab.path));
  __onFor(cur, tab.path).change();
  dirtyLog.length = 0;

  // save
  g.api.fsWrite = async () => ({ ok: true, mtimeMs: 300 });
  await __saveTab(cur, 'doc.ts');
  assert.deepEqual(dirtyLog.at(-1), [false, '']);
});

// -- Part B.3: drawIde project switch toast --

test('switching away from a dirty project shows a toast with file names', async () => {
  g.ui.projectId = 'p1';
  await drawIde();
  const cur1 = __getCur();
  await __openFile(cur1, 'src/one.ts');
  __tabOf(cur1, 'src/one.ts').dirty = true;
  await __openFile(cur1, 'src/two.ts');
  __tabOf(cur1, 'src/two.ts').dirty = true;
  calls.length = 0;

  // switch to p2
  g.ui.projectId = 'p2';
  await drawIde();

  const toasts = calls.filter((c) => c[0] === 'toast');
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0][1], 'Unsaved in Alpha: one.ts, two.ts. Switch back to save them.');
});

test('toast shows first 3 file names and "and N more" when over 3 dirty tabs', async () => {
  g.ui.projectId = 'p1';
  await drawIde();
  const cur1 = __getCur();
  for (const f of ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts']) {
    await __openFile(cur1, f);
    __tabOf(cur1, f).dirty = true;
  }
  calls.length = 0;

  g.ui.projectId = 'p2';
  await drawIde();

  const toasts = calls.filter((c) => c[0] === 'toast');
  assert.equal(toasts.length, 1);
  assert.equal(toasts[0][1], 'Unsaved in Alpha: a.ts, b.ts, c.ts and 2 more. Switch back to save them.');
});

test('no toast when leaving a clean project', async () => {
  g.ui.projectId = 'p1';
  await drawIde();
  await __openFile(__getCur(), 'src/clean.ts');
  calls.length = 0;

  g.ui.projectId = 'p2';
  await drawIde();

  const toasts = calls.filter((c) => c[0] === 'toast');
  assert.equal(toasts.length, 0);
});

test('dirty project state is kept across switches, clean project state is dropped', async () => {
  // p1 with dirty tab
  g.ui.projectId = 'p1';
  await drawIde();
  const cur1 = __getCur();
  await __openFile(cur1, 'dirty.ts');
  __tabOf(cur1, 'dirty.ts').dirty = true;

  // p2 with clean tab
  g.ui.projectId = 'p2';
  await drawIde();
  await __openFile(__getCur(), 'clean.ts');

  // switch to p3
  g.ui.projectId = 'p3';
  await drawIde();

  // p1 (dirty) should still be tracked, p2 (clean) should be dropped
  assert.equal(__states.has('p1'), true);
  assert.equal(__states.has('p2'), false);
});

// -- Part B.4: git stage/unstage args --

test('unstaging a staged rename calls gitUnstage with [file.path, file.from]', async () => {
  g.ui.projectId = 'p1';
  await drawIde();
  const cur = __getCur();

  const gitCalls: any[] = [];
  g.api.git = async (...args: any[]) => {
    gitCalls.push(args);
    if (args[1] === 'status') return { files: [] };
    return {};
  };

  // set up a staged rename file in git state
  const st = {
    pid: 'p1',
    git: {
      files: [{ path: 'new-name.ts', from: 'old-name.ts', index: 'R', worktree: '.', conflict: false }],
    },
    commitMsg: '',
    owners: null,
    gitSeq: 0,
  };

  const rows = __gitFiles(st);
  assert.equal(rows.staged.length, 1);
  assert.equal(rows.staged[0].path, 'new-name.ts');
  assert.equal(rows.staged[0].from, 'old-name.ts');
  assert.equal(rows.staged[0].letter, 'R');

  // render SourceControl and click the unstage button
  const h = harness(() => React.createElement(__SourceControl, { st }));
  h.draw();
  gitCalls.length = 0;

  const unstageBtn = h.one((n: any) => n.props?.label === 'Unstage new-name.ts');
  unstageBtn.props.clickAction();
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);

  const unstageCall = gitCalls.find((c: any) => c[1] === 'unstage-paths');
  assert.ok(unstageCall);
  assert.deepEqual(unstageCall[2], ['new-name.ts', 'old-name.ts']);
});

test('unstaging a plain staged file calls gitUnstage with [file.path] only', async () => {
  const gitCalls: any[] = [];
  g.api.git = async (...args: any[]) => {
    gitCalls.push(args);
    if (args[1] === 'status') return { files: [] };
    return {};
  };

  const st = {
    pid: 'p1',
    git: {
      files: [{ path: 'plain.ts', from: undefined, index: 'M', worktree: '.', conflict: false }],
    },
    commitMsg: '',
    owners: null,
    gitSeq: 0,
  };

  const rows = __gitFiles(st);
  assert.equal(rows.staged.length, 1);
  assert.equal(rows.staged[0].path, 'plain.ts');

  const h = harness(() => React.createElement(__SourceControl, { st }));
  h.draw();
  gitCalls.length = 0;

  const unstageBtn = h.one((n: any) => n.props?.label === 'Unstage plain.ts');
  unstageBtn.props.clickAction();
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);

  const unstageCall = gitCalls.find((c: any) => c[1] === 'unstage-paths');
  assert.ok(unstageCall);
  assert.deepEqual(unstageCall[2], ['plain.ts']);
});

test('staging a file passes [file.path] only', async () => {
  const gitCalls: any[] = [];
  g.api.git = async (...args: any[]) => {
    gitCalls.push(args);
    if (args[1] === 'status') return { files: [] };
    return {};
  };

  const st = {
    pid: 'p1',
    git: {
      files: [{ path: 'unstaged.ts', from: undefined, index: '.', worktree: 'M', conflict: false }],
    },
    commitMsg: '',
    owners: null,
    gitSeq: 0,
  };

  const rows = __gitFiles(st);
  assert.equal(rows.unstaged.length, 1);

  const h = harness(() => React.createElement(__SourceControl, { st }));
  h.draw();
  gitCalls.length = 0;

  const stageBtn = h.one((n: any) => n.props?.label === 'Stage unstaged.ts');
  stageBtn.props.clickAction();
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);

  const stageCall = gitCalls.find((c: any) => c[1] === 'stage-paths');
  assert.ok(stageCall);
  assert.deepEqual(stageCall[2], ['unstaged.ts']);
});

// -- Part B.5: Ctrl+S in main.jsx --

test('Ctrl+S does nothing when e.defaultPrevented is true', async () => {
  g.ui.view = 'ide';
  g.ui.projectId = 'p1';
  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'save-test.ts');
  __tabOf(cur, 'save-test.ts').dirty = true;
  __tabOf(cur, 'save-test.ts').state = editorState('dirty', 'save-test.ts', __onFor(cur, 'save-test.ts'));
  cur.active = 'save-test.ts';

  let prevented = false;
  const writeCalls: any[] = [];
  g.api.fsWrite = async (...args: any[]) => { writeCalls.push(args); return { ok: true, mtimeMs: 300 }; };

  triggerKey({
    key: 's', ctrlKey: true, shiftKey: false, altKey: false,
    defaultPrevented: true,
    preventDefault() { prevented = true; },
  });

  assert.equal(prevented, false);
  await new Promise(setImmediate);
  assert.equal(writeCalls.length, 0);
});

test('Ctrl+S does nothing when overlayOpen() is true', async () => {
  g.ui.view = 'ide';
  g.ui.projectId = 'p1';
  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'save-test.ts');
  __tabOf(cur, 'save-test.ts').dirty = true;
  __tabOf(cur, 'save-test.ts').state = editorState('dirty', 'save-test.ts', __onFor(cur, 'save-test.ts'));
  cur.active = 'save-test.ts';

  g.overlayOpen = () => true;
  let prevented = false;
  triggerKey({
    key: 's', ctrlKey: true, shiftKey: false, altKey: false,
    defaultPrevented: false,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, false);
  g.overlayOpen = () => false;
});

test('Ctrl+S does nothing when ideKeys.asking() is true', async () => {
  g.ui.view = 'ide';
  g.ui.projectId = 'p1';
  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'save-test.ts');
  __tabOf(cur, 'save-test.ts').dirty = true;
  __tabOf(cur, 'save-test.ts').state = editorState('dirty', 'save-test.ts', __onFor(cur, 'save-test.ts'));
  cur.active = 'save-test.ts';

  // set ask state so ideKeys.asking() returns true
  cur.ask = { kind: 'close', path: 'save-test.ts' };
  let prevented = false;
  triggerKey({
    key: 's', ctrlKey: true, shiftKey: false, altKey: false,
    defaultPrevented: false,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, false);
});

test('Ctrl+S calls preventDefault and ideKeys.save() on a dirty active tab', async () => {
  g.ui.view = 'ide';
  g.ui.projectId = 'p1';
  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'save-test.ts');
  const tab = __tabOf(cur, 'save-test.ts');
  tab.dirty = true;
  tab.state = editorState('dirty content', 'save-test.ts', __onFor(cur, 'save-test.ts'));
  cur.active = 'save-test.ts';

  const writeCalls: any[] = [];
  g.api.fsWrite = async (...args: any[]) => { writeCalls.push(args); return { ok: true, mtimeMs: 300 }; };

  let prevented = false;
  triggerKey({
    key: 's', ctrlKey: true, shiftKey: false, altKey: false,
    defaultPrevented: false,
    preventDefault() { prevented = true; },
  });
  assert.equal(prevented, true);

  // wait for async save
  for (let i = 0; i < 10; i++) await new Promise(setImmediate);
  assert.ok(writeCalls.length > 0);
});

test('Ctrl+S does not save when active tab is not dirty', async () => {
  g.ui.view = 'ide';
  g.ui.projectId = 'p1';
  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'clean-file.ts');
  cur.active = 'clean-file.ts';
  assert.equal(__tabOf(cur, 'clean-file.ts').dirty, false);

  const writeCalls: any[] = [];
  g.api.fsWrite = async (...args: any[]) => { writeCalls.push(args); return { ok: true, mtimeMs: 300 }; };

  let prevented = false;
  triggerKey({
    key: 's', ctrlKey: true, shiftKey: false, altKey: false,
    defaultPrevented: false,
    preventDefault() { prevented = true; },
  });
  // preventDefault is still called since the handler runs
  assert.equal(prevented, true);

  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  // but no write happens since tab is not dirty
  assert.equal(writeCalls.length, 0);
});

test('ideKeys.save on a clean active tab does nothing, on a dirty one writes once', async () => {
  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'keys-save.ts');
  cur.active = 'keys-save.ts';
  const tab = __tabOf(cur, 'keys-save.ts');
  tab.state = editorState('body', 'keys-save.ts', __onFor(cur, 'keys-save.ts'));

  const writeCalls: any[] = [];
  g.api.fsWrite = async (...args: any[]) => { writeCalls.push(args); return { ok: true, mtimeMs: 300 }; };

  ideKeys.save();
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  assert.equal(writeCalls.length, 0);

  // without fsWrite a wrongly reached saveTab would toast
  const realWrite = g.api.fsWrite;
  delete g.api.fsWrite;
  calls.length = 0;
  ideKeys.save();
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  assert.deepEqual(calls.filter((c) => c[0] === 'toast'), []);
  g.api.fsWrite = realWrite;

  tab.dirty = true;
  ideKeys.save();
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  assert.equal(writeCalls.length, 1);
});

test('Ctrl+Shift+S does not take the Ctrl+S path', async () => {
  g.ui.view = 'ide';
  g.ui.projectId = 'p1';
  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'shift-save.ts');
  __tabOf(cur, 'shift-save.ts').dirty = true;
  __tabOf(cur, 'shift-save.ts').state = editorState('dirty', 'shift-save.ts', __onFor(cur, 'shift-save.ts'));
  cur.active = 'shift-save.ts';

  const writeCalls: any[] = [];
  g.api.fsWrite = async (...args: any[]) => { writeCalls.push(args); return { ok: true, mtimeMs: 300 }; };

  let prevented = false;
  triggerKey({
    key: 's', ctrlKey: true, shiftKey: true, altKey: false,
    defaultPrevented: false,
    preventDefault() { prevented = true; },
  });
  // Ctrl+Shift+S should not match the Ctrl+S (no shift) branch
  assert.equal(prevented, false);

  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  assert.equal(writeCalls.length, 0);
});
