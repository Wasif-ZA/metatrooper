import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';


const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'night-206-210-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');

// Bundle real screen sources and retain installed React and library controls.
const entry = "export * from './src/verdict.jsx'; export * from './src/ide.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';";
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
const { React, renderToStaticMarkup, Verdict, Ide, drawIde, ideKeys, dirtyIn, ideFiles, ideCommands, dropProject } = await import(pathToFileURL(join(temp, 'panes.mjs')).href);
const g: any = globalThis;
const calls: any[] = [];
const own = new Set(['Ide', 'Files', 'Search', 'SourceControl', 'Crumb', 'Agents', 'StatusBar', 'Asks', 'Verdict']);

// Expand app components with persistent hooks, dependency changes and effect cleanup.
function harness(Screen: any, props: any = {}) {
  const frames = new Map<string, any>();
  let nodes: any[] = [];
  let effects: (() => void)[] = [];
  function expand(value: any, path: string): any {
    if (Array.isArray(value)) return value.map((v, i) => expand(v, path + '/' + (v?.key ?? i)));
    if (!React.isValidElement(value)) return value;
    nodes.push(value);
    if (typeof value.type === 'function' && own.has(value.type.name)) {
      path += '/' + value.type.name;
      const frame = frames.get(path) || { slots: [], cleanups: new Map(), seen: true };
      frames.set(path, frame); frame.seen = true;
      const slots = frame.slots; let cursor = 0;
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H;
      internals.H = {
        useEffect: (fn: any, deps: any[]) => {
          const i = cursor++; const old = slots[i];
          if (!old || !deps || deps.some((v, j) => !Object.is(v, old[j]))) {
            slots[i] = deps;
            effects.push(() => { frame.cleanups.get(i)?.(); frame.cleanups.set(i, fn()); });
          }
        },
        useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
        useRef: (initial: any) => { const i = cursor++; return slots[i] ??= { current: initial }; },
        useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
      };
      let output;
      try { output = value.type(value.props); } finally { internals.H = previous; }
      return expand(output, path + '/render');
    }
    const props: any = { key: value.key ?? path };
    for (const [key, v] of Object.entries(value.props)) if (React.isValidElement(v) || Array.isArray(v)) props[key] = expand(v, path + '/' + key);
    return React.cloneElement(value, props);
  }
  const draw = () => {
    nodes = []; effects = []; for (const f of frames.values()) f.seen = false;
    const tree = expand(React.createElement(Screen, props), 'root');
    for (const [path, f] of frames) if (!f.seen) { for (const cleanup of f.cleanups.values()) cleanup?.(); frames.delete(path); }
    for (const effect of effects) effect();
    return tree;
  };
  return {
    draw, html: () => renderToStaticMarkup(draw()),
    state: (component: string, slot: number) => {
      const found = [...frames].filter(([path]) => path.endsWith('/' + component));
      assert.equal(found.length, 1, 'one component hook frame exists');
      return found[0][1].slots[slot];
    },
    all: (predicate: any) => nodes.filter(predicate),
    one: (predicate: any) => { const found = nodes.find(predicate); assert.ok(found, 'rendered control exists'); return found; },
  };
}
const label = (s: string) => (n: any) => n.props.label === s;
const hasClass = (s: string) => (n: any) => n.props.className?.split(' ').includes(s);
const text = (n: any): string => n == null || typeof n === 'boolean' ? '' : Array.isArray(n) ? n.map(text).join('') : React.isValidElement(n) ? text(n.props.children) : String(n);
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
const event = () => ({ preventDefault() {}, stopPropagation() {} });
const recorded = (name: string) => calls.filter(c => c[0] === name);
let serial = 0;
beforeEach(() => {
  calls.length = 0;
  const pid = 'night-project-' + ++serial;
  Object.assign(g, {
    ui: { view: 'ide', projectId: pid, pendingHide: new Set(), snap: { sessions: [], projects: [{ id: pid, name: 'Test project', path: 'C:/test-project' }] } },
    project: () => g.ui.snap.projects[0], changedFiles: () => [],
    document: { getElementById: () => ({ hidden: false, focus() {}, select() {} }) },
    rpc: async (...args: any[]) => { calls.push(['rpc', ...args]); return { result: { paths: [] } }; },
    toast: (...args: any[]) => calls.push(['toast', ...args]),
    api: {
      fsList: async (...args: any[]) => { calls.push(['fsList', ...args]); return [{ name: 'src', dir: true }, { name: 'src2', dir: true }, { name: 'outside.ts', dir: false }, { name: 'picture.png', dir: false }]; },
      fsFind: async (...args: any[]) => { calls.push(['fsFind', ...args]); return [args[1]]; },
      fsRead: async (...args: any[]) => { calls.push(['fsRead', ...args]); return { text: 'const original = 1;', mtimeMs: 42 }; },
      fsImage: async (...args: any[]) => { calls.push(['fsImage', ...args]); return { url: 'data:image/png;base64,iVBORw0KGgo=' }; },
      fsWrite: async (...args: any[]) => { calls.push(['fsWrite', ...args]); return { ok: true }; },
      fsDelete: async (...args: any[]) => { calls.push(['fsDelete', ...args]); return { ok: true }; },
      fsOpenOutside: async (...args: any[]) => { calls.push(['fsOpenOutside', ...args]); return { ok: true }; },
      git: async (...args: any[]) => { calls.push(['git', ...args]); return { branch: 'test', files: [{ path: 'outside.ts', index: 'M', worktree: '.' }] }; },
      runCheck: async (...args: any[]) => { calls.push(['runCheck', ...args]); return { ok: true, exit_code: 0 }; },
    },
  });
});
afterEach(() => dropProject(g.ui.projectId));

