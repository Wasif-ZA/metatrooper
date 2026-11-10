import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.ts';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCoreDb } from '../src/store/db.ts';
import { BUILT_IN, syncEngines } from '../src/engines/registry.ts';
import { appendEvent } from '../src/events/append.ts';
import { processEvents, turnJobsIdle } from '../src/events/processor.ts';
import { ulid } from '../src/time.ts';

// Database fixture helper for outcome tests.
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'troop-night-outcome-'));
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

  // Helper to insert a session row.
  const createSession = (state = 'starting', outcome: string | null = null) => {
    const id = `s_${randomUUID().replace(/-/g, '')}`;
    const t = new Date().toISOString();
    db.prepare(
      `INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, native_id, outcome)
       VALUES (?, 'p1', 'claude', 'pty', ?, ?, ?, 'conv', ?)`,
    ).run(id, state, t, t, outcome);
    return id;
  };

  // Helper to insert a done_proof row.
  const insertProof = (sessionId: string, exitCode: number | null, at: string) => {
    db.prepare('INSERT INTO done_proof (id, session_id, command, at, exit_code, environment) VALUES (?, ?, ?, ?, ?, ?)').run(
      ulid(),
      sessionId,
      'test-check',
      at,
      exitCode,
      '{}',
    );
  };

  // Helper to retrieve session row.
  const getSession = (id: string) => {
    const row = db.prepare('SELECT state, outcome FROM session WHERE id = ?').get(id) as { state: string; outcome: string | null };
    return JSON.parse(JSON.stringify(row));
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

  return { db, createSession, insertProof, getSession, close };
}

