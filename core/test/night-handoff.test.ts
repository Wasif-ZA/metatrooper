import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.ts';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openCoreDb } from '../src/store/db.ts';
import { BUILT_IN, syncEngines } from '../src/engines/registry.ts';
import { appendEvent } from '../src/events/append.ts';
import { processEvents, turnJobsIdle } from '../src/events/processor.ts';
import { ulid } from '../src/time.ts';
import * as methodsModule from '../src/methods.ts';

// Helper to resolve an RPC method handler.
function getMethod(db: DatabaseSync, name: string) {
  for (const exp of Object.values(methodsModule)) {
    if (typeof exp === 'function') {
      try {
        const ctl = { uiKey: 'test', approvalTimeoutMs: 1000, engines: () => [] };
        const res = (exp as (d: DatabaseSync, c: unknown) => Map<string, { handler: (p: Record<string, unknown>) => unknown }>)(db, ctl);
        if (res && typeof res.get === 'function' && res.has(name)) {
          return res.get(name)!.handler;
        }
      } catch {}
    }
  }
  throw new Error(`Method ${name} not found`);
}

// Database fixture helper for handoff tests.
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'troop-night-handoff-'));
  const vars = {
    HOME: home,
    USERPROFILE: home,
    METATROOPER_HOME: join(home, 'mt'),
    METATROOPER_FAKE_DPAPI: '1',
  };
  const previous = new Map(Object.keys(vars).map((key) => [key, process.env[key]]));
  Object.assign(process.env, vars);
  const db = openCoreDb();
  syncEngines(db, BUILT_IN);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', home, 'test-proj', now, now);

  // Helper to insert session.
  const createSession = (opts: { parentId?: string | null; state?: string } = {}) => {
    const id = `s_${randomUUID().replace(/-/g, '')}`;
    const t = new Date().toISOString();
    db.prepare(
      `INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, native_id, parent_id)
       VALUES (?, 'p1', 'claude', 'pty', ?, ?, ?, 'conv', ?)`,
    ).run(id, opts.state ?? 'working', t, t, opts.parentId ?? null);
    return id;
  };

  // Helper to teardown fixture.
  const close = async () => {
    await turnJobsIdle();
    db.close();
    rmSync(home, { recursive: true, force: true });
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };

  return { db, createSession, close };
}

