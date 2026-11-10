import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { buildMethods } from '../src/methods.ts';
import { CommandRunner } from '../src/pipe/commands.ts';

// Create temporary fixture database with core migrations.
async function fixture(run: (db: DatabaseSync, methods: ReturnType<typeof buildMethods>, runner: CommandRunner) => Promise<void> | void) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-night-labels-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  let db: DatabaseSync | undefined;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.METATROOPER_HOME = path.join(home, 'mt');
    const { openCoreDb } = await import('../src/store/db.ts');
    db = openCoreDb();
    const ctl = { engines: () => [], stop: () => {}, uiKey: 'test_key' };
    const methods = buildMethods(db, ctl);
    const runner = new CommandRunner(db, methods);
    await run(db, methods, runner);
  } finally {
    try { db?.close(); } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
}

// Insert project, engine, and session rows into database.
function seedSession(db: DatabaseSync, sessionId: string, projectId: string, hidden = 0) {
  const at = '2026-11-10T00:00:00.000Z';
  db.prepare('INSERT OR IGNORE INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run(projectId, '/fixture/' + projectId, projectId, at, at);
  db.prepare('INSERT OR IGNORE INTO engine (id, spec_json, cost_rank) VALUES (?, ?, 1)').run('claude', '{}');
  db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sessionId, projectId, 'claude', 'pty', 'working', at, at, hidden);
}

test('session.labels-set rejects non-array or non-string elements with -32602', async () => {
  await fixture(async (db, methods) => {
    seedSession(db, 's1', 'p1');
    const ctx = { ui: true, origin: 'test' };
    const handler = methods.get('session.labels-set')!.handler;

    // Verify non-array inputs throw -32602.
    for (const bad of ['not-an-array', 123, null, undefined, {}]) {
      await assert.rejects(async () => handler({ session_id: 's1', labels: bad }, ctx), (err: any) => err.code === -32602);
    }

    // Verify non-string array elements throw -32602.
    for (const badList of [[123], ['valid', null], ['valid', 42], [{}], [true]]) {
      await assert.rejects(async () => handler({ session_id: 's1', labels: badList }, ctx), (err: any) => err.code === -32602);
    }
  });
});

test('session.labels-set trims each label and stores trimmed value', async () => {
  await fixture(async (db, methods) => {
    seedSession(db, 's1', 'p1');
    const ctx = { ui: true, origin: 'test' };
    const handler = methods.get('session.labels-set')!.handler;

    // Call handler with leading and trailing whitespace.
    const res = await handler({ session_id: 's1', labels: ['  a  '] }, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(res)), { labels: ['a'] });

    // Verify stored name in session_label table.
    const stored = db.prepare('SELECT name FROM session_label WHERE session_id = ?').all('s1');
    assert.deepEqual(JSON.parse(JSON.stringify(stored)), [{ name: 'a' }]);
  });
});

test('session.labels-set removes duplicates after trimming', async () => {
  await fixture(async (db, methods) => {
    seedSession(db, 's1', 'p1');
    const ctx = { ui: true, origin: 'test' };
    const handler = methods.get('session.labels-set')!.handler;

    // Call handler with entries that collide after trimming.
    const res = await handler({ session_id: 's1', labels: ['x', ' x '] }, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(res)), { labels: ['x'] });

    // Verify exactly one row in session_label table.
    const stored = db.prepare('SELECT name FROM session_label WHERE session_id = ?').all('s1');
    assert.deepEqual(JSON.parse(JSON.stringify(stored)), [{ name: 'x' }]);
  });
});

test('session.labels-set validates label length bounds of 1 to 32 characters', async () => {
  await fixture(async (db, methods) => {
    seedSession(db, 's1', 'p1');
    const ctx = { ui: true, origin: 'test' };
    const handler = methods.get('session.labels-set')!.handler;

    // Verify empty or whitespace-only labels throw -32602.
    await assert.rejects(async () => handler({ session_id: 's1', labels: ['   '] }, ctx), (err: any) => err.code === -32602);
    await assert.rejects(async () => handler({ session_id: 's1', labels: [''] }, ctx), (err: any) => err.code === -32602);

    // Verify 33 character label throws -32602.
    const tooLong = 'a'.repeat(33);
    await assert.rejects(async () => handler({ session_id: 's1', labels: [tooLong] }, ctx), (err: any) => err.code === -32602);

    // Verify exactly 32 characters label is accepted.
    const exactly32 = 'a'.repeat(32);
    const r32 = await handler({ session_id: 's1', labels: [exactly32] }, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(r32)), { labels: [exactly32] });

    // Verify exactly 1 character label is accepted.
    const r1 = await handler({ session_id: 's1', labels: ['b'] }, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(r1)), { labels: ['b'] });
  });
});

