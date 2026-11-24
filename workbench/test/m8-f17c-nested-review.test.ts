import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// M8-F17c: the reviewer's run shows nested under the turn it reviewed, folded by default.
// F17C_MUTATE (JSON [[from, to]]) lets a mutation check rewrite home.jsx in memory; unset in normal runs.
const requireUI = createRequire(fileURLToPath(new URL('../ui/package.json', import.meta.url)));
const uiDir = fileURLToPath(new URL('../ui/', import.meta.url));
const { build } = requireUI('esbuild');
const React = requireUI('react');
const { renderToStaticMarkup } = requireUI('react-dom/server');

let src = readFileSync(new URL('../ui/src/home.jsx', import.meta.url), 'utf8');
for (const [a, b] of JSON.parse(process.env.F17C_MUTATE || '[]')) {
  assert.ok(src.includes(a), `mutation target present: ${a}`);
  src = src.replace(a, b);
}

const g = globalThis as any;
g.document ??= { hidden: true, addEventListener() {}, removeEventListener() {} };
g.window ??= g;
g.requestAnimationFrame ??= (f: () => void) => setTimeout(f, 0).unref();
g.cancelAnimationFrame ??= clearTimeout;
g.ui = { snap: { projects: [], git: {} }, projectId: null, pendingHide: new Set() };
g.troop = {};
g.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {} });

const out = await build({
  absWorkingDir: uiDir, bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', logLevel: 'silent',
  loader: { '.css': 'empty' }, external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/server'],
  stdin: { contents: src + '\nexport { TaskView };', resolveDir: uiDir + 'src', sourcefile: 'home.jsx', loader: 'jsx' },
});
const mod: any = { exports: {} };
const req = createRequire(uiDir + 'x.js');
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, req);
const { TaskView } = mod.exports;

const child = { id: 'c1', engine_id: 'codex', state: 'working', title: 'Check the diff', prompt: 'Check the diff' };
const other = { id: 'c2', engine_id: 'claude', state: 'working', title: 'Write the docs', prompt: 'Write the docs' };
const parent = (reviews: object[]) => ({ id: 'p1', engine_id: 'claude', state: 'done', title: 'Parent task', prompt: 'Do it', reviews });
const rev = (o: object = {}) => ({ kind: 'reviewer', who: 'codex', state: 'pending', review_session_id: 'c1', note: '', ...o });

function render(reviews: object[], kids: object[], openList: string[] = []) {
  return renderToStaticMarkup(React.createElement(TaskView, { x: parent(reviews), kids, openList, toggle() {}, picked: null }));
}
const head = (h: string) => h.match(/<div class="ou-hm-reviewhead"[^>]*>/)?.[0] ?? '';

test('a reviewer row shows "Review by <engine> · Reviewing" after the chat, folded by default', () => {
  const h = render([rev()], [child]);
  assert.match(h, /data-review="codex" data-state="pending"/);
  assert.match(h, /Review by [^<]*codex[^<]*<!-- --> · <!-- -->Reviewing|Review by [^<]*· [^<]*Reviewing/i);
  assert.match(head(h), /aria-expanded="false"/);
  assert.doesNotMatch(h, /data-id="c1"/, "the child's row is not shown while folded");
  assert.ok(h.indexOf('ou-hm-review"') > h.indexOf('ou-hm-thread'), 'inside the thread');
  assert.ok(h.indexOf('ou-hm-review"') > h.indexOf('ou-hm-worked'), 'after the work line');
});

test('the review row sits after the chat, not before it', () => {
  const h = render([rev()], [child]);
  assert.ok(h.includes('ou-hm-chat"'), 'chat renders');
  assert.ok(h.indexOf('ou-hm-review"') > h.indexOf('ou-hm-chat"'), 'review after chat');
});

test('the subagents fold does not list the reviewer; absent when it is the only child', () => {
  assert.doesNotMatch(render([rev()], [child]), /ou-hm-subs|subagent/);
});

test('opened via review:c1: the child row and the note render', () => {
  const h = render([rev({ note: 'Looks off by one' })], [child], ['review:c1']);
  assert.match(head(h), /aria-expanded="true"/);
  assert.match(h, /data-id="c1"/);
  assert.match(h, /Looks off by one/);
  assert.doesNotMatch(render([rev({ note: 'Looks off by one' })], [child]), /Looks off by one/);
});

test('passed and failed states say Passed / Failed', () => {
  const p = render([rev({ state: 'passed' })], [child]);
  assert.match(p, /data-state="passed"/); assert.match(p, /Passed/); assert.doesNotMatch(p, /Reviewing/);
  const f = render([rev({ state: 'failed' })], [child]);
  assert.match(f, /data-state="failed"/); assert.match(f, /Failed/); assert.doesNotMatch(f, /Reviewing/);
});

test('no review_session_id, or a child that is not loaded, renders no review row', () => {
  assert.doesNotMatch(render([rev({ review_session_id: null })], [child]), /ou-hm-review"/);
  assert.doesNotMatch(render([rev({ review_session_id: undefined })], []), /ou-hm-review"/);
  assert.doesNotMatch(render([rev({ review_session_id: 'gone' })], [child]), /ou-hm-review"/);
  assert.doesNotMatch(render([rev({ kind: 'self' })], [child]), /ou-hm-review"/);
});

test('ordinary children stay in the subagents fold while the reviewer child is pulled out', () => {
  const h = render([rev()], [child, other], ['p1']);
  assert.match(h, /aria-label="1 subagent"/);
  const subs = h.slice(h.indexOf('ou-hm-subs'), h.indexOf('ou-hm-chat"'));
  assert.match(subs, /data-id="c2"/);
  assert.doesNotMatch(subs, /data-id="c1"/);
  assert.match(h, /ou-hm-review"/);
  assert.doesNotMatch(h.slice(h.indexOf('ou-hm-review"')), /data-id="c2"/);
});
