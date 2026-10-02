import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('M1-28 session tokens equal the sum over unique message.id, last streamed record wins, read incrementally', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-meter-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { readClaudeTranscript, sessionTokens } = await import('../src/meter.ts');
  const db = openCoreDb();
  try {
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s1', 'p', 'claude', 'pty', 'working', 'x', 'x')").run();
    const file = path.join(home, 't.jsonl');
    const rec = (id: string, i: number, o: number, model = 'claude-sonnet-5-5') =>
      JSON.stringify({ type: 'assistant', timestamp: '2026-09-30T10:00:00.000+10:00', message: { id, model, usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 } } }) + '\n';
    fs.writeFileSync(file, rec('m1', 100, 5) + rec('m1', 100, 50) + rec('m2', 200, 20) + 'not json\n');
    assert.equal(readClaudeTranscript(db, 's1', file), 3);
    assert.deepEqual(sessionTokens(db, 's1'), { in: 300, out: 70, cache_read: 20, cache_write: 0 });
    // partial trailing line is left for the next read; already-read bytes are not re-read
    fs.appendFileSync(file, rec('m3', 1, 1).slice(0, 40));
    assert.equal(readClaudeTranscript(db, 's1', file), 0);
    fs.appendFileSync(file, rec('m3', 1, 1).slice(40) + rec('m2', 200, 25, 'unknown-model'));
    assert.equal(readClaudeTranscript(db, 's1', file), 2);
    assert.deepEqual(sessionTokens(db, 's1'), { in: 301, out: 76, cache_read: 30, cache_write: 0 });
    const usd = db.prepare("SELECT usd FROM usage WHERE dedupe_key IN ('m2') ").get() as { usd: number | null };
    assert.equal(usd.usd, null);
    const known = db.prepare("SELECT usd FROM usage WHERE dedupe_key = 'm1'").get() as { usd: number };
    assert.ok(known.usd > 0);
  } finally {
    db.close();
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('M1-28 the core loop reads a Claude transcript named by a hook event, and the workbench snapshot shows its tokens', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-meter2-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { readMeters } = await import('../src/meter.ts');
  const { processEvents } = await import('../src/events/processor.ts');
  const { snapshot } = await import('../../workbench/src/queries.ts');
  const db = openCoreDb();
  try {
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s2', 'p', 'claude', 'pty', 'working', 'x', 'x')").run();
    const file = path.join(home, 't2.jsonl');
    const rec = (id: string, i: number, o: number, model: string) =>
      JSON.stringify({ message: { id, model, usage: { input_tokens: i, output_tokens: o } } }) + '\n';
    fs.writeFileSync(file, rec('a1', 10, 1, 'claude-sonnet-5-5') + rec('a1', 10, 2, 'claude-sonnet-5-5'));
    db.prepare("INSERT INTO event (at, source, session_id, kind, payload) VALUES ('x', 'claude-hook', 's2', 'claude.Stop', ?)")
      .run(JSON.stringify({ session_id: 'native', transcript_path: file }));
    processEvents(db);
    readMeters(db);
    let s = snapshot(db, 'p', null).sessions.find((x) => x.id === 's2')!;
    assert.equal(s.tokens, 12);
    assert.ok(s.usd! > 0);
    fs.appendFileSync(file, rec('a2', 5, 5, 'unknown-model'));
    readMeters(db);
    s = snapshot(db, 'p', null).sessions.find((x) => x.id === 's2')!;
    assert.equal(s.tokens, 22);
    assert.equal(s.usd, null);
  } finally {
    db.close();
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('Codex usage is one row per turn id: the growth in total_token_usage, repeated token counts overwrite, read incrementally', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-meter3-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { readCodexSession, sessionTokens } = await import('../src/meter.ts');
  const db = openCoreDb();
  try {
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('c1', 'p', 'codex', 'pty', 'working', 'x', 'x')").run();
    const file = path.join(home, 'rollout.jsonl');
    const line = (type: string, payload: object) => JSON.stringify({ timestamp: '2026-09-30T13:00:00Z', type, payload }) + '\n';
    const count = (i: number, c: number, o: number) => line('event_msg', { type: 'token_count', info: { total_token_usage: { input_tokens: i, cached_input_tokens: c, cache_write_input_tokens: 0, output_tokens: o } } });
    fs.writeFileSync(file, line('session_meta', { id: 'x' }) + line('turn_context', { model: 'gpt-x' }) + line('event_msg', { type: 'task_started', turn_id: 't1' })
      + count(100, 40, 10) + count(100, 40, 10) + line('event_msg', { type: 'token_count', info: null }));
    readCodexSession(db, 'c1', file);
    assert.deepEqual(sessionTokens(db, 'c1'), { in: 60, out: 10, cache_read: 40, cache_write: 0 });
    fs.appendFileSync(file, line('event_msg', { type: 'task_started', turn_id: 't2' }) + count(250, 100, 30));
    readCodexSession(db, 'c1', file);
    assert.deepEqual(sessionTokens(db, 'c1'), { in: 150, out: 30, cache_read: 100, cache_write: 0 });
    const rows = db.prepare("SELECT dedupe_key, model, usd, source FROM usage WHERE session_id = 'c1' ORDER BY dedupe_key").all();
    assert.deepEqual(rows.map((r: any) => [r.dedupe_key, r.model, r.usd, r.source]), [['codex:c1:t1', 'gpt-x', null, 'codex-session'], ['codex:c1:t2', 'gpt-x', null, 'codex-session']]);
  } finally {
    db.close();
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('usage rows carry the session run_id and step_id so run budgets count them; exited sessions stop being read; a deleted file is skipped', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-meter4-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { noteTranscript, noteCodexSession, readMeters } = await import('../src/meter.ts');
  const { Runner } = await import('../src/pipelines/runner.ts');
  const db = openCoreDb();
  try {
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
    db.prepare("INSERT INTO pipeline (id, source, path, version, valid) VALUES ('pl', 'project', 'x', 1, 1)").run();
    db.prepare(`INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at)
      VALUES ('r1', 'pl', 'p', '{}', ?, 'running', 'manual', 1000, 10, 60, '2026-09-30T00:00:00Z')`).run(home);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, run_id, step_id, state, state_at, started_at) VALUES ('s4', 'p', 'claude', 'pty', 'r1', 'build', 'working', 'x', 'x')").run();
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('c4', 'p', 'codex', 'pty', 'working', 'x', 'x')").run();
    const t = path.join(home, 't4.jsonl');
    const rec = (id: string, i: number) => JSON.stringify({ message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: i, output_tokens: 0 } } }) + '\n';
    fs.writeFileSync(t, rec('b1', 40));
    noteTranscript('s4', t);
    noteCodexSession('c4', path.join(home, 'missing.jsonl'));
    readMeters(db);
    const row = db.prepare("SELECT run_id, step_id FROM usage WHERE dedupe_key = 'b1'").get() as { run_id: string; step_id: string };
    assert.deepEqual({ ...row }, { run_id: 'r1', step_id: 'build' });
    assert.equal(new Runner(db).used('r1').tokens, 40);
    db.prepare("UPDATE session SET ended_at = 'x' WHERE id = 's4'").run();
    fs.appendFileSync(t, rec('b2', 5));
    readMeters(db);
    fs.appendFileSync(t, rec('b3', 7));
    readMeters(db);
    assert.equal(new Runner(db).used('r1').tokens, 45);
  } finally {
    db.close();
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
