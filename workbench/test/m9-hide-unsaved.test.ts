import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm9-hide-'));
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
  drawIde,
  dirtyIn,
  editorState,
  __states,
  __onFor,
  __openFile,
  __tabOf,
  __getCur,
  __resetCur,
} = ideModule;

beforeEach(() => {
  calls.length = 0;
  elements.clear();
  __states.clear();
  __resetCur?.();
  initGlobals();
});


// helper: sets up IDE with a dirty tab in a given project
async function setupDirty(pid: string, files: string[]) {
  g.ui.projectId = pid;
  await drawIde();
  const cur = __getCur();
  for (const f of files) {
    await __openFile(cur, f);
    __tabOf(cur, f).dirty = true;
  }
}

test('dirtyIn returns dirty file paths for a project with unsaved tabs', async () => {
  await setupDirty('p1', ['src/a.ts', 'src/b.ts']);

  const dirty = dirtyIn('p1');
  assert.deepEqual(dirty, ['src/a.ts', 'src/b.ts']);
});

test('dirtyIn returns empty array for a project with no dirty tabs', async () => {
  g.ui.projectId = 'p1';
  await drawIde();
  await __openFile(__getCur(), 'src/clean.ts');

  const dirty = dirtyIn('p1');
  assert.deepEqual(dirty, []);
});

test('dirtyIn returns empty array for a project with no state', () => {
  const dirty = dirtyIn('p999');
  assert.deepEqual(dirty, []);
});


test('unsaved state of OTHER projects is untouched after hiding one project', async () => {
  // set up p1 with dirty tabs
  await setupDirty('p1', ['src/alpha.ts']);

  // switch to p2 and set up dirty tabs there too
  await setupDirty('p2', ['src/beta.ts']);

  // verify both have dirty state
  assert.deepEqual(dirtyIn('p1'), ['src/alpha.ts']);
  assert.deepEqual(dirtyIn('p2'), ['src/beta.ts']);

  // simulate hiding p2: in real code this removes p2 from the menu
  // but it does NOT clear the ide state of p1
  const unsavedP2 = dirtyIn('p2');
  assert.equal(unsavedP2.length, 1);

  // after "hiding" p2, p1's dirty state is still intact
  assert.deepEqual(dirtyIn('p1'), ['src/alpha.ts']);
});

const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');

function declaration(name: string) {
  const start = appSource.indexOf('function ' + name + '(');
  assert.notEqual(start, -1);
  const end = appSource.indexOf('\n}', start);
  assert.notEqual(end, -1);
  return appSource.slice(start, end + 2);
}

// Runs the real app.js onClick on a project-hide button with stubbed confirm, dirtyIn and rpc.
async function hide(dirty: string[], answer: boolean, rpcResult: any = { result: true }) {
  const prompts: string[] = [];
  const rpcCalls: any[] = [];
  let removed = 0;
  const onClick = runInNewContext('(async ' + declaration('onClick') + ')', {
    globalThis: { ideView: { dirtyIn: (id: string) => (id === 'p2' ? dirty : []) } },
    confirm: (text: string) => { prompts.push(text); return answer; },
    rpc: async (...args: any[]) => { rpcCalls.push(args); return rpcResult; },
    hideMenu() {},
  });
  const row = { remove: () => { removed++; }, parentElement: { querySelector: () => ({}), remove() {} } };
  const button = { tagName: 'BUTTON', dataset: { action: 'project-hide', id: 'p2' }, closest: (sel: string) => (sel === '.item' ? row : null) };
  await onClick({ stopPropagation() {}, target: { closest: () => button } });
  return { prompts, rpcCalls: JSON.parse(JSON.stringify(rpcCalls)), removed };
}

test('hide with 1 unsaved file asks with the exact singular prompt', async () => {
  const r = await hide(['model.ts'], true);
  assert.deepEqual(r.prompts, ['1 unsaved file in this project: model.ts. Hide it and lose them?']);
});

test('hide with 3 unsaved files asks with the exact plural prompt', async () => {
  const r = await hide(['a.ts', 'b.ts', 'c.ts'], true);
  assert.deepEqual(r.prompts, ['3 unsaved files in this project: a.ts, b.ts, c.ts. Hide it and lose them?']);
});

test('hide prompt names at most the first 5 files', async () => {
  const r = await hide(['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts', 'g.ts'], true);
  assert.deepEqual(r.prompts, ['7 unsaved files in this project: a.ts, b.ts, c.ts, d.ts, e.ts. Hide it and lose them?']);
});

test('cancel on the confirm prompt sends no project.hide and removes no row', async () => {
  const r = await hide(['src/keep.ts'], false);
  assert.equal(r.prompts.length, 1);
  assert.deepEqual(r.rpcCalls, []);
  assert.equal(r.removed, 0);
});

test('OK on the confirm prompt sends project.hide', async () => {
  const r = await hide(['src/gone.ts'], true);
  assert.equal(r.prompts.length, 1);
  assert.deepEqual(r.rpcCalls, [['project.hide', { project_id: 'p2' }]]);
  assert.equal(r.removed, 1);
});

test('hiding a clean project sends project.hide with no confirm call', async () => {
  const r = await hide([], false);
  assert.deepEqual(r.prompts, []);
  assert.deepEqual(r.rpcCalls, [['project.hide', { project_id: 'p2' }]]);
});

test('dirtyIn from the real ide export feeds the hide prompt', async () => {
  await setupDirty('p2', ['x.ts', 'y.ts']);
  const r = await hide(dirtyIn('p2'), true);
  assert.deepEqual(r.prompts, ['2 unsaved files in this project: x.ts, y.ts. Hide it and lose them?']);
});
