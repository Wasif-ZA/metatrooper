import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { approvalInput, approvalText, chatModeOf, groupItems, splitLabel, TERMINAL_ONLY_NOTE } from '../ui/src/chat-model.js';

const tool = (id: string, label: string, status = 'ok', file?: string) => ({ kind: 'tool', id, name: file ? 'Edit' : 'Bash', label, status, ...(file ? { file } : {}) });
const text = (t: string) => ({ kind: 'text', text: t });

test('an approval shows the bare command, without the past-tense verb of a finished row', () => {
  assert.equal(approvalText({ label: 'Ran npm test -- --watch=false', name: 'Bash' }), 'npm test -- --watch=false');
  assert.equal(approvalText({ label: 'Edited src/app.js', name: 'Edit' }), 'Edit src/app.js');
  assert.equal(approvalText({ label: 'Used mcp__browser__open', name: 'mcp__browser__open' }), 'Use mcp__browser__open');
});

test('chat mode needs a transcript; anything else falls back to the terminal with a note', () => {
  assert.equal(chatModeOf('claude', 'transcript'), 'chat');
  assert.equal(chatModeOf('codex', 'none'), 'terminal');
  assert.equal(chatModeOf('claude', undefined), 'terminal');
  assert.match(TERMINAL_ONLY_NOTE, /terminal only/);
});

test('approval keys answer the Claude Code permission prompt; other engines get none', () => {
  assert.equal(approvalInput('claude', true), '1');
  assert.equal(approvalInput('claude', false), '\x1b');
  assert.equal(approvalInput('codex', true), null);
});

test('runs of four or more tool steps fold into one collapsible group; shorter runs, edits and waiting tools stay as rows', () => {
  const items = [
    text('Looking around.'),
    tool('a', 'Read views/list.html'),
    tool('b', 'Ran npm test', 'error'),
    tool('c', 'Searched for todo'),
    tool('g', 'Listed src/**'),
    tool('d', 'Edited routes/todos.js', 'ok', 'routes/todos.js'),
    tool('e', 'Read app.js'),
    tool('h', 'Read b.js'),
    text('Now the test.'),
    tool('f', 'Ran npm test -- --watch=false', 'waiting'),
  ];
  const out = groupItems(items);
  assert.deepEqual(out.map((x: any) => x.kind), ['text', 'steps', 'tool', 'tool', 'tool', 'text', 'tool']);
  const group = out[1] as any;
  assert.equal(group.label, '4 steps · 1 failed');
  assert.deepEqual(group.items.map((x: any) => x.id), ['a', 'b', 'c', 'g']);
  assert.equal(group.id, 'steps:a');
  assert.equal((out[2] as any).file, 'routes/todos.js');
  assert.deepEqual(out.slice(3, 5).map((x: any) => x.id), ['e', 'h']);
  assert.equal((out[6] as any).status, 'waiting');
});

test('a running step keeps its group labelled as working', () => {
  const out = groupItems([tool('a', 'Read a'), tool('b', 'Read b'), tool('c', 'Read c'), tool('d', 'Ran npm test', 'running')]) as any[];
  assert.equal(out.length, 1);
  assert.equal(out[0].label, '4 steps · working');
});

test('a row label splits into a bold verb and a mono target', () => {
  assert.deepEqual(splitLabel('Ran npm test -- --watch=false'), { verb: 'Ran', arg: 'npm test -- --watch=false' });
  assert.deepEqual(splitLabel('Searched the web for cats'), { verb: 'Searched the web for', arg: 'cats' });
  assert.deepEqual(splitLabel('Started a helper: tidy docs'), { verb: 'Started a helper:', arg: 'tidy docs' });
  assert.deepEqual(splitLabel('Updated the plan'), { verb: 'Updated the plan', arg: '' });
  assert.deepEqual(splitLabel('Edited src/a.js'), { verb: 'Edited', arg: 'src/a.js' });
});

test('the answer box hides while the chat shows its own approval card', () => {
  const src = readFileSync(new URL('../ui/src/home.jsx', import.meta.url), 'utf8');
  assert.match(src, /chat\?\.waiting/);
});

function loadView(saved: Record<string, string>) {
  const source = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
  const start = source.indexOf('const ui = {');
  assert.ok(start >= 0, 'app.js declares ui');
  const line = source.slice(start).split('\n').find((l) => /^\s*view:/.test(l));
  assert.ok(line, 'ui has a view field');
  const load = (k: string) => saved[k] ?? null;
  return vm.runInNewContext(`({${line}})`, { load }).view;
}

test('first run opens Home; a saved Wall or other view is kept', () => {
  assert.equal(loadView({}), 'home');
  assert.equal(loadView({ view: 'wall' }), 'wall');
  assert.equal(loadView({ view: 'ide' }), 'ide');
  assert.equal(loadView({ view: 'nonsense' }), 'home');
});

test('starting a task from Home stays on Home and selects the new agent there', () => {
  const src = readFileSync(new URL('../ui/src/home.jsx', import.meta.url), 'utf8');
  const launch = src.slice(src.indexOf('const launch = async'), src.indexOf('const edit = '));
  assert.ok(launch.length > 0);
  assert.doesNotMatch(launch, /homeView\.set\('wall'\)/);
  assert.doesNotMatch(launch, /await pick\(/);
  assert.match(launch, /ui\.homeSel = r\.result\.session_id/);
});

test('terminal.js lends a live tile to another host and takes it back', () => {
  const src = readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8');
  assert.match(src, /function lend\(/);
  assert.match(src, /lend,/);
});
