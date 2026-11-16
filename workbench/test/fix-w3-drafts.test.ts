import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const fn = (name: string) => source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?\\n}\\n`, 'm'))![0];

test('keyed field typed value survives re-render and is cleared after send or cancel', () => {
  // Evaluates draft retention across setHtml re-renders and clearing via clearDrafts.
  const ui: { rendered: Record<string, string>; drafts: Record<string, unknown> } = { rendered: {}, drafts: {} };
  const onInput = new Function('ui', `${fn('onInput')}; return onInput;`)(ui);
  const clearDrafts = new Function('ui', `${fn('clearDrafts')}; return clearDrafts;`)(ui);

  const noteField = { dataset: { key: 'comment-note' }, type: 'textarea', value: 'typed comment note' };
  const sessionField = { dataset: { key: 'comment-session' }, type: 'select', value: 'sess-42' };

  // Records input into drafts.
  onInput({ target: noteField });
  onInput({ target: sessionField });

  assert.equal(ui.drafts['comment-note'], 'typed comment note');
  assert.equal(ui.drafts['comment-session'], 'sess-42');

  // Simulates re-render replacing elements with blank values.
  const freshNote = { dataset: { key: 'comment-note' }, type: 'textarea', value: '' };
  const freshSession = { dataset: { key: 'comment-session' }, type: 'select', value: '' };
  const container = { innerHTML: '', contains: () => false, querySelectorAll: () => [freshNote, freshSession] };
  const setHtml = new Function('ui', 'document', `${fn('setHtml')}; return setHtml;`)(ui, { getElementById: () => container, activeElement: null });

  setHtml('test-panel', '<div class="form">new content</div>');

  // Asserts typed values survive re-render.
  assert.equal(freshNote.value, 'typed comment note');
  assert.equal(freshSession.value, 'sess-42');

  // Clears drafts as done in comment-cancel and comment-send handlers.
  clearDrafts('comment-note', 'comment-session');
  assert.equal(ui.drafts['comment-note'], undefined);
  assert.equal(ui.drafts['comment-session'], undefined);

  // Verifies subsequent re-render does not restore cleared values.
  const resetNote = { dataset: { key: 'comment-note' }, type: 'textarea', value: '' };
  const resetSession = { dataset: { key: 'comment-session' }, type: 'select', value: '' };
  const resetContainer = { innerHTML: '', contains: () => false, querySelectorAll: () => [resetNote, resetSession] };
  const resetHtml = new Function('ui', 'document', `${fn('setHtml')}; return setHtml;`)(ui, { getElementById: () => resetContainer, activeElement: null });

  delete ui.rendered['test-panel'];
  resetHtml('test-panel', '<div class="form">fresh content</div>');
  assert.equal(resetNote.value, '');
  assert.equal(resetSession.value, '');

  // Verifies comment-cancel and comment-send invoke clearDrafts for comment fields.
  assert.match(source, /case 'comment-cancel':[\s\S]*?clearDrafts\('comment-note',\s*'comment-session'\)/);
  assert.match(source, /case 'comment-send':[\s\S]*?clearDrafts\('comment-note',\s*'comment-session'\)/);
});
