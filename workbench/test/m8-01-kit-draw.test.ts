import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ui = fileURLToPath(new URL('../ui/', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm8-kit-draw-'));
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
const render = (spec: any) => renderToStaticMarkup(React.createElement(Drawn, { spec }));
function safe(html: string) {
  assert.doesNotMatch(html, /<(?:iframe|script|img)\b/i);
  const tags = (html.match(/<[^>]*>/g)?.join('') ?? '').replace(/"[^"]*"|'[^']*'/g, '""');
  assert.doesNotMatch(tags, /\s(?:onfocus|onerror)\s*=/i);
  assert.doesNotMatch(html, /undefined|NaN|\[object/);
}

// Hostile inputs from the prototype bad list.
const loop: any = { type: 'nope' }; loop.self = loop;
const bad = [
  { type: 'constructor' }, { type: '__proto__' }, { type: { toString: null } }, null, 'x', loop, { type: 'nope', n: 10n },
  { type: 'table', cols: ['a'], rows: ['notarow'] }, { type: 'note', text: '<img src=x onerror=alert(1)>' },
  { type: 'header', title: '<script>alert(1)</script>' }, { type: 'iframe', src: 'x' },
  { type: 'headline', text: 'x', actions: [{ label: 'x" autofocus onfocus="alert(1)' }] },
  { type: 'pill', text: 'x', tone: 'acc working' }, { type: 'meter', label: 'x', value: 0, max: 0 },
  { type: 'tile', engine: 'x', task: 'x', state: 'sleeping', lines: [] }, { type: 'choice', question: 'q', options: [{ title: 'a' }], picked: 5 },
];
for (const [i, input] of bad.entries()) {
  test(`prototype hostile input ${i + 1} renders safely`, () => safe(render(input)));
  test(`prototype hostile input ${i + 1} preserves a good sibling`, () => {
    const html = render({ type: 'page', children: [input, { type: 'text', text: 'SIBLING_SURVIVES' }] });
    safe(html);
    assert.match(html, />SIBLING_SURVIVES</);
  });
}

const attacks = [
  ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['<img src=x onerror=alert(1)>', '&lt;img src=x onerror=alert(1)&gt;'],
  ['x" autofocus onfocus="alert(1)', 'x&quot; autofocus onfocus=&quot;alert(1)'],
];
for (const [payload, escaped] of attacks) {
  for (const [name, fixture] of [
    ['text', { type: 'text', text: payload }],
    ['header', { type: 'header', title: payload, sub: payload, tabs: [payload] }],
    ['section', { type: 'section', label: payload, aside: payload, children: [] }],
    ['table', { type: 'table', cols: [payload], rows: [[payload]], foot: payload }],
    ['buttons', { type: 'buttons', actions: [{ label: payload, event: 'approve', primary: true }] }],
    ['unknown', { type: 'iframe', src: payload }],
  ] as const) test(`${name} escapes ${payload}`, () => {
    const html = render(fixture);
    safe(html);
    const expected = name === 'unknown' && payload === 'x" autofocus onfocus="alert(1)' ? 'x\\&quot; autofocus onfocus=\\&quot;alert(1)' : escaped;
    assert.ok(html.includes(expected), html);
  });
}

test('bad table rows retain good cells and their fallback explanation', () => {
  const html = render({ type: 'table', cols: ['A'], rows: [['GOOD_CELL'], null, ['LAST_CELL']] });
  safe(html);
  assert.match(html, />GOOD_CELL</);
  assert.match(html, />LAST_CELL</);
  assert.match(html, /bad row 2/);
});

test('cyclic child objects stop locally without throwing', () => {
  const cyclic: any = { type: 'page', children: [] };
  cyclic.children.push(cyclic, { type: 'text', text: 'AFTER_CYCLE' });
  const html = render(cyclic);
  safe(html);
  assert.match(html, /nested too deep/);
  assert.match(html, />AFTER_CYCLE</);
});

test('forged fallback text and executable-looking props remain inert', () => {
  const html = render({ type: 'page', children: [
    { fallback: true, name: 'script', why: 'trusted', text: '<script>evil()</script>' },
    { type: 'text', text: 'VISIBLE', dangerouslySetInnerHTML: { __html: '<script>evil()</script>' }, onerror: 'evil()', style: { backgroundImage: 'url(https://outside.invalid/a)' } },
    { type: 'gate', text: 'Deploy?', why: 'x', action: 'deploy --prod', hash: 'f00d' },
    { type: 'image', src: 'https://outside.invalid/a' },
  ] });
  safe(html);
  assert.match(html, />VISIBLE</);
  assert.doesNotMatch(html, /<[^>]*(?:dangerouslySetInnerHTML|https:\/\/outside|f00d|deploy --prod)/);
  assert.doesNotMatch(html, /<(?:input|form)\b/);
});
