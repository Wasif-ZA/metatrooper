import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ui = fileURLToPath(new URL('../ui/', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm8-28-'));
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

const { expand, MAX_ROWS } = await import('../ui/src/kit/check.js');

function noNeedsYou(html: string) {
  assert.doesNotMatch(html, /--(?:st-)?wait\b|ou-ny-ring-needs|ou-ide-status-needs|ou-hm-wait\b|ou-pb-k-heal|ou-pb-flag|data-variant="warning"/i);
  assert.doesNotMatch(html, /\b(?:x1q8g9m5|xzud2hm)\b/);
}

const gate = { type: 'gate', title: 'GATE_TITLE', text: 'GATE_TEXT', why: 'GATE_WHY', aside: 'GATE_ASIDE',
  actions: [{ label: 'Approve', primary: true }], action: 'approve', hash: 'abc123' };

test('gate draws the not-a-gate line, text and why with no button, action or hash', () => {
  const html = render(gate);
  assert.match(html, /not a gate/);
  for (const t of ['GATE_TITLE', 'GATE_TEXT', 'GATE_WHY', 'GATE_ASIDE']) assert.match(html, new RegExp(t));
  assert.doesNotMatch(html, /<button/i);
  assert.doesNotMatch(html, /Approve|abc123/);
});

test('gate never draws the needs-you colour', () => {
  noNeedsYou(render(gate));
  noNeedsYou(render({ type: 'gate', text: 'T', why: 'W' }));
});

const tile = { type: 'tile', engine: 'ENGINE_X', task: 'TASK_X', state: 'done', lines: ['LINE_ONE', 'LINE_TWO'], branch: 'BRANCH_X' };

test('tile draws engine, task, lines, branch and the state label', () => {
  const html = render(tile);
  for (const t of ['ENGINE_X', 'TASK_X', 'LINE_ONE', 'LINE_TWO', 'BRANCH_X', 'Done']) assert.match(html, new RegExp(t));
});

test('tile state needs says Asks you without the needs-you colour', () => {
  const html = render({ ...tile, state: 'needs' });
  assert.match(html, /Asks you/);
  noNeedsYou(html);
});

// check.js rejects a state outside working/needs/done before Tile runs, so Tile's Working default is unreachable through Drawn.
test('tile with an unknown state falls back as a bad prop instead of drawing a badge', () => {
  const html = render({ ...tile, state: 'bogus' });
  assert.match(html, /wrong or missing prop: state/);
  assert.doesNotMatch(html, /Working|Asks you|Done/);
});

test('tile cuts lines beyond MAX_ROWS', () => {
  const lines = Array.from({ length: MAX_ROWS + 5 }, (_, i) => `ROW_${i}_END`);
  const html = render({ ...tile, lines });
  assert.match(html, new RegExp(`ROW_${MAX_ROWS - 1}_END`));
  assert.doesNotMatch(html, new RegExp(`ROW_${MAX_ROWS}_END`));
});

const specs = 'C:/Users/User/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/specs';
test('M8-28a: every p-*.json prototype spec passes check with nothing falling back', { skip: !existsSync(specs) && 'prototype specs folder is absent' }, () => {
  const files = readdirSync(specs).filter(f => /^p-.*\.json$/.test(f));
  assert.ok(files.length > 0);
  for (const f of files) {
    const out = expand(JSON.parse(readFileSync(join(specs, f), 'utf8')).spec);
    assert.deepEqual(out.fellBack, [], f);
  }
});
