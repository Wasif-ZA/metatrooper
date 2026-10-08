import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('core restart relaunches agent steps whose session died, re-registers builtin plugins at runtime', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-recover-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { Runner } = await import('../src/pipelines/runner.ts');
  const { syncPipelines } = await import('../src/pipelines/store.ts');
  const db = openCoreDb();
  try {
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
    db.prepare("INSERT INTO pipeline (id, source, path, version, valid) VALUES ('pl', 'project', 'x', 1, 1)").run();
    fs.writeFileSync(path.join(home, 'pipeline.json'), JSON.stringify({
      schema: 1, id: 'pl', title: 'pl', steps: [{ id: 'build', title: 'build', kind: 'agent', fanout: 3, prompt: 'x' }],
    }));
    db.prepare(`INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at)
      VALUES ('r1', 'pl', 'p', '{}', ?, 'running', 'manual', 1000, 10, 60, 'x')`).run(home);
    const session = db.prepare("INSERT INTO session (id, project_id, engine_id, host, pid, run_id, step_id, state, state_at, started_at) VALUES (?, 'p', 'claude', 'pty', ?, 'r1', 'build', 'working', 'x', 'x')");
    session.run('dead', 2 ** 30);
    session.run('alive', process.pid);
    session.run('finished', 2 ** 30);
    const out = path.join(home, 'build-2.md');
    fs.writeFileSync(out, '---\nstatus: done\n---\n');
    const step = db.prepare("INSERT INTO run_step (run_id, step_id, iteration, fanout_index, status, engine_id, session_id, started_at) VALUES ('r1', 'build', 0, ?, 'running', 'claude', ?, 'x')");
    step.run(0, 'dead');
    step.run(1, 'alive');
    db.prepare("INSERT INTO run_step (run_id, step_id, iteration, fanout_index, status, engine_id, session_id, output_path, started_at) VALUES ('r1', 'build', 0, 2, 'running', 'claude', 'finished', ?, 'x')").run(out);

    new Runner(db).recover();
    const rows = db.prepare("SELECT fanout_index, status, session_id FROM run_step WHERE run_id = 'r1' ORDER BY fanout_index").all().map((r) => ({ ...r }));
    assert.deepEqual(rows, [
      { fanout_index: 0, status: 'running', session_id: null },
      { fanout_index: 1, status: 'running', session_id: 'alive' },
      { fanout_index: 2, status: 'running', session_id: 'finished' },
    ]);
    assert.equal((db.prepare("SELECT state FROM session WHERE id = 'finished'").get() as { state: string }).state, 'exited');
    assert.ok(fs.existsSync(out));
    assert.equal((db.prepare("SELECT status FROM run WHERE id = 'r1'").get() as { status: string }).status, 'running');

    new Runner(db).recover();
    assert.equal((db.prepare("SELECT status FROM run WHERE id = 'r1'").get() as { status: string }).status, 'running');

    db.prepare("DELETE FROM plugin WHERE source = 'builtin'").run();
    syncPipelines(db);
    assert.ok(db.prepare("SELECT 1 FROM plugin WHERE id = 'media' AND source = 'builtin'").get());
  } finally {
    db.close();
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

async function recoverDb() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-recover-'));
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { Runner } = await import('../src/pipelines/runner.ts');
  const db = openCoreDb();
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
  db.prepare("INSERT INTO pipeline (id, source, path, version, valid) VALUES ('pl', 'project', 'x', 1, 1)").run();
  return { home, db, Runner };
}

test('core restart fails a running run whose folder is gone instead of crashing', async () => {
  const { home, db, Runner } = await recoverDb();
  try {
    db.prepare(`INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at)
      VALUES ('gone', 'pl', 'p', '{}', ?, 'running', 'manual', 1000, 10, 60, 'x')`).run(path.join(home, 'missing'));
    db.prepare("INSERT INTO run_step (run_id, step_id, iteration, fanout_index, status) VALUES ('gone', 'a', 0, 0, 'running')").run();
    new Runner(db).recover();
    assert.equal((db.prepare("SELECT status FROM run WHERE id = 'gone'").get() as { status: string }).status, 'failed');
  } finally {
    db.close();
  }
});

test('core restart kills a stored dev server only while its pid is the same process, and clears its pane preview', async () => {
  const { home, db, Runner } = await recoverDb();
  const { spawn } = await import('node:child_process');
  const sleeper = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const ours = sleeper();
  const reused = sleeper();
  const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
  try {
    db.prepare(`INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, paused_why, trigger, max_tokens, max_usd, max_minutes, started_at)
      VALUES ('pk', 'pl', 'p', '{}', ?, 'paused', 'handoff', 'manual', 1000, 10, 60, 'x')`).run(home);
    for (const [idx, port] of [[0, 3901], [1, 3902]]) db.prepare("INSERT INTO port_lease (port, run_id, idx, leased_at) VALUES (?, 'pk', ?, 'x')").run(port, idx);
    const server = db.prepare("INSERT INTO dev_server (run_id, idx, port, pid, status, started_at) VALUES ('pk', ?, ?, ?, 'ready', ?)");
    server.run(0, 3901, ours.pid, new Date().toISOString());
    server.run(1, 3902, reused.pid, new Date(Date.now() - 2 * 3_600_000).toISOString());
    db.prepare("INSERT INTO browser_pane (id, project_id, run_id, variant, url, open) VALUES ('bp-pk', 'p', 'pk', 0, 'http://127.0.0.1:3901/', 1)").run();
    new Runner(db).recover();
    for (let i = 0; i < 50 && alive(ours.pid as number); i++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(alive(ours.pid as number), false);
    assert.equal(alive(reused.pid as number), true);
    assert.equal((db.prepare("SELECT url FROM browser_pane WHERE id = 'bp-pk'").get() as { url: string | null }).url, null);
  } finally {
    ours.kill();
    reused.kill();
    db.close();
  }
});

test('core restart fails a run with several interrupted steps once', async () => {
  const { home, db, Runner } = await recoverDb();
  try {
    fs.writeFileSync(path.join(home, 'pipeline.json'), JSON.stringify({ schema: 1, id: 'pl', title: 'pl', steps: [{ id: 'a', kind: 'code', code: 'x.mjs', fanout: 3 }] }));
    db.prepare(`INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at)
      VALUES ('many', 'pl', 'p', '{}', ?, 'running', 'manual', 1000, 10, 60, 'x')`).run(home);
    for (const i of [0, 1, 2]) db.prepare("INSERT INTO run_step (run_id, step_id, iteration, fanout_index, status) VALUES ('many', 'a', 0, ?, 'running')").run(i);
    new Runner(db).recover();
    assert.equal((db.prepare("SELECT count(*) AS n FROM needs_you WHERE ref = 'many' AND kind = 'run-failed'").get() as { n: number }).n, 1);
  } finally {
    db.close();
  }
});
