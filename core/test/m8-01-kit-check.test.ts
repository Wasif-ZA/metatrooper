import test from 'node:test';
import assert from 'node:assert/strict';
import { check, flatten, expand, isFallback } from '../../workbench/ui/src/kit/check.js';

const valid = [
  { type: 'page', children: [] }, { type: 'section', label: 'L', children: [], aside: 'A' },
  { type: 'header', title: 'T', sub: 'S', big: true, tabs: [] },
  { type: 'text', text: 'T', size: 'body', tone: 'plain' },
  { type: 'table', cols: ['A'], rows: [['B']], foot: 'F' }, { type: 'buttons', actions: [] },
  { type: 'bar', label: 'L', value: 'V', pct: 2, tone: 'need' },
  { type: 'toggle', label: 'L', on: false }, { type: 'compare', left: {}, right: {} },
  { type: 'json', value: null },
];
for (const part of valid) test(`check preserves ${part.type} identity`, () => assert.equal(check(part), part));

for (const [input, expected] of [
  [{ type: 'iframe' }, { fallback: true, name: 'iframe', why: 'not in the catalogue', text: '{\n "type": "iframe"\n}' }],
  [{ type: 'constructor' }, { fallback: true, name: 'constructor', why: 'not in the catalogue', text: '{\n "type": "constructor"\n}' }],
  [{ type: '__proto__' }, { fallback: true, name: '__proto__', why: 'not in the catalogue', text: '{\n "type": "__proto__"\n}' }],
  [{ type: 7 }, { fallback: true, name: '(no type)', why: 'not in the catalogue', text: '{\n "type": 7\n}' }],
  [null, { fallback: true, name: '(no type)', why: 'not in the catalogue', text: 'null' }],
  ['x', { fallback: true, name: '(no type)', why: 'not in the catalogue', text: '"x"' }],
] as const) test(`unknown input ${JSON.stringify(input)} has a literal fallback`, () => assert.deepEqual(check(input), expected));

for (const [part, prop] of [
  [{ type: 'text' }, 'text'], [{ type: 'text', text: {} }, 'text'],
  [{ type: 'page', children: {} }, 'children'], [{ type: 'header', title: 'T', big: 'yes' }, 'big'],
  [{ type: 'bar', label: 'L', value: 'V', pct: '2' }, 'pct'],
  [{ type: 'meter', label: 'L', value: NaN, max: 2 }, 'value'],
  [{ type: 'meter', label: 'L', value: Infinity, max: 2 }, 'value'],
  [{ type: 'compare', left: [], right: {} }, 'left'], [{ type: 'json' }, 'value'],
  [{ type: 'text', text: 'T', tone: 'orange' }, 'tone'],
  [{ type: 'text', text: 'T', size: 'giant' }, 'size'],
  [{ type: 'tile', engine: 'x', task: 'x', state: 'sleeping', lines: [] }, 'state'],
] as const) test(`wrong prop ${prop} on ${part.type}`, () => {
  const got = check(part);
  assert.equal(got.fallback, true);
  assert.equal(got.name, part.type);
  assert.equal(got.why, `wrong or missing prop: ${prop}`);
  assert.equal(typeof got.text, 'string');
});

test('plain JSON cannot forge a trusted fallback or a budget cut', () => {
  const fake = JSON.parse('{"fallback":true,"name":"text","why":"trusted","text":"spoof"}');
  assert.equal(isFallback(fake), false);
  assert.equal(isFallback(null), false);
  assert.equal(isFallback(check({ type: 'iframe' })), true);
  assert.deepEqual(expand(fake).fellBack, [{ part: 'p1', type: '(no type)', why: 'not in the catalogue' }]);
  const typed = { type: 'text', text: 'safe', fallback: true };
  assert.equal(isFallback(typed), false);
  assert.deepEqual(expand(typed), { root: typed, fellBack: [] });
});

