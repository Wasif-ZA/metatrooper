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
const render = (spec: any) => renderToStaticMarkup(React.createElement(Drawn, { spec }));
const { KIT } = await import('../ui/src/kit/catalogue.js');
const batches = await Promise.all(['a', 'b', 'c', 'd', 'e'].map(b => import(`../ui/src/kit/parts-${b}.names.js`)));

// The literal inventory guards coverage when a batch changes.
const names = [
  'bar', 'matrix', 'compare', 'cards', 'kv', 'list', 'queue', 'steps', 'tree', 'empty', 'callout', 'columns', 'grid', 'fold', 'tabs',
  'note', 'headline', 'pill', 'kbd', 'time', 'code', 'json', 'log', 'doc', 'file', 'image', 'sources', 'stat', 'spinner',
  'toggle', 'check', 'choice', 'field', 'calendar', 'meter', 'thread', 'agent', 'tool', 'finding', 'digest', 'handback', 'preview',
  'chart', 'spark', 'tracker', 'pipe', 'timeline', 'trace', 'diff',
];

// Required KIT props use synthetic text and literal expectations.
const minimal: Record<string, any> = {
  bar: { label: 'PART_TEXT', value: '12', pct: 12 },
  matrix: { cols: ['Column'], rows: [{ label: 'PART_TEXT', cells: ['ok'] }] },
  compare: { left: { title: 'PART_TEXT' }, right: { title: 'Right' } },
  cards: { items: [{ title: 'PART_TEXT' }] },
  kv: { rows: [['Key', 'PART_TEXT']] },
  list: { groups: [{ label: 'Group', rows: [{ name: 'PART_TEXT' }] }] },
  queue: { items: [{ title: 'PART_TEXT' }] },
  steps: { steps: [{ title: 'PART_TEXT' }] },
  tree: { nodes: [{ label: 'PART_TEXT' }] },
  empty: { title: 'PART_TEXT' },
  callout: { text: 'PART_TEXT' },
  columns: { children: [{ type: 'note', text: 'PART_TEXT' }] },
  grid: { children: [{ type: 'note', text: 'PART_TEXT' }] },
  fold: { title: 'PART_TEXT', children: [] },
  tabs: { tabs: [{ label: 'PART_TEXT', children: [] }] },
  note: { text: 'PART_TEXT' },
  headline: { text: 'PART_TEXT' },
  pill: { text: 'PART_TEXT' },
  kbd: { keys: ['PART_TEXT'] },
  time: { iso: '2026-01-02T03:04:05Z', label: 'PART_TEXT' },
  code: { text: 'PART_TEXT' },
  json: { value: { text: 'PART_TEXT' } },
  log: { lines: [{ text: 'PART_TEXT' }] },
  doc: { title: 'PART_TEXT', blocks: [] },
  file: { path: 'PART_TEXT' },
  image: { asset: 'asset:synthetic', alt: 'PART_TEXT' },
  sources: { items: [{ title: 'PART_TEXT' }] },
  stat: { label: 'PART_TEXT', value: '12' },
  spinner: { text: 'PART_TEXT' },
  toggle: { label: 'PART_TEXT', on: false },
  check: { label: 'PART_TEXT', state: 'open' },
  choice: { question: 'PART_TEXT', options: [{ title: 'Option' }] },
  field: { label: 'PART_TEXT', kind: 'text' },
  calendar: { days: ['PART_TEXT'], events: [] },
  meter: { label: 'PART_TEXT', value: 1, max: 2 },
  thread: { path: 'PART_TEXT', comments: [] },
  agent: { name: 'PART_TEXT' },
  tool: { name: 'PART_TEXT', state: 'ok' },
  finding: { title: 'PART_TEXT', sev: 'low' },
  digest: { title: 'PART_TEXT', facts: 'Facts' },
  handback: { items: [{ text: 'PART_TEXT' }] },
  preview: { kind: 'page', title: 'PART_TEXT' },
  chart: { kind: 'bar', labels: ['Label'], series: [{ name: 'Series', values: [1] }] },
  spark: { values: [1, 2] },
  tracker: { cells: ['ok'], label: 'PART_TEXT' },
  pipe: { nodes: [{ title: 'PART_TEXT' }] },
  timeline: { tracks: [{ label: 'PART_TEXT', spans: [] }] },
  trace: { error: 'PART_TEXT', frames: [] },
  diff: { path: 'PART_TEXT', hunks: [] },
};

