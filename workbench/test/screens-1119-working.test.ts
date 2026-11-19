import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { workingCounts, workingLabel } from '../ui/src/words.js';

const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const row = (id: string, state: string, project_id: string, parent_id: string | null = null) => ({ id, state, project_id, parent_id });

// The demo's moment: sidebar said Working 2, Needs you said Working 3, the composer said 3 agents running.
const snap = {
  sessions: [row('split', 'working', 'shop'), row('preview', 'waiting_for_you', 'shop', 'split'), row('tests', 'working', 'shop', 'split'), row('docs', 'exited', 'api')],
  live: [row('rate', 'working', 'api'), row('tests', 'working', 'shop', 'split'), row('chat', 'waiting_for_you', 'shop')],
  tree_rows: { split: row('split', 'working', 'shop'), boot: row('boot', 'starting', 'web'), self: row('self', 'working', 'web', 'self') },
};

test('Working counts sessions you started that are starting or working, in every project, each once; sub-agents are helpers', () => {
  assert.deepEqual(workingCounts(snap), { working: 4, helpers: 1 }, 'split, rate, boot, self (own parent) work; tests is a helper; waiting and exited do not count');
});

test('a waiting sub-agent is not a helper, and an empty or partial snapshot counts zero', () => {
  assert.deepEqual(workingCounts({ sessions: [row('a', 'working', 'p'), row('k', 'waiting_for_you', 'p', 'a')] }), { working: 1, helpers: 0 });
  assert.deepEqual(workingCounts({}), { working: 0, helpers: 0 });
  assert.deepEqual(workingCounts(undefined), { working: 0, helpers: 0 });
});

test('the label says Working with the same number everywhere, helpers as a small extra', () => {
  assert.equal(workingLabel({ working: 2, helpers: 1 }), 'Working 2 (+1 helper)');
  assert.equal(workingLabel({ working: 3, helpers: 2 }), 'Working 3 (+2 helpers)');
  assert.equal(workingLabel({ working: 1, helpers: 0 }), 'Working 1');
  assert.equal(workingLabel({ working: 0, helpers: 0 }), 'Nothing working');
});

test('sidebar, Needs you and the composer all take their Working number from workingCounts', () => {
  const frame = src('renderer/frame.js');
  assert.match(frame, /workingCounts\(/, 'sidebar Working shelf count');
  assert.doesNotMatch(frame, /shelfHtml\('working', 'Working', working, rows\)/, 'the shelf no longer shows working.length (threads incl. waiting)');
  const inbox = src('ui/src/inbox.jsx');
  assert.match(inbox, /workingCounts\(/, 'Needs you Working section and header count');
  assert.doesNotMatch(inbox, /count: workingSessions\.length/);
  const home = src('ui/src/home.jsx');
  assert.match(home, /workingLabel\(workingCounts\(/, 'composer status label');
  assert.doesNotMatch(home, /agent\$\{[^}]*\} running/);
});
