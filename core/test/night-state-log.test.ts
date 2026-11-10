import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.ts';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openCoreDb } from '../src/store/db.ts';
import { BUILT_IN, syncEngines, type EngineSpec } from '../src/engines/registry.ts';
import { appendEvent } from '../src/events/append.ts';
import { processEvents, turnJobsIdle } from '../src/events/processor.ts';
import { launchSession } from '../src/sessions/launch.ts';
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

// Database fixture helper for state log tests.
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'troop-night-statelog-'));
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

  // Helper to insert session and initial state log row.
  const createSession = (state = 'starting') => {
    const id = `s_${randomUUID().replace(/-/g, '')}`;
    const t = new Date().toISOString();
    db.prepare(
      `INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, native_id)
       VALUES (?, 'p1', 'claude', 'pty', ?, ?, ?, 'conv')`,
    ).run(id, state, t, t);
    db.prepare('INSERT INTO session_state_log (session_id, at, state) VALUES (?, ?, ?)').run(id, t, state);
    return { id, initialAt: t };
  };

  // Helper to query session row.
  const getSession = (id: string) => {
    const row = db.prepare('SELECT state, state_at FROM session WHERE id = ?').get(id) as { state: string; state_at: string };
    return JSON.parse(JSON.stringify(row));
  };

  // Helper to query all state log rows for a session.
  const getStateLogs = (id: string) => {
    const rows = db.prepare('SELECT session_id, at, state FROM session_state_log WHERE session_id = ? ORDER BY rowid ASC').all(id) as Array<{ session_id: string; at: string; state: string }>;
    return JSON.parse(JSON.stringify(rows));
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

  return { db, createSession, getSession, getStateLogs, close };
}

test('launch writes starting row to session_state_log with at equal to started_at', () => {
  // Capture SQL statements and params from launchSession using fake database.
  const statements: Array<{ sql: string; params: unknown[] }> = [];
  const fakeDb = {
    prepare(sql: string) {
      return {
        run(...params: unknown[]) {
          statements.push({ sql, params });
          if (sql.includes('session_state_log')) {
            throw new Error('STOP_AFTER_LOG_INSERT');
          }
          return { changes: 1 };
        },
        get() {
          return undefined;
        },
        all() {
          return [];
        },
      };
    },
    exec() {},
  };

  const fakeEngine = {
    id: 'fake-engine',
    command: 'node',
    cost_rank: 1,
    roles: ['worker'],
  };

  try {
    launchSession(fakeDb as unknown as DatabaseSync, {
      projectId: 'p1',
      projectPath: '/path/p1',
      projectName: 'p1',
      engine: fakeEngine as unknown as EngineSpec,
    });
  } catch (err: unknown) {
    if ((err as Error).message !== 'STOP_AFTER_LOG_INSERT') throw err;
  }

  // Verify session and state log statements were captured.
  const sessionInsert = statements.find((s) => s.sql.includes('INSERT INTO session '));
  const logInsert = statements.find((s) => s.sql.includes('INSERT INTO session_state_log'));
  assert.ok(sessionInsert);
  assert.ok(logInsert);

  // Assert starting row values match started_at.
  const [logSessionId, logAt, logState] = logInsert.params;
  const startedAt = sessionInsert.params[10];
  assert.equal(logSessionId, sessionInsert.params[0]);
  assert.equal(logAt, startedAt);
  assert.equal(logState, 'starting');
});

