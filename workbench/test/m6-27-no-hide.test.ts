import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const terminalSource = readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8');

const fn = (name: string, src: string, indent = '') =>
  src.match(new RegExp(`^${indent}(?:async )?function ${name}\\([^]*?\\r?\\n${indent}}\\r?\\n`, 'm'))![0];
const line = (start: string) => appSource.split('\n').find((l) => l.startsWith(start))!;

const LIVE = ['starting', 'working', 'waiting_for_you', 'unknown'];
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

// counts the tile's elements carrying data-action="hide", shown or not
const tileHides = (t: any) => {
  const tx = t.el.querySelector('.tx');
  return (tx.dataset.action === 'hide' ? 1 : 0) + (t.el.querySelector('.tile-previews').innerHTML.match(/data-action="hide"/g) || []).length;
};

const session = (state: string, extra = {}) => ({ id: 's1', state, engine_id: 'claude', task: 't', words: state, ...extra });
const snapOfEveryState = () => ({ snap: { sessions: [...LIVE, ...SETTLED].map((state) => ({ id: state, state })) } });

test('M6-27a tile: no hide x while starting, working, waiting_for_you or unknown; exactly one when done, idle or exited', () => {
  // protects=M6-27a a live agent's tile cannot be hidden, so it never drops out of "need you"
  // fails_when=label() leaves data-action="hide" on the tile x for a live state, or drops it for a settled one
  // no_claim=CSS, real DOM layout, or the core session.hide (out of scope)
  assert.match(terminalSource, /<button class="tx" data-action="hide"/);
  for (const state of LIVE) {
    const t = fakeTile();
    label(t, session(state));
    assert.equal(tileHides(t), 0, state);
    assert.equal(t.el.querySelector('.tx').hidden, true, state);
  }
  for (const state of SETTLED) {
    const t = fakeTile();
    label(t, session(state));
    assert.equal(tileHides(t), 1, state);
    assert.equal(t.el.querySelector('.tx').hidden, false, state);
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

test('M6-27a list row: no hide x while starting, working, waiting_for_you or unknown; exactly one when done, idle or exited', () => {
  // protects=M6-27a the list row x cannot hide a live agent
  // fails_when=rowHtml() renders data-action="hide" for a live state, or not exactly once for a settled one
  // no_claim=the click handler for case 'hide' or the core session.hide
  const rowHtml = new Function('ui', `${line('const LIVE_STATES')}\n${line('const STATE_WORDS')}\n${['esc', 'short', 'taskOf', 'openedIn', 'unseen', 'resumeButton', 'rowHtml'].map((n) => fn(n, appSource)).join('\n')}; return rowHtml;`)(
    { snap: { git: {}, engines: [] } },
  );
  for (const state of [...LIVE, ...SETTLED]) {
    const html: string = rowHtml({ id: 's1', state, engine_id: 'claude', title: 't', state_at: new Date().toISOString() }, false);
    assert.equal((html.match(/data-action="hide"/g) || []).length, LIVE.includes(state) ? 0 : 1, state);
  }
});

test('M6-27 context menu: Hide is offered only for a settled session', () => {
  // protects=the right-click Hide cannot hide a live agent
  // fails_when=the contextmenu handler offers data-action="menu-hide" for a live or unknown session, or drops it for a settled one
  // no_claim=menu position or Clear status
  const block = appSource.match(/^document\.addEventListener\('contextmenu'[^]*?\r?\n}\);\r?\n/m)![0];
  for (const state of [...LIVE, ...SETTLED]) {
    let handler: any;
    const menu: any = { style: {}, hidden: true, innerHTML: '' };
    const doc = { addEventListener: (_: string, h: any) => { handler = h; }, getElementById: () => menu };
    new Function('document', 'ui', `${line('const LIVE_STATES')}\n${fn('esc', appSource)}\n${fn('canHide', appSource)}\n${block}`)(doc, snapOfEveryState());
    handler({ target: { closest: () => ({ dataset: { id: state } }) }, preventDefault() {}, clientX: 0, clientY: 0 });
    assert.equal((menu.innerHTML.match(/data-action="menu-hide"/g) || []).length, LIVE.includes(state) ? 0 : 1, state);
  }
});

test('M6-27 click: hide and menu-hide send no session.hide for a live session, even from a stale button', async () => {
  // protects=a hide button or menu item rendered before its session went live cannot hide it
  // fails_when=onClick sends session.hide for a session whose current state is live or unknown, or skips it for a settled one
  // no_claim=what the core does with session.hide
  const sent: string[] = [];
  const rpc = async (method: string, p: any) => { sent.push(`${method}:${p.session_id}`); return {}; };
  const fired: Array<() => Promise<void>> = [];
  for (const action of ['hide', 'menu-hide']) {
    const onClick = new Function('ui', 'rpc', 'document', 'render', 'toast', 'setTimeout', `${line('const LIVE_STATES')}\n${line('const UNDO_MS')}\n${fn('canHide', appSource)}\n${fn('hideLater', appSource)}\n${fn('onClick', appSource)}; return onClick;`)(
      { ...snapOfEveryState(), pendingHide: new Set() }, rpc, { getElementById: () => ({}) }, () => {}, () => {}, (f: () => Promise<void>) => fired.push(f));
    for (const state of [...LIVE, ...SETTLED]) {
      const el = { dataset: { action, id: state }, tagName: 'DIV', closest: () => null };
      await onClick({ target: { closest: () => el }, stopPropagation() {} });
      for (const f of fired.splice(0)) await f();
    }
  }
  assert.deepEqual(sent, [...SETTLED, ...SETTLED].map((s) => `session.hide:${s}`));
});