async function verdict(result = 'needs_review') {
  const id = 'session-' + ++serial;
  g.rpc = async (...args: any[]) => { calls.push(['rpc', ...args]); return { result: { result, proof: { command: 'npm test', exit_code: 1 } } }; };
  const h = harness(Verdict, { x: { id, state: 'done', state_at: '2026-11-11T00:00:00Z' } });
  h.draw(); await flush(); h.draw();
  return { h, id };
}
const runButton = (n: any) => n.props['data-action'] === 'run-check';

test('night-206 Run check renders only for needs_review, not done or checks_passed', async () => {
  const review = await verdict();
  assert.equal(review.h.all(runButton).length, 1);
  assert.equal(review.h.one(runButton).props.label, 'Run check');
  for (const result of ['done', 'checks_passed']) {
    const { h } = await verdict(result);
    assert.equal(h.all(runButton).length, 0);
    assert.equal(h.one((n: any) => n.type?.name === 'Badge').props.label, result === 'done' ? 'Done, check passed' : 'Check passed');
  }
});

test('night-206 clicking Run check calls runCheck exactly once with only the session id', async () => {
  const { h, id } = await verdict();
  await h.one(runButton).props.onClick(event());
  assert.deepEqual(recorded('runCheck'), [['runCheck', id]]);
});

test('night-206 a passing check toasts then refreshes done.result and the badge', async () => {
  const { h, id } = await verdict();
  assert.equal(h.one((n: any) => n.type?.name === 'Badge').props.label, 'Needs your review');
  g.rpc = async (...args: any[]) => { calls.push(['rpc', ...args]); return { result: { result: 'done', proof: { command: 'npm test', exit_code: 0 } } }; };
  calls.length = 0;
  await h.one(runButton).props.onClick(event()); h.draw();
  assert.deepEqual(calls, [
    ['runCheck', id], ['toast', 'Check passed.', false],
    ['rpc', 'done.result', { session_id: id }, true],
  ]);
  assert.equal(h.one((n: any) => n.type?.name === 'Badge').props.label, 'Done, check passed');
  assert.equal(h.all(runButton).length, 0);
});

test('night-206 an error check toasts its text and leaves the badge unchanged', async () => {
  const { h, id } = await verdict();
  g.api.runCheck = async (...args: any[]) => { calls.push(['runCheck', ...args]); return { error: 'Saved check is unavailable' }; };
  calls.length = 0;
  await h.one(runButton).props.onClick(event()); h.draw();
  assert.deepEqual(calls, [['runCheck', id], ['toast', 'Saved check is unavailable', true]]);
  assert.equal(h.one((n: any) => n.type?.name === 'Badge').props.label, 'Needs your review');
  assert.equal(h.one(runButton).props.label, 'Run check');
});

test('night-206 a pending check disables the button and reads Checking', async () => {
  const { h } = await verdict();
  let finish: any;
  g.api.runCheck = () => new Promise(resolve => { finish = resolve; });
  assert.equal(h.one(runButton).props.isDisabled, false);
  const pending = h.one(runButton).props.onClick(event()); h.draw();
  assert.equal(h.one(runButton).props.isDisabled, true);
  assert.equal(h.one(runButton).props.label, 'Checking');
  finish({ error: 'Check stopped' }); await pending; h.draw();
  assert.equal(h.one(runButton).props.isDisabled, false);
  assert.equal(h.one(runButton).props.label, 'Run check');
});

