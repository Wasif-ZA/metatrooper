import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

type UsageModule = typeof import('../src/usage.ts');

async function fixture(check: (db: DatabaseSync, usage: UsageModule) => void) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-m7-23d-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  let db: DatabaseSync | undefined;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.METATROOPER_HOME = path.join(home, 'mt');
    const { openCoreDb } = await import('../src/store/db.ts');
    const usage = await import('../src/usage.ts');
    db = openCoreDb();
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
    for (const engine of ['claude', 'codex']) {
      db.prepare('INSERT INTO engine (id, spec_json, cost_rank) VALUES (?, ?, 1)').run(engine, JSON.stringify({ id: engine }));
    }
    db.prepare("INSERT INTO pipeline (id, source, path, version, valid) VALUES ('pl', 'project', 'x', 1, 1)").run();
    for (const run of ['r1', 'r2']) {
      db.prepare("INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at) VALUES (?, 'pl', 'p', '{}', ?, 'running', 'manual', 10000, 10, 60, 'x')").run(run, home);
    }
    for (const [id, engine, run] of [['s1', 'claude', 'r1'], ['s2', 'codex', 'r2']]) {
      db.prepare("INSERT INTO session (id, project_id, engine_id, host, run_id, state, state_at, started_at) VALUES (?, 'p', ?, 'pty', ?, 'working', 'x', 'x')").run(id, engine, run);
    }
    check(db, usage);
  } finally {
    try { db?.close(); } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
}

const now = new Date(2026, 10, 8, 12);
const at = now.toISOString();

function addUsage(db: DatabaseSync, id: string, session: string, usd: number | null, estimated = 0) {
  const engine = session === 's1' ? 'claude' : 'codex';
  const run = session === 's1' ? 'r1' : 'r2';
  db.prepare("INSERT INTO usage (at, run_id, session_id, engine_id, provider, tokens_in, tokens_out, cache_read, cache_write, usd, usd_estimated, source, dedupe_key) VALUES (?, ?, ?, ?, 'local-cli', 100, 20, 0, 0, ?, ?, 'transcript', ?)")
    .run(at, run, session, engine, usd, estimated, id);
}

function seedUsage(db: DatabaseSync, secondUsd: number | null = 0.5, secondEstimated = 0) {
  addUsage(db, 'u1', 's1', 0.25);
  addUsage(db, 'u2', 's1', secondUsd, secondEstimated);
  addUsage(db, 'u3', 's1', 1);
  addUsage(db, 'u4', 's2', 0.125);
  addUsage(db, 'u5', 's2', 0.375);
}

test('M7-23d all priced published rows sum USD with no estimated flag', async () => {
  await fixture((db, { usageSummary }) => {
    seedUsage(db);
    const summary = usageSummary(db, { window: 'today', now });
    assert.equal(summary.usd, 2.25);
    assert.equal(summary.usd_estimated, false);
    assert.equal(summary.by_agent.find((row) => row.session_id === 's1')?.usd, 1.75);
    assert.equal(summary.by_agent.find((row) => row.session_id === 's1')?.usd_estimated, false);
    assert.equal(summary.by_agent.find((row) => row.session_id === 's2')?.usd, 0.5);
    assert.equal(summary.by_agent.find((row) => row.session_id === 's2')?.usd_estimated, false);
  });
});

test('M7-23d one estimated row flags the summary and only its agent', async () => {
  await fixture((db, { usageSummary }) => {
    seedUsage(db, 0.5, 1);
    const summary = usageSummary(db, { window: 'today', now });
    assert.equal(summary.usd, 2.25);
    assert.equal(summary.usd_estimated, true);
    assert.equal(summary.by_agent.find((row) => row.session_id === 's1')?.usd, 1.75);
    assert.equal(summary.by_agent.find((row) => row.session_id === 's1')?.usd_estimated, true);
    assert.equal(summary.by_agent.find((row) => row.session_id === 's2')?.usd, 0.5);
    assert.equal(summary.by_agent.find((row) => row.session_id === 's2')?.usd_estimated, false);
  });
});

test('M7-23d one unpriced row makes USD null only in scopes containing it', async () => {
  await fixture((db, { usageSummary }) => {
    seedUsage(db, null);
    const summary = usageSummary(db, { window: 'today', now });
    assert.equal(summary.usd, null);
    assert.equal(summary.usd_estimated, false);
    assert.equal(summary.by_agent.find((row) => row.session_id === 's1')?.usd, null);
    assert.equal(summary.by_agent.find((row) => row.session_id === 's1')?.usd_estimated, false);
    assert.equal(summary.by_agent.find((row) => row.session_id === 's2')?.usd, 0.5);
    assert.equal(summary.by_agent.find((row) => row.session_id === 's2')?.usd_estimated, false);
  });
});
