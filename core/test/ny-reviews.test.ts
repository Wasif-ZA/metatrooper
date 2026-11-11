import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { buildMethods } from '../src/methods.ts';
import { CommandRunner } from '../src/pipe/commands.ts';
import { appendEvent } from '../src/events/append.ts';
import { processEvents } from '../src/events/processor.ts';
import { finishedOk, parseVerdict, reviewPrompt, reviewTick, type ReviewDeps } from '../src/reviews.ts';

const ui = { ui: true, origin: 'test' };
const AT = '2026-11-11T00:00:00.000Z';

async function fixture(run: (db: DatabaseSync, methods: ReturnType<typeof buildMethods>, runner: CommandRunner) => Promise<void> | void) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-ny-reviews-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  let db: DatabaseSync | undefined;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.METATROOPER_HOME = path.join(home, 'mt');
    const { openCoreDb } = await import('../src/store/db.ts');
    db = openCoreDb();
    const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'test_key' });
    await run(db, methods, new CommandRunner(db, methods));
  } finally {
    try { db?.close(); } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
}

function seed(db: DatabaseSync, id: string, state = 'working', parent: string | null = null) {
  db.prepare("INSERT OR IGNORE INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/fixture/p1', 'p1', ?, ?)").run(AT, AT);
  for (const e of ['claude', 'codex', 'gemini']) db.prepare("INSERT OR IGNORE INTO engine (id, spec_json, cost_rank) VALUES (?, '{}', 1)").run(e);
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, cwd, prompt, state, state_at, started_at, parent_id) VALUES (?, 'p1', 'claude', 'pty', '/fixture/p1/wt', 'add the login page', ?, ?, ?, ?)")
    .run(id, state, AT, AT, parent);
}

const rows = (db: DatabaseSync, id: string) => db.prepare('SELECT kind, who, state, note, review_session_id FROM session_review WHERE session_id = ? ORDER BY kind, who').all(id).map((r) => ({ ...r }));

// Fake engine deps: launch records calls and seeds a child row; readLines returns the scripted screen.
function fakeDeps(db: DatabaseSync, screens: Record<string, string[]> = {}) {
  const launched: Array<{ parent: string; engine: string; cwd: string | null; prompt: string }> = [];
  const deps: ReviewDeps = {
    launch: (row, engine, prompt) => {
      const child = `rv_${engine}_${launched.length}`;
      launched.push({ parent: row.session_id, engine, cwd: row.cwd, prompt });
      seed(db, child, 'working', row.session_id);
      return child;
    },
    readLines: async (id) => screens[id] ?? null,
  };
  return { deps, launched };
}

function exitOk(db: DatabaseSync, id: string) {
  appendEvent('claude.Stop', id, {}, db);
  appendEvent('core.process-gone', id, { code: 0 }, db);
  processEvents(db);
}

function setChild(db: DatabaseSync, id: string, state: string) {
  db.prepare('UPDATE session SET state = ? WHERE id = ?').run(state, id);
}

test('migration 016 creates session_review and records itself', async () => {
  await fixture((db) => {
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_review'").get());
    assert.ok(db.prepare('SELECT 1 FROM schema_migration WHERE id = 16').get());
  });
});

test('reviewers-set is refused without a trusted UI connection', async () => {
  await fixture(async (db, methods, runner) => {
    seed(db, 's1');
    for (const method of ['session.reviewers-set', 'session.approve', 'session.reject']) assert.equal(methods.get(method)!.needsUi, true, method);
    await assert.rejects(async () => runner.call({ method: 'session.reviewers-set', params: { session_id: 's1', reviewers: ['codex'], approvers: [] } } as never, { ui: false, origin: 'test' } as never), /needs a trusted UI connection/);
    assert.deepEqual(rows(db, 's1'), []);
  });
});

