// M8-19b/c/e: Quiet look in one step with reset; error lens and bracket colours off on a fresh install; Tab redirects a queued message.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = (f: string) => fs.readFileSync(new URL(`../ui/src/${f}`, import.meta.url), 'utf8');
const grab = (source: string, re: RegExp, what: string) => {
  const body = source.match(re)?.[0];
  assert.ok(body, `${what} must exist`);
  return body.replace(/^export /gm, '');
};

function store(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), m };
}

function lookHarness(ls: ReturnType<typeof store>) {
  const code = grab(src('editor.js'), /^export const LOOKS = [^]*?^export function setEditorLook\([^]*?^\}/m, 'look block');
  const g = { localStorage: ls };
  return new Function('globalThis', code + '\nreturn { LOOKS, editorLook, lookOptions, setEditorLook, editors };')(g);
}
const fakeEditor = () => { const calls: any[] = []; return { calls, updateOptions: (o: any) => calls.push(o) }; };

test('M8-19c: a fresh install is on Default with brackets, inlay hints and error lens off', () => {
  const h = lookHarness(store());
  assert.equal(h.editorLook(), 'default');
  const o = h.lookOptions();
  assert.equal(o.bracketPairColorization.enabled, false);
  assert.equal(o.inlayHints.enabled, 'off');
  assert.equal(o.guides.bracketPairs, false);
  assert.equal(o.guides.indentation, true);
  assert.equal(o.stickyScroll.enabled, true);
  assert.equal(o.overviewRulerLanes, 3);
  assert.ok(!Object.keys(o).some((k) => /lens|errorLens|inlineDiagnostic/i.test(k)), 'no error lens option');
  assert.equal(h.LOOKS.default.brackets, false);
  assert.equal(h.LOOKS.default.hints, false);
});

test('M8-19c: an unknown stored look reads as Default', () => {
  assert.equal(lookHarness(store({ 'cc.editorLook': 'nope' })).editorLook(), 'default');
  assert.equal(lookHarness(store({ 'cc.editorLook': 'quiet' })).editorLook(), 'quiet');
});

test('M8-19b: Quiet differs from Default and sets every editor in one call; reset restores Default', () => {
  const ls = store();
  const h = lookHarness(ls);
  const a = fakeEditor(), b = fakeEditor();
  h.editors.add(a); h.editors.add(b);
  const def = h.lookOptions();
  assert.equal(h.setEditorLook('quiet'), 'quiet');
  assert.equal(ls.m.get('cc.editorLook'), 'quiet');
  for (const e of [a, b]) {
    assert.equal(e.calls.length, 1);
    assert.deepEqual(e.calls[0], { stickyScroll: { enabled: false }, guides: { indentation: false, bracketPairs: false }, overviewRulerLanes: 0, bracketPairColorization: { enabled: false }, inlayHints: { enabled: 'off' } });
    assert.notDeepEqual(e.calls[0], def);
  }
  assert.equal(h.editorLook(), 'quiet');
  assert.equal(h.setEditorLook('default'), 'default');
  assert.equal(ls.m.has('cc.editorLook'), false);
  for (const e of [a, b]) { assert.equal(e.calls.length, 2); assert.deepEqual(e.calls[1], def); }
});

test('M8-19b: Everything turns brackets and hints on; an unknown name falls back to Default', () => {
  const ls = store({ 'cc.editorLook': 'quiet' });
  const h = lookHarness(ls);
  const a = fakeEditor();
  h.editors.add(a);
  h.setEditorLook('all');
  assert.equal(a.calls[0].bracketPairColorization.enabled, true);
  assert.equal(a.calls[0].inlayHints.enabled, 'on');
  assert.equal(h.setEditorLook('bogus'), 'default');
  assert.equal(ls.m.has('cc.editorLook'), false);
  assert.deepEqual(a.calls[1], h.lookOptions());
});

