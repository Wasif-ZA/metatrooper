import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'm8-07-profile-'));
const prior = process.env.METATROOPER_HOME;
process.env.METATROOPER_HOME = dir;
const { getProfile, proposeChange, answerProposal, undoChange } = await import('../src/profile.ts');
const { METHODS } = await import('../src/methods.ts');
const { expand } = await import('../../workbench/ui/src/kit/check.js');
const profileFile = join(dir, 'profile.json');

test.after(() => {
  if (prior === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prior;
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});
test.beforeEach(() => rmSync(profileFile, { force: true }));

const rpc = (code: number) => (e: any) => e.code === code;

test('a profile hiding gate, choice, handback, pipe or layout is refused', () => {
  const before = getProfile();
  for (const part of ['gate', 'choice', 'handback', 'pipe', 'page', 'section', 'columns', 'grid', 'fold', 'tabs', 'header']) {
    assert.throws(() => proposeChange({ key: 'hide', value: part }, 'x'), rpc(-32003), part);
  }
  assert.deepEqual(getProfile(), before);
  assert.equal(getProfile().pending, null);
  assert.equal(proposeChange({ key: 'hide', value: 'kv' }, 'x').pending?.change.value, 'kv');

  writeFileSync(profileFile, JSON.stringify({ profile: { hide: ['gate', 'kv'] } }));
  assert.deepEqual(getProfile().profile.hide, ['kv']);

  const spec = { type: 'page', children: [{ type: 'gate', text: 'Ship it?' }, { type: 'kv', rows: [] }] };
  const out = JSON.stringify(expand(spec, 'tab', {}, {}, 0, ['gate', 'kv']));
  assert.match(out, /Ship it\?/);
  assert.doesNotMatch(out, /"type":"kv"/);
  assert.match(JSON.stringify(expand(spec, 'tab', {}, {}, 0, [])), /"type":"kv"/);
});

test('a second proposal waits while one is pending, and an unanswered one changes nothing', () => {
  proposeChange({ key: 'density', value: 'compact' }, 'a');
  const g = proposeChange({ key: 'hide', value: 'kv' }, 'b');
  assert.equal(g.pending?.change.key, 'density');
  assert.equal(g.waiting, 1);
  assert.equal(g.profile.density, 'comfortable');
  assert.deepEqual(g.profile.hide, []);

  const first = g.pending!.id;
  const second = JSON.parse(readFileSync(profileFile, 'utf8')).pending[1].id as string;
  assert.throws(() => answerProposal(second, true), rpc(-32002));

  const r = answerProposal(first, true);
  assert.equal(r.profile.density, 'compact');
  assert.equal(r.pending?.id, second);
  assert.equal(r.pending?.change.key, 'hide');
  assert.equal(r.waiting, 0);

  const r2 = answerProposal(second, false);
  assert.deepEqual(r2.profile.hide, []);
  assert.equal(r2.pending, null);
});

test('undo restores the profile before that change', () => {
  const yes = (c: any) => answerProposal(proposeChange(c, '').pending!.id, true);
  yes({ key: 'hide', value: 'kv' });
  const r = yes({ key: 'density', value: 'compact' });
  assert.equal(r.history.length, 2);
  const firstId = r.history[1].id;
  const u = undoChange(firstId);
  assert.equal(u.profile.density, 'comfortable');
  assert.deepEqual(u.profile.hide, []);
  assert.deepEqual(u.history, []);
});

test('answer and undo need a UI connection', () => {
  const m = (n: string) => METHODS.find((d) => d.name === n);
  assert.equal(m('profile.answer')?.needsUi, true);
  assert.equal(m('profile.undo')?.needsUi, true);
  assert.ok(!m('profile.propose')?.needsUi);
});
