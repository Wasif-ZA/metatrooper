import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// M8-23c: a session resumed after a core restart shows one quiet line 'resumed after close', not a card.
// M823C_OVERRIDE (JSON {relative path: file}) lets a mutation check swap in a modified copy; unset in normal runs.
const over: Record<string, string> = JSON.parse(process.env.M823C_OVERRIDE || '{}');
const read = (rel: string) => readFileSync(over[rel] || new URL(`../${rel}`, import.meta.url), 'utf8');
const requireUI = createRequire(fileURLToPath(new URL('../ui/package.json', import.meta.url)));

function labelRun(x: Record<string, unknown>) {
  const src = read('renderer/terminal.js');
  const lines = src.split('\n').filter((l) => /^\s*continued\.(hidden|textContent) =/.test(l));
  assert.equal(lines.length, 2, 'label sets .tile-continued hidden and text');
  const continued: { hidden: boolean; textContent: string } = { hidden: false, textContent: 'stale' };
  vm.runInNewContext(lines.join('\n'), { x, continued });
  return continued;
}

test('label: a resumed row shows "resumed after close" and is not hidden', () => {
  assert.deepEqual(labelRun({ resumed: true }), { hidden: false, textContent: 'resumed after close' });
});

test('label: continued-from wins when both are set', () => {
  assert.deepEqual(labelRun({ resumed: true, continuedEngine: 'codex' }), { hidden: false, textContent: 'continued from codex' });
  assert.deepEqual(labelRun({ continuedEngine: 'codex' }), { hidden: false, textContent: 'continued from codex' });
});

test('label: neither -> hidden and empty', () => {
  assert.deepEqual(labelRun({ resumed: false }), { hidden: true, textContent: '' });
  assert.deepEqual(labelRun({}), { hidden: true, textContent: '' });
});

test('app.js Wall mapping: resumed is true only when resumed_from is set', () => {
  const src = read('renderer/app.js');
  const m = src.match(/\bresumed: (Boolean\(x\.resumed_from\)),/);
  assert.ok(m, 'tile row has resumed: Boolean(x.resumed_from)');
  assert.equal(src.match(/\bresumed: /g)!.length, 1);
  const ev = (x: object) => vm.runInNewContext(m![1], { x, Boolean });
  assert.equal(ev({ resumed_from: 's0' }), true);
  assert.equal(ev({ resumed_from: null }), false);
  assert.equal(ev({}), false);
});

test('Home TaskView: the line shows for a session with resumed_from and not without', () => {
  const src = read('ui/src/home.jsx');
  const line = src.split('\n').find((l) => /ou-hm-resumed/.test(l));
  assert.ok(line, 'TaskView has the resumed line');
  const { transformSync } = requireUI('esbuild');
  const code = transformSync(`const f = (x) => (<>${line.trim()}</>); export default f;`, { loader: 'jsx', format: 'cjs', tsconfigRaw: {} }).code;
  const React = requireUI('react');
  const { renderToStaticMarkup } = requireUI('react-dom/server');
  const mod: { exports: { default?: (x: object) => unknown } } = { exports: {} };
  new Function('module', 'exports', 'React', code.replace(/\/\*#__PURE__\*\//g, '').replace(/import_react\./g, 'React.'))(mod, mod.exports, React);
  const f = mod.exports.default!;
  const withIt = renderToStaticMarkup(f({ resumed_from: 's0' }) as never);
  assert.equal(withIt, '<div class="ou-hm-resumed" data-resumed-from="s0">resumed after close</div>');
  assert.equal(renderToStaticMarkup(f({ resumed_from: null }) as never), '');
  assert.equal(renderToStaticMarkup(f({}) as never), '');
  assert.match(read('ui/src/ui.css'), /^\.ou-hm-resumed \{/m);
});
