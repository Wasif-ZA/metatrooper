import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'inbox-working-'));
after(() => rmSync(temp, { recursive: true, force: true }));
// Bundle the real UI sources, as in m8-ax-screens.test.ts.
const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');
async function bundle(contents: string, output: string) {
  try { await build({
    absWorkingDir: join(wb, 'ui'), tsconfigRaw: {},
    stdin: { contents, resolveDir: join(wb, 'ui'), loader: 'jsx' },
    plugins: [{ name: 'installed-ui-modules', setup(b: any) {
      b.onResolve({ filter: /.*/ }, (args: any) => {
        if (args.path.endsWith('.css')) return { path: args.path, namespace: 'empty-css' };
        if (!args.path.startsWith('.')) return { path: pathToFileURL(requireUI.resolve(args.path)).href, external: true };
        return { path: resolve(args.namespace === 'screen' ? dirname(args.importer) : join(wb, 'ui'), args.path), namespace: 'screen' };
      });
      b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'screen' }, (args: any) => ({ contents: `import { createElement as __create, Fragment as __fragment } from 'react'; function __element(...args) { const node = __create(...args); return node; }\n` + readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.jsx') ? 'jsx' : 'js' }));
    } }],
    bundle: true, platform: 'node', format: 'esm', jsx: 'transform', jsxFactory: '__element', jsxFragment: '__fragment',
    loader: { '.css': 'empty' }, outfile: join(temp, output),
  }); } catch (error: any) {
    if (error.code !== 'EPERM' || process.platform !== 'win32') throw error;
    // Compile real sources with inherited handles and the same JSX transformation.
    const helper = join(temp, 'capture.jsx');
    writeFileSync(helper, `import { createElement, Fragment } from ${JSON.stringify(requireUI.resolve('react'))}; export const __fragment = Fragment; export function __element(...args) { const node = createElement(...args); return node; }`);
    const entry = join(temp, output + '.jsx');
    const source = contents.replaceAll("'./src/", "'" + join(wb, 'ui/src/').replaceAll('\\', '/')).replace(/'(react(?:-dom\/server)?)'/g, (_, name) => JSON.stringify(requireUI.resolve(name)));
    writeFileSync(entry, source);
    const binary = join(dirname(requireUI.resolve('esbuild/package.json')), '../@esbuild/win32-x64/esbuild.exe');
    await new Promise<void>((resolveBuild, reject) => {
      const child = spawn(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=transform', '--jsx-factory=__element', '--jsx-fragment=__fragment', '--inject:' + helper, '--loader:.css=empty', '--banner:js=import { createRequire as __axRequire } from "node:module"; const require = __axRequire(import.meta.url);', '--outfile=' + join(temp, output)], { stdio: 'inherit', windowsHide: true });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolveBuild() : reject(new Error('esbuild exited ' + code)));
    });
  }
}

await bundle("export { Inbox, inboxStore } from './src/inbox.jsx'; export * as React from 'react';", 'inbox.mjs');
const { Inbox, inboxStore, React } = await import(pathToFileURL(join(temp, 'inbox.mjs')).href);
const g: any = globalThis;
const own = new Set(['Inbox', 'Glyph']);

// Expand Inbox with persistent hook slots; library controls keep their real props.
function harness(Screen: any) {
  const frames = new Map<string, any[]>();
  let nodes: any[] = [];
  function expand(value: any, path: string): any {
    if (Array.isArray(value)) return value.map((v, i) => expand(v, path + '/' + i));
    if (!React.isValidElement(value)) return value;
    nodes.push(value);
    if (typeof value.type === 'function' && own.has(value.type.name)) {
      const slots = frames.get(path) || []; frames.set(path, slots); let cursor = 0; let rerender = false;
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H;
      internals.H = {
        useEffect: () => {},
        useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
        useRef: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useLayoutEffect: () => {},
        useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (v: any) => { const next = typeof v === 'function' ? v(slots[i]) : v; if (!Object.is(next, slots[i])) { slots[i] = next; rerender = true; } }]; },
      };
      let output;
      try {
        let renders = 0;
        do {
          assert.ok(renders++ < 25, 'render-phase state updates settle');
          cursor = 0; rerender = false; output = value.type(value.props);
        } while (rerender);
      } finally { internals.H = previous; }
      return expand(output, path + '/render');
    }
    const props: any = { key: value.key ?? path };
    for (const [key, v] of Object.entries(value.props)) if (React.isValidElement(v) || Array.isArray(v)) props[key] = expand(v, path + '/' + key);
    return React.cloneElement(value, props);
  }
  let tree: any;
  const draw = () => { nodes = []; tree = expand(React.createElement(Screen), 'root'); return tree; };
  return {
    draw,
    all: (predicate: any) => nodes.filter(predicate),
    one: (predicate: any) => { const found = nodes.find(predicate); assert.ok(found, 'rendered control exists'); return found; },
  };
}

