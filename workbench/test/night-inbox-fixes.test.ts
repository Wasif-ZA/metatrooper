import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'night-inbox-fixes-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(wb, 'ui/package.json'));
// The CLI with inherited handles also works where Windows denies child pipe creation.
// Keep installed UI packages external, as the neighboring screen tests do.
const entry = join(temp, 'entry.jsx'), bundle = join(temp, 'screens.mjs');
writeFileSync(entry, ['inbox'].map(name => `export * from ${JSON.stringify(join(wb, 'ui/src', name + '.jsx').replace(/\\/g, '/'))};`).join('\n') + "\nexport * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';");
const platform = process.platform === 'win32' ? 'win32-' + process.arch : process.platform + '-' + process.arch;
const binary = requireUI.resolve('@esbuild/' + platform + (process.platform === 'win32' ? '/esbuild.exe' : '/bin/esbuild'));
const built = spawnSync(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--packages=external', '--log-level=error', '--outfile=' + bundle], { stdio: 'inherit', windowsHide: true });
assert.ifError(built.error); assert.equal(built.status, 0, 'screen bundle builds');
writeFileSync(bundle, readFileSync(bundle, 'utf8').replace(/from "([^"\n]+)"/g, (all, specifier) => specifier.startsWith('.') || specifier.startsWith('node:') ? all : 'from ' + JSON.stringify(pathToFileURL(requireUI.resolve(specifier)).href)));
const { React, renderToStaticMarkup, Inbox, inboxStore, findServiceUrl } = await import(pathToFileURL(join(temp, 'screens.mjs')).href);
const g: any = globalThis;
const calls: any[] = [];
const own = new Set(['Inbox', 'DetailAsk', 'DetailNotice', 'TerminalPreview', 'NoteActions']);

// Match the neighboring screen harness, including dependency changes and effect cleanup.
function harness(Screen: any) {
  const frames = new Map<string, any[]>();
  let nodes: any[] = [];
  let effects: Function[] = [];
  function expand(value: any, path: string): any {
    if (Array.isArray(value)) return value.map((v, i) => expand(v, path + '/' + (v?.key ?? i)));
    if (!React.isValidElement(value)) return value;
    nodes.push(value);
    if (typeof value.type === 'function' && own.has(value.type.name)) {
      const key = path + '/' + value.type.name + ':' + (value.key ?? '');
      const slots = frames.get(key) || []; frames.set(key, slots);
      let cursor = 0;
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H;
      internals.H = {
        useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
        useState: (initial: any) => {
          const i = cursor++;
          if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
          return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }];
        },
        useEffect: (fn: Function, deps: any[]) => {
          const i = cursor++, old = slots[i];
          if (!old || !deps || deps.length !== old.deps.length || deps.some((d, j) => !Object.is(d, old.deps[j]))) {
            effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
          }
        },
      };
      let output;
      try { output = value.type(value.props); } finally { internals.H = previous; }
      return expand(output, key + '/render');
    }
    const props: any = { key: value.key ?? path };
    for (const [key, v] of Object.entries(value.props)) {
      if (React.isValidElement(v) || Array.isArray(v)) props[key] = expand(v, path + '/' + key);
    }
    return React.cloneElement(value, props);
  }
  const draw = () => {
    nodes = []; effects = [];
    const tree = expand(React.createElement(Screen), 'root');
    for (const effect of effects) effect();
    return tree;
  };
  return { draw, html: () => renderToStaticMarkup(draw()), all: (predicate: any) => nodes.filter(predicate) };
}
let rpcReply: (method: string) => any = () => ({ result: {} });
beforeEach(() => {
  calls.length = 0;
  rpcReply = () => ({ result: {} });
  Object.assign(g, {
    ui: { view: 'inbox', projectId: 'p1', drafts: {}, snap: { sessions: [], live: [], approvals: [], needs_you: [], engines: [{ id: 'claude', light: 'green' }, { id: 'codex', light: 'green' }], projects: [{ id: 'p1', name: 'Alpha' }] } },
    rpc: async (method: string, params: any) => { calls.push([method, params]); return rpcReply(method); },
    toast: (...args: any[]) => calls.push(['toast', ...args]),
    waitingAll: () => g.ui.snap.live.filter((s: any) => s.state === 'waiting_for_you'),
    isInfo: () => false, taskOf: (s: any) => s.title || 'filler task', ago: () => '1m ago', openTermLink: () => {},
  });
  inboxStore.set({ filter: 'all', selectedId: null, collapsed: [] });
});
const session = (extra: any = {}) => ({ id: 's1', project_id: 'p1', engine_id: 'claude', state: 'waiting_for_you', state_at: '2026-11-10T00:00:00Z', started_at: '2026-11-10T00:00:00Z', title: 'terminal title', labels: [], prompt: null, ...extra });
const handSelector = (h: any) => h.all((n: any) => n.props?.label === 'Hand to another agent')[0];
const settle = () => new Promise((r) => setImmediate(r));