test('session.labels-set enforces cap of at most 8 distinct labels', async () => {
  await fixture(async (db, methods) => {
    seedSession(db, 's1', 'p1');
    const ctx = { ui: true, origin: 'test' };
    const handler = methods.get('session.labels-set')!.handler;

    // Verify 9 distinct labels throw -32602.
    const nineDistinct = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    await assert.rejects(async () => handler({ session_id: 's1', labels: nineDistinct }, ctx), (err: any) => err.code === -32602);

    // Verify exactly 8 distinct labels are accepted.
    const eightDistinct = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const r8 = await handler({ session_id: 's1', labels: eightDistinct }, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(r8)), { labels: ['1', '2', '3', '4', '5', '6', '7', '8'] });

    // Verify 9 entries with one duplicate yielding 8 distinct labels are accepted.
    const nineWithDup = ['1', '2', '3', '4', '5', '6', '7', '8', '8'];
    const r9dup = await handler({ session_id: 's1', labels: nineWithDup }, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(r9dup)), { labels: ['1', '2', '3', '4', '5', '6', '7', '8'] });
  });
});

test('session.labels-set rejects unknown session with -32002', async () => {
  await fixture(async (_db, methods) => {
    const ctx = { ui: true, origin: 'test' };
    const handler = methods.get('session.labels-set')!.handler;

    // Verify call with nonexistent session id throws -32002.
    await assert.rejects(async () => handler({ session_id: 'unknown_session', labels: ['tag'] }, ctx), (err: any) => err.code === -32002);
  });
});

test('session.labels-set replaces existing set and empty array clears all labels', async () => {
  await fixture(async (db, methods) => {
    seedSession(db, 's1', 'p1');
    const ctx = { ui: true, origin: 'test' };
    const handler = methods.get('session.labels-set')!.handler;

    // Set initial labels.
    const first = await handler({ session_id: 's1', labels: ['beta', 'alpha'] }, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(first)), { labels: ['alpha', 'beta'] });

    // Replace with second set of labels.
    const second = await handler({ session_id: 's1', labels: ['gamma'] }, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(second)), { labels: ['gamma'] });
    const storedAfterSecond = db.prepare('SELECT name FROM session_label WHERE session_id = ? ORDER BY name').all('s1');
    assert.deepEqual(JSON.parse(JSON.stringify(storedAfterSecond)), [{ name: 'gamma' }]);

    // Clear all labels with empty array.
    const cleared = await handler({ session_id: 's1', labels: [] }, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(cleared)), { labels: [] });
    const storedAfterClear = db.prepare('SELECT name FROM session_label WHERE session_id = ? ORDER BY name').all('s1');
    assert.deepEqual(JSON.parse(JSON.stringify(storedAfterClear)), []);
  });
});

test('session.labels-set leaves existing labels unchanged on validation failure in one transaction', async () => {
  await fixture(async (db, methods) => {
    seedSession(db, 's1', 'p1');
    const ctx = { ui: true, origin: 'test' };
    const handler = methods.get('session.labels-set')!.handler;

    // Establish initial stored labels.
    await handler({ session_id: 's1', labels: ['keep_a', 'keep_b'] }, ctx);

    // Attempt invalid updates and verify rejection.
    await assert.rejects(async () => handler({ session_id: 's1', labels: ['valid', ''] }, ctx), (err: any) => err.code === -32602);
    await assert.rejects(async () => handler({ session_id: 's1', labels: ['valid', 'a'.repeat(33)] }, ctx), (err: any) => err.code === -32602);
    await assert.rejects(async () => handler({ session_id: 's1', labels: ['1', '2', '3', '4', '5', '6', '7', '8', '9'] }, ctx), (err: any) => err.code === -32602);

    // Verify initial stored labels remain intact.
    const stored = db.prepare('SELECT name FROM session_label WHERE session_id = ? ORDER BY name').all('s1');
    assert.deepEqual(JSON.parse(JSON.stringify(stored)), [{ name: 'keep_a' }, { name: 'keep_b' }]);
  });
});

