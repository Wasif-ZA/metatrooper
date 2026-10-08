import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const fn = (name: string) => source.match(new RegExp(`^function ${name}\\([^]*?\\n}\\n`, 'm'))![0];
const esc = (s: unknown) => String(s);

test('inputField applies checkbox and choice defaults', () => {
  const inputField = new Function('esc', `${fn('inputField')}; return inputField;`)(esc);
  assert.match(inputField('dry', { type: 'boolean', default: true }), / checked>/);
  assert.doesNotMatch(inputField('dry', { type: 'boolean' }), /checked/);
  assert.match(inputField('mode', { type: 'choice', choices: ['a', 'b'], default: 'b' }), /<option >a<\/option><option selected>b<\/option>/);
});

test('setHtml puts typed drafts back after a re-render', () => {
  const note = { dataset: { key: 'combine-note' }, type: 'textarea', value: '' };
  const box = { dataset: { key: 'input:dry' }, type: 'checkbox', checked: false };
  const other = { dataset: { key: 'git-msg' }, type: 'textarea', value: 'kept' };
  const el = { innerHTML: '', contains: () => false, querySelectorAll: () => [note, box, other] };
  const ui = { rendered: {}, drafts: { 'combine-note': 'take the header', 'input:dry': true } };
  const setHtml = new Function('ui', 'document', `${fn('setHtml')}; return setHtml;`)(ui, { getElementById: () => el, activeElement: null });
  setHtml('x', '<p>new</p>');
  assert.equal(note.value, 'take the header');
  assert.equal(box.checked, true);
  assert.equal(other.value, 'kept');
});
