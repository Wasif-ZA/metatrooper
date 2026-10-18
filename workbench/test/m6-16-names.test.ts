import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const terminalSource = readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8');
const fn = (name: string, src: string, indent = '') =>
  src.match(new RegExp(`^${indent}(?:async )?function ${name}\\([^]*?\\r?\\n${indent}}\\r?\\n`, 'm'))![0];
const esc = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// the real label() and approvalCard(), run against plain objects
const label = new Function('selected', 'escapeAttr', 'deskHtml', `${fn('label', terminalSource, '  ')}; return label;`)(null, esc, () => '');
const approvalCard = (ui: object) => new Function('ui', 'esc', 'sessionLabel', 'short', `${fn('approvalCard', appSource)}; return approvalCard;`)(ui, esc, (x: any) => `${x.engine_id} · ${x.title}`, () => '1m');

function fakeTile() {
  const els = new Map<string, any>();
  const el = (sel: string) => {
    if (!els.has(sel)) els.set(sel, { textContent: '', className: '', innerHTML: '', hidden: false, dataset: {}, classList: { toggle() {} } });
    return els.get(sel);
  };
  return { el: { dataset: {}, ariaLabel: null, classList: { add() {}, toggle() {} }, querySelector: el }, term: { options: {}, write() {} } };
}

test('M6-16e tiles are named groups "<agent label>, <state>" and the Open preview chip is a button named by its text', () => {
  // protects=the names an agent finds the wall by (Change 4) fails_when=a tile loses role=group or its "<task>, <state>" name, or the chip stops being a button whose text is "Open preview" no_claim=what Chromium's UI Automation tree exposes (the opt-in E2E reads that)
  assert.match(terminalSource, /el\.role = 'group';/);
  const t = fakeTile();
  label(t, { id: 's1', state: 'working', words: 'working', engine_id: 'demo-fixture', task: 'preview', previews: [{ url: 'http://localhost:5173/', port: 5173 }] });
  assert.equal(t.el.ariaLabel, 'preview, working');
  assert.match(t.el.querySelector('.tile-previews').innerHTML, /^<button class="btn" data-action="open-preview"[^>]*>Open preview<\/button>$/);
  const bare = fakeTile();
  label(bare, { id: 's2', state: 'starting', words: '', engine_id: 'demo-fixture', task: '' });
  assert.equal(bare.el.ariaLabel, 'demo-fixture, starting', 'falls back to the engine and raw state');
});

test('M6-16e the approval card is a dialog named "Approval: <summary>" whose buttons keep Approve once, Approve for this session and Reject', () => {
  // protects=the card an agent approves on the demo desk fails_when=the card loses role=dialog or its name, or a button is renamed no_claim=the folded sheet's CSS (the scripted agent opens it from its tab)
  const ui = { projectId: 'p1', snap: { sessions: [{ id: 's1', project_id: 'p1', engine_id: 'demo-fixture', title: 'asker' }], projects: [] } };
  const html = approvalCard(ui)({ id: 'ap_1', session_id: 's1', summary: 'click Send in shop.example.invalid', reason: 'risky control: Send', created_at: '' }, 0);
  assert.match(html, /^<div class="gate cur" data-approval="ap_1" role="dialog" aria-label="Approval: click Send in shop.example.invalid">/);
  assert.match(html, /demo-fixture · asker/);
  const buttons = [...html.matchAll(/<button class="btn[^"]*" data-action="approval"[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);
  assert.deepEqual(buttons, ['Approve once', 'Approve for this session', 'Reject']);
  assert.doesNotMatch(appSource.match(/No agent actions waiting<\/div>'/)![0], /role="dialog"/, 'the empty placeholder is not a dialog');
});