test('reviewers-set validates engines, approvers and the session', async () => {
  await fixture(async (db, methods) => {
    seed(db, 's1');
    const set = methods.get('session.reviewers-set')!.handler;
    const code = (n: number) => (e: { code: number }) => e.code === n;
    await assert.rejects(async () => set({ session_id: 's1', reviewers: 'codex', approvers: [] }, ui), code(-32602));
    await assert.rejects(async () => set({ session_id: 's1', reviewers: [7], approvers: [] }, ui), code(-32602));
    await assert.rejects(async () => set({ session_id: 's1', reviewers: ['nope'], approvers: [] }, ui), code(-32602));
    await assert.rejects(async () => set({ session_id: 's1', reviewers: [], approvers: ['bob'] }, ui), code(-32602));
    await assert.rejects(async () => set({ session_id: 'missing', reviewers: ['codex'], approvers: [] }, ui), code(-32002));
    assert.deepEqual(rows(db, 's1'), []);
  });
});

test('reviewers-set replaces the set and keeps the state of rows it keeps', async () => {
  await fixture(async (db, methods) => {
    seed(db, 's1');
    const set = methods.get('session.reviewers-set')!.handler;
    assert.deepEqual(await set({ session_id: 's1', reviewers: ['codex', 'gemini', 'codex'], approvers: ['you'] }, ui), { ok: true });
    assert.deepEqual(rows(db, 's1').map((r) => [r.kind, r.who, r.state]), [['approver', 'you', 'pending'], ['reviewer', 'codex', 'pending'], ['reviewer', 'gemini', 'pending']]);
    db.prepare("UPDATE session_review SET state = 'passed', note = 'fine' WHERE who = 'codex'").run();
    await set({ session_id: 's1', reviewers: ['codex'], approvers: [] }, ui);
    assert.deepEqual(rows(db, 's1'), [{ kind: 'reviewer', who: 'codex', state: 'passed', note: 'fine', review_session_id: null }]);
  });
});

test('a session that exits ok launches one review child per reviewer, once, in its folder', async () => {
  await fixture(async (db, methods) => {
    seed(db, 's1');
    await methods.get('session.reviewers-set')!.handler({ session_id: 's1', reviewers: ['codex', 'gemini'], approvers: ['you'] }, ui);
    const { deps, launched } = fakeDeps(db);
    await reviewTick(db, deps);
    assert.equal(launched.length, 0, 'nothing launches while the session runs');
    exitOk(db, 's1');
    assert.equal((db.prepare('SELECT outcome FROM session WHERE id = ?').get('s1') as { outcome: string }).outcome, 'succeeded');
    await reviewTick(db, deps);
    await reviewTick(db, deps);
    assert.deepEqual(launched.map((l) => [l.parent, l.engine, l.cwd]), [['s1', 'codex', '/fixture/p1/wt'], ['s1', 'gemini', '/fixture/p1/wt']]);
    assert.match(launched[0].prompt, /add the login page/);
    assert.deepEqual(rows(db, 's1').filter((r) => r.kind === 'reviewer').map((r) => r.review_session_id), ['rv_codex_0', 'rv_gemini_1']);
  });
});

test('a session that exits failed or cancelled launches no review', async () => {
  await fixture(async (db, methods) => {
    seed(db, 's1');
    seed(db, 's2');
    for (const id of ['s1', 's2']) await methods.get('session.reviewers-set')!.handler({ session_id: id, reviewers: ['codex'], approvers: [] }, ui);
    appendEvent('claude.Stop', 's1', {}, db);
    appendEvent('core.process-gone', 's1', { code: 2 }, db);
    appendEvent('core.process-gone', 's2', { code: 0 }, db);
    processEvents(db);
    const { deps, launched } = fakeDeps(db);
    await reviewTick(db, deps);
    assert.equal(launched.length, 0);
  });
});

