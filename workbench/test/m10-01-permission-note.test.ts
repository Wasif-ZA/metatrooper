import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import * as chatModel from '../ui/src/chat-model.js';

const { approvalInput } = chatModel;

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm10-01-'));
const previousHome = process.env.METATROOPER_HOME;
process.env.METATROOPER_HOME = join(temp, 'home');
after(() => {
  rmSync(temp, { recursive: true, force: true });
  if (previousHome === undefined) delete process.env.METATROOPER_HOME;
  else process.env.METATROOPER_HOME = previousHome;
});

const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');

async function bundle(contents: string, output: string) {
  try {
    await build({
      absWorkingDir: join(wb, 'ui'),
      tsconfigRaw: {},
      stdin: { contents, resolveDir: join(wb, 'ui'), loader: 'jsx' },
      plugins: [{
        name: 'installed-ui-modules',
        setup(b: any) {
          b.onResolve({ filter: /.*/ }, (args: any) => {
            if (args.path.endsWith('.css')) return { path: args.path, namespace: 'empty-css' };
            if (args.path === 'react-dom/client') return { path: args.path, namespace: 'mount-spy' };
            if (!args.path.startsWith('.')) return { path: pathToFileURL(requireUI.resolve(args.path)).href, external: true };
            return { path: resolve(args.namespace === 'screen' ? dirname(args.importer) : join(wb, 'ui'), args.path), namespace: 'screen' };
          });
          b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
          b.onLoad({ filter: /.*/, namespace: 'mount-spy' }, () => ({ contents: 'export const createRoot = globalThis.__axCreateRoot;', loader: 'js' }));
          b.onLoad({ filter: /.*/, namespace: 'screen' }, (args: any) => ({
            contents: `import { createElement as __create, Fragment as __fragment } from 'react'; function __element(...args) { const node = __create(...args); globalThis.__axCapture?.(node); return node; }\n` + readFileSync(args.path, 'utf8'),
            loader: args.path.endsWith('.jsx') ? 'jsx' : 'js',
          }));
        },
      }],
      bundle: true,
      platform: 'node',
      format: 'esm',
      jsx: 'transform',
      jsxFactory: '__element',
      jsxFragment: '__fragment',
      loader: { '.css': 'empty' },
      outfile: join(temp, output),
    });
  } catch (error: any) {
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
      const child = spawn(binary, [
        entry,
        '--bundle',
        '--platform=node',
        '--format=esm',
        '--jsx=transform',
        '--jsx-factory=__element',
        '--jsx-fragment=__fragment',
        '--inject:' + helper,
        '--alias:react-dom/client=' + mount,
        '--loader:.css=empty',
        '--banner:js=import { createRequire as __axRequire } from "node:module"; const require = __axRequire(import.meta.url);',
        '--outfile=' + join(temp, output),
      ], { stdio: 'inherit', windowsHide: true });
      child.on('error', reject);
      child.on('exit', (code) => code === 0 ? resolveBuild() : reject(new Error('esbuild exited ' + code)));
    });
  }
}

await bundle("export * from './src/home.jsx'; export { Chat, useChat } from './src/chat.jsx'; export * from './src/chat-model.js'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", 'screens.mjs');

const screens = await import(pathToFileURL(join(temp, 'screens.mjs')).href);
const { React, renderToStaticMarkup, Chat } = screens;

const g: any = globalThis;
const calls: any[] = [];
const own = new Set(['Inbox', 'Glyph', 'NoteActions', 'DetailAsk', 'DetailNotice', 'TerminalPreview', 'Addons', 'Home', 'TaskPanel', 'RailCard', 'ChatFixture', 'Chat', 'ToolSteps', 'ToolRow', 'EditCard', 'Approval', 'AutomationsPage', 'TemplateCards', 'AutomationEditor', 'StartBox', 'Tile', 'AgentCard', 'AgentHead', 'PluginInstall', 'Automations', 'Field', 'Screen', 'CheckCommand']);

