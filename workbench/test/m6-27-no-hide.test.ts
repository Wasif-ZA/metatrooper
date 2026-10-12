import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const terminalSource = readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8');

const fn = (name: string, src: string, indent = '') =>
  src.match(new RegExp(`^${indent}(?:async )?function ${name}\\([^]*?\\r?\\n${indent}}\\r?\\n`, 'm'))![0];

const LIVE = ['starting', 'working', 'waiting_for_you'];
const SETTLED = ['done', 'idle', 'exited'];

// the real label() from terminal.js, run against a tile whose elements are plain objects
const label = new Function('selected', 'escapeAttr', `${fn('label', terminalSource, '  ')}; return label;`)(null, (v: string) => v);

function fakeTile() {
  const els = new Map<string, any>();
  const el = (sel: string) => {
    if (!els.has(sel)) els.set(sel, { textContent: '', className: '', innerHTML: '', hidden: false, dataset: sel === '.tx' ? { action: 'hide' } : {}, classList: { toggle() {} } });
    return els.get(sel);
  };
  return { el: { dataset: {}, classList: { add() {}, toggle() {} }, querySelector: el }, term: { options: {}, write() {} } };
}

// counts the elements the tile shows with data-action="hide"
const tileHides = (t: any) => {
  const tx = t.el.querySelector('.tx');
  return (!tx.hidden && tx.dataset.action === 'hide' ? 1 : 0) + (t.el.querySelector('.tile-previews').innerHTML.match(/data-action="hide"/g) || []).length;
};

const session = (state: string, extra = {}) => ({ id: 's1', state, engine_id: 'claude', task: 't', words: state, ...extra });

test('M6-27a tile: no hide x while starting, working or waiting_for_you; exactly one when done, idle or exited', () => {
  // protects=M6-27a a live agent's tile cannot be hidden, so it never drops out of "need you"
  // fails_when=label() leaves data-action="hide" on the tile x for a live state, or drops it for a settled one
  // no_claim=CSS, real DOM layout, or the core session.hide (out of scope)
  assert.match(terminalSource, /<button class="tx" data-action="hide"/);
  for (const state of LIVE) {
    const t = fakeTile();
    label(t, session(state));
    assert.equal(tileHides(t), 0, state);
  }
  for (const state of SETTLED) {
    const t = fakeTile();
    label(t, session(state));
    assert.equal(tileHides(t), 1, state);
  }
});

test('M6-27a tile: a shell keeps its close button in every state', () => {
  // protects=closing a shell tile, which shares the tile x
  // fails_when=the live-state gate also removes the shell close
  // no_claim=what shell-close does in the core
  for (const state of [...LIVE, ...SETTLED]) {
    const t = fakeTile();
    label(t, session(state, { shell: true }));
    const tx = t.el.querySelector('.tx');
    assert.equal(tx.hidden, false, state);
    assert.equal(tx.dataset.action, 'shell-close', state);
  }
});

test('M6-27b tile: a session going from working to done gains its x in one render', () => {
  // protects=M6-27b the x comes back as soon as the agent finishes
  // fails_when=the x stays gone after a working -> done relabel, or appears while working
  // no_claim=how often show() is called on a snapshot
  const t = fakeTile();
  label(t, session('working'));
  assert.equal(tileHides(t), 0);
  label(t, session('done'));
  assert.equal(tileHides(t), 1);
  label(t, session('waiting_for_you'));
  assert.equal(tileHides(t), 0);
});

test('M6-27a list row: no hide x while starting, working or waiting_for_you; exactly one when done, idle or exited', () => {
  // protects=M6-27a the list row x cannot hide a live agent
  // fails_when=rowHtml() renders data-action="hide" for a live state, or not exactly once for a settled one
  // no_claim=the click handler for case 'hide' or the core session.hide
  const rowHtml = new Function('ui', `${appSource.split('\n').find((l) => l.startsWith('const STATE_WORDS'))}\n${['esc', 'short', 'taskOf', 'openedIn', 'unseen', 'resumeButton', 'rowHtml'].map((n) => fn(n, appSource)).join('\n')}; return rowHtml;`)(
    { snap: { git: {}, engines: [] } },
  );
  for (const state of [...LIVE, ...SETTLED]) {
    const html: string = rowHtml({ id: 's1', state, engine_id: 'claude', title: 't', state_at: new Date().toISOString() }, false);
    assert.equal((html.match(/data-action="hide"/g) || []).length, LIVE.includes(state) ? 0 : 1, state);
  }
});