test('session.labels-set requires UI authentication and labels.list is available to non-UI caller', async () => {
  await fixture(async (db, methods, runner) => {
    seedSession(db, 's1', 'p1');

    // Verify needsUi declaration flags.
    assert.equal(Boolean(methods.get('session.labels-set')!.needsUi), true);
    assert.equal(Boolean(methods.get('labels.list')!.needsUi), false);

    // Verify command runner rejects session.labels-set without UI authentication.
    await assert.rejects(
      async () => runner.call({ id: 'c1', method: 'session.labels-set', params: { session_id: 's1', labels: ['tag'] }, origin: 'cli' }, { ui: false, origin: 'cli' }),
      (err: any) => err.code === -32012,
    );

    // Verify command runner accepts session.labels-set with UI authentication.
    const resSet = await runner.call(
      { id: 'c2', method: 'session.labels-set', params: { session_id: 's1', labels: ['tag'] }, origin: 'workbench' },
      { ui: true, origin: 'workbench' },
    );
    assert.deepEqual(JSON.parse(JSON.stringify(resSet)), { labels: ['tag'] });

    // Verify command runner accepts labels.list without UI authentication.
    const resList = await runner.call(
      { id: 'c3', method: 'labels.list', params: { project_id: 'p1' }, origin: 'cli' },
      { ui: false, origin: 'cli' },
    );
    assert.deepEqual(JSON.parse(JSON.stringify(resList)), { labels: [{ name: 'tag', count: 1 }] });
  });
});

test('labels.list aggregates session counts per label within project ordered by count desc then name asc', async () => {
  await fixture(async (db, methods) => {
    // Seed visible and hidden sessions in project p1.
    seedSession(db, 's1', 'p1', 0);
    seedSession(db, 's2', 'p1', 0);
    seedSession(db, 's3', 'p1', 1);

    // Seed session in another project p2.
    seedSession(db, 's4', 'p2', 0);

    const ctx = { ui: true, origin: 'test' };
    const setHandler = methods.get('session.labels-set')!.handler;
    const listHandler = methods.get('labels.list')!.handler;

    // Assign labels across sessions.
    await setHandler({ session_id: 's1', labels: ['bug', 'urgent', 'frontend'] }, ctx);
    await setHandler({ session_id: 's2', labels: ['bug', 'urgent'] }, ctx);
    await setHandler({ session_id: 's3', labels: ['bug', 'docs'] }, ctx);
    await setHandler({ session_id: 's4', labels: ['bug', 'other'] }, ctx);

    // Query labels list for project p1.
    const resP1 = await listHandler({ project_id: 'p1' }, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(resP1)), {
      labels: [
        { name: 'bug', count: 3 },
        { name: 'urgent', count: 2 },
        { name: 'docs', count: 1 },
        { name: 'frontend', count: 1 },
      ],
    });

    // Seed empty project without sessions.
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p_empty', '/fixture/p_empty', 'empty', 'x', 'x')").run();
    const resEmpty = await listHandler({ project_id: 'p_empty' }, ctx);
    assert.deepEqual(JSON.parse(JSON.stringify(resEmpty)), { labels: [] });
  });
});

test('labels.list rejects missing or invalid project_id with -32602', async () => {
  await fixture(async (_db, methods) => {
    const ctx = { ui: true, origin: 'test' };
    const handler = methods.get('labels.list')!.handler;

    // Verify missing or empty project_id throws -32602.
    await assert.rejects(async () => handler({}, ctx), (err: any) => err.code === -32602);
    await assert.rejects(async () => handler({ project_id: '' }, ctx), (err: any) => err.code === -32602);
    await assert.rejects(async () => handler({ project_id: 123 }, ctx), (err: any) => err.code === -32602);
  });
});
