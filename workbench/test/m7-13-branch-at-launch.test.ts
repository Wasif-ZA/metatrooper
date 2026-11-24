import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const uiDir = fileURLToPath(new URL('../ui/', import.meta.url));
const requireUI = createRequire(join(uiDir, 'package.json'));
const { build } = requireUI('esbuild');
// Bundle the real Home and its local imports, retaining the installed React and
// library controls. Keep the bundle in memory so this harness needs no temp files.
const bundle = await build({
  absWorkingDir: uiDir, tsconfigRaw: {},
  stdin: {
    contents: "export { Home, homeStore } from './src/home.jsx'; export * as React from 'react';",
    resolveDir: uiDir, loader: 'jsx',
  },
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', write: false,
  plugins: [{ name: 'installed-ui-modules', setup(b: any) {
    b.onResolve({ filter: /.*/ }, (args: any) => {
      if (args.path.endsWith('.css')) return { path: args.path, namespace: 'empty-css' };
      if (!args.path.startsWith('.')) return { path: pathToFileURL(requireUI.resolve(args.path)).href, external: true };
      return { path: resolve(args.namespace === 'screen' ? dirname(args.importer) : uiDir, args.path), namespace: 'screen' };
    });
    b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
    b.onLoad({ filter: /.*/, namespace: 'screen' }, (args: any) => ({
      contents: readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.jsx') ? 'jsx' : 'js',
    }));
  } }],
});
const { React, Home, homeStore } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const g: any = globalThis;
const calls: any[] = [];
const switches: string[] = [];
const originalProject = 'p1';
const worktreeProject = 'p-worktree';
const worktreePath = 'C:/worktrees/fix-x';
const taskText = 'Fix the branch launch regression';
let createReply: any;
let openReply: any;

// Minimal copy of m8-ax-screens' persistent hook-slot harness. Walk element
// props as well as children (StartState receives the composer as a prop), and
// expand only Home and StartBox. Effects stay off, as in wire-03.
function harness() {
  const frames = new Map<string, any[]>();
  let nodes: any[] = [];
  function expand(value: any, path: string): void {
    if (Array.isArray(value)) { value.forEach((v, i) => expand(v, path + '/' + i)); return; }
    if (!React.isValidElement(value)) return;
    nodes.push(value);
    if (typeof value.type === 'function' && ['Home', 'StartBox'].includes(value.type.name)) {
      const slots = frames.get(path) || [];
      frames.set(path, slots);
      let cursor = 0;
      let rerender = false;
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H;
      internals.H = {
        useEffect: () => {}, useLayoutEffect: () => {},
        useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
        useRef: (initial: any) => {
          const i = cursor++;
          if (!(i in slots)) slots[i] = { current: initial };
          return slots[i];
        },
        useState: (initial: any) => {
          const i = cursor++;
          if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
          return [slots[i], (v: any) => {
            const next = typeof v === 'function' ? v(slots[i]) : v;
            if (!Object.is(next, slots[i])) { slots[i] = next; rerender = true; }
          }];
        },
      };
      let output;
      try {
        let renders = 0;
        do {
          assert.ok(renders++ < 25, 'render-phase state updates settle');
          cursor = 0; rerender = false;
          output = value.type(value.props);
        } while (rerender);
      } finally { internals.H = previous; }
      expand(output, path + '/render');
      return;
    }
    for (const [key, v] of Object.entries(value.props)) {
      if (React.isValidElement(v) || Array.isArray(v)) expand(v, path + '/' + key);
    }
  }
  return {
    draw: () => { nodes = []; expand(React.createElement(Home), 'root'); },
    one: (predicate: (n: any) => boolean) => {
      const found = nodes.find(predicate);
      assert.ok(found, 'rendered control exists');
      return found;
    },
  };
}
const label = (text: string) => (n: any) => n.props.label === text;

