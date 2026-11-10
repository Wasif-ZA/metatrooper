import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm9-ide-act-'));
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
      querySelector: () => null,
      querySelectorAll: () => [],
      style: {},
      setAttribute() {},
      getAttribute: () => null,
      contains: () => false,
      classList: { add() {}, remove() {}, contains: () => false, toggle: () => false },
    });
  }
  return elements.get(id);
};

const g: any = globalThis;
g.requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
g.cancelAnimationFrame = (id: any) => clearTimeout(id);
g.matchMedia = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
});
g.__axCreateRoot = () => ({ render: () => {} });
g.document = {
  documentElement: { style: {} },
  body: { style: {} },
  activeElement: null,
  readyState: 'loading',
  getElementById: getEl,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag: string) => ({ tagName: tag.toUpperCase(), style: {}, setAttribute() {}, appendChild() {} }),
  addEventListener: (event: string, fn: any) => { (docListeners[event] ||= []).push(fn); },
  removeEventListener: (event: string, fn: any) => {
    if (docListeners[event]) docListeners[event] = docListeners[event].filter((f) => f !== fn);
  },
};
g.window = g;

function initGlobals() {
  calls.length = 0;
  elements.clear();
  try { __states?.clear(); } catch {}
  g.ui = {
    view: 'ide',
    projectId: 'p1',
    look: { theme: { scheme: 'dark' } },
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
    fsRead: async (_pid: string, _path: string) => ({ text: 'sample', mtimeMs: 100 }),
    fsWrite: async () => ({ ok: true, mtimeMs: 200 }),
    fsCreate: async (_pid: string, _path: string, _kind: string) => ({ ok: true }),
    fsSearch: async () => ({ hits: [] }),
    fsFind: async () => [],
    git: async () => ({ files: [] }),
    sessionDiffFile: async () => '',
    openInVsCode: async () => ({ ok: true }),
    fsOpenOutside: async () => ({ ok: true }),
    settingsPage: async () => ({}),
    setSetting: async (...args: any[]) => { calls.push(['setSetting', ...args]); },
    setApproval: async (...args: any[]) => { calls.push(['setApproval', ...args]); },
    setCheck: async (...args: any[]) => { calls.push(['setCheck', ...args]); },
    uiSettings: async () => ({}),
    addons: async () => [],
    openLogs: () => calls.push(['logs']),
  };
  g.rpc = async (...args: any[]) => { calls.push(['rpc', ...args]); return { result: { session_id: 'new-session' } }; };
  g.toast = (msg: string, isError?: boolean) => { calls.push(['toast', msg, isError]); };
  g.render = () => { calls.push(['render']); };
  g.applyLook = () => {};
  g.setLook = async () => {};
  g.openSinks = () => { calls.push(['sinks']); };
  g.waitingAll = () => g.ui.snap.live.filter((s: any) => s.state === 'waiting_for_you');
  g.isInfo = (n: any) => ['gate', 'approval', 'handoff', 'done', 'uncommitted', 'other', 'spool-too-large'].includes(n.kind) && !g.loopOf(n) && !g.lendOf(n);
  g.loopOf = (n: any) => n.kind === 'other' && n.ref?.startsWith('loop:') ? n.ref.slice(5) : null;
  g.lendOf = (n: any) => { if (n.kind !== 'other' || !n.ref?.startsWith('lend:')) return null; const [project, origin] = n.ref.slice(5).split(' '); return { project, origin }; };
  g.taskOf = (x: any) => x?.task || x?.title || x?.id || '';
  g.ago = () => '1m ago';
  g.approvalCard = (a: any) => '<p>' + a.summary + '</p>';
  g.homeView = { shown: () => false, draw: () => {}, set: (v: string) => { calls.push(['view', v]); g.ui.view = v; } };
  g.load = () => null;
  g.save = (...args: any[]) => { calls.push(['save', ...args]); };
  g.pick = async (id: string) => { calls.push(['pick', id]); };
  g.changedFiles = () => [];
  g.STATE_ORDER = ['waiting_for_you', 'working', 'starting', 'done', 'failed', 'exited'];
  g.STATE_WORDS = { waiting_for_you: 'Needs you', working: 'Working', done: 'Finished' };
  g.needsCount = () => g.waitingAll().length + g.ui.snap.approvals.length + g.ui.snap.needs_you.filter((n: any) => !n.read_at && !g.isInfo(n)).length;
  g.paletteItems = () => [];
  g.overlayOpen = () => false;
  g.diffLines = () => [];
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
          code += '\nexport { states as __states, onFor as __onFor, saveTab as __saveTab, reloadTab as __reloadTab, openFile as __openFile, closeTab as __closeTab, dropTab as __dropTab, tabOf as __tabOf, newFile as __newFile, openOutside as __openOutside, openInVsCode as __openInVsCode }; export const __getCur = () => cur;\n';
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
`, 'ide-actions-bundle.mjs');

const ideModule = await import(pathToFileURL(join(temp, 'ide-actions-bundle.mjs')).href);
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
  __newFile,
  __openOutside,
  __openInVsCode,
  __getCur,
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

beforeEach(() => {
  initGlobals();
  __states.clear();
  const cur = __getCur();
  if (cur) {
    cur.ask = null;
    cur.tabs = [];
    cur.active = null;
  }
});

test('New file dialog creates file on submit and opens the tab', async () => {
  await drawIde();
  const cur = __getCur();
  cur.ask = null;
  cur.tabs = [];
  cur.active = null;
  const h = harness(Ide);

  // Set ask to new file
  cur.ask = { kind: 'new', path: '' };
  h.draw();

  // Find Dialog and TextInput
  const dialog = h.one((n: any) => n.props?.['aria-label'] === 'New file');
  assert.ok(dialog);

  const input = h.one((n: any) => n.props?.placeholder === 'notes/todo.md');
  assert.ok(input);
  assert.equal(input.props.label, 'Path inside the project');

  // Submit button is disabled when empty
  const submitBtn = h.one((n: any) => n.props?.label === 'Create file');
  assert.equal(submitBtn.props.isDisabled, true);

  // Enter a file path with folder
  input.props.onChange('docs/architecture.md');
  assert.equal(cur.ask.path, 'docs/architecture.md');

  h.draw();
  const submitBtnActive = h.one((n: any) => n.props?.label === 'Create file');
  assert.ok(!submitBtnActive.props.isDisabled);

  const createCalls: any[] = [];
  g.api.fsCreate = async (...args: any[]) => {
    createCalls.push(args);
    return { ok: true };
  };

  // Form submit simulating Enter in text input
  const form = h.one((n: any) => typeof n.props?.onSubmit === 'function');
  let prevented = false;
  const ask = cur.ask;
  form.props.onSubmit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  for (let i = 0; ask.busy && i < 200; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(ask.busy, false, 'newFile settled');

  // Checks folder creation and file creation
  assert.deepEqual(createCalls, [
    ['p1', 'docs', 'dir'],
    ['p1', 'docs/architecture.md', 'file'],
  ]);

  // Dialog closes and tab opens
  assert.equal(cur.ask, null);
  assert.equal(cur.active, 'docs/architecture.md');
  const tab = __tabOf(cur, 'docs/architecture.md');
  assert.ok(tab);
  assert.equal(tab.path, 'docs/architecture.md');
});

test('Open in VS Code from breadcrumb calls api.openInVsCode', async () => {
  await drawIde();
  const cur = __getCur();
  cur.ask = null;
  cur.tabs = [];
  cur.active = null;
  await __openFile(cur, 'src/server.ts');

  const vsCalls: any[] = [];
  g.api.openInVsCode = async (...args: any[]) => {
    vsCalls.push(args);
    return { ok: true };
  };

  const h = harness(Ide);
  h.draw();

  const crumbBtn = h.one((n: any) => n.props?.label === 'Open in VS Code' && n.props?.variant === 'ghost');
  assert.ok(crumbBtn);
  assert.equal(crumbBtn.props.size, 'sm');

  await crumbBtn.props.onClick();
  assert.deepEqual(vsCalls, [['p1', 'src/server.ts']]);

  // Toast shown when openInVsCode returns error
  g.api.openInVsCode = async () => ({ error: 'code not found on PATH' });
  await crumbBtn.props.onClick();
  assert.ok(calls.some((c) => c[0] === 'toast' && c[1] === 'code not found on PATH' && c[2] === true));
});

test('Open in VS Code and New file from palette', async () => {
  await drawIde();
  const cur = __getCur();
  cur.ask = null;
  cur.tabs = [];
  cur.active = null;
  await __openFile(cur, 'src/index.ts');

  const h = harness(Ide);
  h.draw();

  const cp = h.one((n: any) => n.props?.label === 'IDE commands');
  assert.ok(cp);

  // Search palette for VS Code
  const vsItems = await cp.props.searchSource.search('VS Code');
  const vsItem = vsItems.find((i: any) => i.label === 'Open in VS Code');
  assert.ok(vsItem);

  const vsCalls: any[] = [];
  g.api.openInVsCode = async (...args: any[]) => {
    vsCalls.push(args);
    return { ok: true };
  };

  // Trigger palette item run
  cp.props.onValueChange(vsItem.id);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(vsCalls, [['p1', 'src/index.ts']]);

  // Search palette for New file
  const newItems = await cp.props.searchSource.search('New file');
  const newItem = newItems.find((i: any) => i.label === 'New file');
  assert.ok(newItem);

  assert.equal(cur.ask, null);
  cp.props.onValueChange(newItem.id);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(cur.ask, { kind: 'new', path: '' });
});

test('error empty state shows Open outside and Open in VS Code buttons', async () => {
  await drawIde();
  const cur = __getCur();
  cur.ask = null;
  cur.tabs = [];
  cur.active = null;
  await __openFile(cur, 'chart.png');
  const tab = __tabOf(cur, 'chart.png');
  tab.error = 'not a text file';

  const h = harness(Ide);
  h.draw();

  const emptyState = h.one((n: any) => n.props?.title === 'not a text file');
  assert.ok(emptyState);
  assert.equal(emptyState.props.isCompact, true);

  const outsideBtn = h.one((n: any) => n.props?.label === 'Open outside');
  assert.ok(outsideBtn);
  assert.equal(outsideBtn.props.size, 'sm');

  const vsBtn = h.all((n: any) => n.props?.label === 'Open in VS Code').find((n: any) => n.props?.variant === 'secondary');
  assert.ok(vsBtn);
  assert.equal(vsBtn.props.size, 'sm');

  // Click Open outside
  const outsideCalls: any[] = [];
  g.api.fsOpenOutside = async (...args: any[]) => {
    outsideCalls.push(args);
    return { ok: true };
  };
  await outsideBtn.props.onClick();
  assert.deepEqual(outsideCalls, [['p1', 'chart.png']]);

  // Open outside error shows toast
  g.api.fsOpenOutside = async () => ({ error: 'cannot open outside' });
  await outsideBtn.props.onClick();
  assert.ok(calls.some((c) => c[0] === 'toast' && c[1] === 'cannot open outside' && c[2] === true));

  // Click Open in VS Code
  const vsCalls: any[] = [];
  g.api.openInVsCode = async (...args: any[]) => {
    vsCalls.push(args);
    return { ok: true };
  };
  await vsBtn.props.onClick();
  assert.deepEqual(vsCalls, [['p1', 'chart.png']]);

  // Open in VS Code error shows toast
  g.api.openInVsCode = async () => ({ error: 'VS Code failed' });
  await vsBtn.props.onClick();
  assert.ok(calls.some((c) => c[0] === 'toast' && c[1] === 'VS Code failed' && c[2] === true));
});
