import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire, stripTypeScriptTypes } from 'node:module';
import { usdFor } from '../../core/src/meter.ts';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm8-f17b-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(wb, 'ui/package.json'));
const entry = join(temp, 'entry.jsx'), bundle = join(temp, 'screens.mjs');
writeFileSync(entry, `export * from ${JSON.stringify(join(wb, 'ui/src/inbox.jsx').replace(/\\/g, '/'))};\nexport * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';`);
const platform = process.platform === 'win32' ? 'win32-' + process.arch : process.platform + '-' + process.arch;
const binary = requireUI.resolve('@esbuild/' + platform + (process.platform === 'win32' ? '/esbuild.exe' : '/bin/esbuild'));
const built = spawnSync(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--packages=external', '--log-level=error', '--outfile=' + bundle], { stdio: 'inherit', windowsHide: true });
assert.ifError(built.error); assert.equal(built.status, 0, 'screen bundle builds');
writeFileSync(bundle, readFileSync(bundle, 'utf8').replace(/from "([^"\n]+)"/g, (all, specifier) => specifier.startsWith('.') || specifier.startsWith('node:') ? all : 'from ' + JSON.stringify(pathToFileURL(requireUI.resolve(specifier)).href)));
const { React, renderToStaticMarkup, Inbox, inboxStore, reviewCostText } = await import(pathToFileURL(bundle).href);
const g: any = globalThis;
const calls: any[] = [];
const own = new Set(['Inbox', 'DetailAsk', 'DetailNotice', 'TerminalPreview', 'NoteActions', 'ReviewCost']);

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


// 1. the text
test('reviewCostText: every branch is labelled (estimate)', () => {
  assert.equal(reviewCostText({ tokens: 20000, usd: 0.06 }, 'codex'), 'codex review: about $0.06 (estimate)');
  assert.equal(reviewCostText({ tokens: 100, usd: 0.0003 }, 'codex'), 'codex review: about under $0.01 (estimate)');
  assert.equal(reviewCostText({ tokens: 20000, usd: null }, 'codex'), 'codex review: about 20k tokens, no price known (estimate)');
  assert.equal(reviewCostText({ error: 'x' }, 'codex'), 'codex review: cost not known (estimate)');
  assert.equal(reviewCostText(null, 'codex'), 'codex review: cost not known (estimate)');
  for (const r of [{ tokens: 5, usd: 1.234 }, { tokens: 5, usd: null }, { tokens: 5, usd: 0 }, { error: 'e' }, null]) assert.match(reviewCostText(r, 'codex'), /\(estimate\)$/);
});

// 2. the IPC handler with injected deps
function ipc(o: { cwd?: string | null; changes?: any; diff?: string; model?: string | null }) {
  const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const registration = source.match(/  on\('reviewEstimate', async[^]*?\n  \}\);/)?.[0];
  assert.ok(registration, 'reviewEstimate IPC registration must exist');
  let handler: (s: unknown, e: unknown) => Promise<any> = async () => null;
  const asked: any[] = [];
  const deps = {
    on: (name: string, cb: typeof handler) => { assert.equal(name, 'reviewEstimate'); handler = cb; },
    cwdOf: () => o.cwd === undefined ? temp : o.cwd,
    gitIn: () => async (args: string[]) => { assert.equal(args[0], 'diff'); assert.equal(args[1], 'BASE'); return o.diff ?? ''; },
    diffBase: async () => 'BASE',
    sessionChanges: async () => o.changes ?? { files: [], untracked: [] },
    fs, path, usdFor,
    db: () => ({ prepare: (sql: string) => ({ get: (...a: any[]) => { asked.push([sql, ...a]); return o.model ? { model: o.model } : undefined; } }) }),
  };
  new Function(...Object.keys(deps), stripTypeScriptTypes(registration))(...Object.values(deps));
  return { call: (e: unknown = 'codex') => handler('s1', e), asked };
}
const mk = (name: string, n: number) => { writeFileSync(join(temp, name), 'x'.repeat(n)); return name; };

test('IPC: tokens = ceil(chars/4) over the diff plus each changed file once, usd = tokens * 3 / 1e6 at the engine model input price', async () => {
  const a = mk('a.txt', 1000), b = mk('b.txt', 2001);
  const h = ipc({ diff: 'd'.repeat(500), changes: { files: [{ path: a }, { path: b }], untracked: [] }, model: 'claude-sonnet-5-5' });
  const r = await h.call();
  assert.equal(r.tokens, Math.ceil(3501 / 4));
  assert.equal(r.model, 'claude-sonnet-5-5');
  assert.equal(r.usd, r.tokens * 3 / 1e6);
  assert.equal(r.estimate, true);
  assert.equal(h.asked[0][1], 'codex');
});

test('IPC: a file both changed and untracked counts once; an untracked-only file counts', async () => {
  const a = mk('c.txt', 400), u = mk('u.txt', 40);
  const h = ipc({ diff: '', changes: { files: [{ path: a }], untracked: [a, u] }, model: 'claude-sonnet-5-5' });
  assert.equal((await h.call()).tokens, 110);
});

test('IPC: no usage row for the engine gives model null and usd null, tokens still counted', async () => {
  const a = mk('d.txt', 80);
  const r = await ipc({ diff: 'x'.repeat(20), changes: { files: [{ path: a }], untracked: [] }, model: null }).call();
  assert.equal(r.model, null); assert.equal(r.usd, null); assert.equal(r.tokens, 25);
});

test('IPC: no folder recorded, or a non-string engine, is an error', async () => {
  assert.match((await ipc({ cwd: null }).call()).error, /no folder/);
  assert.ok((await ipc({}).call(42)).error);
});

// 3. the inbox shows it before any review starts
test('inbox: the Reviewers prop shows the estimate for the offered engine before a review starts', async () => {
  const asked: any[] = [];
  g.api = { reviewEstimate: async (...a: any[]) => { asked.push(a); return { tokens: 20000, usd: 0.06 }; } };
  g.runEffects = true;
  const h = open([{ id: 'claude', light: 'green' }, { id: 'codex', light: 'green' }]);
  const shown = () => h.all((n: any) => n.props?.['data-review-cost'] === 'codex').map((n: any) => text(n.props.children)).pop();
  assert.equal(shown(), 'codex review: estimating');
  await settle(); await settle();
  h.draw();
  assert.deepEqual(asked[0], ['s1', 'codex']);
  assert.equal(shown(), 'codex review: about $0.06 (estimate)');
  assert.ok(prop(h, 'Reviewers'), 'inside the Reviewers prop area');
  assert.deepEqual(sent('session.reviewers-set'), []);
  delete g.api;
});

// 4. preload
test('preload exposes reviewEstimate invoking the reviewEstimate channel', () => {
  assert.match(readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8'), /reviewEstimate: \(sessionId, engineId\) => ipcRenderer\.invoke\('reviewEstimate', sessionId, engineId\)/);
});
