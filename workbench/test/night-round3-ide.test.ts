import test, { after, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'night-round3-ide-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');

// Bundle real screen sources and retain installed React and library controls.
const entry = "export * from './src/verdict.jsx'; export * from './src/ide.jsx'; export * from './src/ide-panel.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';";
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
const { React, renderToStaticMarkup, Ide, drawIde, ideKeys, dropProject, Problems } = await import(pathToFileURL(join(temp, 'panes.mjs')).href);
const g: any = globalThis;
const calls: any[] = [];
const own = new Set(['Ide', 'Files', 'Search', 'SourceControl', 'Crumb', 'Agents', 'StatusBar', 'Asks', 'Verdict', 'OpenInVsCodeButton', 'ScRow', 'Problems']);

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
const label = (s: string) => (n: any) => n.props?.label === s;
const hasClass = (s: string) => (n: any) => n.props?.className?.split(' ').includes(s);
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
      openInVsCode: async (...args: any[]) => { calls.push(['openInVsCode', ...args]); return { ok: true }; },
      git: async (...args: any[]) => { calls.push(['git', ...args]); return { branch: 'test', files: [{ path: 'outside.ts', index: 'M', worktree: '.' }] }; },
      runCheck: async (...args: any[]) => { calls.push(['runCheck', ...args]); return { ok: true, exit_code: 0 }; },
    },
  });
});
afterEach(() => dropProject(g.ui.projectId));

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

// Verify Open in VS Code button renders at the end of the tab strip and calls openInVsCode.
test('fe1e04a8 IDE: Open in VS Code is a small ghost button with a link icon at the END of the tab strip', async () => {
  const h = await explorer();
  await open(h, 'outside.ts');
  const tabsBar = h.one(hasClass('ou-ide-tabs'));
  const children = Array.isArray(tabsBar.props.children) ? tabsBar.props.children : [tabsBar.props.children];
  const tabListIndex = children.findIndex((c: any) => c?.type?.name === 'TabList');
  const btnIndex = children.findIndex((c: any) => c?.type?.name === 'OpenInVsCodeButton' || c?.props?.className === 'ou-ide-open-vscode');
  assert.ok(tabListIndex >= 0);
  assert.equal(btnIndex, children.length - 1);
  const tabList = children[tabListIndex];
  const tabs = Array.isArray(tabList.props.children) ? tabList.props.children : [tabList.props.children];
  const lastTab = tabs[tabs.length - 1];
  assert.equal(lastTab.props.value, 'outside.ts');
  assert.ok(btnIndex > tabListIndex);
  const btn = h.one(hasClass('ou-ide-open-vscode'));
  assert.equal(btn.props.label, 'Open in VS Code');
  assert.equal(btn.props.size, 'sm');
  assert.equal(btn.props.variant, 'ghost');
  const iconPath = btn.props.icon?.type?.(btn.props.icon.props)?.props?.children?.props?.d;
  assert.equal(iconPath, 'M7 3.5H4.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9M9.5 3.5h3v3M12.5 3.5l-5 5');
  await btn.props.onClick(event());
  assert.deepEqual(recorded('openInVsCode'), [['openInVsCode', g.ui.projectId, 'outside.ts']]);
});

test('IDE bottom panel: Problems and Terminal tabs, Terminal shown first, no Agents strip; the status bar count opens Problems', async () => {
  const h = await explorer();
  const tabs = h.all((n: any) => typeof n.props?.label === 'string' && ['problems', 'terminal', 'agents'].includes(n.props.value));
  assert.deepEqual(tabs.map((n: any) => n.props.label), ['Problems', 'Terminal']);
  assert.equal(h.all(hasClass('ou-soontag')).length, 0);
  assert.equal(h.all((n: any) => n.props?.id === 'ide-agents').length, 0);
  const term = h.one((n: any) => n.type?.name === 'Terminal');
  assert.equal(term.props.pid, g.ui.projectId);
  const count = h.one(hasClass('ou-ip-sprob'));
  assert.equal(count.props['aria-label'], '0 errors, 0 warnings. Show Problems');
  count.props.onClick(); h.draw();
  assert.equal(h.all((n: any) => n.type?.name === 'Terminal').length, 0);
  assert.equal(text(h.one(hasClass('ou-ip-empty'))), 'No problems in open files.');
});