test('precedence branch a: done proof with exit_code 0 yields succeeded', async () => {
  const f = fixture();
  try {
    // Create session and attach successful proof.
    const id = f.createSession('working');
    f.insertProof(id, 0, new Date().toISOString());

    // Exit the session.
    appendEvent('core.process-gone', id, { code: 0 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    // Verify outcome.
    const s = f.getSession(id);
    assert.equal(s.state, 'exited');
    assert.equal(s.outcome, 'succeeded');
  } finally {
    await f.close();
  }
});

test('precedence branch a: done proof with non-zero exit_code yields failed', async () => {
  const f = fixture();
  try {
    // Create session and attach failed proof.
    const id = f.createSession('done');
    f.insertProof(id, 1, new Date().toISOString());

    // Exit the session.
    appendEvent('core.process-gone', id, { code: 0 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    // Verify outcome.
    const s = f.getSession(id);
    assert.equal(s.state, 'exited');
    assert.equal(s.outcome, 'failed');
  } finally {
    await f.close();
  }
});

test('precedence branch a: done proof with null exit_code yields failed', async () => {
  const f = fixture();
  try {
    // Create session and attach null exit code proof.
    const id = f.createSession('done');
    f.insertProof(id, null, new Date().toISOString());

    // Exit the session.
    appendEvent('core.process-gone', id, { code: 0 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    // Verify outcome.
    const s = f.getSession(id);
    assert.equal(s.state, 'exited');
    assert.equal(s.outcome, 'failed');
  } finally {
    await f.close();
  }
});

test('precedence branch b: non-zero exit event code yields failed when no proof exists', async () => {
  const f = fixture();
  try {
    // Create session with prior done state but non-zero exit code.
    const id = f.createSession('done');

    // Exit with non-zero code.
    appendEvent('core.process-gone', id, { code: 137 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    // Verify outcome.
    const s = f.getSession(id);
    assert.equal(s.state, 'exited');
    assert.equal(s.outcome, 'failed');
  } finally {
    await f.close();
  }
});

test('precedence branch c: prior state done yields succeeded when exit code is 0 and no proof exists', async () => {
  const f = fixture();
  try {
    // Create session in done state.
    const id = f.createSession('done');

    // Exit with exit code 0.
    appendEvent('core.process-gone', id, { code: 0 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    // Verify outcome.
    const s = f.getSession(id);
    assert.equal(s.state, 'exited');
    assert.equal(s.outcome, 'succeeded');
  } finally {
    await f.close();
  }
});

test('precedence branch d: prior non-done state yields cancelled when exit code is 0 and no proof exists', async () => {
  const f = fixture();
  try {
    // Create session in working state.
    const id = f.createSession('working');

    // Exit with exit code 0.
    appendEvent('core.process-gone', id, { code: 0 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    // Verify outcome.
    const s = f.getSession(id);
    assert.equal(s.state, 'exited');
    assert.equal(s.outcome, 'cancelled');
  } finally {
    await f.close();
  }
});

test('latest proof decides outcome beating older proof of opposite result in single session', async () => {
  const f = fixture();
  try {
    // Create session in working state.
    const id = f.createSession('working');

    // Insert older successful proof and newer failed proof.
    const older = new Date(Date.now() - 2000).toISOString();
    const newer = new Date(Date.now() - 1000).toISOString();
    f.insertProof(id, 0, older);
    f.insertProof(id, 1, newer);

    // Exit the session.
    appendEvent('core.process-gone', id, { code: 0 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    // Verify newer proof decides outcome.
    const s = f.getSession(id);
    assert.equal(s.state, 'exited');
    assert.equal(s.outcome, 'failed');
  } finally {
    await f.close();
  }
});

test('proof beats non-zero exit code', async () => {
  const f = fixture();
  try {
    // Create session with successful proof.
    const id = f.createSession('working');
    f.insertProof(id, 0, new Date().toISOString());

    // Exit with non-zero exit code.
    appendEvent('core.process-gone', id, { code: 1 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    // Verify proof takes precedence over exit code.
    const s = f.getSession(id);
    assert.equal(s.state, 'exited');
    assert.equal(s.outcome, 'succeeded');
  } finally {
    await f.close();
  }
});

test('non-zero exit code beats prior state done', async () => {
  const f = fixture();
  try {
    // Create session in done state without proof.
    const id = f.createSession('done');

    // Exit with non-zero code.
    appendEvent('core.process-gone', id, { code: 2 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    // Verify non-zero exit code takes precedence over done state.
    const s = f.getSession(id);
    assert.equal(s.state, 'exited');
    assert.equal(s.outcome, 'failed');
  } finally {
    await f.close();
  }
});

test('outcome is set once and never overwritten by subsequent exit or pre-set outcome', async () => {
  const f = fixture();
  try {
    // Test pre-set outcome is preserved on exit.
    const idPreset = f.createSession('working', 'succeeded');
    appendEvent('core.process-gone', idPreset, { code: 1 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    const sPreset = f.getSession(idPreset);
    assert.equal(sPreset.state, 'exited');
    assert.equal(sPreset.outcome, 'succeeded');

    // Test second exit event does not overwrite outcome.
    const idSecond = f.createSession('done');
    appendEvent('core.process-gone', idSecond, { code: 0 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    const sFirstExit = f.getSession(idSecond);
    assert.equal(sFirstExit.outcome, 'succeeded');

    // Append second exit event with failed code.
    appendEvent('core.process-gone', idSecond, { code: 1 }, f.db);
    processEvents(f.db);
    await turnJobsIdle();

    const sSecondExit = f.getSession(idSecond);
    assert.equal(sSecondExit.outcome, 'succeeded');
  } finally {
    await f.close();
  }
});

test('non-exit transitions leave outcome null', async () => {
  const f = fixture();
  try {
    // Start session in starting state.
    const id = f.createSession('starting');
    assert.equal(f.getSession(id).outcome, null);

    // Transition starting -> working.
    appendEvent('claude.UserPromptSubmit', id, { session_id: 'conv' }, f.db);
    processEvents(f.db);
    assert.equal(f.getSession(id).state, 'working');
    assert.equal(f.getSession(id).outcome, null);

    // Transition working -> waiting_for_you.
    appendEvent('claude.PermissionRequest', id, { session_id: 'conv', tool_name: 'test' }, f.db);
    processEvents(f.db);
    assert.equal(f.getSession(id).state, 'waiting_for_you');
    assert.equal(f.getSession(id).outcome, null);

    // Transition waiting_for_you -> working.
    appendEvent('claude.PostToolUse', id, { session_id: 'conv', tool_name: 'test' }, f.db);
    processEvents(f.db);
    assert.equal(f.getSession(id).state, 'working');
    assert.equal(f.getSession(id).outcome, null);

    // Transition working -> done.
    appendEvent('claude.Stop', id, { session_id: 'conv' }, f.db);
    processEvents(f.db);
    assert.equal(f.getSession(id).state, 'done');
    assert.equal(f.getSession(id).outcome, null);

    // Transition done -> idle.
    appendEvent('core.seen', id, {}, f.db);
    processEvents(f.db);
    assert.equal(f.getSession(id).state, 'idle');
    assert.equal(f.getSession(id).outcome, null);
  } finally {
    await f.close();
  }
});