async function explorer() {
  await drawIde();
  const h = harness(Ide); h.draw(); await flush(); h.draw();
  return h;
}
async function open(h: any, path: string) {
  ideKeys.find(); h.draw();
  h.one((n: any) => n.props.id === 'ide-find').props.onChange({ target: { value: path } });
  await flush(); h.draw();
  h.one((n: any) => hasClass('ou-ide-hit')(n) && n.props.title === path).props.onClick();
  await flush(); h.draw();
}
async function askDelete(h: any, path: string) {
  h.one((n: any) => n.props.id === 'ide-find').props.onKeyDown({ key: 'Escape', ...event() }); h.draw();
  h.one((n: any) => n.props.id === 'ide-tree-menu').props.onContextMenu({ target: { closest: () => ({ dataset: { treeId: path } }) } }); h.draw();
  const menu = h.one((n: any) => n.props.id === 'ide-tree-menu');
  const remove = menu.props.items.find((item: any) => item.label === 'Delete');
  assert.ok(remove); assert.notEqual(remove.isDisabled, true);
  remove.onClick(); menu.props.onOpenChange(false);
  await new Promise(resolve => setTimeout(resolve, 5)); h.draw();
  assert.equal(h.one((n: any) => n.type?.name === 'Dialog').props['aria-label'], `Move ${path} to the Recycle Bin?`);
}
const openPaths = () => ideFiles().filter((f: any) => f.auxiliaryData.group === 'Open files').map((f: any) => f.id);

for (const [reply, message] of [[{ commit: 'abc1234' }, 'Committed abc1234'], [{ ok: true }, 'Committed']] as const) {
  test('night-210 A commit reply toasts ' + message, async () => {
    const baseGit = g.api.git;
    g.api.git = async (...args: any[]) => {
      if (args[1] !== 'commit') return baseGit(...args);
      calls.push(['git', ...args]); return reply;
    };
    const h = await explorer(); h.one(label('Changes 1')).props.onClick(); h.draw(); await flush(); h.draw();
    h.one(hasClass('ou-ide-scmsg')).props.onChange({ target: { value: '  Save work  ' } }); h.draw();
    assert.equal(h.one(label('Commit')).props.isDisabled, false);
    h.one(label('Commit')).props.onClick(); await flush(); h.draw();
    assert.deepEqual(recorded('git').filter(c => c[2] === 'commit'), [['git', g.ui.projectId, 'commit', 'Save work']]);
    assert.deepEqual(recorded('toast'), [['toast', message]]);
    assert.equal(h.one(hasClass('ou-ide-scmsg')).props.value, '');
  });
}

test('night-210 B a png uses fsImage, renders an img and stays clean', async () => {
  const h = await explorer(); await open(h, 'picture.png');
  assert.deepEqual(recorded('fsImage'), [['fsImage', g.ui.projectId, 'picture.png']]);
  assert.deepEqual(recorded('fsRead'), []);
  const image = h.one((n: any) => n.type === 'img');
  assert.equal(image.props.src, 'data:image/png;base64,iVBORw0KGgo=');
  assert.equal(image.props.alt, 'picture.png');
  assert.deepEqual(dirtyIn(g.ui.projectId), []);
  assert.equal(h.all(hasClass('ou-ide-dirty')).length, 0);
  assert.equal(h.all(label('Save')).length, 0);
  ideKeys.save(); await open(h, 'picture.png'); await drawIde(); await flush(); h.draw();
  assert.deepEqual(recorded('fsRead'), []);
  assert.deepEqual(recorded('fsWrite'), []);
  assert.deepEqual(dirtyIn(g.ui.projectId), []);
  assert.deepEqual(openPaths(), ['picture.png']);
  assert.equal(recorded('fsImage').length, 1);
});

test('night-210 B a png error shows its text and Open outside', async () => {
  g.api.fsImage = async (...args: any[]) => { calls.push(['fsImage', ...args]); return { error: 'Image exceeds size limit' }; };
  const h = await explorer(); await open(h, 'picture.png');
  assert.deepEqual(recorded('fsImage'), [['fsImage', g.ui.projectId, 'picture.png']]);
  assert.deepEqual(recorded('fsRead'), []);
  assert.ok(h.one((n: any) => n.props.title === 'Image exceeds size limit'));
  assert.equal(h.all((n: any) => n.type === 'img').length, 0);
  h.one(label('Open outside')).props.onClick(); await flush();
  assert.deepEqual(recorded('fsOpenOutside'), [['fsOpenOutside', g.ui.projectId, 'picture.png']]);
  assert.deepEqual(dirtyIn(g.ui.projectId), []);
});