function harness(Screen: any, runEffects = false) {
  const frames = new Map<string, any[]>();
  let nodes: any[] = [];
  function expand(value: any, path: string): any {
    if (Array.isArray(value)) return value.map((v, i) => expand(v, path + '/' + i));
    if (!React.isValidElement(value)) return value;
    nodes.push(value);
    if (typeof value.type === 'function' && own.has(value.type.name)) {
      const slots = frames.get(path) || [];
      frames.set(path, slots);
      let cursor = 0;
      let rerender = false;
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H;
      internals.H = {
        useEffect: (fn: any) => { if (runEffects) { const i = cursor++; if (!slots[i]) { slots[i] = true; queueMicrotask(fn); } } },
        useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
        useRef: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useLayoutEffect: () => {},
        useCallback: (fn: any) => { cursor++; return fn; },
        useMemo: (fn: any) => { cursor++; return fn(); },
        useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (v: any) => { const next = typeof v === 'function' ? v(slots[i]) : v; if (!Object.is(next, slots[i])) { slots[i] = next; rerender = true; } }]; },
      };
      let output;
      try {
        let renders = 0;
        do {
          assert.ok(renders++ < 25, 'render-phase state updates settle');
          cursor = 0;
          rerender = false;
          output = value.type(value.props);
        } while (rerender);
      } finally {
        internals.H = previous;
      }
      return expand(output, path + '/render');
    }
    const props: any = { key: value.key ?? path };
    for (const [key, v] of Object.entries(value.props)) {
      if (React.isValidElement(v) || Array.isArray(v)) props[key] = expand(v, path + '/' + key);
    }
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

const label = (text: string) => (n: any) => n.props.label === text;
function session(id: string, state: string, extra: any = {}) {
  return { id, state, project_id: 'p1', engine_id: 'synthetic', title: 'Task ' + id, ...extra };
}

beforeEach(() => {
  calls.length = 0;
  Object.assign(g, {
    ui: { view: 'home', projectId: 'p1', pendingHide: new Set(), drafts: {}, look: { theme: { name: 'neutral', scheme: 'dark' } }, snap: { sessions: [], live: [], approvals: [], needs_you: [], engines: [], projects: [{ id: 'p1', name: 'Alpha' }] } },
    api: {},
    troop: { termInput: async (...args: any[]) => { calls.push(['input', ...args]); return false; } },
    toast: (...args: any[]) => calls.push(['toast', ...args]),
  });
});

test('terminal-only session waiting on a permission shows the answer-in-terminal line', () => {
  const x = { id: 's1', engine_id: 'codex', state: 'waiting_for_you', reason: 'permission' };
  const chat = { engine_id: 'codex', source: 'terminal', items: [] };
  function ChatFixture() { return React.createElement(Chat, { x, chat }); }
  const html = harness(ChatFixture).html();
  const occurrences = (html.match(/This agent asks for permission\. Answer in its terminal\./g) || []).length;
  assert.equal(occurrences, 1);
});

test('the line is absent when the session is working or waits for another reason', () => {
  const sentence = 'This agent asks for permission. Answer in its terminal.';
  const chat = { engine_id: 'codex', source: 'terminal', items: [] };

  const cases = [
    { id: 's1', engine_id: 'codex', state: 'working', reason: null },
    { id: 's1', engine_id: 'codex', state: 'working', reason: 'permission' },
    { id: 's1', engine_id: 'codex', state: 'waiting_for_you', reason: null },
    { id: 's1', engine_id: 'codex', state: 'waiting_for_you', reason: 'stopped: error' },
  ];

  for (const x of cases) {
    function ChatFixture() { return React.createElement(Chat, { x, chat }); }
    const html = harness(ChatFixture).html();
    assert.equal(html.includes(sentence), false, `sentence must be absent for state=${x.state} reason=${x.reason}`);
  }
});

test('a Claude chat keeps Allow and Deny and never shows the line', () => {
  const sentence = 'This agent asks for permission. Answer in its terminal.';
  const x = session('chat', 'waiting_for_you', { engine_id: 'claude', reason: 'permission' });
  const chat = { source: 'transcript', engine_id: 'claude', items: [{ kind: 'tool', id: 'ask', name: 'Bash', label: 'Ran npm test', status: 'waiting' }] };
  function ChatFixture() { return React.createElement(Chat, { x, chat }); }
  const h = harness(ChatFixture);
  const html = h.html();

  assert.ok(h.one(label('Allow')), 'Allow button renders');
  assert.ok(h.one(label('Deny')), 'Deny button renders');
  assert.match(html, />Allow</);
  assert.match(html, />Deny</);
  assert.equal(html.includes(sentence), false, 'sentence does not render');
});

test('approvalInput stays null for every engine but claude', () => {
  for (const engine of ['codex', 'agy', 'gemini', 'opencode']) {
    assert.equal(approvalInput(engine, true), null, `${engine} allow returns null`);
    assert.equal(approvalInput(engine, false), null, `${engine} deny returns null`);
  }
  assert.equal(approvalInput('claude', true), '1', 'claude allow returns 1');
  assert.equal(approvalInput('claude', false), '\x1b', 'claude deny returns \\x1b');
});

test('PERMISSION_TERMINAL_NOTE is the exact sentence', () => {
  const note = (chatModel as any).PERMISSION_TERMINAL_NOTE ?? (screens as any).PERMISSION_TERMINAL_NOTE;
  assert.equal(note, 'This agent asks for permission. Answer in its terminal.');
});