test('a run of events gives exactly the rows of each transition in order with at equal to state_at', async () => {
  const f = fixture();
  try {
    // Start session in starting state.
    const { id, initialAt } = f.createSession('starting');
    const recordedAt: string[] = [initialAt];

    // Transition 1: starting -> working.
    appendEvent('claude.UserPromptSubmit', id, { session_id: 'conv' }, f.db);
    processEvents(f.db);
    recordedAt.push(f.getSession(id).state_at);

    // Transition 2: working -> waiting_for_you.
    appendEvent('claude.PermissionRequest', id, { session_id: 'conv', tool_name: 'test' }, f.db);
    processEvents(f.db);
    recordedAt.push(f.getSession(id).state_at);

    // Transition 3: waiting_for_you -> working.
    appendEvent('claude.PostToolUse', id, { session_id: 'conv', tool_name: 'test' }, f.db);
    processEvents(f.db);
    recordedAt.push(f.getSession(id).state_at);

    // Transition 4: working -> done.
    appendEvent('claude.Stop', id, { session_id: 'conv' }, f.db);
    processEvents(f.db);
    recordedAt.push(f.getSession(id).state_at);

    // Transition 5: done -> exited.
    appendEvent('core.process-gone', id, { code: 0 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();
    recordedAt.push(f.getSession(id).state_at);

    // Verify state log rows match transitions and timestamps.
    const logs = f.getStateLogs(id);
    assert.equal(logs.length, 6);
    assert.deepEqual(logs.map((r) => r.state), ['starting', 'working', 'waiting_for_you', 'working', 'done', 'exited']);
    for (let i = 0; i < logs.length; i++) {
      assert.equal(logs[i].at, recordedAt[i]);
    }
  } finally {
    await f.close();
  }
});

test('repeated same-state events add no row to session_state_log', async () => {
  const f = fixture();
  try {
    // Start session and transition to working.
    const { id } = f.createSession('starting');
    appendEvent('claude.UserPromptSubmit', id, { session_id: 'conv' }, f.db);
    processEvents(f.db);
    assert.equal(f.getSession(id).state, 'working');

    const logsBefore = f.getStateLogs(id);
    assert.equal(logsBefore.length, 2);

    // Send another event that evaluates to working.
    appendEvent('claude.PreToolUse', id, { session_id: 'conv', tool_name: 'test' }, f.db);
    processEvents(f.db);
    assert.equal(f.getSession(id).state, 'working');

    // Verify row count remains unchanged.
    const logsAfter = f.getStateLogs(id);
    assert.equal(logsAfter.length, 2);
  } finally {
    await f.close();
  }
});

test('session.clear-status adds idle with at equal to state_at', async () => {
  const f = fixture();
  try {
    // Start session and transition to done.
    const { id } = f.createSession('starting');
    appendEvent('claude.UserPromptSubmit', id, { session_id: 'conv' }, f.db);
    processEvents(f.db);
    appendEvent('claude.Stop', id, { session_id: 'conv' }, f.db);
    processEvents(f.db);
    assert.equal(f.getSession(id).state, 'done');

    // Call session.clear-status handler.
    const clearStatus = getMethod(f.db, 'session.clear-status');
    clearStatus({ session_id: id });

    // Verify session state and state_at.
    const s = f.getSession(id);
    assert.equal(s.state, 'idle');

    // Verify last log row is idle with matching timestamp.
    const logs = f.getStateLogs(id);
    const lastLog = logs[logs.length - 1];
    assert.equal(lastLog.state, 'idle');
    assert.equal(lastLog.at, s.state_at);
  } finally {
    await f.close();
  }
});

test('waiting_for_you uses the event written time as at', async () => {
  const f = fixture();
  try {
    // Start session with chronological timestamps in the past.
    const t0 = new Date(Date.now() - 20000).toISOString();
    const t1 = new Date(Date.now() - 10000).toISOString();
    const writtenAt = new Date(Date.now() - 5000).toISOString();

    const id = `s_${randomUUID().replace(/-/g, '')}`;
    f.db.prepare(
      `INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, native_id)
       VALUES (?, 'p1', 'claude', 'pty', 'starting', ?, ?, 'conv')`,
    ).run(id, t0, t0);
    f.db.prepare('INSERT INTO session_state_log (session_id, at, state) VALUES (?, ?, ?)').run(id, t0, 'starting');

    // Transition starting -> working at t1.
    appendEvent('claude.UserPromptSubmit', id, { session_id: 'conv' }, f.db);
    f.db.prepare('UPDATE event SET at = ? WHERE seq = (SELECT max(seq) FROM event)').run(t1);
    processEvents(f.db);
    assert.equal(f.getSession(id).state, 'working');

    // Append wait event with timestamp writtenAt after t1.
    appendEvent('claude.PermissionRequest', id, { session_id: 'conv', tool_name: 'fs' }, f.db);
    f.db.prepare('UPDATE event SET at = ? WHERE seq = (SELECT max(seq) FROM event)').run(writtenAt);

    // Process events and verify waiting_for_you timestamp.
    processEvents(f.db);
    const s = f.getSession(id);
    assert.equal(s.state, 'waiting_for_you');
    assert.equal(s.state_at, writtenAt);

    // Verify state log row carries writtenAt.
    const logs = f.getStateLogs(id);
    const lastLog = logs[logs.length - 1];
    assert.equal(lastLog.state, 'waiting_for_you');
    assert.equal(lastLog.at, writtenAt);
  } finally {
    await f.close();
  }
});
