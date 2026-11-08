import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

type UsageModule = typeof import('../src/usage.ts');

async function fixture(check: (db: DatabaseSync, usage: UsageModule) => void) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-m8-24-'));
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

function addUsage(db: DatabaseSync, id: string, session: string, time: string, tokens: [number, number, number, number]) {
  const engine = session === 's1' ? 'claude' : 'codex';
  const run = session === 's1' ? 'r1' : 'r2';
  db.prepare("INSERT INTO usage (at, run_id, session_id, engine_id, provider, tokens_in, tokens_out, cache_read, cache_write, source, dedupe_key) VALUES (?, ?, ?, ?, 'local-cli', ?, ?, ?, ?, 'transcript', ?)")
    .run(time, run, session, engine, ...tokens, id);
}

function addEvent(db: DatabaseSync, session: string, kind: string, payload: object, time = at) {
  db.prepare("INSERT INTO event (at, source, session_id, kind, payload) VALUES (?, 'claude-hook', ?, ?, ?)")
    .run(time, session, 'claude.' + kind, JSON.stringify(payload));
}

function assertBalanced(summary: ReturnType<UsageModule['usageSummary']>, total: number) {
  assert.equal(summary.total, total);
  assert.equal(summary.in + summary.out + summary.cache_read + summary.cache_write, total);
  assert.equal(summary.parts.reduce((sum, part) => sum + Number(part.tokens), 0), total);
  assert.equal(summary.by_agent.reduce((sum, agent) => sum + Number(agent.tokens), 0), total);
  assert.deepEqual(summary.parts.map((part) => part.kind), ['file_reads', 'shell', 'screenshots', 'instructions', 'replies', 'other']);
  for (const part of summary.parts) {
    assert.ok(Number.isInteger(part.tokens) && Number(part.tokens) >= 0, part.kind + ' must be nonnegative');
  }
  assert.equal(summary.estimate, true);
}

const partsOf = (summary: ReturnType<UsageModule['usageSummary']>) => Object.fromEntries(summary.parts.map(({ kind, tokens }) => [kind, tokens]));

test('M8-24a parts and per-agent totals include input, replies, and both caches', async () => {
  await fixture((db, { usageSummary }) => {
    addUsage(db, 'u1', 's1', at, [100, 20, 30, 10]);
    addUsage(db, 'u2', 's1', at, [10, 5, 2, 3]);
    addUsage(db, 'u3', 's2', at, [40, 10, 5, 5]);
    for (const [tool_name, response_length] of [['Read', 30], ['Bash', 15], ['PowerShell', 12], ['browser.screenshot', 9], ['browser.snapshot', 6]] as const) {
      addEvent(db, 's1', 'PostToolUse', { tool_name, response_length });
    }
    addEvent(db, 's1', 'UserPromptSubmit', { prompt_length: 12 });
    const summary = usageSummary(db, { window: 'today', now });
    assertBalanced(summary, 240);
    assert.deepEqual(partsOf(summary), { file_reads: 10, shell: 9, screenshots: 5, instructions: 4, replies: 35, other: 177 });
    assert.deepEqual(summary.by_agent.map((row) => [row.session_id, row.engine_id, row.tokens]), [['s1', 'claude', 180], ['s2', 'codex', 60]]);
  });
});

test('M8-24a oversized estimates scale into the remaining tokens with rounding in other', async () => {
  await fixture((db, { usageSummary }) => {
    addUsage(db, 'scaled', 's1', at, [7, 4, 2, 2]);
    addEvent(db, 's1', 'PostToolUse', { tool_name: 'Read', response_length: 60 });
    addEvent(db, 's1', 'PostToolUse', { tool_name: 'Bash', response_length: 30 });
    addEvent(db, 's1', 'PostToolUse', { tool_name: 'browser.screenshot', response_length: 15 });
    addEvent(db, 's1', 'UserPromptSubmit', { prompt_length: 15 });
    const summary = usageSummary(db, { window: 'today', now });
    assertBalanced(summary, 15);
    assert.deepEqual(partsOf(summary), { file_reads: 5, shell: 2, screenshots: 1, instructions: 1, replies: 4, other: 2 });
  });
});

test('M8-24a no events leaves all non-reply tokens in other', async () => {
  await fixture((db, { usageSummary }) => {
    addUsage(db, 'no-events', 's1', at, [20, 5, 3, 2]);
    const summary = usageSummary(db, { window: 'today', now });
    assertBalanced(summary, 30);
    assert.deepEqual(partsOf(summary), { file_reads: 0, shell: 0, screenshots: 0, instructions: 0, replies: 5, other: 25 });
  });
});

