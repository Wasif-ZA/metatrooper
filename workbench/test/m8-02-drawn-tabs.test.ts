import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ui = fileURLToPath(new URL('../ui/', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm8-drawn-tabs-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(ui, 'package.json'));
const { build } = requireUI('esbuild');
const entrySrc = "export { syncDrawn, DrawnTabs } from './src/kit/DrawnTabs.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';";
try { await build({
  stdin: { contents: entrySrc, resolveDir: ui, loader: 'jsx' },
  absWorkingDir: ui, tsconfigRaw: {}, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
  loader: { '.css': 'empty' }, outfile: join(temp, 'tabs.mjs'),
  plugins: [{ name: 'installed-dependencies', setup(b: any) {
    b.onResolve({ filter: /^[^./]|^@/ }, (args: any) => ({ path: pathToFileURL(requireUI.resolve(args.path)).href, external: true }));
  } }],
}); } catch (error: any) {
  if (error.code !== 'EPERM' || process.platform !== 'win32') throw error;
  const entry = join(temp, 'entry.jsx');
  writeFileSync(entry, entrySrc.replace("'./src/kit/DrawnTabs.jsx'", JSON.stringify(join(ui, 'src/kit/DrawnTabs.jsx'))).replace("'react'", JSON.stringify(requireUI.resolve('react'))).replace("'react-dom/server'", JSON.stringify(requireUI.resolve('react-dom/server'))));
  const binary = join(dirname(requireUI.resolve('esbuild/package.json')), '../@esbuild/win32-x64/esbuild.exe');
  await new Promise<void>((ok, reject) => {
    const child = spawn(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--loader:.css=empty', '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);', '--outfile=' + join(temp, 'tabs.mjs')], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? ok() : reject(new Error('esbuild exited ' + code)));
  });
}
const { syncDrawn, DrawnTabs, React, renderToStaticMarkup } = await import(pathToFileURL(join(temp, 'tabs.mjs')).href);
const g = globalThis as any;
const html = (pid: string) => renderToStaticMarkup(React.createElement(DrawnTabs, { pid }));
const surf = (pid: string, seq: number, over: any = {}) => ({ id: 's1', project_id: pid, session_id: 'sess-abcdef123456', title: 'Plan board', seq, ...over });
const spec = (text: string) => ({ type: 'text', text });
function world(pid: string, surfaces: any[], replies: (n: number) => any, view = 'ide') {
  const calls: any[] = [];
  g.ui = { projectId: pid, view, snap: { surfaces } };
  g.api = { call: async (m: string, p: any) => { calls.push([m, p]); return replies(calls.length); } };
  return calls;
}
const reply = (result: any) => ({ kind: 'reply', reply: { result } });

test('a new surface in the snapshot opens one tab and a seq bump redraws it', async () => {
  const pid = 'p-open';
  world(pid, [], () => assert.fail('no surface, no read'));
  await syncDrawn();
  assert.equal(html(pid), '');
  let calls = world(pid, [surf(pid, 1)], () => reply({ spec: spec('FIRST_DRAWING'), seq: 1 }));
  await syncDrawn();
  assert.deepEqual(calls, [['ui.get', { surface: 's1' }]]);
  let out = html(pid);
  assert.match(out, /Plan board/);
  assert.match(out, /FIRST_DRAWING/);
  assert.equal((out.match(/data-tab-value=/g) || []).length, 1);
  assert.match(out, /data-selected="selected"/);
  await syncDrawn();
  assert.equal(calls.length, 1, 'same seq reads nothing');
  calls = world(pid, [surf(pid, 2)], () => reply({ spec: spec('SECOND_DRAWING'), seq: 2 }));
  await syncDrawn();
  assert.equal(calls.length, 1);
  out = html(pid);
  assert.equal((out.match(/data-tab-value=/g) || []).length, 1);
  assert.match(out, /SECOND_DRAWING/);
  assert.doesNotMatch(out, /FIRST_DRAWING/);
});

test('a surface of another project, or outside the IDE view, opens nothing', async () => {
  const pid = 'p-mine';
  let calls = world(pid, [surf('p-other', 1)], () => reply({ spec: spec('X'), seq: 1 }));
  await syncDrawn();
  assert.equal(calls.length, 0);
  assert.equal(html(pid), '');
  calls = world(pid, [surf(pid, 1)], () => reply({ spec: spec('X'), seq: 1 }), 'home');
  await syncDrawn();
  assert.equal(calls.length, 0);
  assert.equal(html(pid), '');
});

test('ui.get with no result leaves no tab and retries on the next sync', async () => {
  const pid = 'p-retry';
  let calls = world(pid, [], () => null);
  await syncDrawn();
  calls = world(pid, [surf(pid, 1)], () => ({ kind: 'reply', reply: { error: { message: 'gone' } } }));
  await syncDrawn();
  assert.equal(calls.length, 1);
  assert.equal(html(pid), '');
  calls = world(pid, [surf(pid, 1)], () => reply({ spec: spec('RETRIED'), seq: 1 }));
  await syncDrawn();
  assert.equal(calls.length, 1, 'asked again');
  assert.match(html(pid), /RETRIED/);
});
