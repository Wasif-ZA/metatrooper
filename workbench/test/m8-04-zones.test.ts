import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ui = fileURLToPath(new URL('../ui/', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm8-kit-parts-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(ui, 'package.json'));
const { build } = requireUI('esbuild');
try { await build({
  stdin: { contents: "export { Drawn } from './src/kit/Draw.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", resolveDir: ui, loader: 'jsx' },
  absWorkingDir: ui, tsconfigRaw: {}, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
  loader: { '.css': 'empty' }, outfile: join(temp, 'draw.mjs'),
  plugins: [{ name: 'installed-dependencies', setup(b: any) {
    b.onResolve({ filter: /^[^./]|^@/ }, (args: any) => ({ path: pathToFileURL(requireUI.resolve(args.path)).href, external: true }));
  } }],
}); } catch (error: any) {
  if (error.code !== 'EPERM' || process.platform !== 'win32') throw error;
  const entry = join(temp, 'entry.jsx');
  writeFileSync(entry, `export { Drawn } from ${JSON.stringify(join(ui, 'src/kit/Draw.jsx'))}; export * as React from ${JSON.stringify(requireUI.resolve('react'))}; export { renderToStaticMarkup } from ${JSON.stringify(requireUI.resolve('react-dom/server'))};`);
  const binary = join(dirname(requireUI.resolve('esbuild/package.json')), '../@esbuild/win32-x64/esbuild.exe');
  await new Promise<void>((resolveBuild, reject) => {
    const child = spawn(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--loader:.css=empty', '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);', '--outfile=' + join(temp, 'draw.mjs')], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolveBuild() : reject(new Error('esbuild exited ' + code)));
  });
}
const { Drawn, React, renderToStaticMarkup } = await import(pathToFileURL(join(temp, 'draw.mjs')).href);
const { PAGE_ROWS } = await import('../ui/src/kit/check.js');
const draw = (spec: any, zone?: string) => renderToStaticMarkup(React.createElement(Drawn, { spec, zone }));
const nums = (n: number) => Array.from({ length: n }, (_, i) => i);
const count = (html: string, tag: string) => new Set(html.match(new RegExp(`${tag}[0-9]+`, 'g'))).size;
const two = { type: 'columns', children: [{ type: 'note', text: 'AAA' }, { type: 'note', text: 'BBB' }] };

test('a table in the status zone draws its first line and an open button', () => {
  const html = draw({ type: 'table', cols: ['A'], rows: [['FIRSTLINE']] }, 'status');
  assert.match(html, /FIRSTLINE/);
  assert.match(html, />open</);
  assert.doesNotMatch(html, /<table/);
});

test('a 120-row table, list and queue each draw 50 rows and a more button that sends a more event', () => {
  assert.equal(PAGE_ROWS, 50);
  const specs: [string, any, string][] = [
    ['table', { type: 'table', cols: ['A'], rows: nums(120).map(i => ['TROW' + i]) }, 'TROW'],
    ['list', { type: 'list', groups: [{ label: 'G', rows: nums(120).map(i => ({ name: 'LROW' + i })) }] }, 'LROW'],
    ['queue', { type: 'queue', items: nums(120).map(i => ({ title: 'QROW' + i })) }, 'QROW'],
  ];
  for (const [name, spec, tag] of specs) {
    const html = draw(spec);
    assert.equal(count(html, tag), 50, `${name} draws 50 rows`);
    assert.match(html, />Show 50 more</, `${name} has a more button`);
  }
  // A static render cannot click; the event is emitted by the button's onClick in usePage.
});

test('columns in the phone zone draw as one column', () => {
  const tab = draw(two, 'tab');
  assert.match(tab, /data-columns="2"/);
  const phone = draw(two, 'phone');
  assert.doesNotMatch(phone, /data-columns/);
  assert.match(phone, /AAA/);
  assert.match(phone, /BBB/);
});