test('exit with parent and no claims writes a handoff row with empty files list', async () => {
  const f = fixture();
  try {
    // Create parent and child sessions.
    const parentId = f.createSession({ state: 'working' });
    const childId = f.createSession({ parentId, state: 'working' });

    // Exit child session.
    appendEvent('core.process-gone', childId, { code: 0 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    // Verify handoff row written.
    const handoffRows = f.db.prepare('SELECT 1 FROM handoff WHERE session_id = ?').all(childId);
    assert.equal(handoffRows.length, 1);

    const handoffRow = f.db.prepare('SELECT session_id, parent_id, files FROM handoff WHERE session_id = ?').get(childId) as { session_id: string; parent_id: string; files: string } | undefined;
    assert.ok(handoffRow);
    const parsed = JSON.parse(JSON.stringify(handoffRow));
    assert.equal(parsed.session_id, childId);
    assert.equal(parsed.parent_id, parentId);
    assert.deepEqual(JSON.parse(parsed.files), []);

    // Verify notice inserted in comment table for parent.
    const notices = f.db.prepare("SELECT body FROM comment WHERE session_id = ? AND kind = 'notice'").all(parentId) as Array<{ body: string }>;
    assert.equal(notices.length, 1);
    assert.match(notices[0].body, /Session .* has ended/);
  } finally {
    await f.close();
  }
});

test('exit with claims and no parent writes a handoff row with parent_id null and sorted files', async () => {
  const f = fixture();
  try {
    // Create orphan session with claims.
    const id = f.createSession({ parentId: null, state: 'working' });
    appendEvent('core.claim', id, { files: [{ path: 'src/zebra.ts' }, { path: 'src/apple.ts' }] }, f.db);
    appendEvent('core.claim', id, { files: [{ path: 'src/mango.ts' }] }, f.db);

    // Exit session.
    appendEvent('core.process-gone', id, { code: 0 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    // Verify handoff row written.
    const handoffRow = f.db.prepare('SELECT session_id, parent_id, files FROM handoff WHERE session_id = ?').get(id) as { session_id: string; parent_id: string | null; files: string } | undefined;
    assert.ok(handoffRow);
    const parsed = JSON.parse(JSON.stringify(handoffRow));
    assert.equal(parsed.session_id, id);
    assert.equal(parsed.parent_id, null);

    // Verify files list is sorted by path and committed is boolean.
    const files = JSON.parse(parsed.files) as Array<{ path: string; committed: boolean }>;
    assert.deepEqual(files.map((x) => x.path), ['src/apple.ts', 'src/mango.ts', 'src/zebra.ts']);
    for (const fItem of files) {
      assert.equal(typeof fItem.committed, 'boolean');
    }

    // Verify no notice created because parent_id is null.
    const notices = f.db.prepare("SELECT 1 FROM comment WHERE kind = 'notice' AND body LIKE ?").all(`%child:${id}%`);
    assert.equal(notices.length, 0);
  } finally {
    await f.close();
  }
});

test('exit with neither parent nor claims writes no handoff row', async () => {
  const f = fixture();
  try {
    // Create orphan session without claims.
    const id = f.createSession({ parentId: null, state: 'working' });

    // Exit session.
    appendEvent('core.process-gone', id, { code: 0 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    // Verify no handoff row exists.
    const rows = f.db.prepare('SELECT 1 FROM handoff WHERE session_id = ?').all(id);
    assert.equal(rows.length, 0);
  } finally {
    await f.close();
  }
});

test('session.handoff returns latest of two rows by at with parsed files array', () => {
  const f = fixture();
  try {
    // Create session and insert two handoff rows with distinct timestamps.
    const id = f.createSession({ state: 'exited' });
    const older = new Date(Date.now() - 5000).toISOString();
    const newer = new Date(Date.now() - 1000).toISOString();

    const insertHandoff = f.db.prepare(
      'INSERT INTO handoff (id, session_id, parent_id, at, cwd, summary, files, transcript) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertHandoff.run(ulid(), id, null, older, '/cwd', 'old summary', JSON.stringify([{ path: 'old.ts', committed: true }]), null);
    insertHandoff.run(ulid(), id, null, newer, '/cwd', 'new summary', JSON.stringify([{ path: 'new.ts', committed: false }]), '/t.json');

    // Query session.handoff RPC method.
    const handoffMethod = getMethod(f.db, 'session.handoff');
    const res = handoffMethod({ session_id: id }) as { handoff: { at: string; summary: string; files: unknown[]; transcript: string | null } | null };

    // Assert latest row is returned with files parsed as array.
    assert.ok(res.handoff);
    assert.equal(res.handoff.at, newer);
    assert.equal(res.handoff.summary, 'new summary');
    assert.equal(res.handoff.transcript, '/t.json');
    assert.ok(Array.isArray(res.handoff.files));
    assert.deepEqual(res.handoff.files, [{ path: 'new.ts', committed: false }]);
  } finally {
    void f.close();
  }
});

test('session.handoff returns null when session has no handoff row', () => {
  const f = fixture();
  try {
    // Create session without handoff.
    const id = f.createSession({ state: 'working' });

    // Query session.handoff RPC method.
    const handoffMethod = getMethod(f.db, 'session.handoff');
    const res = handoffMethod({ session_id: id }) as { handoff: unknown };

    // Assert result is null.
    assert.equal(res.handoff, null);
  } finally {
    void f.close();
  }
});

test('session.handoff throws -32002 on unknown session', () => {
  const f = fixture();
  try {
    const handoffMethod = getMethod(f.db, 'session.handoff');
    assert.throws(
      () => handoffMethod({ session_id: 'unknown_session_id' }),
      (err: { code: number }) => err.code === -32002,
    );
  } finally {
    void f.close();
  }
});

test('session.handoff throws -32602 on missing session_id', () => {
  const f = fixture();
  try {
    const handoffMethod = getMethod(f.db, 'session.handoff');
    assert.throws(
      () => handoffMethod({}),
      (err: { code: number }) => err.code === -32602,
    );
    assert.throws(
      () => handoffMethod({ session_id: '' }),
      (err: { code: number }) => err.code === -32602,
    );
  } finally {
    void f.close();
  }
});

test('migrations apply on fresh database', () => {
  const f = fixture();
  try {
    // Verify handoff table exists.
    const handoffCols = (f.db.prepare('PRAGMA table_info(handoff)').all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(handoffCols.includes('session_id'));
    assert.ok(handoffCols.includes('files'));

    // Verify session_state_log table exists.
    const stateLogCols = (f.db.prepare('PRAGMA table_info(session_state_log)').all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(stateLogCols.includes('session_id'));
    assert.ok(stateLogCols.includes('state'));

    // Verify outcome column exists on session.
    const sessionCols = (f.db.prepare('PRAGMA table_info(session)').all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(sessionCols.includes('outcome'));
  } finally {
    void f.close();
  }
});