beforeEach(() => {
  calls.length = 0; switches.length = 0;
  createReply = { result: { path: worktreePath } };
  openReply = { result: { project_id: worktreeProject } };
  Object.assign(g, {
    ui: {
      view: 'home', projectId: originalProject, homeSel: '', drafts: {}, pendingHide: new Set(),
      settingsLook: { themes: [] },
      snap: {
        sessions: [], live: [], approvals: [], needs_you: [],
        engines: [{ id: 'codex', light: 'green' }],
        projects: [{ id: originalProject, name: 'Alpha', path: 'C:/work/alpha' }],
      },
    },
    project: () => g.ui.snap.projects.find((p: any) => p.id === g.ui.projectId),
    waitingAll: () => [], homeView: { shown: () => true },
    load: () => null, save: () => {},
    toast: () => {},
    switchProject: (id: string) => { switches.push(id); g.ui.projectId = id; },
    rpc: async (method: string, params: any) => {
      calls.push([method, params]);
      if (method === 'worktree.create') return createReply;
      if (method === 'project.open') return openReply;
      if (method === 'session.launch') return { result: { session_id: 'new-session' } };
      assert.fail('unexpected RPC: ' + method);
    },
  });
  homeStore.set({ open: [], tick: 0, selected: null });
});

function composerWithBranch(branch: string) {
  const h = harness();
  h.draw();
  const menu = h.one((n: any) => n.props.items?.some((i: any) => i.label === 'Branch and model'));
  menu.props.items.find((i: any) => i.label === 'Branch and model').onClick();
  h.draw();
  h.one(label('Task for a new agent')).props.onChange(taskText);
  h.one(label('Branch for a new worktree')).props.onChange(branch);
  h.draw();
  return h;
}

test('M7-13a: branch creates a worktree, opens it, and launches in the opened project', async () => {
  const h = composerWithBranch('fix-x');
  await h.one(label('Start')).props.onClick();
  assert.deepEqual(calls, [
    ['worktree.create', { project_id: originalProject, branch: 'fix-x' }],
    ['project.open', { path: worktreePath }],
    ['session.launch', { project_id: worktreeProject, engine_id: 'codex', prompt: taskText }],
  ]);
  assert.deepEqual(switches, [worktreeProject]);
});

test('M7-13a trim: branch whitespace is removed before worktree.create', async () => {
  const h = composerWithBranch('  fix-x  ');
  await h.one(label('Start')).props.onClick();
  assert.deepEqual(calls, [
    ['worktree.create', { project_id: originalProject, branch: 'fix-x' }],
    ['project.open', { path: worktreePath }],
    ['session.launch', { project_id: worktreeProject, engine_id: 'codex', prompt: taskText }],
  ]);
});

test('M7-13c: worktree.create error starts nothing and keeps task and branch', async () => {
  createReply = { error: { code: -32003, message: 'worktree folder holds another branch' } };
  const h = composerWithBranch('fix-x');
  await h.one(label('Start')).props.onClick();
  h.draw();
  assert.deepEqual(calls, [['worktree.create', { project_id: originalProject, branch: 'fix-x' }]]);
  assert.equal(h.one(label('Task for a new agent')).props.value, taskText);
  assert.equal(g.ui.drafts['home-task'], taskText);
  assert.equal(h.one(label('Branch for a new worktree')).props.value, 'fix-x');
  assert.deepEqual(switches, []);
});

test('M7-13c: project.open error after worktree creation starts nothing', async () => {
  openReply = { error: { code: -32003, message: 'could not open the created worktree' } };
  const h = composerWithBranch('fix-x');
  await h.one(label('Start')).props.onClick();
  h.draw();
  assert.deepEqual(calls, [
    ['worktree.create', { project_id: originalProject, branch: 'fix-x' }],
    ['project.open', { path: worktreePath }],
  ]);
  assert.equal(h.one(label('Task for a new agent')).props.value, taskText);
  assert.equal(g.ui.drafts['home-task'], taskText);
  assert.equal(h.one(label('Branch for a new worktree')).props.value, 'fix-x');
  assert.deepEqual(switches, []);
});