test('review verdicts land as passed or failed with a note; no verdict at exit fails', async () => {
  await fixture(async (db, methods) => {
    seed(db, 's1');
    await methods.get('session.reviewers-set')!.handler({ session_id: 's1', reviewers: ['claude', 'codex', 'gemini'], approvers: [] }, ui);
    const screens: Record<string, string[]> = {
      rv_claude_0: ['> Review the work ... End your reply with a final line made of the word VERDICT', '● VERDICT: FAIL - old', '● VERDICT: PASS - tests cover the login form'],
      rv_codex_1: ['checking', 'VERDICT: FAIL: the password is logged'],
      rv_gemini_2: ['I looked at the diff.'],
    };
    const { deps } = fakeDeps(db, screens);
    exitOk(db, 's1');
    await reviewTick(db, deps);
    await reviewTick(db, deps);
    assert.deepEqual(rows(db, 's1').map((r) => r.state), ['pending', 'pending', 'pending'], 'children still working: no verdict read');
    setChild(db, 'rv_claude_0', 'done');
    setChild(db, 'rv_codex_1', 'exited');
    setChild(db, 'rv_gemini_2', 'idle');
    await reviewTick(db, deps);
    assert.deepEqual(rows(db, 's1').map((r) => [r.who, r.state, r.note]), [
      ['claude', 'passed', 'tests cover the login form'],
      ['codex', 'failed', 'the password is logged'],
      ['gemini', 'pending', null],
    ]);
    setChild(db, 'rv_gemini_2', 'exited');
    await reviewTick(db, deps);
    assert.deepEqual(rows(db, 's1').find((r) => r.who === 'gemini'), { kind: 'reviewer', who: 'gemini', state: 'failed', note: 'no verdict', review_session_id: 'rv_gemini_2' });
    const needs = db.prepare("SELECT text FROM needs_you WHERE ref = 's1' AND kind = 'failed' ORDER BY text").all().map((r) => (r as { text: string }).text);
    assert.deepEqual(needs, ['codex review failed: the password is logged', 'gemini review failed: no verdict']);
  });
});

test('a launch that throws fails the review with the reason', async () => {
  await fixture(async (db, methods) => {
    seed(db, 's1');
    await methods.get('session.reviewers-set')!.handler({ session_id: 's1', reviewers: ['codex'], approvers: [] }, ui);
    exitOk(db, 's1');
    await reviewTick(db, { launch: () => { throw new Error('codex is not installed'); }, readLines: async () => null });
    assert.deepEqual(rows(db, 's1').map((r) => [r.state, r.note]), [['failed', 'could not launch: codex is not installed']]);
  });
});

test('approve and reject set the "you" approver; reject needs a note and raises Needs you', async () => {
  await fixture(async (db, methods) => {
    seed(db, 's1');
    seed(db, 's2');
    const call = (m: string, p: Record<string, unknown>) => methods.get(m)!.handler(p, ui);
    await assert.rejects(async () => call('session.approve', { session_id: 's1' }), (e: { code: number }) => e.code === -32002);
    await call('session.reviewers-set', { session_id: 's1', reviewers: [], approvers: ['you'] });
    await call('session.reviewers-set', { session_id: 's2', reviewers: [], approvers: ['you'] });
    assert.deepEqual(await call('session.approve', { session_id: 's1', note: 'looks right' }), { ok: true });
    assert.deepEqual(rows(db, 's1').map((r) => [r.state, r.note]), [['passed', 'looks right']]);
    await assert.rejects(async () => call('session.reject', { session_id: 's2' }), (e: { code: number }) => e.code === -32602);
    await assert.rejects(async () => call('session.reject', { session_id: 's2', note: '   ' }), (e: { code: number }) => e.code === -32602);
    assert.deepEqual(rows(db, 's2').map((r) => r.state), ['pending']);
    await call('session.reject', { session_id: 's2', note: 'wrong page' });
    assert.deepEqual(rows(db, 's2').map((r) => [r.state, r.note]), [['failed', 'wrong page']]);
    assert.deepEqual(db.prepare("SELECT kind, text FROM needs_you WHERE ref = 's2'").all().map((r) => ({ ...r })), [{ kind: 'failed', text: 'You rejected this: wrong page' }]);
    assert.equal(db.prepare("SELECT count(*) AS n FROM needs_you WHERE ref = 's1'").get()!.n, 0);
  });
});

