import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'night-refresh-'));
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
const { React, renderToStaticMarkup, Ide, drawIde, dropProject } = await import(pathToFileURL(join(temp, 'panes.mjs')).href);
const g: any = globalThis;
const calls: any[] = [];
const own = new Set(['Ide', 'Files', 'Search', 'SourceControl', 'Crumb', 'Agents', 'StatusBar', 'Asks', 'Verdict', 'LoadDir']);

// Expand app components with persistent hooks, dependency changes and effect cleanup.
function harness(Screen: any, props: any = {}) {
  const frames = new Map<string, any>();
  let nodes: any[] = [];
  let effects: (() => void)[] = [];
  function expand(value: any, path: string): any {
    if (Array.isArray(value)) return value.map((v, i) => expand(v, path + '/' + (v?.key ?? i)));
    if (value && typeof value === 'object' && !React.isValidElement(value)) {
      const out: any = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = (React.isValidElement(v) || Array.isArray(v) || (v && typeof v === 'object')) ? expand(v, path + '/' + k) : v;
      }
      return out;
    }
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
    const elemProps: any = { key: value.key ?? path };
    for (const [key, v] of Object.entries(value.props)) if (React.isValidElement(v) || Array.isArray(v) || (v && typeof v === 'object')) elemProps[key] = expand(v, path + '/' + key);
    return React.cloneElement(value, elemProps);
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
    all: (predicate: any) => nodes.filter(predicate),
    one: (predicate: any) => { const found = nodes.find(predicate); assert.ok(found, 'rendered control exists'); return found; },
  };
}

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
const recorded = (name: string) => calls.filter(c => c[0] === name);
let serial = 0;

beforeEach(() => {
  calls.length = 0;
  const pid = 'night-project-' + ++serial;
  Object.assign(g, {
    ui: { view: 'ide', projectId: pid, pendingHide: new Set(), snap: { sessions: [], git: {}, projects: [{ id: pid, name: 'Test project', path: 'C:/test-project' }] } },
    project: () => g.ui.snap.projects[0],
    changedFiles: () => [],
    document: { getElementById: () => ({ hidden: false, focus() {}, select() {} }), querySelector: () => null },
    rpc: async (...args: any[]) => { calls.push(['rpc', ...args]); return { result: { paths: [] } }; },
    toast: (...args: any[]) => calls.push(['toast', ...args]),
    api: {
      fsList: async (...args: any[]) => {
        calls.push(['fsList', ...args]);
        const rel = args[1];
        if (rel === '.' || rel === '') return [{ name: 'src', dir: true }, { name: 'docs', dir: true }, { name: 'README.md', dir: false }];
        if (rel === 'src') return [{ name: 'a', dir: true }, { name: 'file1.ts', dir: false }];
        if (rel === 'src/a') return [{ name: 'x.ts', dir: false }];
        if (rel === 'docs') return [{ name: 'guide.md', dir: false }];
        return [];
      },
      fsFind: async (...args: any[]) => { calls.push(['fsFind', ...args]); return [args[1]]; },
      fsRead: async (...args: any[]) => { calls.push(['fsRead', ...args]); return { text: 'const original = 1;', mtimeMs: 42 }; },
      git: async (...args: any[]) => { calls.push(['git', ...args]); return { branch: 'test', files: [] }; },
    },
  });
});
afterEach(() => dropProject(g.ui.projectId));

// Helper loads the real IDE tree and expands folders '', 'src', 'src/a', and 'docs'.
async function openFolders(primeGit = true) {
  await drawIde();
  const h = harness(Ide);
  h.draw(); await flush();
  h.draw(); await flush();
  h.draw(); await flush();
  const st = h.one((n: any) => n.type?.name === 'Files').props.st;
  if (primeGit) {
    g.ui.snap.git = {};
    await drawIde();
  } else {
    st.sig = '';
    delete st.gitSnap;
  }
  calls.length = 0;
  return h;
}

// A git snapshot with changed path in src/a re-lists only src/a with exact arguments.
test('night-refresh 1 a git snapshot with changed path src/a/x.ts re-lists only src/a', async () => {
  const pid = g.ui.projectId;
  await openFolders();
  g.ui.snap.git = { repo: { changed: ['src/a/x.ts'] } };
  await drawIde();
  await flush();
  assert.deepEqual(recorded('fsList'), [['fsList', pid, 'src/a']]);
});

// A changed top-level file re-lists the root directory dot argument.
test('night-refresh 2 a changed top-level file README.md re-lists the root', async () => {
  const pid = g.ui.projectId;
  await openFolders();
  g.ui.snap.git = { repo: { changed: ['README.md'] } };
  await drawIde();
  await flush();
  assert.deepEqual(recorded('fsList'), [['fsList', pid, '.']]);
});

// Two changed paths in different open folders re-list exactly those two, each once.
test('night-refresh 3 two changed paths in different open folders re-list exactly those two, each once', async () => {
  const pid = g.ui.projectId;
  await openFolders();
  g.ui.snap.git = { repo: { changed: ['src/a/x.ts', 'docs/guide.md'] } };
  await drawIde();
  await flush();
  assert.deepEqual(recorded('fsList').sort((a, b) => a[2].localeCompare(b[2])), [
    ['fsList', pid, 'docs'],
    ['fsList', pid, 'src/a'],
  ]);
});

// A changed path under a folder that is not open re-lists nothing for it.
test('night-refresh 4 a changed path under a folder that is not open re-lists nothing for it', async () => {
  await openFolders();
  g.ui.snap.git = { repo: { changed: ['closed/secret.ts'] } };
  await drawIde();
  await flush();
  assert.deepEqual(recorded('fsList'), []);
});

// With no earlier git snapshot, the first signature change re-lists all open folders.
test('night-refresh 5 the first signature change with no earlier git snapshot re-lists every open folder', async () => {
  const pid = g.ui.projectId;
  await openFolders(false);
  g.ui.snap.git = { repo: { changed: ['src/a/x.ts'] } };
  await drawIde();
  await flush();
  assert.deepEqual(recorded('fsList').sort((a, b) => a[2].localeCompare(b[2])), [
    ['fsList', pid, '.'],
    ['fsList', pid, 'docs'],
    ['fsList', pid, 'src'],
    ['fsList', pid, 'src/a'],
  ]);
});