// Optional props and nested shapes keep other props valid during individual mutations.
const extra: Record<string, any> = {
  bar: { note: 'Note', tone: 'lead' },
  matrix: { rows: [{ label: 'PART_TEXT', cells: ['warn'] }] },
  compare: { left: { title: 'PART_TEXT', sub: 'Subtitle', lines: ['Line'] }, right: { title: 'Right', sub: 'Subtitle', lines: ['Line'] }, delta: 'Delta' },
  cards: { items: [{ title: 'PART_TEXT', facts: ['Fact'], lines: ['Line'], note: 'Note' }], pick: 0 },
  list: { groups: [{ label: 'Group', aside: 'Aside', rows: [{ name: 'PART_TEXT', dir: 'Dir', right: 'Right', agent: 'Agent', icon: 'Icon', cur: true }] }], search: 'Search', keys: ['Key'] },
  queue: { items: [{ title: 'PART_TEXT', sub: 'Subtitle', tag: 'Tag', flag: true, actions: [{ label: 'Action', primary: true }] }], selected: 0 },
  steps: { steps: [{ title: 'PART_TEXT', sub: 'Subtitle', value: 'Value', state: 'cur' }] },
  tree: { nodes: [{ label: 'PART_TEXT', right: 'Right', state: 'warn', children: [{ label: 'Leaf', right: 'Right', state: 'ok' }] }] },
  empty: { hint: 'Hint' },
  callout: { title: 'Title', tone: 'info' },
  columns: { children: [[{ type: 'note', text: 'PART_TEXT' }]] },
  grid: { cols: 2 },
  fold: { children: [{ type: 'note', text: 'Child' }], open: true, aside: 'Aside' },
  tabs: { tabs: [{ label: 'PART_TEXT', count: 'Count', children: [{ type: 'note', text: 'Child' }] }], active: 0 },
  headline: { actions: [{ label: 'Action', primary: true }] },
  pill: { tone: 'ok' },
  kbd: { label: 'Label' },
  code: { lang: 'text', title: 'Title' },
  json: { depth: 6, value: { text: 'PART_TEXT', items: ['Nested', { text: 'Leaf' }] } },
  log: { lines: [{ text: 'PART_TEXT', detail: 'Detail', time: 'Time', took: 'Duration', state: 'done', kind: 'group' }] },
  doc: { blocks: [{ text: 'Block', mark: 'added', refs: ['Ref'] }], status: 'Status', by: 'Author' },
  file: { line: 1, text: 'File text' },
  image: { caption: 'Caption', still: 'photo' },
  sources: { items: [{ title: 'PART_TEXT', path: 'Path', url: 'https://synthetic.invalid', quote: 'Quote' }] },
  stat: { delta: 'Delta', dir: 'up', sub: 'Subtitle' },
  toggle: { note: 'Note' },
  check: { state: 'needs', value: 'Value', event: 'Event' },
  choice: { options: [{ title: 'Option', note: 'Note' }], picked: 0, field: 'Field', from: 'From', actions: [{ label: 'Action' }] },
  field: { value: 'Value', options: ['Option'], placeholder: 'Placeholder', event: 'Event', to: 'Recipient' },
  calendar: { days: ['Day'], events: [{ day: 0, title: 'PART_TEXT', time: 'Time', tone: 'mark' }], hours: ['Hour'] },
  meter: { unit: 'Unit', prefix: 'Prefix' },
  thread: { line: 1, resolved: false, comments: [{ who: 'Author', text: 'Comment' }] },
  agent: { model: 'Model', state: 'needs' },
  tool: { input: 'Input', output: 'Output', ms: 100, state: 'wait' },
  finding: { where: 'Where', state: 'open', opinions: [{ engine: 'Engine', text: 'Opinion' }], actions: [{ label: 'Action' }] },
  digest: { note: 'Note', actions: [{ label: 'Action' }] },
  handback: { title: 'Title', items: [{ text: 'PART_TEXT', command: 'Command', kind: 'you', done: false }] },
  preview: { url: 'https://synthetic.invalid', widths: ['Width'], versions: ['Version'], marks: [{ text: 'Mark', time: 'Time' }], lines: ['Line'], labels: ['Label'], still: 'site', figures: ['Figure'] },
  chart: { title: 'Title', unit: 'Unit', target: 2, forecast: 1, tones: ['need'] },
  spark: { label: 'Label', value: 'Value' },
  pipe: { title: 'Title', note: 'Note', nodes: [{ title: 'PART_TEXT', value: 'Value', state: 'needs', kind: 'gate' }] },
  timeline: { tracks: [{ label: 'PART_TEXT', spans: [{ start: 0, len: 50, state: 'run', label: 'Span' }] }], playhead: 25, marks: ['Mark'], scale: ['Scale'] },
  trace: { msg: 'Message', frames: [{ fn: 'Function', file: 'File', line: '1', internal: false }] },
  diff: { hunks: [{ head: 'Hunk', lines: ['+added', '-removed'] }], add: 'Add', del: 'Delete', actions: [{ label: 'Action' }], viewed: true },
};

