import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { taskSlug, makeTaskFolder } from '../src/task-folder.ts';
import { snapshot } from '../src/queries.ts';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'first-run-home-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });
const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');

async function bundle(contents: string, output: string) {
  try { await build({
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
  }); } catch (error: any) {
    if (error.code !== 'EPERM' || process.platform !== 'win32') throw error;
    const helper = join(temp, 'capture.jsx');
    writeFileSync(helper, `import { createElement, Fragment } from ${JSON.stringify(requireUI.resolve('react'))}; export const __fragment = Fragment; export function __element(...args) { const node = createElement(...args); globalThis.__axCapture?.(node); return node; }`);
    const mount = join(temp, 'mount.mjs');
    writeFileSync(mount, 'export const createRoot = globalThis.__axCreateRoot;');
    const entry = join(temp, output + '.jsx');
    const source = contents.replaceAll("'./src/", "'" + join(wb, 'ui/src/').replaceAll('\\', '/')).replace(/'(react(?:-dom\/server)?)'/g, (_, name) => JSON.stringify(requireUI.resolve(name)));
    writeFileSync(entry, source);
    const binary = join(dirname(requireUI.resolve('esbuild/package.json')), '../@esbuild/win32-x64/esbuild.exe');
    await new Promise<void>((resolveBuild, reject) => {
      const child = spawn(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=transform', '--jsx-factory=__element', '--jsx-fragment=__fragment', '--inject:' + helper, '--alias:react-dom/client=' + mount, '--loader:.css=empty', '--banner:js=import { createRequire as __axRequire } from "node:module"; const require = __axRequire(import.meta.url);', '--outfile=' + join(temp, output)], { stdio: 'inherit', windowsHide: true });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolveBuild() : reject(new Error('esbuild exited ' + code)));
    });
  }
}

await bundle("export * from './src/home.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", 'screens.mjs');
const screens = await import(pathToFileURL(join(temp, 'screens.mjs')).href);
const { React, renderToStaticMarkup, Home, homeStore, NEW_USER_HEADING } = screens;

const g: any = globalThis;
const own = new Set(['Home', 'StartBox', 'StartState']);

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
        useSyncExternalStore: (_subscribe: any, snapshotFn: any) => snapshotFn(),
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
  const draw = () => { nodes = []; return expand(React.createElement(Screen), 'root'); };
  return {
    draw,
    html: () => renderToStaticMarkup(draw()),
    all: (predicate: any) => nodes.filter(predicate),
    one: (predicate: any) => { const found = nodes.find(predicate); assert.ok(found, 'rendered control exists'); return found; },
  };
}

const label = (text: string) => (n: any) => n.props?.label === text || n.props?.['aria-label'] === text;

const calls: any[] = [];
beforeEach(() => {
  calls.length = 0;
  homeStore.set({ open: [], tick: 0 });
  Object.assign(g, {
    ui: {
      view: 'home',
      homeSel: '',
      projectId: 'p1',
      pendingHide: new Set(),
      drafts: {},
      look: { theme: { name: 'neutral', scheme: 'dark' } },
      settingsLook: { themes: [], approval: 'contained' },
      snap: {
        has_sessions: false,
        sessions: [],
        live: [],
        approvals: [],
        needs_you: [],
        engines: [{ id: 'claude', light: 'green', approvals: ['ask', 'edits', 'contained'] }],
        projects: [{ id: 'p1', name: 'Alpha', path: '/projects/alpha' }],
      },
    },
    api: {
      makeTaskFolder: async (task: string) => '/projects/task',
      pickFolder: async () => '/projects/picked',
    },
    rpc: async (method: string, params: any) => {
      calls.push(['rpc', method, params]);
      if (method === 'project.open') return { result: { project_id: 'p-new' } };
      if (method === 'session.launch') return { result: { session_id: 's1' } };
      return { result: { session_id: 's1' } };
    },
    toast: (...args: any[]) => calls.push(['toast', ...args]),
    project: () => g.ui.snap.projects.find((p: any) => p.id === g.ui.projectId),
    waitingAll: () => [],
    homeView: { shown: () => true, set: (v: string) => { g.ui.view = v; } },
    load: () => null,
    save: (...args: any[]) => calls.push(['save', ...args]),
    switchProject: (id: string) => { g.ui.projectId = id; calls.push(['switchProject', id]); },
    document: {
      querySelector: () => ({ focus() {} }),
      documentElement: { style: {} },
      getElementById: () => ({ hidden: false }),
    },
  });
});