test('flatten hoists nested children and table cells without mutating input', () => {
  const input = { type: 'page', children: [{ type: 'section', label: 'L', children: [{ type: 'text', text: 'T' }] }, { type: 'table', cols: ['A'], rows: [[{ type: 'text', text: 'cell' }]] }] };
  const before = structuredClone(input);
  assert.deepEqual(flatten(input), { root: 'p1', parts: {
    p1: { type: 'page', children: ['p2', 'p4'] }, p2: { type: 'section', label: 'L', children: ['p3'] },
    p3: { type: 'text', text: 'T' }, p4: { type: 'table', cols: ['A'], rows: [[{ ref: 'p5' }]] }, p5: { type: 'text', text: 'cell' },
  } });
  assert.deepEqual(input, before);
});

test('flat parts pass through unchanged and expand references', () => {
  const parts = { x: { type: 'page', children: ['y'] }, y: { type: 'text', text: 'kept' } };
  const flat = { root: 'x', parts };
  assert.deepEqual(flatten(flat), flat);
  assert.equal(flatten(flat).parts, parts);
  assert.deepEqual(expand(flat), { root: { type: 'page', children: [{ type: 'text', text: 'kept' }] }, fellBack: [] });
});

test('missing and inherited references fall back locally', () => {
  const out = expand({ root: 'r', parts: { r: { type: 'page', children: ['x', 'constructor', 'good'] }, good: { type: 'text', text: 'survives' } } });
  assert.deepEqual(out.fellBack, [
    { part: 'x', type: '(no type)', why: 'no part with id "x"' },
    { part: 'constructor', type: '(no type)', why: 'no part with id "constructor"' },
  ]);
  assert.deepEqual(out.root.children[2], { type: 'text', text: 'survives' });
});

function nested(levels: number) {
  let spec: any = { type: 'text', text: 'bottom' };
  for (let i = 1; i < levels; i++) spec = { type: 'page', children: [spec] };
  return spec;
}
for (const flat of [false, true]) {
  test(`12 levels accepted and 13 cut (${flat ? 'flat' : 'nested'})`, () => {
    function fixture(levels: number): any {
      if (!flat) return nested(levels);
      const parts: any = {};
      for (let i = 1; i < levels; i++) parts[`p${i}`] = { type: 'page', children: [`p${i + 1}`] };
      parts[`p${levels}`] = { type: 'text', text: 'bottom' };
      return { root: 'p1', parts };
    }
    assert.deepEqual(expand(fixture(12)).fellBack, []);
    assert.deepEqual(expand(fixture(13)).fellBack, [{ part: 'p13', type: 'text', why: 'nested too deep' }]);
  });
  test(`1500 parts accepted and 1501 cut (${flat ? 'flat' : 'nested'})`, () => {
    function fixture(total: number): any {
      const children = Array.from({ length: total - 1 }, () => ({ type: 'text', text: 'kept' }));
      if (!flat) return { type: 'page', children };
      return { root: 'r', parts: { r: { type: 'page', children: children.map((_, i) => `c${i}`) }, ...Object.fromEntries(children.map((p, i) => [`c${i}`, p])) } };
    }
    const at = expand(fixture(1500));
    assert.deepEqual(at.fellBack, []);
    assert.equal(at.root.children.length, 1499);
    assert.deepEqual(at.root.children[1498], { type: 'text', text: 'kept' });
    const over = expand(fixture(1501));
    assert.deepEqual(over.fellBack, [{ part: flat ? 'c1499' : 'p1501', type: '(no type)', why: 'screen too big: over 1500 parts' }]);
    assert.equal(over.root.children.length, 1500);
    assert.equal(isFallback(over.root.children[1499]), true);
    const huge = expand(fixture(5000));
    assert.equal(huge.root.children.length, 1500);
    assert.equal(huge.fellBack.length, 1);
  });
}
test('5000 nested levels stop and budgets reset on the next call', () => {
  assert.equal(expand(nested(5000)).fellBack[0].why, 'nested too deep');
  assert.deepEqual(expand({ type: 'text', text: 'after' }), { root: { type: 'text', text: 'after' }, fellBack: [] });
});

