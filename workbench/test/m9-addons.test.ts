import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm9-addons-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });
const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');

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
      b.onLoad({ filter: /.*/, namespace: 'screen' }, (args: any) => ({ contents: `import { createElement as __create, Fragment as __fragment } from 'react'; function __element(...args) { const node = __create(...args); globalThis.__axCapture?.(node); return node; }\n` + readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.jsx') ? 'jsx' : 'js' }));
    } }],
    bundle: true, platform: 'node', format: 'esm', jsx: 'transform', jsxFactory: '__element', jsxFragment: '__fragment',
    loader: { '.css': 'empty' }, outfile: join(temp, output),
  });
}

await bundle("export * from './src/addons.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", 'screens.mjs');

const screens = await import(pathToFileURL(join(temp, 'screens.mjs')).href);
const { React, renderToStaticMarkup, Addons, addonsStore, drawAddons } = screens;
const g: any = globalThis;
const own = new Set(['Addons']);

function harness(Screen: any) {
  const frames = new Map<string, any[]>();
  let nodes: any[] = [];
  function expand(value: any, path: string): any {
    if (Array.isArray(value)) return value.map((v, i) => expand(v, path + '/' + i));
    if (!React.isValidElement(value)) return value;
    nodes.push(value);
    if (typeof value.type === 'function' && own.has(value.type.name)) {
      const slots = frames.get(path) || []; frames.set(path, slots); let cursor = 0;
      const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H;
      internals.H = {
        useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
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
  let tree: any;
  const draw = () => { nodes = []; tree = expand(React.createElement(Screen), 'root'); return tree; };
  return {
    draw,
    html: () => renderToStaticMarkup(draw()),
    all: (predicate: any) => nodes.filter(predicate),
    one: (predicate: any) => { const found = nodes.find(predicate); assert.ok(found, 'rendered control exists'); return found; },
  };
}

const textContent = (node: any): string => Array.isArray(node) ? node.map(textContent).join('') : React.isValidElement(node) ? textContent((node.props as any).children) : node == null ? '' : String(node);
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };

beforeEach(() => {
  Object.assign(g, {
    ui: { view: 'addons', snap: { engines: [] } },
    api: { addons: async () => [] },
    document: { documentElement: { style: {} }, getElementById: () => ({ hidden: false }) },
  });
  addonsStore.set({ tick: 0, rows: [] });
});

test('facet filters are OR within one group and AND across groups', () => {
  g.ui.snap.engines = [
    { id: 'eng-on', light: 'green' },
    { id: 'eng-bad', light: 'red' },
  ];
  addonsStore.set({
    rows: [
      { id: 'plug-on', enabled: true, permissions: [] },
      { id: 'plug-off', enabled: false, permissions: [] },
    ],
  });
  const h = harness(Addons);
  const facetBox = (id: string) => h.one((n: any) => n.props['data-action'] === 'addon-facet' && n.props['data-id'] === id);
  const shownIds = () => h.all((n: any) => n.type === 'article').map((n: any) => String(n.key).split(':')[1]);

  h.draw();
  assert.deepEqual(shownIds(), ['eng-bad', 'eng-on', 'plug-off', 'plug-on']);

  // Ticking agent shows only agents
  facetBox('agent').props.onChange(true);
  h.draw();
  assert.deepEqual(shownIds(), ['eng-bad', 'eng-on']);

  // Ticking plugin as well tests OR within KIND group
  facetBox('plugin').props.onChange(true);
  h.draw();
  assert.deepEqual(shownIds(), ['eng-bad', 'eng-on', 'plug-off', 'plug-on']);

  // Unticking plugin leaves only agents
  facetBox('plugin').props.onChange(false);
  h.draw();
  assert.deepEqual(shownIds(), ['eng-bad', 'eng-on']);

  // Ticking bad tests AND across groups: KIND=agent AND STATE=bad
  facetBox('bad').props.onChange(true);
  h.draw();
  assert.deepEqual(shownIds(), ['eng-bad']);

  // Ticking off tests OR within STATE group: KIND=agent AND STATE=(bad OR off)
  facetBox('off').props.onChange(true);
  h.draw();
  assert.deepEqual(shownIds(), ['eng-bad']);

  // Ticking plugin tests OR within both groups: KIND=(agent OR plugin) AND STATE=(bad OR off)
  facetBox('plugin').props.onChange(true);
  h.draw();
  assert.deepEqual(shownIds(), ['eng-bad', 'plug-off']);

  // Ticking on includes all states
  facetBox('on').props.onChange(true);
  h.draw();
  assert.deepEqual(shownIds(), ['eng-bad', 'eng-on', 'plug-off', 'plug-on']);
});

test('facet counts follow the search text', () => {
  g.ui.snap.engines = [
    { id: 'alpha-agent', light: 'green' },
    { id: 'beta-agent', light: 'red' },
  ];
  addonsStore.set({
    rows: [
      { id: 'alpha-plugin', enabled: true, permissions: ['reading'] },
      { id: 'gamma-plugin', enabled: false, permissions: ['alpha'] },
    ],
  });
  const h = harness(Addons);
  h.draw();

  const countOf = (key: string) => {
    const row = h.one((n: any) => typeof n.props.className === 'string' && n.props.className.startsWith('ou-facetrow') && n.key === key);
    return textContent(row.props.children[1]);
  };
  const searchInput = () => h.one((n: any) => n.props['data-action'] === 'addon-search');

  // Initial counts without search query
  assert.equal(countOf('agent'), '2');
  assert.equal(countOf('plugin'), '2');
  assert.equal(countOf('on'), '2');
  assert.equal(countOf('off'), '1');
  assert.equal(countOf('bad'), '1');

  // Search for alpha matches alpha-agent, alpha-plugin and gamma-plugin
  searchInput().props.onChange('alpha');
  h.draw();
  assert.equal(countOf('agent'), '1');
  assert.equal(countOf('plugin'), '2');
  assert.equal(countOf('on'), '2');
  assert.equal(countOf('off'), '1');
  assert.equal(countOf('bad'), '0');

  // Search for beta matches only beta-agent
  searchInput().props.onChange('beta');
  h.draw();
  assert.equal(countOf('agent'), '1');
  assert.equal(countOf('plugin'), '0');
  assert.equal(countOf('on'), '0');
  assert.equal(countOf('off'), '0');
  assert.equal(countOf('bad'), '1');

  // Search for non-matching query zeroes all counts
  searchInput().props.onChange('nonexistent');
  h.draw();
  assert.equal(countOf('agent'), '0');
  assert.equal(countOf('plugin'), '0');
  assert.equal(countOf('on'), '0');
  assert.equal(countOf('off'), '0');
  assert.equal(countOf('bad'), '0');
});

test('the +N permissions expand shows the rest', () => {
  addonsStore.set({
    rows: [
      {
        id: 'plug-perms',
        enabled: true,
        description: 'Multi permissions',
        permissions: ['Perm A', 'Perm B', 'Perm C', 'Perm D', 'Perm E'],
      },
    ],
  });
  const h = harness(Addons);
  const initialHtml = h.html();
  assert.ok(initialHtml.includes('Perm A'));
  assert.ok(initialHtml.includes('Perm B'));
  assert.ok(initialHtml.includes('Perm C'));
  assert.ok(!initialHtml.includes('Perm D'));
  assert.ok(!initialHtml.includes('Perm E'));

  const moreBtn = h.one((n: any) => n.props['data-action'] === 'addon-more');
  assert.equal(moreBtn.props['data-id'], 'plug-perms');
  assert.equal(moreBtn.props['aria-expanded'], false);
  assert.equal(textContent(moreBtn), '+2');

  // Click expand button to show all permissions
  moreBtn.props.onClick();
  const expandedHtml = h.html();
  assert.ok(expandedHtml.includes('Perm D'));
  assert.ok(expandedHtml.includes('Perm E'));
  assert.equal(h.one((n: any) => n.props['data-action'] === 'addon-more').props['aria-expanded'], true);
  assert.equal(textContent(h.one((n: any) => n.props['data-action'] === 'addon-more')), 'Show less');

  // Click again to collapse
  h.one((n: any) => n.props['data-action'] === 'addon-more').props.onClick();
  const collapsedHtml = h.html();
  assert.ok(!collapsedHtml.includes('Perm D'));
  assert.equal(textContent(h.one((n: any) => n.props['data-action'] === 'addon-more')), '+2');
});

test('an error from the loader shows the error state with Try again and Try again reloads', async () => {
  g.ui.view = 'addons';
  addonsStore.set({ rows: null });
  let shouldFail = true;
  let fetchCount = 0;
  g.api.addons = async () => {
    fetchCount++;
    if (shouldFail) throw new Error('loader failure');
    return [{ id: 'recovered-plug', permissions: [], enabled: true }];
  };

  await drawAddons();
  assert.equal(fetchCount, 1);
  assert.equal(addonsStore.get().rows, 'error');

  const h = harness(Addons);
  const errorHtml = h.html();
  assert.match(errorHtml, /Could not load plugins\./);
  const retryBtn = h.one((n: any) => n.props['data-action'] === 'addons-retry');
  assert.equal(retryBtn.props.label, 'Try again');

  // Trigger retry with recovered loader
  shouldFail = false;
  retryBtn.props.onClick();
  await flush();
  assert.equal(fetchCount, 2);
  assert.equal(Array.isArray(addonsStore.get().rows), true);
  assert.equal(addonsStore.get().rows[0].id, 'recovered-plug');

  const recoveredHtml = h.html();
  assert.doesNotMatch(recoveredHtml, /Could not load plugins\./);
  assert.match(recoveredHtml, /recovered-plug/);
});

test('Clear filters resets search and facets', () => {
  g.ui.snap.engines = [{ id: 'alpha-agent', light: 'green' }];
  addonsStore.set({ rows: [{ id: 'alpha-plugin', enabled: true, permissions: [] }] });
  const h = harness(Addons);
  h.draw();

  // Set search query and tick facet to match nothing
  h.one((n: any) => n.props['data-action'] === 'addon-search').props.onChange('nomatch');
  h.one((n: any) => n.props['data-action'] === 'addon-facet' && n.props['data-id'] === 'bad').props.onChange(true);

  const filteredHtml = h.html();
  assert.match(filteredHtml, /No add-ons match\./);
  const clearBtn = h.one((n: any) => n.props['data-action'] === 'addon-clear');
  assert.equal(clearBtn.props.label, 'Clear filters');

  // Click clear filters button
  clearBtn.props.onClick();
  const clearedHtml = h.html();
  assert.doesNotMatch(clearedHtml, /No add-ons match\./);
  assert.match(clearedHtml, /alpha-agent/);
  assert.match(clearedHtml, /alpha-plugin/);
  assert.equal(h.one((n: any) => n.props['data-action'] === 'addon-search').props.value, '');
  assert.equal(h.one((n: any) => n.props['data-action'] === 'addon-facet' && n.props['data-id'] === 'bad').props.value, false);
});