test('night-210 C1 Delete calls fsDelete only after confirmation', async () => {
  const h = await explorer(); await open(h, 'outside.ts');
  await askDelete(h, 'outside.ts');
  assert.deepEqual(recorded('fsDelete'), []);
  assert.deepEqual(openPaths(), ['outside.ts']);
  h.one(label('Cancel')).props.onClick(); h.draw();
  const command = ideCommands((_group: string, name: string, run: any) => ({ name, run })).find((c: any) => c.name === 'Delete file');
  assert.ok(command); command.run(); h.draw();
  assert.equal(h.one((n: any) => n.type?.name === 'Dialog').props['aria-label'], 'Move outside.ts to the Recycle Bin?');
  assert.deepEqual(recorded('fsDelete'), []);
  h.one(label('Move to Recycle Bin')).props.onClick(); await flush(); h.draw();
  assert.deepEqual(recorded('fsDelete'), [['fsDelete', g.ui.projectId, 'outside.ts']]);
  assert.deepEqual(openPaths(), []);
});

test('night-210 C2 Cancel makes no calls and preserves the tab', async () => {
  const h = await explorer(); await open(h, 'outside.ts'); await askDelete(h, 'outside.ts');
  assert.deepEqual(recorded('fsDelete'), []);
  calls.length = 0;
  h.one(label('Cancel')).props.onClick(); await flush(); h.draw();
  assert.deepEqual(calls, []);
  assert.deepEqual(openPaths(), ['outside.ts']);
  assert.equal(h.all((n: any) => n.type?.name === 'Dialog').length, 0);
});

test('night-210 C3 deleting a folder with a dirty tab warns of unsaved changes', async () => {
  const h = await explorer(); await open(h, 'src/a.ts');
  // Seed the dirty precondition through the real rendered editor tab.
  h.one((n: any) => n.type?.name === 'EditorHost' && n.props.tab.path === 'src/a.ts').props.tab.dirty = true;
  h.draw(); assert.deepEqual(dirtyIn(g.ui.projectId), ['src/a.ts']);
  await askDelete(h, 'src');
  assert.ok(h.one((n: any) => n.type === 'p' && text(n) === 'It has unsaved changes. They will be lost.'));
  assert.deepEqual(recorded('fsDelete'), []);
});

test('night-210 C4 a delete error keeps the tab open and toasts the error', async () => {
  g.api.fsDelete = async (...args: any[]) => { calls.push(['fsDelete', ...args]); return { error: 'Recycle Bin is unavailable' }; };
  const h = await explorer(); await open(h, 'outside.ts'); await askDelete(h, 'outside.ts');
  h.one(label('Move to Recycle Bin')).props.onClick(); await flush(); h.draw();
  assert.deepEqual(recorded('fsDelete'), [['fsDelete', g.ui.projectId, 'outside.ts']]);
  assert.deepEqual(openPaths(), ['outside.ts']);
  assert.ok(h.one(label('Close outside.ts')));
  assert.deepEqual(recorded('toast'), [['toast', 'Recycle Bin is unavailable', true]]);
});

test('night-210 C5 deleting src closes only its tabs and preserves src2/a.ts', async () => {
  const h = await explorer();
  for (const path of ['outside.ts', 'src2/a.ts', 'src/a.ts', 'src/nested/b.ts']) await open(h, path);
  assert.deepEqual(openPaths(), ['outside.ts', 'src2/a.ts', 'src/a.ts', 'src/nested/b.ts']);
  await askDelete(h, 'src');
  assert.deepEqual(recorded('fsDelete'), []);
  h.one(label('Move to Recycle Bin')).props.onClick(); await flush(); h.draw();
  assert.deepEqual(recorded('fsDelete'), [['fsDelete', g.ui.projectId, 'src']]);
  assert.deepEqual(openPaths(), ['outside.ts', 'src2/a.ts']);
  assert.ok(h.one(label('Close src2/a.ts')));
  assert.ok(h.one(label('Close outside.ts')));
  assert.equal(h.all(label('Close src/a.ts')).length, 0);
  assert.equal(h.all(label('Close src/nested/b.ts')).length, 0);
  assert.deepEqual(recorded('toast'), [['toast', 'Moved to the Recycle Bin']]);
});