test('parseVerdict takes the last verdict line and the prompt never matches it', () => {
  assert.equal(parseVerdict(reviewPrompt({ prompt: 'x', started_at: AT }).split('. ')), null);
  assert.deepEqual(parseVerdict(['VERDICT: PASS', 'later text']), { passed: true, note: null });
  assert.deepEqual(parseVerdict(['  ⏺ verdict: fail — no tests']), { passed: false, note: '— no tests' });
  assert.equal(parseVerdict(['VERDICT: MAYBE']), null);
  assert.ok(!reviewPrompt({ prompt: 'a\nb', started_at: AT }).includes('\n'));
});

const outcomeOf = (db: DatabaseSync, id: string) => (db.prepare('SELECT outcome FROM session WHERE id = ?').get(id) as { outcome: string }).outcome;

test('done, card opened (idle), then exited counts as finished ok and launches the review', async () => {
  await fixture(async (db, methods) => {
    seed(db, 's1');
    await methods.get('session.reviewers-set')!.handler({ session_id: 's1', reviewers: ['codex'], approvers: [] }, ui);
    appendEvent('claude.Stop', 's1', {}, db);
    processEvents(db);
    await methods.get('session.seen')!.handler({ session_id: 's1' }, ui);
    processEvents(db);
    assert.equal((db.prepare('SELECT state FROM session WHERE id = ?').get('s1') as { state: string }).state, 'idle');
    appendEvent('core.process-gone', 's1', { code: 0 }, db);
    processEvents(db);
    assert.equal(outcomeOf(db, 's1'), 'cancelled');
    assert.equal(finishedOk(db, 's1'), true);
    const { deps, launched } = fakeDeps(db);
    await reviewTick(db, deps);
    assert.deepEqual(launched.map((l) => [l.parent, l.engine]), [['s1', 'codex']]);
  });
});

test('finishedOk is false for a failed exit, a kill before done, and work resumed after done', async () => {
  await fixture(async (db, methods) => {
    for (const id of ['f1', 'k1', 'r1']) {
      seed(db, id);
      await methods.get('session.reviewers-set')!.handler({ session_id: id, reviewers: ['codex'], approvers: [] }, ui);
    }
    appendEvent('claude.Stop', 'f1', {}, db);
    appendEvent('core.process-gone', 'f1', { code: 1 }, db);
    appendEvent('core.process-gone', 'k1', { code: 0 }, db);
    appendEvent('claude.Stop', 'r1', {}, db);
    appendEvent('claude.PostToolUse', 'r1', { tool_use_id: 't1' }, db);
    appendEvent('core.interrupted', 'r1', {}, db);
    appendEvent('core.process-gone', 'r1', { code: 0 }, db);
    processEvents(db);
    assert.deepEqual(['f1', 'k1', 'r1'].map((id) => [outcomeOf(db, id), finishedOk(db, id)]), [['failed', false], ['cancelled', false], ['cancelled', false]]);
    const { deps, launched } = fakeDeps(db);
    await reviewTick(db, deps);
    assert.equal(launched.length, 0);
  });
});

test('finishedOk on an older database without session_state_log takes succeeded only', async () => {
  await fixture(async (db) => {
    seed(db, 'ok1');
    seed(db, 'c1');
    db.prepare("INSERT INTO session_state_log (session_id, at, state) VALUES ('c1', ?, 'done')").run(AT);
    db.prepare("UPDATE session SET state = 'exited', outcome = 'succeeded' WHERE id = 'ok1'").run();
    db.prepare("UPDATE session SET state = 'exited', outcome = 'cancelled' WHERE id = 'c1'").run();
    assert.equal(finishedOk(db, 'c1'), true);
    db.exec('DROP TABLE session_state_log');
    assert.equal(finishedOk(db, 'ok1'), true);
    assert.equal(finishedOk(db, 'c1'), false);
    assert.equal(finishedOk(db, 'missing'), false);
  });
});