const hasClass = (name: string) => (n: any) => typeof n.props.className === 'string' && n.props.className.split(' ').includes(name);
const textContent = (node: any): string => Array.isArray(node) ? node.map(textContent).join('') : React.isValidElement(node) ? textContent(node.props.children) : node == null ? '' : String(node);

test('Inbox Working counts filtered top-level sessions while retaining helper rows', () => {
  const session = (id: string, state: string, extra: any = {}) => ({ id, state, project_id: 'p1', engine_id: 'synthetic', title: 'Task ' + id, ...extra });
  const live = [
    session('A', 'working'),
    session('B', 'working', { project_id: 'p2' }),
    session('K', 'working', { parent_id: 'A' }),
    session('W', 'waiting_for_you'),
  ];
  Object.assign(g, {
    ui: { view: 'inbox', projectId: 'p1', snap: { live, sessions: [], approvals: [], needs_you: [], engines: [], projects: [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }] } },
    waitingAll: () => live.filter(x => x.state === 'waiting_for_you'),
    taskOf: (x: any) => x.title,
    ago: () => '1m ago',
  });
  inboxStore.set({ filter: 'all', engine: '', project: '', collapsed: [], selectedId: null });
  const h = harness(Inbox);
  const workingCount = () => h.all((n: any) => hasClass('ou-ny-gcount')(n) && n.props['data-group'] === 'working');
  const assertWorkingCount = (expected: number) => {
    const counts = workingCount();
    assert.equal(counts.length, 1, 'Working group is rendered');
    assert.equal(textContent(counts[0]), String(expected), 'Working group displays the filtered top-level count');
  };
  const workingRows = () => {
    const fold = h.one((n: any) => n.type?.name === 'Fold' && n.props.head?.props['data-group'] === 'working');
    return React.Children.toArray(fold.props.children).filter((n: any) => hasClass('ou-irow')(n)).map((n: any) => n.props['data-id']);
  };

  h.draw();
  assertWorkingCount(2);
  assert.match(textContent(h.one(hasClass('ou-ny-counts'))), /1 waiting.*2 working.*0 notices/);
  assert.deepEqual(workingRows(), ['A', 'B', 'K'], 'helpers remain visible and waiting sessions stay outside Working');

  h.one((n: any) => n.props.label === 'Project').props.onChange('p1');
  h.draw();
  assertWorkingCount(1);
  assert.deepEqual(workingRows(), ['A', 'K']);
  assert.match(textContent(h.one(hasClass('ou-ny-counts'))), /2 working/, 'overall header still counts the full snapshot');

  h.one((n: any) => n.props.label === 'Project').props.onChange('');
  const kinds = h.one((n: any) => n.props.label === 'Show');
  const needsAnswer = kinds.props.options.find((o: any) => o.label === 'Needs your answer');
  assert.ok(needsAnswer, 'Kinds offers Needs your answer');
  kinds.props.onChange(needsAnswer.value);
  h.draw();
  if (workingCount().length) assertWorkingCount(0);
  assert.deepEqual(h.all(hasClass('ou-irow')).map((n: any) => n.props['data-id']), ['W'], 'Kinds actually filters to the waiting row');
});