test('hand-over is disabled with a reason when the original task was not recorded', () => {
  g.ui.snap.live = [session()];
  inboxStore.set({ selectedId: 's1' });
  const h = harness(Inbox); h.draw();
  const sel = handSelector(h);
  assert.equal(sel.props.isDisabled, true);
  assert.match(sel.props.disabledMessage, /original task was not recorded/);
});

test('hand-over launches with the stored prompt and keeps the details pane open', async () => {
  g.ui.snap.live = [session({ prompt: 'fix the login bug' })];
  inboxStore.set({ selectedId: 's1' });
  rpcReply = (m) => (m === 'session.launch' ? { result: { session_id: 's2' } } : { result: {} });
  const h = harness(Inbox); h.draw();
  const sel = handSelector(h);
  assert.equal(sel.props.isDisabled, false);
  sel.props.onChange('codex');
  h.draw();
  const dialog = h.all((n: any) => n.props?.actionLabel === 'Hand over')[0];
  await dialog.props.onAction();
  assert.deepEqual(calls.find((c) => c[0] === 'session.launch')[1], { project_id: 'p1', engine_id: 'codex', prompt: 'fix the login bug' });
  assert.equal(inboxStore.get().selectedId, 's1');
  h.draw();
  assert.equal(h.all((n: any) => n.props?.className === 'ou-ipane').length, 1);
});

test('Service link accepts only bare local hosts and takes the newest one', () => {
  assert.equal(findServiceUrl('Local: http://localhost:3000@evil.example/x'), null);
  assert.equal(findServiceUrl('http://user:pw@localhost:3000/'), null);
  assert.equal(findServiceUrl('http://localhost.evil.example:3000/'), null);
  assert.equal(findServiceUrl('old http://localhost:3000/ then new http://127.0.0.1:5173/app'), 'http://127.0.0.1:5173/app');
  assert.equal(findServiceUrl('listening on http://0.0.0.0:8080'), 'http://localhost:8080/');
  assert.equal(findServiceUrl('no server here'), null);
});

test('label add and remove are undone when the core refuses them', async () => {
  const s1 = session({ labels: ['keep'] });
  g.ui.snap.live = [s1];
  inboxStore.set({ selectedId: 's1' });
  rpcReply = (m) => (m === 'session.labels-set' ? { error: { code: -32602, message: 'label refused' } } : { result: {} });
  const h = harness(Inbox); h.draw();
  h.all((n: any) => n.props?.['aria-label'] === 'Remove label keep')[0].props.onClick({ stopPropagation() {} });
  assert.deepEqual(s1.labels, []);
  await settle();
  assert.deepEqual(s1.labels, ['keep']);
  assert.ok(calls.some((c) => c[0] === 'toast' && c[1] === 'label refused'));
  h.all((n: any) => n.props?.['aria-label'] === 'Add label')[0].props.onClick();
  h.draw();
  const input = h.all((n: any) => n.props?.placeholder === 'Label, Enter adds')[0];
  input.props.onChange('new');
  h.draw();
  await h.all((n: any) => n.props?.placeholder === 'Label, Enter adds')[0].props.onEnter();
  assert.deepEqual(s1.labels, ['keep']);
  assert.equal(calls.filter((c) => c[0] === 'session.labels-set').length, 2);
});

test('Escape inside a dialog or text field does not clear the selection; elsewhere it does', () => {
  g.ui.snap.live = [session()];
  inboxStore.set({ selectedId: 's1' });
  const h = harness(Inbox); h.draw();
  const root = h.all((n: any) => n.props?.className === 'ou-inbox')[0];
  const escape = (inside: string | null) => root.props.onKeyDown({ key: 'Escape', preventDefault() {}, target: { closest: (sel: string) => (inside && sel.includes(inside) ? {} : null) } });
  for (const inside of ['[role="alertdialog"]', '[role="dialog"]', 'input', 'textarea']) {
    escape(inside);
    assert.equal(inboxStore.get().selectedId, 's1', inside);
  }
  escape(null);
  assert.equal(inboxStore.get().selectedId, null);
});