test('M8-19b: editors register on open and leave on destroy; options() spreads the current look', () => {
  const s = src('editor.js');
  assert.match(s, /editors\.add\(ed\)/);
  assert.match(s, /editors\.delete\(ed\)/);
  assert.match(s, /const options = \(path\) => \(\{\n[^\n]*\.\.\.lookOptions\(\)/);
});

function commandsFor(look: string) {
  const ide = src('ide.jsx');
  const code = grab(ide, /^ {2}const look = editorLook\(\);\n[^]*?Reset to Default[^\n]*\n/m, 'Appearance commands');
  const calls: string[] = [], toasts: string[] = [];
  const out: any[] = [];
  const cmd = (group: string, label: string, run: () => void) => ({ group, label, run });
  new Function('out', 'cmd', 'editorLook', 'setEditorLook', 'toast', code)(out, cmd, () => look, (n: string) => calls.push(n), (m: string) => toasts.push(m));
  return { out, calls, toasts };
}

test('M8-19b: palette offers the other looks, and Reset only when not on Default', () => {
  const labels = (look: string) => commandsFor(look).out.map((c) => c.label);
  assert.deepEqual(labels('default'), ['Appearance: Quiet', 'Appearance: Everything']);
  assert.deepEqual(labels('quiet'), ['Appearance: Default', 'Appearance: Everything', 'Appearance: Reset to Default']);
  assert.deepEqual(labels('all'), ['Appearance: Quiet', 'Appearance: Default', 'Appearance: Reset to Default']);
  assert.ok(commandsFor('quiet').out.every((c) => c.group === 'Appearance'));
});

test('M8-19b: running Quiet and Reset calls setEditorLook and toasts', () => {
  const q = commandsFor('default');
  q.out.find((c) => c.label === 'Appearance: Quiet').run();
  assert.deepEqual(q.calls, ['quiet']);
  assert.deepEqual(q.toasts, ['Look: Quiet']);
  const r = commandsFor('quiet');
  r.out.find((c) => c.label === 'Appearance: Reset to Default').run();
  assert.deepEqual(r.calls, ['default']);
  assert.deepEqual(r.toasts, ['Look: Default']);
});

test('M8-19b: the diff editor forces sticky scroll off after spreading options', () => {
  const s = grab(src('editor.js'), /^export function openDiff\([^]*?^\}/m, 'openDiff');
  assert.match(s, /createDiffEditor\(parent, \{ \.\.\.options\(path\), stickyScroll: \{ enabled: false \}/);
});

function queueHandler(draft: string) {
  const line = src('home.jsx').split('\n').find((l) => l.includes('label="Queue a follow-up"'));
  assert.ok(line, 'queue TextInput must exist');
  assert.match(line, /onEnter=\{enqueue\}/);
  const h = line.match(/onKeyDown=\{(\(e\) => \{[^]*?\})\} width=/)?.[1];
  assert.ok(h, 'queue onKeyDown must exist');
  const log: any[] = [];
  const fn = new Function('draft', 'setDraft', 'sendFollowUp', 'x', `return ${h};`)(draft, (v: string) => log.push(['set', v]), (x: any, t: string) => log.push(['send', x, t]), { id: 's1' });
  return (key: string, shiftKey = false) => {
    const ev = { key, shiftKey, prevented: false, preventDefault() { this.prevented = true; } };
    log.length = 0;
    fn(ev);
    return { ev, log: [...log] };
  };
}

test('M8-19e: Tab with a draft redirects now: prevents default, clears the draft, sends the trimmed text', () => {
  const r = queueHandler('  do this instead  ')('Tab');
  assert.equal(r.ev.prevented, true);
  assert.deepEqual(r.log, [['set', ''], ['send', { id: 's1' }, 'do this instead']]);
});

test('M8-19e: Shift+Tab, an empty draft and other keys do nothing; Enter still queues', () => {
  const p = queueHandler('hello');
  for (const r of [p('Tab', true), p('Enter'), p('a')]) { assert.equal(r.ev.prevented, false); assert.deepEqual(r.log, []); }
  for (const d of ['', '   ']) { const r = queueHandler(d)('Tab'); assert.equal(r.ev.prevented, false); assert.deepEqual(r.log, []); }
  assert.match(src('home.jsx'), /const enqueue = \(\) => \{ if \(!draft\.trim\(\)\) return; setQueued\(x\.id, draft\); setDraft\(''\)/);
});