test('Problems groups markers by file, errors before warnings then by line, and a row opens the file at its line', () => {
  const opened: any[] = [];
  const FileIcon = ({ path }: any) => React.createElement('i', null, path);
  const problems = [
    { path: 'src/a.ts', line: 9, col: 2, severity: 'warning', message: 'unused x', source: 'ts' },
    { path: 'src/b.css', line: 1, col: 1, severity: 'error', message: 'bad rule', source: 'css' },
    { path: 'src/a.ts', line: 30, col: 4, severity: 'error', message: 'no such name', source: 'ts' },
  ];
  const h = harness(Problems, { problems, FileIcon, open: (path: string, line: number) => opened.push([path, line]) });
  h.draw();
  assert.deepEqual(h.all(hasClass('ou-ip-pname')).map(text), ['a.ts', 'b.css']);
  assert.deepEqual(h.all(hasClass('ou-ip-pcount')).map(text), ['2', '1']);
  const rows = h.all(hasClass('ou-ip-prow'));
  assert.deepEqual(rows.map((r: any) => text(r.props.children[1])), ['no such name', 'unused x', 'bad rule']);
  assert.equal(text(rows[0].props.children[3]), '[Ln 30, Col 4]');
  rows[1].props.onClick();
  assert.deepEqual(opened, [['src/a.ts', 9]]);
});

// Verify project name casing is preserved and chevron toggles tree folded and unfolded states.
test('ac1fa681 IDE explorer: the root row shows the project name exactly as typed, and clicking the chevron folds and unfolds the tree', async () => {
  g.ui.snap.projects[0].name = 'myProjectName';
  const h = await explorer();
  const rootBtn = h.one(hasClass('ou-ide-root'));
  assert.equal(rootBtn.props.children.at(-1), 'myProjectName');
  assert.notEqual(rootBtn.props.children.at(-1), 'MYPROJECTNAME');
  assert.equal(rootBtn.props['aria-expanded'], true);
  assert.equal(text(rootBtn.props.children[0]), '\u25be');
  const treeList = h.one((n: any) => n.props?.density === 'compact');
  assert.equal(treeList.props.items.length, 4);
  rootBtn.props.onClick(event());
  h.draw();
  const foldedBtn = h.one(hasClass('ou-ide-root'));
  assert.equal(foldedBtn.props['aria-expanded'], false);
  assert.equal(text(foldedBtn.props.children[0]), '\u25b8');
  const foldedTreeList = h.one((n: any) => n.props?.density === 'compact');
  assert.equal(foldedTreeList.props.items.length, 0);
  foldedBtn.props.onClick(event());
  h.draw();
  const unfoldedBtn = h.one(hasClass('ou-ide-root'));
  assert.equal(unfoldedBtn.props['aria-expanded'], true);
  assert.equal(text(unfoldedBtn.props.children[0]), '\u25be');
  const unfoldedTreeList = h.one((n: any) => n.props?.density === 'compact');
  assert.equal(unfoldedTreeList.props.items.length, 4);
});

// Verify opening a png from Changes uses fsImage while a ts calls fsRead.
test('d9aa6ca1 IDE: a file opened from the Changes list is read the same way as from the tree', async () => {
  g.api.git = async (...args: any[]) => {
    calls.push(['git', ...args]);
    if (args[1] === 'status') {
      return { branch: 'test', files: [{ path: 'picture.png', index: 'M', worktree: '.' }, { path: 'outside.ts', index: 'M', worktree: '.' }] };
    }
    return '';
  };
  const h = await explorer();
  h.one((n: any) => typeof n.props?.label === 'string' && n.props.label.startsWith('Changes')).props.onClick(event());
  h.draw(); await flush(); h.draw();
  calls.length = 0;
  const pngRow = h.one((n: any) => hasClass('ou-ide-scrow')(n) && n.props.title === 'picture.png');
  pngRow.props.onClick(event());
  await flush(); h.draw();
  assert.deepEqual(recorded('fsImage'), [['fsImage', g.ui.projectId, 'picture.png']]);
  assert.deepEqual(recorded('fsRead'), []);
  const tsRow = h.one((n: any) => hasClass('ou-ide-scrow')(n) && n.props.title === 'outside.ts');
  tsRow.props.onClick(event());
  await flush(); h.draw();
  assert.deepEqual(recorded('fsRead'), [['fsRead', g.ui.projectId, 'outside.ts']]);
});
