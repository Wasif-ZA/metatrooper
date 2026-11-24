import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm8-f17e-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(wb, 'ui/package.json'));
const entry = join(temp, 'entry.jsx'), bundle = join(temp, 'screens.mjs');
writeFileSync(entry, `export * from ${JSON.stringify(join(wb, 'ui/src/inbox.jsx').replace(/\\/g, '/'))};\nexport * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';`);
const platform = process.platform === 'win32' ? 'win32-' + process.arch : process.platform + '-' + process.arch;
const binary = requireUI.resolve('@esbuild/' + platform + (process.platform === 'win32' ? '/esbuild.exe' : '/bin/esbuild'));
const built = spawnSync(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--packages=external', '--log-level=error', '--outfile=' + bundle], { stdio: 'inherit', windowsHide: true });
assert.ifError(built.error); assert.equal(built.status, 0, 'screen bundle builds');
writeFileSync(bundle, readFileSync(bundle, 'utf8').replace(/from "([^"\n]+)"/g, (all, specifier) => specifier.startsWith('.') || specifier.startsWith('node:') ? all : 'from ' + JSON.stringify(pathToFileURL(requireUI.resolve(specifier)).href)));
const { React, renderToStaticMarkup, Inbox, inboxStore, motionOn, leaveRow } = await import(pathToFileURL(bundle).href);
const g: any = globalThis;
const calls: any[] = [];
const own = new Set(['Inbox', 'DetailAsk', 'DetailNotice', 'TerminalPreview', 'NoteActions']);

function harness(Screen: any) {
  const frames = new Map<string, any[]>();
  let nodes: any[] = [];
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
        useSyncExternalStore: (_s: any, snapshot: any) => snapshot(),
        useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
        useEffect: (fn: any) => { cursor++; if (g.runEffects) fn(); },
      };
      let output;
      try { output = value.type(value.props); } finally { internals.H = previous; }
      return expand(output, key + '/render');
    }
    const props: any = { key: value.key ?? path };
    for (const [k, v] of Object.entries(value.props)) if (React.isValidElement(v) || Array.isArray(v)) props[k] = expand(v, path + '/' + k);
    return React.cloneElement(value, props);
  }
  const draw = () => { nodes = []; return expand(React.createElement(Screen), 'root'); };
  return { draw, html: () => renderToStaticMarkup(draw()), all: (p: any) => nodes.filter(p), one: (p: any) => { const f = nodes.find(p); assert.ok(f, 'rendered control exists'); return f; } };
}
const text = (n: any): string => n == null || typeof n === 'boolean' ? '' : Array.isArray(n) ? n.map(text).join('') : React.isValidElement(n) ? text(n.props.children) : String(n);
const hasClass = (c: string) => (n: any) => typeof n.props.className === 'string' && n.props.className.split(' ').includes(c);
const label = (s: string) => (n: any) => n.props.label === s;
const prop = (h: any, name: string) => h.all(hasClass('ou-ny-prop')).find((n: any) => text(n.props.children[0]) === name);
const settle = () => new Promise((r) => setImmediate(r));
let reply: (method: string) => any = () => ({ result: {} });
const sent = (method: string) => calls.filter((c) => c[0] === method).map((c) => c[1]);

beforeEach(() => {
  calls.length = 0;
  reply = () => ({ result: {} });
  Object.assign(g, {
    ui: { view: 'inbox', projectId: 'p1', snap: { sessions: [], live: [], approvals: [], needs_you: [], automations: [{ id: 'a1', name: 'nightly tests' }], engines: [{ id: 'claude', light: 'green' }, { id: 'codex', light: 'green' }], projects: [{ id: 'p1', name: 'Alpha' }] } },
    rpc: async (method: string, params: any) => { calls.push([method, params]); return reply(method); },
    toast: (...args: any[]) => calls.push(['toast', ...args]),
    waitingAll: () => g.ui.snap.live.filter((s: any) => s.state === 'waiting_for_you'),
    isInfo: () => false, taskOf: (s: any) => s.title, ago: () => '1m ago', openTermLink: () => {},
  });
  g.runEffects = false;
  inboxStore.set({ selectedId: null, collapsed: [], props: true });
});
const s = (id: string, extra: any = {}) => ({ id, project_id: 'p1', engine_id: 'claude', state: 'working', state_at: '2026-11-10T00:00:00Z', title: 'Task ' + id, labels: [], prompt: 'do ' + id, ...extra });

const rv = (who: string) => ({ kind: 'reviewer', who, state: 'pending', note: null, review_session_id: null });
const open = (engines: any[], extra: any = {}) => {
  g.ui.snap.engines = engines; g.ui.snap.live = [s('s1', extra)]; inboxStore.set({ selectedId: 's1' });
  const h = harness(Inbox); h.draw(); return h;
};
const noSecond = (h: any) => h.all((n: any) => n.props?.['data-no-second'] === '1' && text(n.props.children) === 'No second engine installed');

test('only the session own engine ready, others red or absent: says so, offers no picker, starts nothing', async () => {
  const h = open([{ id: 'claude', light: 'green' }, { id: 'codex', light: 'red' }]);
  assert.equal(noSecond(h).length, 1);
  assert.equal(h.all(label('Add reviewer')).length, 0);
  assert.match(text(prop(h, 'Reviewers')), /No second engine installed/);
  await settle();
  assert.deepEqual(sent('session.reviewers-set'), []);
});

test('no engines at all: says so, offers no picker, starts nothing', async () => {
  const h = open([]);
  assert.equal(noSecond(h).length, 1);
  assert.equal(h.all(label('Add reviewer')).length, 0);
  await settle();
  assert.deepEqual(sent('session.reviewers-set'), []);
});

test('another engine ready: the picker offers it and not the session own engine, and picking it sets it as reviewer', async () => {
  const h = open([{ id: 'claude', light: 'green' }, { id: 'codex', light: 'green' }, { id: 'gemini', light: 'red' }]);
  assert.equal(noSecond(h).length, 0);
  const picker = h.one(label('Add reviewer'));
  assert.deepEqual(picker.props.options.map((o: any) => o.value), ['', 'codex']);
  picker.props.onChange('codex'); await settle();
  assert.deepEqual(sent('session.reviewers-set'), [{ session_id: 's1', reviewers: ['codex'], approvers: [] }]);
});