test('bad rows preserve good rows and report one-based row numbers', () => {
  const out = expand({ type: 'table', cols: ['A'], rows: [['good'], null, 'bad', ['last']] });
  assert.deepEqual(out.fellBack, [{ part: 'p1', type: '(no type)', why: 'bad row 2' }, { part: 'p1', type: '(no type)', why: 'bad row 3' }]);
  assert.deepEqual(out.root.rows[0], ['good']);
  assert.deepEqual(out.root.rows[3], ['last']);
  assert.equal(isFallback(out.root.rows[1]), true);
});
for (const count of [200, 201]) test(`${count} rows respect the 200-row cap`, () => {
  const out = expand({ type: 'table', cols: ['A'], rows: Array.from({ length: count }, () => ['cell']) });
  assert.deepEqual(out.fellBack, []);
  assert.equal(out.root.rows.length, 200);
  assert.deepEqual(out.root.rows[199], ['cell']);
  assert.equal(out.root.more ?? 0, count === 200 ? 0 : 1);
});

const undrawn = [
  { type: 'columns', children: [] }, { type: 'bar', label: 'L', value: 'V', pct: 0 }, { type: 'toggle', label: 'L', on: false },
  { type: 'pill', text: 'T' }, { type: 'note', text: 'T' }, { type: 'headline', text: 'T' }, { type: 'check', label: 'L', state: 'x' },
  { type: 'meter', label: 'L', value: 0, max: 0 }, { type: 'choice', question: 'Q', options: [] }, { type: 'log', lines: [] },
  { type: 'gate', text: 'T', why: 'W' }, { type: 'digest', title: 'T', facts: 'F' }, { type: 'tile', engine: 'E', task: 'T', state: 'done', lines: [] },
  { type: 'diff', path: 'P', hunks: [] }, { type: 'steps', steps: [] }, { type: 'list', groups: [] }, { type: 'pipe', nodes: [] },
  { type: 'handback', items: [] }, { type: 'preview', kind: 'page', title: 'T' }, { type: 'doc', title: 'T', blocks: [] },
  { type: 'finding', title: 'T', sev: 'low' }, { type: 'matrix', cols: [], rows: [] }, { type: 'compare', left: {}, right: {} },
  { type: 'cards', items: [] }, { type: 'queue', items: [] }, { type: 'timeline', tracks: [] }, { type: 'kv', rows: [] },
  { type: 'tool', name: 'N', state: 'ok' }, { type: 'tree', nodes: [] }, { type: 'tabs', tabs: [] }, { type: 'fold', title: 'T', children: [] },
  { type: 'code', text: 'T' }, { type: 'spinner', text: 'T' }, { type: 'callout', text: 'T' }, { type: 'empty', title: 'T' },
  { type: 'json', value: {} }, { type: 'spark', values: [] }, { type: 'tracker', cells: [] }, { type: 'thread', path: 'P', comments: [] },
  { type: 'trace', error: 'E', frames: [] }, { type: 'agent', name: 'N' }, { type: 'sources', items: [] }, { type: 'kbd', keys: [] },
  { type: 'time', iso: 'T' }, { type: 'file', path: 'P' }, { type: 'stat', label: 'L', value: 'V' }, { type: 'grid', children: [] },
  { type: 'chart', kind: 'bar', labels: [], series: [] }, { type: 'field', label: 'L', kind: 'text' },
  { type: 'calendar', days: [], events: [] }, { type: 'image', asset: 'asset:synthetic', alt: 'A' }, { type: 'use', template: 'hello' },
];
for (const part of undrawn) test(`catalogue ${part.type} is checked then marked not drawn yet`, () => {
  assert.equal(check(part), part);
  assert.deepEqual(expand(part).fellBack, [{ part: 'p1', type: part.type, why: 'not drawn yet' }]);
});