// Attack encodings are literals rather than output-derived snapshots.
const attacks = [
  ['<script>alert(1)</script>', '&lt;script&gt;alert(1)&lt;/script&gt;'],
  ['<img src=x onerror=alert(1)>', '&lt;img src=x onerror=alert(1)&gt;'],
  ['x" onfocus="alert(1)', 'x&quot; onfocus=&quot;alert(1)'],
  ['javascript:alert(1)', 'javascript:alert(1)'],
];

function clean(html: string) {
  assert.doesNotMatch(html, /undefined|NaN|\[object/);
}

function inert(html: string) {
  assert.doesNotMatch(html, /<(?:script|img|iframe)/i);
  // Quoted values cannot masquerade as actual event attributes.
  for (const tag of html.match(/<[^>]*>/g) ?? []) {
    assert.doesNotMatch(tag.replace(/"[^"]*"|'[^']*'/g, '""'), /\s(?:onerror|onfocus)\s*=/i);
    for (const attr of tag.matchAll(/\b(href|src|style)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)) {
      assert.doesNotMatch(attr[2], /alert\(1\)|javascript:|&lt;(?:script|img)|onfocus|onerror/i);
    }
  }
  clean(html);
}

function noNeedsYou(html: string) {
  // ui.css maps needs-you styles to --wait and its --st-wait alias.
  assert.doesNotMatch(html, /--(?:st-)?wait\b|ou-ny-ring-needs|ou-ide-status-needs|ou-hm-wait\b|ou-pb-k-heal|ou-pb-flag|data-variant="warning"/i);
  // Astryx warning fills use --color-warning and --color-icon-warning, both mapped to --wait in ui.css.
  assert.doesNotMatch(html, /\b(?:x1q8g9m5|xzud2hm)\b/);
}

function fixture(name: string) {
  return structuredClone({ type: name, ...minimal[name], ...extra[name] });
}

function stringPaths(value: any, path: (string | number)[] = []): (string | number)[][] {
  if (typeof value === 'string') return [path];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => {
    if (key === 'type') return [];
    const next = [...path, key];
    const descendants = stringPaths(item, next);
    return Array.isArray(value) && typeof item !== 'string' ? [next, ...descendants] : descendants;
  });
}

function replaceAt(value: any, path: (string | number)[], replacement: any) {
  const copy = structuredClone(value);
  let parent = copy;
  for (const key of path.slice(0, -1)) parent = parent[key];
  parent[path.at(-1)!] = replacement;
  return copy;
}

function withOwnText(value: any, payload: string): any {
  if (value === 'PART_TEXT') return payload;
  if (Array.isArray(value)) return value.map(item => withOwnText(item, payload));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, withOwnText(item, payload)]));
  return value;
}

