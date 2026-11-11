import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { snapshot } from '../src/queries.ts';
import { checksOf, refreshRowGit, rowGit } from '../src/rowgit.ts';
import { ENGINE_MARKS, engineMarkSvg, engineName } from '../ui/src/icons/engine-marks.js';

const wb = resolve(import.meta.dirname, '..');
const schema = readFileSync(resolve(wb, '../contracts/schema.sql'), 'utf8');
const T = (min: number) => new Date(Date.UTC(2026, 10, 11, 0, min)).toISOString();

function fixture(steps: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-home-data-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  if (steps) db.exec('CREATE TABLE session_step (session_id TEXT REFERENCES session(id), idx INTEGER, text TEXT, done INTEGER, PRIMARY KEY (session_id, idx))');
  for (const p of ['p1', 'p2', 'p3']) mkdirSync(join(dir, p));
  for (const p of ['p1', 'p2', 'p3']) db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run(p, join(dir, p), p, T(0), T(p === 'p1' ? 9 : 1));
  db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1), ('codex', '{}', 2)").run();
  const add = db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, parent_id, wait_reason, prompt) VALUES (?, ?, ?, 'pty', ?, ?, ?, ?, ?, ?)");
  return { dir, db, add, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('snapshot sessions and live carry project_id, parent_id, reason and steps; the tree spans projects with open sessions and the last 10 exited', () => {
  const f = fixture(true);
  try {
    f.add.run('parent', 'p1', 'claude', 'waiting_for_you', T(5), T(1), null, 'permission', 'split checkout');
    f.add.run('kid', 'p1', 'codex', 'working', T(6), T(2), 'parent', null, null);
    for (let i = 0; i < 12; i++) f.add.run(`old${i}`, 'p1', 'claude', 'exited', T(10 + i), T(i), null, null, null);
    f.add.run('other', 'p2', 'codex', 'working', T(3), T(3), null, null, null);
    const step = f.db.prepare('INSERT INTO session_step (session_id, idx, text, done) VALUES (?, ?, ?, ?)');
    step.run('parent', 1, 'second', 0);
    step.run('parent', 0, 'first', 1);
    step.run('parent', 2, 'third', 1);
    f.db.prepare("INSERT INTO usage (at, session_id, engine_id, provider, model, source, dedupe_key) VALUES (?, 'kid', 'codex', 'local-cli', 'gpt-x', 'unknown', 'k1')").run(T(6));
    const snap = JSON.parse(JSON.stringify(snapshot(f.db, 'p1')));
    const want = { done: 2, total: 3, items: [{ text: 'first', done: true }, { text: 'second', done: false }, { text: 'third', done: true }] };
    const s = snap.sessions.find((x: { id: string }) => x.id === 'parent');
    assert.deepEqual([s.project_id, s.parent_id, s.reason, s.steps], ['p1', null, 'permission', want]);
    const live = Object.fromEntries(snap.live.map((x: { id: string }) => [x.id, x]));
    assert.deepEqual([live.parent.reason, live.parent.steps, live.kid.parent_id, live.kid.steps, live.other.project_id], ['permission', want, 'parent', null, 'p2']);
    assert.deepEqual(snap.tree.map((g: { project_id: string; name: string }) => [g.project_id, g.name]), [['p1', 'p1'], ['p2', 'p2']], 'p3 has no sessions, so no group');
    const p1 = snap.tree[0].sessions as string[];
    assert.equal(p1.filter((id) => id.startsWith('old')).length, 10);
    assert.ok(!p1.includes('old0') && !p1.includes('old1') && p1.includes('old11'), 'the 10 most recently exited stay');
    assert.ok(p1.includes('parent') && p1.includes('kid'));
    assert.deepEqual(Object.keys(snap.tree_rows).sort(), [...p1, 'other'].sort());
    assert.deepEqual([snap.tree_rows.kid.parent_id, snap.tree_rows.kid.model, snap.tree_rows.parent.prompt, snap.tree_rows.parent.steps.total], ['parent', 'gpt-x', 'split checkout', 3]);
  } finally { f.close(); }
});

test('a database without session_step gives steps null', () => {
  const f = fixture(false);
  try {
    f.add.run('a', 'p1', 'claude', 'working', T(1), T(1), null, null, null);
    const snap = snapshot(f.db, 'p1');
    assert.equal(snap.sessions[0].steps, null);
    assert.equal(snap.live[0].steps, null);
    assert.equal(snap.tree_rows?.a.steps, null);
  } finally { f.close(); }
});

function frame() {
  const ctx: any = { document: { documentElement: { classList: { contains: () => false } }, addEventListener() {} }, STATE_ORDER: [], STATE_WORDS: {}, esc: String, taskOf: (x: { id: string }) => x.id };
  ctx.globalThis = ctx;
  vm.runInNewContext(readFileSync(join(wb, 'renderer/frame.js'), 'utf8'), ctx);
  return ((...a: unknown[]) => JSON.parse(JSON.stringify(ctx.frameView.treeGroups(...a)))) as (...a: unknown[]) => Array<{ project_id: string; worktrees: Array<{ title: string; branch: string | null; primary: boolean; state: string; selected: boolean; lines: Array<{ id: string; depth: number }> }> }>;
}

test('the sidebar tree groups each project into worktrees, sub-agents under their parent, primary first', () => {
  const treeGroups = frame();
  const row = (id: string, state: string, parent: string | null, cwd: string) => ({ id, state, parent_id: parent, cwd, project_id: 'p1', engine_id: 'claude' });
  const rows = {
    lead: row('lead', 'working', null, 'C:\\r\\wt-a\\src'),
    k1: row('k1', 'waiting_for_you', 'lead', 'C:\\r\\elsewhere'),
    k2: row('k2', 'exited', 'lead', 'C:\\r\\wt-a'),
    k3: row('k3', 'working', 'lead', 'C:\\r\\wt-a'),
    gk: row('gk', 'working', 'k1', 'C:\\r\\wt-a'),
    main: row('main', 'exited', null, 'C:/r/repo'),
    orphan: row('orphan', 'working', 'gone', 'C:/r/repo'),
    hid: row('hid', 'working', null, 'C:/r/repo'),
  };
  const git = { lead: { root: 'C:/r/wt-a', branch: 'fix/a' }, main: { root: 'C:/r/repo', branch: 'main' } };
  const tree = [{ project_id: 'p1', name: 'repo', sessions: ['main', 'lead', 'k1', 'k2', 'k3', 'gk', 'orphan', 'hid'] }, { project_id: 'p2', name: 'empty', sessions: ['missing'] }];
  const out = treeGroups(tree, rows, git, [{ id: 'p1', path: 'C:\\r\\repo\\' }], new Set(['hid']), 'k3');
  assert.equal(out.length, 1, 'a project with no drawable rows is left out');
  const [primary, wt] = out[0].worktrees;
  assert.deepEqual([primary.title, primary.primary, primary.branch, primary.state, primary.lines], ['repo', true, 'main', 'work', [{ id: 'orphan', depth: 0 }, { id: 'main', depth: 0 }]]);
  assert.deepEqual([wt.title, wt.primary, wt.branch, wt.state, wt.selected], ['wt-a', false, 'fix/a', 'wait', true]);
  assert.deepEqual(wt.lines, [{ id: 'lead', depth: 0 }, { id: 'k1', depth: 1 }, { id: 'gk', depth: 2 }, { id: 'k3', depth: 1 }, { id: 'k2', depth: 1 }]);
});

test('a parent cycle still draws every row once', () => {
  const treeGroups = frame();
  const rows = { a: { id: 'a', state: 'working', parent_id: 'b', cwd: '/x' }, b: { id: 'b', state: 'working', parent_id: 'a', cwd: '/x' } };
  const out = treeGroups([{ project_id: 'p', name: 'p', sessions: ['a', 'b'] }], rows, {}, []);
  assert.deepEqual(out[0].worktrees[0].lines, [{ id: 'a', depth: 0 }, { id: 'b', depth: 1 }]);
});

test('row git carries the short commit and one PR lookup per distinct repo and branch', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-home-git-'));
  try {
    const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { cwd: dir, encoding: 'utf8' }).trim();
    git('init', '-q', '-b', 'feat/x');
    writeFileSync(join(dir, 'a.txt'), 'a\n');
    git('add', 'a.txt');
    git('commit', '-q', '-m', 'a');
    const asked: string[] = [];
    const pr = { number: 7, state: 'OPEN', url: 'https://example.invalid/7', checks: 'pass' as const };
    await refreshRowGit([{ id: 'hd1', cwd: dir }, { id: 'hd2', cwd: dir }], {}, async (_top, branch) => { asked.push(branch); return pr; });
    assert.deepEqual(asked, ['feat/x']);
    const g = rowGit();
    assert.deepEqual([g.hd1.commit, g.hd1.branch, g.hd1.pr, g.hd2.pr], [git('rev-parse', '--short', 'HEAD'), 'feat/x', pr, pr]);
    assert.equal(g.hd1.root?.toLowerCase(), git('rev-parse', '--show-toplevel').toLowerCase());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('checksOf reads a statusCheckRollup as fail, pass, pending or null', () => {
  assert.equal(checksOf([]), null);
  assert.equal(checksOf([{ conclusion: 'SUCCESS' }, { state: 'SUCCESS' }, { conclusion: 'SKIPPED' }]), 'pass');
  assert.equal(checksOf([{ conclusion: 'SUCCESS' }, { status: 'IN_PROGRESS' }]), 'pending');
  assert.equal(checksOf([{ status: 'IN_PROGRESS' }, { conclusion: 'FAILURE' }]), 'fail');
});

test('engine marks: each named engine has its own shape and colour and is titled with its name', () => {
  const ids = ['claude', 'codex', 'agy', 'gemini', 'copilot', 'opencode', 'pi'];
  assert.deepEqual(Object.keys(ENGINE_MARKS).sort(), [...ids].sort());
  const inner = ids.map((id) => ENGINE_MARKS[id as keyof typeof ENGINE_MARKS].shape('#000'));
  assert.equal(new Set(inner).size, ids.length, 'shapes differ');
  assert.equal(new Set(ids.map((id) => ENGINE_MARKS[id as keyof typeof ENGINE_MARKS].colour)).size, ids.length, 'colours differ');
  assert.match(engineMarkSvg('codex'), /<title>Codex<\/title>/);
  assert.match(engineMarkSvg('Some<Tool>'), /<title>Some&#60;Tool&#62;<\/title>.*>S<\/text>/);
  assert.equal(engineName(''), 'Unknown engine');
});