test('taskSlug lowercases, keeps a-z 0-9 and hyphens, collapses other runs to one hyphen, max 40 chars, trims hyphens', () => {
  assert.equal(taskSlug('Hello World!'), 'hello-world');
  assert.equal(taskSlug('  ---Leading and Trailing---  '), 'leading-and-trailing');
  assert.equal(taskSlug('Special @#$% Characters 123'), 'special-characters-123');
  assert.equal(taskSlug('a'.repeat(60)).length, 40);
  assert.equal(taskSlug('a'.repeat(60)), 'a'.repeat(40));
});

test('taskSlug turns empty or Windows reserved names into task', () => {
  assert.equal(taskSlug(''), 'task');
  assert.equal(taskSlug('   '), 'task');
  assert.equal(taskSlug('---'), 'task');
  for (const name of ['con', 'prn', 'aux', 'nul', 'com1', 'com9', 'lpt1', 'lpt9']) {
    assert.equal(taskSlug(name), 'task');
    assert.equal(taskSlug(name.toUpperCase()), 'task');
  }
});

test('taskSlug strips path traversal and slashes', () => {
  assert.equal(taskSlug('../../x'), 'x');
  assert.equal(taskSlug('..\\..\\x'), 'x');
  assert.equal(taskSlug('../../../'), 'task');
});