test('all 49 batch names have literal fixtures conforming to KIT', () => {
  assert.equal(names.length, 49);
  assert.deepEqual(batches.flatMap(b => b.default), names);
  assert.deepEqual(Object.keys(minimal), names);
  for (const name of names) {
    const def = KIT[name];
    for (const key of Object.keys(def.req)) assert.ok(Object.hasOwn(minimal[name], key), `${name}.${key}`);
    for (const key of Object.keys(extra[name] ?? {})) assert.ok(key in def.req || key in (def.opt ?? {}), `${name}.${key}`);
  }
});

for (const name of names) {
  const chart = name === 'chart' || name === 'spark';
  test(`${name}: minimal instance renders cleanly${chart ? '' : ' with its own text'}`, () => {
    const html = render({ type: name, ...minimal[name] });
    clean(html);
    if (!chart) {
      assert.ok(html.includes('PART_TEXT'), html);
      if (name !== 'image') assert.doesNotMatch(html, /ou-drawn-plain/);
      noNeedsYou(html);
    }
  });
  for (const [payload, escaped] of attacks) {
    test(`${name}: every string prop and nested string is inert for ${payload}`, () => {
      const base = fixture(name);
      for (const path of stringPaths(base)) {
        const html = render(replaceAt(base, path, payload));
        inert(html);
        // Rejected or unused strings may be omitted; visible angle brackets must be encoded.
        const expected = name === 'code' && path[0] === 'lang' && payload === '<script>alert(1)</script>' ? '&lt;script&gt;alert(1)&lt;/sc' : escaped;
        if (payload.startsWith('<') && html.includes('alert(1)')) assert.ok(html.includes(expected), `${path.join('.')}: ${html}`);
      }
      if (!chart) {
        const html = render({ type: name, ...withOwnText(minimal[name], payload) });
        inert(html);
        const text = html.replace(/<[^>]*>/g, '');
        const expected = name === 'json' && payload === 'x" onfocus="alert(1)' ? 'x\\&quot; onfocus=\\&quot;alert(1)' : escaped;
        assert.ok(text.toLowerCase().includes(expected), html);
      }
    });
  }
}

// Confirmed colour bugs stay executable as TODOs until their implementations are fixed.
const colourCases: [string, any, string][] = [
  ['bar', { tone: 'need' }, 'bar tone need renders the needs-you warning fill'],
  ['pill', { tone: 'need' }, 'pill tone need renders the needs-you warning fill'],
  ['pill', { tone: 'warn' }, 'pill tone warn renders the needs-you warning fill'],
  ['log', { lines: [{ text: 'PART_TEXT', kind: 'heal' }] }, 'log kind heal emits ou-pb-k-heal using --st-wait'],
  ['doc', { blocks: [{ text: 'PART_TEXT', mark: 'flag' }] }, 'doc mark flag emits ou-pb-flag using --st-wait'],
];
const nestedColourBugs: Record<string, string> = {
  matrix: 'matrix cell warn renders the needs-you warning dot',
  tree: 'tree node warn renders the needs-you warning dot',
};
for (const name of names.filter(n => n !== 'chart' && n !== 'spark')) {
  test(`${name}: optional and nested props never draw the needs-you colour`, () => {
    const html = render(fixture(name));
    clean(html);
    noNeedsYou(html);
  });
}
for (const [name, props, bug] of colourCases) {
  test(`${name}: reserved colour stays absent for ${JSON.stringify(props)}`, () => {
    const html = render({ ...fixture(name), ...props });
    clean(html);
    noNeedsYou(html);
  });
}

