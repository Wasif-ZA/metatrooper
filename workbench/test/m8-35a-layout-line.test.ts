import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ui = fileURLToPath(new URL('../ui/', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm8-35a-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(ui, 'package.json'));
const { build } = requireUI('esbuild');
const exports = 'syncWorkspace, layoutLine, undoLayout, workspaceKey, wsStore';
try { await build({
  stdin: { contents: `export { ${exports} } from './src/workspace.jsx';`, resolveDir: ui, loader: 'jsx' },
  absWorkingDir: ui, tsconfigRaw: {}, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
  loader: { '.css': 'empty' }, outfile: join(temp, 'ws.mjs'),
  plugins: [{ name: 'installed-dependencies', setup(b: any) {
    b.onResolve({ filter: /^[^./]|^@/ }, (args: any) => ({ path: pathToFileURL(requireUI.resolve(args.path)).href, external: true }));
  } }],
}); } catch (error: any) {
  if (error.code !== 'EPERM' || process.platform !== 'win32') throw error;
  const entry = join(temp, 'entry.jsx');
  writeFileSync(entry, `export { ${exports} } from ${JSON.stringify(join(ui, 'src/workspace.jsx'))};`);
  const binary = join(dirname(requireUI.resolve('esbuild/package.json')), '../@esbuild/win32-x64/esbuild.exe');
  await new Promise<void>((resolveBuild, reject) => {
    const child = spawn(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--loader:.css=empty', '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);', '--outfile=' + join(temp, 'ws.mjs')], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolveBuild() : reject(new Error('esbuild exited ' + code)));
  });
}
const { syncWorkspace, layoutLine, undoLayout, workspaceKey, wsStore } = await import(pathToFileURL(join(temp, 'ws.mjs')).href);
(globalThis as any).ui = { snap: { sessions: [] } };

const ideSrc = readFileSync(join(ui, 'src/ide.jsx'), 'utf8');
const calls: string[] = [];
let reply: any = null;
(globalThis as any).api = { call: async (method: string) => { calls.push(method); return { kind: 'reply', reply: { result: reply } }; } };
const lay = (applied: boolean, at: string, extra: any = {}) => ({ usual: false, current: { name: 'dev' }, last: { applied, at }, undo: true, ...extra });
const sync = async (pid: string, ws: any) => { reply = ws; await syncWorkspace(pid, true); };
// the status bar's text, as ide.jsx builds it (checked against the source in the undo test)
const text = (l: any) => l && `layout: ${l.name} · ${l.n} ${l.n === 1 ? 'change' : 'changes'}${l.undo ? ' · Ctrl+Z' : ''}`;
const usual = { usual: true, current: null, last: null, undo: false };

test('no change yet and the usual layout shows: no layout line', async () => {
  await sync('p1', usual);
  await sync('p1', usual);
  assert.equal(layoutLine('p1', wsStore.get().ws), null);
  assert.equal(layoutLine('p1', null), null);
});

test('an applied change shows "layout: dev · 1 change · Ctrl+Z"; seeing it again does not double count', async () => {
  await sync('p2', lay(true, 't1'));
  assert.equal(text(layoutLine('p2', wsStore.get().ws)), 'layout: dev · 1 change · Ctrl+Z');
  await sync('p2', lay(true, 't1'));
  await sync('p2', lay(true, 't1'));
  assert.equal(layoutLine('p2', wsStore.get().ws)?.n, 1);
});

test('a second change counts 2; a refused change is not counted', async () => {
  await sync('p3', lay(true, 't1'));
  await sync('p3', lay(true, 't2'));
  assert.equal(text(layoutLine('p3', wsStore.get().ws)), 'layout: dev · 2 changes · Ctrl+Z');
  await sync('p3', lay(false, 't3'));
  assert.equal(layoutLine('p3', wsStore.get().ws)?.n, 2);
});

test('a refused change alone never shows the line on the usual layout', async () => {
  await sync('p3b', { ...usual, last: { applied: false, at: 't1' } });
  assert.equal(layoutLine('p3b', wsStore.get().ws), null);
});

test('back on the usual layout after changes the line stays, named "your usual"', async () => {
  await sync('p4', lay(true, 't1'));
  assert.equal(layoutLine('p4', usual)?.name, 'your usual');
});

test('no undo: disabled and no Ctrl+Z in the text; undo available: enabled with Ctrl+Z; ide.jsx wires both', async () => {
  await sync('p5', lay(true, 't1', { undo: false }));
  const l = layoutLine('p5', wsStore.get().ws);
  assert.equal(l?.undo, false);
  assert.equal(text(l), 'layout: dev · 1 change');
  assert.equal(layoutLine('p5', lay(true, 't1'))?.undo, true);
  assert.match(ideSrc, /ou-ide-status-layout" disabled=\{!lay\.undo\}/);
  assert.match(ideSrc, /onClick=\{\(\) => void undoLayout\(\)\}>\s*\{`layout: \$\{lay\.name\} · \$\{lay\.n\} \$\{lay\.n === 1 \? 'change' : 'changes'\}\$\{lay\.undo \? ' · Ctrl\+Z' : ''\}`\}/);
});

test('clicking the line (undoLayout) calls workspace.undo and counts the undo as a change', async () => {
  await sync('p6', lay(true, 't1'));
  calls.length = 0;
  reply = lay(true, 't2', { current: { name: 'video' } });
  await undoLayout();
  assert.deepEqual(calls, ['workspace.undo']);
  assert.equal(text(layoutLine('p6', wsStore.get().ws)), 'layout: video · 2 changes · Ctrl+Z');
});

test('Ctrl+Z still undoes the last layout change; not without undo or inside a text box', async () => {
  await sync('p7', lay(true, 't1'));
  calls.length = 0;
  let prevented = false;
  const key = (extra: any = {}) => ({ ctrlKey: true, altKey: false, shiftKey: false, key: 'z', target: null, preventDefault() { prevented = true; }, ...extra });
  assert.equal(workspaceKey(key()), true);
  assert.ok(prevented);
  assert.deepEqual(calls, ['workspace.undo']);
  calls.length = 0;
  assert.equal(workspaceKey(key({ target: { closest: () => ({}) } })), false);
  await sync('p7', lay(true, 't1', { undo: false }));
  assert.equal(workspaceKey(key()), false);
  assert.deepEqual(calls.filter(c => c !== 'workspace.get'), []);
});
