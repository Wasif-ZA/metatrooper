import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { checkWorkspace, changeWorkspace, undoWorkspace, usualWorkspace, exampleNames } from '../../core/src/workspace.ts';
import { schemaFile } from '../../core/src/paths.ts';

const ui = fileURLToPath(new URL('../ui/', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm8-workspace-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(ui, 'package.json'));
const { build } = requireUI('esbuild');
const exports = 'Pane, WorkspaceBanner, workspaceKey, wsStore';
try { await build({
  stdin: { contents: `export { ${exports} } from './src/workspace.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';`, resolveDir: ui, loader: 'jsx' },
  absWorkingDir: ui, tsconfigRaw: {}, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
  loader: { '.css': 'empty' }, outfile: join(temp, 'ws.mjs'),
  plugins: [{ name: 'installed-dependencies', setup(b: any) {
    b.onResolve({ filter: /^[^./]|^@/ }, (args: any) => ({ path: pathToFileURL(requireUI.resolve(args.path)).href, external: true }));
  } }],
}); } catch (error: any) {
  if (error.code !== 'EPERM' || process.platform !== 'win32') throw error;
  const entry = join(temp, 'entry.jsx');
  writeFileSync(entry, `export { ${exports} } from ${JSON.stringify(join(ui, 'src/workspace.jsx'))}; export * as React from ${JSON.stringify(requireUI.resolve('react'))}; export { renderToStaticMarkup } from ${JSON.stringify(requireUI.resolve('react-dom/server'))};`);
  const binary = join(dirname(requireUI.resolve('esbuild/package.json')), '../@esbuild/win32-x64/esbuild.exe');
  await new Promise<void>((resolveBuild, reject) => {
    const child = spawn(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--loader:.css=empty', '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);', '--outfile=' + join(temp, 'ws.mjs')], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolveBuild() : reject(new Error('esbuild exited ' + code)));
  });
}
const { Pane, WorkspaceBanner, workspaceKey, wsStore, React, renderToStaticMarkup } = await import(pathToFileURL(join(temp, 'ws.mjs')).href);

const examples = fileURLToPath(new URL('../ui/src/workspaces/', import.meta.url));
const example = (name: string) => JSON.parse(readFileSync(join(examples, name + '.json'), 'utf8'));
const leaves = (n: any): number => n.split ? n.children.reduce((a: number, c: any) => a + leaves(c), 0) : 1;
const stubs: Record<string, string> = { explorer: 'EXPLORER', editor: 'EDITOR', terminal: 'TERMINAL', wall: 'WALL' };
const named = (n: any, out = new Set<string>()): Set<string> => { if (n.split) n.children.forEach((c: any) => named(c, out)); else out.add(n.view); return out; };
(globalThis as any).ui = { snap: { sessions: [] } };

function harness(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'm8-11-workspace-'));
  const prev = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = dir;
  const db = new DatabaseSync(join(dir, 'fixture.db'));
  t.after(() => {
    db.close();
    if (prev === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prev;
    rmSync(dir, { recursive: true, force: true });
  });
  db.exec(readFileSync(schemaFile, 'utf8'));
  db.exec(readFileSync(new URL('../../core/src/store/migrations/021-ui-surface.sql', import.meta.url), 'utf8'));
  const at = '2026-11-14T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project', dir, 'Synthetic', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('fake', '{}', 1, 'local-cli');
  db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('session-abcdef', 'project', 'fake', 'pty', 'idle', at, at);
  const set = (workspace: unknown) => changeWorkspace(db, { session_id: 'session-abcdef', op: 'set', workspace });
  const op = (o: string, name?: string) => changeWorkspace(db, { session_id: 'session-abcdef', op: o, name });
  return { set, op };
}

test('each of the four example layouts applies', () => {
  for (const name of ['dev', 'video', 'bakery', 'revise']) {
    const json = example(name);
    assert.deepEqual(checkWorkspace(json, () => false), [], name);
    const html = renderToStaticMarkup(React.createElement(Pane, { node: json.layout, views: stubs, pid: 'p1' }));
    assert.equal(html.match(/class="ou-ws-pane"/g)?.length, leaves(json.layout), `${name} panes`);
    for (const v of named(json.layout)) if (stubs[v]) assert.ok(html.includes(stubs[v]), `${name} shows ${v}`);
  }
});

test('Undo restores the last layout and My usual the default, one key each', t => {
  const calls: any[] = [];
  (globalThis as any).api = { call: async (method: string, params: any) => { calls.push([method, params]); return { kind: 'reply', reply: { result: { project_id: 'p1', current: null, undo: 0, last: null } } }; } };
  const state = () => wsStore.set({ pid: 'p1', seenAt: null, ws: { project_id: 'p1', current: example('dev'), undo: 1, last: { applied: true, at: 't', setter: 'claude (abc)', asked: '', reasons: [] } } });
  const key = (over: any, target: any = { closest: () => null }) => workspaceKey({ ctrlKey: false, altKey: false, shiftKey: false, key: '', target, preventDefault: () => {}, ...over });
  state();
  assert.equal(key({ ctrlKey: true, altKey: true, key: '0' }), true);
  assert.deepEqual(calls.at(-1), ['workspace.usual', { project_id: 'p1' }]);
  state();
  assert.equal(key({ ctrlKey: true, key: 'z' }), true);
  assert.deepEqual(calls.at(-1), ['workspace.undo', { project_id: 'p1' }]);
  state();
  const before = calls.length;
  assert.equal(key({ ctrlKey: true, key: 'z' }, { closest: () => ({}) }), false);
  assert.equal(calls.length, before);

  const h = harness(t);
  const dev = example('dev'), video = example('video');
  h.set(dev);
  h.set(video);
  assert.deepEqual(undoWorkspace('project').current, dev);
  assert.equal(usualWorkspace('project').current, null);
});

// A full Electron render of Ide() is out of scope; the gate and status bar are checked in the source.
test('a waiting gate shows with the agent panel hidden', () => {
  const src = readFileSync(new URL('../ui/src/ide.jsx', import.meta.url), 'utf8');
  const start = src.indexOf('if (layout) {');
  assert.ok(start > 0);
  const block = src.slice(start, src.indexOf('\n  }\n', start));
  assert.ok(block.includes('<Asks st={st} />'));
  assert.ok(block.includes('<StatusBar'));
  assert.ok(block.includes('<WorkspaceBanner />'));
  wsStore.set({ pid: 'p1', seenAt: null, ws: { project_id: 'p1', current: null, undo: 0, last: { applied: false, at: 't2', setter: 'claude (abc)', asked: '', reasons: ['a pane is empty'] } } });
  wsStore.use = () => wsStore.get(); // the store has no server snapshot, so read it directly while rendering to a string
  const html = renderToStaticMarkup(React.createElement(WorkspaceBanner));
  assert.ok(html.includes('could not be built'));
  assert.ok(html.includes('a pane is empty'));
});

test('all 8 persona layouts load', t => {
  const personas = ['analyst', 'editor', 'engineer', 'researcher', 'shop', 'student', 'website', 'writer'].map(p => 'persona-' + p);
  const have = exampleNames();
  const h = harness(t);
  for (const name of personas) {
    assert.ok(have.includes(name), name);
    const r = h.op('example', name);
    assert.equal(r.last?.applied, true, name);
    assert.equal(r.current?.name, example(name).name, name);
  }
  assert.throws(() => h.op('example', 'no-such-layout'), { code: -32002 });
});
