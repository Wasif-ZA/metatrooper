// M8-18e: blame on an agent line names the agent, the run and the age.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = (f: string) => fs.readFileSync(new URL(`../ui/src/${f}`, import.meta.url), 'utf8');
const grab = (source: string, re: RegExp, what: string) => {
  const body = source.match(re)?.[0];
  assert.ok(body, `${what} must exist`);
  return body.replace(/^export /, '');
};

const NOW = Date.parse('2026-01-01T12:00:00Z');
const minAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();

function blameHarness(sessions: any[], changed: Record<string, string[]>) {
  const ide = src('ide.jsx');
  const code = [
    grab(ide, /^const ago = .*$/m, 'ago'),
    grab(ide, /^function blameOf\([^]*?^\}/m, 'blameOf'),
  ].join('\n');
  const deps = {
    ui: { snap: { sessions } },
    changedFiles: (id: string) => changed[id] || [],
    slashed: (f: string) => String(f).split(String.fromCharCode(92)).join('/'),
    ownerOf: (path: string, preferred?: string) => {
      const has = (id: string) => (changed[id] || []).some((f) => f.split(String.fromCharCode(92)).join('/') === path);
      if (preferred && has(preferred)) return preferred;
      return sessions.find((y) => has(y.id))?.id ?? null;
    },
  };
  return new Function(...Object.keys(deps), code + '\nreturn blameOf;')(...Object.values(deps));
}

test('blameOf names the engine, run and age of the owning agent', (t) => {
  const real = Date.now;
  Date.now = () => NOW;
  t.after(() => { Date.now = real; });
  const sessions = [
    { id: 's1', engine_id: 'claude', run_id: 'run-7', started_at: minAgo(12) },
    { id: 's2', engine_id: 'codex', run_id: 'run-9', started_at: minAgo(180) },
  ];
  const blameOf = blameHarness(sessions, { s1: ['a.ts'], s2: ['dir' + String.fromCharCode(92) + 'b.ts'] });
  assert.equal(blameOf({ path: 'a.ts' }), 'Changed by claude, run run-7, started 12 min ago');
  assert.equal(blameOf({ path: 'dir/b.ts' }), 'Changed by codex, run run-9, started 3 h ago');
});

test('blameOf falls back to the session id without a run id', (t) => {
  const real = Date.now;
  Date.now = () => NOW;
  t.after(() => { Date.now = real; });
  const blameOf = blameHarness([{ id: 's1', engine_id: 'claude', started_at: minAgo(5) }], { s1: ['a.ts'] });
  assert.equal(blameOf({ path: 'a.ts' }), 'Changed by claude, run s1, started 5 min ago');
});

test('blameOf is null for a git diff tab or a file no agent owns', () => {
  const blameOf = blameHarness([{ id: 's1', engine_id: 'claude', run_id: 'r', started_at: minAgo(1) }], { s1: ['a.ts'] });
  assert.equal(blameOf({ path: 'a.ts', gitDiff: true }), null);
  assert.equal(blameOf({ path: 'other.ts' }), null);
});

function diffHarness(hooks: any, changes: () => any[]) {
  const code = grab(src('editor.js'), /^export function openDiff\([^]*?^\}/m, 'openDiff');
  const sets: any[][] = [];
  let update: () => void = () => {};
  const editor = (label: string) => ({
    label, updateOptions() {}, onMouseMove() {}, onMouseLeave() {}, onMouseDown() {}, onDidScrollChange() {}, onDidLayoutChange() {},
    createDecorationsCollection: () => ({ set: (d: any[]) => { sets.push(d); }, clear() {} }),
  });
  const orig = editor('orig'), mod = editor('mod');
  const fake = {
    setModel() {}, getOriginalEditor: () => orig, getModifiedEditor: () => mod,
    getLineChanges: () => changes(), onDidUpdateDiff: (f: () => void) => { update = f; }, dispose() {},
  };
  const m = {
    editor: { createModel: () => ({ dispose() {} }), createDiffEditor: () => fake, MouseTargetType: {} },
    Range: class { a: number; b: number; c: number; d: number; constructor(a: number, b: number, c: number, d: number) { Object.assign(this, { a, b, c, d }); } },
  };
  const deps = { loadMonaco: () => Promise.resolve(m), appKeys() {}, options: () => ({}), langOf: () => 'plaintext', sameZone: () => false };
  const openDiff = new Function(...Object.keys(deps), code + '\nreturn openDiff;')(...Object.values(deps));
  return { run: async () => { openDiff({}, { original: 'a', modified: 'b' }, 'a.ts', hooks); await new Promise((r) => setImmediate(r)); }, sets, update: () => update() };
}

const lc = (s: number, e: number) => ({ modifiedStartLineNumber: s, modifiedEndLineNumber: e });

test('openDiff with a blame hook decorates the modified ranges, skips pure deletions, and redraws on update', async () => {
  let text = 'Changed by claude, run r1, started 1 min ago';
  let changes = [lc(2, 4), lc(6, 0), lc(9, 9)];
  const h = diffHarness({ blame: () => text }, () => changes);
  await h.run();
  h.update();
  assert.equal(h.sets.length, 1);
  const spans = (d: any[]) => d.map((x) => [x.range.a, x.range.b, x.range.c, x.range.d]);
  assert.deepEqual(spans(h.sets[0]), [[2, 1, 4, 1], [9, 1, 9, 1]]);
  for (const x of h.sets[0]) {
    assert.equal(x.options.isWholeLine, true);
    assert.equal(x.options.linesDecorationsClassName, 'cc-agent-line');
    assert.deepEqual(x.options.hoverMessage, { value: text });
  }
  text = 'Changed by codex, run r2, started 3 h ago';
  changes = [lc(1, 1)];
  h.update();
  assert.equal(h.sets.length, 2);
  assert.deepEqual(spans(h.sets[1]), [[1, 1, 1, 1]]);
  assert.deepEqual(h.sets[1][0].options.hoverMessage, { value: text });
});

test('openDiff without a blame hook sets no blame decorations', async () => {
  const h = diffHarness({}, () => [lc(2, 4)]);
  await h.run();
  h.update();
  assert.equal(h.sets.length, 0);
});