test('M8-24a an empty window and events without metered tokens stay nonnegative', async () => {
  await fixture((db, { usageSummary }) => {
    const empty = usageSummary(db, { window: 'today', now });
    assertBalanced(empty, 0);
    assert.deepEqual(empty.by_agent, []);
    addEvent(db, 's1', 'PostToolUse', { tool_name: 'Read', response_length: 300 });
    assertBalanced(usageSummary(db, { window: 'today', now }), 0);
    addUsage(db, 'replies-only', 's1', at, [0, 5, 0, 0]);
    const replies = usageSummary(db, { window: 'today', now });
    assertBalanced(replies, 5);
    assert.deepEqual(partsOf(replies), { file_reads: 0, shell: 0, screenshots: 0, instructions: 0, replies: 5, other: 0 });
  });
});

test('M8-24b saverReport defaults to exactly four disabled savers with no claimed saving', async () => {
  await fixture((_db, { saverReport }) => {
    assert.deepEqual(saverReport(), [
      { id: 'shrink_shell', on: false, saving: null },
      { id: 'lean_handoffs', on: false, saving: null },
      { id: 'small_screenshots', on: false, saving: null },
      { id: 'cheap_model', on: false, saving: null },
    ]);
  });
});

test('M8-24c repeatReads groups Read calls per session and ignores single reads and other tools', async () => {
  await fixture((db, { repeatReads }) => {
    const read = (session: string, file_path: string) => addEvent(db, session, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path } });
    read('s1', 'repeated.ts');
    read('s1', 'repeated.ts');
    read('s2', 'repeated.ts');
    read('s1', 'single.ts');
    read('s1', 'shared-once.ts');
    read('s2', 'shared-once.ts');
    for (const tool_name of ['Bash', 'PowerShell', 'Write', 'Edit', 'browser.snapshot']) {
      for (let i = 0; i < 2; i++) addEvent(db, 's1', 'PreToolUse', { tool_name, tool_input: { file_path: tool_name + '.ts' } });
      addEvent(db, 's1', 'PreToolUse', { tool_name, tool_input: { file_path: 'repeated.ts' } });
    }
    for (let i = 0; i < 2; i++) {
      addEvent(db, 's1', 'PostToolUse', { tool_name: 'Read', tool_input: { file_path: 'post-only.ts' } });
      addEvent(db, 's1', 'PreToolUse', { tool_name: 'Read', tool_input: {} });
    }
    const eventsBefore = db.prepare('SELECT * FROM event ORDER BY seq').all();
    const expected = [{ session_id: 's1', file_path: 'repeated.ts', count: 2 }];
    assert.deepEqual(repeatReads(db, { window: 'today', now }).map((row) => ({ ...row })), expected);
    assert.deepEqual(repeatReads(db, { window: 'today', now }).map((row) => ({ ...row })), expected);
    assert.deepEqual(db.prepare('SELECT * FROM event ORDER BY seq').all(), eventsBefore);
  });
});

// methods.ts imports terminal/index.ts, which requires absent node-pty and @xterm packages.
// These window checks call usageSummary directly without importing the RPC method or starting a daemon.
test('M8-24d today, week, and run select different times and run ids using now', async () => {
  await fixture((db, { usageSummary, repeatReads }) => {
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const weekStart = now.getTime() - 7 * 86400_000;
    const rows: [string, string, number, number][] = [
      ['today', 's2', midnight, 10],
      ['yesterday', 's1', midnight - 1, 20],
      ['week-boundary', 's2', weekStart, 30],
      ['before-week', 's1', weekStart - 1, 50],
    ];
    for (const [id, session, time, tokens] of rows) {
      const timestamp = new Date(time).toISOString();
      addUsage(db, id, session, timestamp, [tokens, 0, 0, 0]);
      addEvent(db, session, 'PostToolUse', { tool_name: 'Read', response_length: tokens * 3 }, timestamp);
      for (let i = 0; i < 2; i++) addEvent(db, session, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: id + '.ts' } }, timestamp);
    }
    for (const [options, total, files] of [
      [{ window: 'today', now }, 10, ['today.ts']],
      [{ window: 'week', now }, 60, ['today.ts', 'week-boundary.ts', 'yesterday.ts']],
      [{ window: 'run', run_id: 'r1', now }, 70, ['before-week.ts', 'yesterday.ts']],
      [{ window: 'run', run_id: 'r2', now }, 40, ['today.ts', 'week-boundary.ts']],
    ] as const) {
      const summary = usageSummary(db, options);
      assert.equal(summary.window, options.window);
      assertBalanced(summary, total);
      assert.equal(partsOf(summary).file_reads, total);
      assert.deepEqual(repeatReads(db, options).map((row) => row.file_path).sort(), [...files].sort());
    }
    assert.equal(usageSummary(db, { window: 'week', now: new Date(now.getTime() + 8 * 86400_000) }).total, 0);
    assertBalanced(usageSummary(db, { window: 'run', run_id: 'missing', now }), 0);
  });
});