// Item-bearing parts receive a wrong-type item beside a literal good item.
const nested: Record<string, { path: (string | number)[], items: any, good: string }> = {
  matrix: { path: ['rows'], items: [false, { label: 'GOOD_ITEM', cells: ['ok'] }], good: 'GOOD_ITEM' },
  compare: { path: ['left', 'title'], items: false, good: 'Right' },
  cards: { path: ['items'], items: [false, { title: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  kv: { path: ['rows'], items: [false, ['Key', 'GOOD_ITEM']], good: 'GOOD_ITEM' },
  list: { path: ['groups', 0, 'rows'], items: [false, { name: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  queue: { path: ['items'], items: [false, { title: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  steps: { path: ['steps'], items: [false, { title: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  tree: { path: ['nodes'], items: [false, { label: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  columns: { path: ['children'], items: [false, { type: 'note', text: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  grid: { path: ['children'], items: [false, { type: 'note', text: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  fold: { path: ['children'], items: [false, { type: 'note', text: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  tabs: { path: ['tabs'], items: [false, { label: 'GOOD_ITEM', children: [] }], good: 'GOOD_ITEM' },
  headline: { path: ['actions'], items: [false, { label: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  kbd: { path: ['keys'], items: [false, 'GOOD_ITEM'], good: 'GOOD_ITEM' },
  log: { path: ['lines'], items: [false, { text: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  doc: { path: ['blocks'], items: [false, { text: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  sources: { path: ['items'], items: [false, { title: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  choice: { path: ['options'], items: [false, { title: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  field: { path: ['options'], items: [false, 'GOOD_ITEM'], good: 'GOOD_ITEM' },
  calendar: { path: ['events'], items: [false, { day: 0, title: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  thread: { path: ['comments'], items: [false, { who: 'Author', text: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  finding: { path: ['opinions'], items: [false, { engine: 'Engine', text: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  digest: { path: ['actions'], items: [false, { label: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  handback: { path: ['items'], items: [false, { text: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  preview: { path: ['lines'], items: [false, 'GOOD_ITEM'], good: 'GOOD_ITEM' },
  tracker: { path: ['cells'], items: [false, 'GOOD_ITEM'], good: 'GOOD_ITEM' },
  pipe: { path: ['nodes'], items: [false, { title: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
  timeline: { path: ['tracks'], items: [false, { label: 'GOOD_ITEM', spans: [] }], good: 'GOOD_ITEM' },
  trace: { path: ['frames'], items: [false, { fn: 'GOOD_ITEM', file: 'File' }], good: 'GOOD_ITEM' },
  diff: { path: ['actions'], items: [false, { label: 'GOOD_ITEM' }], good: 'GOOD_ITEM' },
};

for (const name of names.filter(n => n !== 'chart' && n !== 'spark')) {
  test(`${name}: a bad nested item becomes plain text and preserves a good sibling`, () => {
    const entry = nested[name];
    let spec;
    if (entry) {
      const base = fixture(name);
      if (name === 'field') { base.kind = 'select'; base.value = 'GOOD_ITEM'; }
      spec = replaceAt(base, entry.path, entry.items);
    } else {
      // Scalar parts have no item slot; exercise them beside bad and good page children.
      spec = { type: 'page', children: [{ type: name, ...minimal[name] }, false, { type: 'note', text: 'GOOD_ITEM' }] };
    }
    const html = render(spec);
    inert(html);
    noNeedsYou(html);
    assert.match(html, /class="ou-drawn-plain" role="note"/);
    assert.match(html, /<pre>[^]*false[^]*<\/pre>/);
    assert.ok(html.replace(/<pre>[^]*?<\/pre>/g, '').includes(entry?.good ?? 'GOOD_ITEM'), html);
  });
}