test('makeTaskFolder creates folder and repeats with suffix -2, -3 inside base', async () => {
  const base = mkdtempSync(join(tmpdir(), 'first-run-task-'));
  try {
    const f1 = await makeTaskFolder(base, 'My Task');
    assert.equal(f1, join(base, 'my-task'));
    assert.ok(existsSync(f1));

    const f2 = await makeTaskFolder(base, 'My Task');
    assert.equal(f2, join(base, 'my-task-2'));
    assert.ok(existsSync(f2));

    const f3 = await makeTaskFolder(base, 'My Task');
    assert.equal(f3, join(base, 'my-task-3'));
    assert.ok(existsSync(f3));

    const fEscape = await makeTaskFolder(base, '../../escape');
    assert.ok(resolve(fEscape).startsWith(resolve(base)));
    assert.equal(fEscape, join(base, 'escape'));
    assert.ok(existsSync(fEscape));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

function initTestDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  db.exec('PRAGMA foreign_keys = OFF');
  return db;
}

test('snapshot has_sessions is false on empty DB and true when any session exists', () => {
  const db = initTestDb();
  try {
    const snapEmpty = snapshot(db, null);
    assert.equal(snapEmpty.has_sessions, false);

    const now = new Date().toISOString();
    db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', '/tmp/p1', 'P1', now, now);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES (?, ?, 'claude', 'pty', 'working', ?, ?, 0)").run('s1', 'p1', now, now);

    const snapAny = snapshot(db, null);
    assert.equal(snapAny.has_sessions, true);

    const snapOther = snapshot(db, 'other-project');
    assert.equal(snapOther.has_sessions, true);
  } finally {
    db.close();
  }
});

test('Home heading reflects has_sessions false vs true and old rows are gone', () => {
  g.ui.snap.has_sessions = false;
  const h = harness(Home);
  let html = h.html();
  assert.equal(NEW_USER_HEADING, 'What do you want done?');
  assert.match(html, new RegExp(NEW_USER_HEADING.replace('?', '\\?')));
  assert.doesNotMatch(html, /Pick up where your agents left off/);
  assert.doesNotMatch(html, /ou-hm-startlist/);
  assert.doesNotMatch(html, /Import projects|Automations|Open the Wall|Learn cc/);

  g.ui.snap.has_sessions = true;
  h.draw();
  html = h.html();
  assert.match(html, /Pick up where your agents left off/);
  assert.doesNotMatch(html, new RegExp(NEW_USER_HEADING.replace('?', '\\?')));
});

test('three starter buttons fill the task box without launching', () => {
  const h = harness(Home);
  h.draw();
  const starters = h.all((n: any) => ['Explain this project', 'Fix a bug', 'Build a page'].includes(n.props?.label));
  assert.equal(starters.length, 3);

  calls.length = 0;
  h.one(label('Fix a bug')).props.onClick();
  h.draw();
  assert.equal(calls.filter(c => c[0] === 'rpc').length, 0);
  const taskBox = h.one(label('Task for a new agent'));
  assert.equal(taskBox.props.value, 'Help me find and fix a bug in my project.');
});

test('placeholder and project chip reflect whether a project is open', () => {
  g.ui.projectId = null;
  const h = harness(Home);
  h.draw();
  const textareaNoProj = h.one(label('Task for a new agent'));
  assert.equal(textareaNoProj.props.placeholder, 'Ask an agent to do something');
  assert.doesNotMatch(textareaNoProj.props.placeholder, /@/);
  assert.match(h.html(), /No folder/);

  g.ui.projectId = 'p1';
  h.draw();
  const textareaWithProj = h.one(label('Task for a new agent'));
  assert.match(textareaWithProj.props.placeholder, /@ for files/);
});

test('Start with no project open opens folder dialog without calling session.launch', async () => {
  g.ui.projectId = null;
  const h = harness(Home);
  h.draw();

  calls.length = 0;
  await h.one(label('Start')).props.onClick();
  assert.equal(calls.filter(c => c[0] === 'rpc' && c[1] === 'session.launch').length, 0);

  h.draw();
  const dialog = h.one((n: any) => n.props?.['aria-label'] === 'Where should the agent work?');
  assert.ok(dialog);
  assert.ok(h.one(label('Choose a folder')));
  assert.ok(h.one(label('Make a new folder')));
});

test('approval chip shows Auto when engine supports contained, Ask first when it does not', () => {
  g.ui.snap.engines = [{ id: 'claude', light: 'green', approvals: ['ask', 'edits', 'contained'] }];
  g.ui.settingsLook = { approval: 'contained' };
  const h = harness(Home);
  h.draw();

  const accessContained = h.one(label('Approval'));
  assert.equal(accessContained.props.renderValue(), 'Auto');
  const optsContained = accessContained.props.options;
  assert.ok(optsContained.some((o: any) => o.label === 'Auto: cannot control your desktop or outside services (default)'));
  assert.ok(optsContained.some((o: any) => o.label === 'Ask first: can control your desktop and outside services'));
  assert.ok(!optsContained.some((o: any) => o.value === 'contained'));

  g.ui.snap.engines = [{ id: 'gemini', light: 'green', approvals: ['ask', 'edits'] }];
  g.ui.drafts['home-engine'] = 'gemini';
  h.draw();

  const accessAsk = h.one(label('Approval'));
  assert.equal(accessAsk.props.renderValue(), 'Ask first');

  const options = accessAsk.props.options;
  assert.ok(options.some((o: any) => o.label === 'Ask first: can control your desktop and outside services (default)'));
  assert.ok(!options.some((o: any) => o.value === 'ask'));
});

test('no-project Start flow end to end for Make a new folder and Choose a folder', async () => {
  g.ui.projectId = null;
  g.ui.snap.engines = [
    { id: 'claude', light: 'green', approvals: ['ask', 'edits', 'contained'] },
    { id: 'codex', light: 'green', approvals: ['ask', 'edits', 'contained'] },
  ];
  g.ui.drafts = {};
  homeStore.set({ open: [], tick: 0 });

  const events: any[] = [];
  g.api.makeTaskFolder = async (task: string) => {
    events.push(['makeTaskFolder', task]);
    return '/path/to/make-folder';
  };
  g.api.pickFolder = async () => {
    events.push(['pickFolder']);
    return '/path/to/pick-folder';
  };
  g.rpc = async (method: string, params: any) => {
    events.push(['rpc', method, params]);
    if (method === 'project.open') return { result: { project_id: 'p-new' } };
    if (method === 'session.launch') return { result: { session_id: 's1' } };
    return { result: {} };
  };
  g.switchProject = (id: string) => {
    events.push(['switchProject', id]);
    g.ui.projectId = id;
  };

  const h = harness(Home);
  h.draw();

  h.one(label('Task for a new agent')).props.onChange('Build my app');
  h.one(label('Agent')).props.onChange('codex');
  h.one(label('Agent')).props.onChange('model:o3-mini');
  h.one(label('Approval')).props.onChange('ask');
  h.draw();

  await h.one(label('Start')).props.onClick();
  h.draw();

  const dialog = h.one((n: any) => n.props?.['aria-label'] === 'Where should the agent work?');
  assert.ok(dialog);

  events.length = 0;
  await h.one(label('Make a new folder')).props.onClick();
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(events, [
    ['makeTaskFolder', 'Build my app'],
    ['rpc', 'project.open', { path: '/path/to/make-folder' }],
    ['switchProject', 'p-new'],
    ['rpc', 'session.launch', {
      project_id: 'p-new',
      engine_id: 'codex',
      prompt: 'Build my app',
      model: 'o3-mini',
      approval: 'ask',
    }],
  ]);

  g.ui.projectId = null;
  h.draw();
  h.one(label('Task for a new agent')).props.onChange('Build my app');
  h.draw();
  await h.one(label('Start')).props.onClick();
  h.draw();

  events.length = 0;
  await h.one(label('Choose a folder')).props.onClick();
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(events, [
    ['pickFolder'],
    ['rpc', 'project.open', { path: '/path/to/pick-folder' }],
    ['switchProject', 'p-new'],
    ['rpc', 'session.launch', {
      project_id: 'p-new',
      engine_id: 'codex',
      prompt: 'Build my app',
      model: 'o3-mini',
      approval: 'ask',
    }],
  ]);

  g.ui.projectId = null;
  h.draw();
  h.one(label('Task for a new agent')).props.onChange('Build my app');
  h.draw();
  await h.one(label('Start')).props.onClick();
  h.draw();

  g.api.pickFolder = async () => {
    events.push(['pickFolder']);
    return null;
  };
  events.length = 0;
  await h.one(label('Choose a folder')).props.onClick();
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(events, [
    ['pickFolder'],
  ]);
});

test('Home shows with no project: homeView.shown is true and renderStart keeps #start hidden', () => {
  const homeJs = readFileSync(resolve(import.meta.dirname, '../renderer/home.js'), 'utf8');
  const appJs = readFileSync(resolve(import.meta.dirname, '../renderer/app.js'), 'utf8');

  const fn = (name: string, code = appJs) => {
    const match = code.match(new RegExp(`^(?:async )?function ${name}\\([^]*?\\r?\\n}`, 'm'));
    assert.ok(match, 'real renderer function exists: ' + name);
    return match[0];
  };

  const startEl = { hidden: false, innerHTML: '' };
  const mockDoc = {
    getElementById: (id: string) => (id === 'start' ? startEl : id === 'home' || id === 'centre' ? { hidden: true } : null),
    querySelectorAll: () => [],
    addEventListener: () => {},
  };

  const testUi: any = {
    view: 'home',
    projectId: null,
    snap: { projects: [], sessions: [], live: [], engines: [], needs_you: [] },
  };

  new Function('ui', 'document', 'project', 'esc', 'setHtml', homeJs)(testUi, mockDoc, () => null, (s: any) => s, () => {});

  testUi.view = 'home';
  assert.equal(globalThis.homeView.shown(), true);

  testUi.view = 'wall';
  assert.equal(globalThis.homeView.shown(), false);

  const renderStartFn = new Function('ui', 'project', 'document', 'setHtml', 'esc', 'shortPath', 'engineTip',
    fn('renderStart') + '\nreturn renderStart;'
  )(testUi, () => null, mockDoc, (id: string, html: string) => { if (id === 'start') startEl.innerHTML = html; }, (s: any) => s, (p: string) => p, () => '');

  testUi.view = 'home';
  startEl.hidden = false;
  renderStartFn();
  assert.equal(startEl.hidden, true);

  testUi.view = 'wall';
  startEl.hidden = true;
  renderStartFn();
  assert.equal(startEl.hidden, false);
});
