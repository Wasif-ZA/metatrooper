import test from 'node:test';
import assert from 'node:assert/strict';
import { ZONES, expand } from '../../workbench/ui/src/kit/check.js';

const page = (...children: any[]) => ({ type: 'page', children });
const root = (spec: any, zone: string) => expand(spec, zone).root as any;

test('status zone accepts text, kbd and time only; inbox accepts one line plus one action', () => {
  assert.deepEqual(ZONES.status.parts, ['text', 'kbd', 'time']);
  for (const p of [{ type: 'text', text: 'T' }, { type: 'kbd', keys: ['K'] }, { type: 'time', iso: '2026-01-02T03:04:05Z', label: 'L' }]) {
    const r = root(p, 'status');
    assert.equal(r.folded, undefined, p.type);
    assert.equal(r.type, p.type);
  }
  assert.deepEqual(root({ type: 'table', cols: ['A'], rows: [['x']] }, 'status'), { folded: true, name: 'table', line: 'x' });

  // gate has no component yet (expand returns a fallback for it), so its action cap is asserted on the zone matrix.
  assert.deepEqual(ZONES.inbox.parts, ['text', 'choice', 'gate']);
  assert.equal(ZONES.inbox.actions, 1);
  const p = root(page({ type: 'text', text: 'one' }, { type: 'text', text: 'two' }), 'inbox');
  assert.equal(p.children.length, 1);
  assert.equal(p.children[0].text, 'one');
});

test('tab zone folds nothing', () => {
  const r = root(page({ type: 'table', cols: ['A'], rows: [['x']] }, { type: 'text', text: 'T' }, { type: 'text', text: 'U' }), 'tab');
  assert.equal(r.children.length, 3);
  assert.ok(r.children.every((c: any) => !c.folded));
});

test('a choice keeps one action in inbox and all of them in tab', () => {
  const choice = { type: 'choice', question: 'Pick', options: ['a', 'b'], actions: [{ label: 'A' }, { label: 'B' }, { label: 'C' }] };
  assert.equal(root(choice, 'inbox').actions.length, 1);
  assert.equal(root(choice, 'tab').actions.length, 3);
});
