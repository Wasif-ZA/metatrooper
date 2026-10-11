import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, harness, runNode, sleep } from './helpers.ts';
import { GENERATED, block } from '../gen-methods.ts';
import { buildMethods } from '../src/methods.ts';
import { call } from '../src/pipe/client.ts';

// Rebuild generated fixtures before running public API tests.
before(buildGenerated);

// Literal list of all public methods declared in spec.
const EXPECTED_METHODS = [
  'core.ping',
  'settings.set',
  'core.stop',
  'account.state',
  'project.open',
  'project.clear',
  'session.launch',
  'session.list',
  'session.wait',
  'session.resume',
  'session.focus',
  'session.live-text',
  'session.seen',
  'session.hide',
  'session.clear-status',
  'session.owners',
  'session.paste-prompt',
  'needs_you.mark-read',
  'needs_you.mark-unread',
  'needs.dismiss',
  'shell.list',
  'shell.open',
  'shell.close',
  'worktree.create',
  'ui.hello',
  'engines.check',
  'hooks.install',
  'hooks.uninstall',
  'plugin.preview',
  'plugin.install',
  'plugin.remove',
  'plugin.secret.set',
  'mcp.resolve',
  'mcp.missing',
  'notify.sink.set',
  'notify.sink.list',
  'notify.sink.test',
  'notify.sink.remove',
  'comment.deliver',
  'pane.open',
  'pane.close',
  'pane.url',
  'pane.assign',
  'pane.capture',
];

// Literal list of methods moved to pipeline products.
const EXPECTED_MOVED = [
  'run.start',
  'run.cancel',
  'run.clear',
  'run.resume',
  'run.item-set',
  'gate.resolve',
  'schedule.set',
  'pipeline.validate',
  'template.list',
  'variant.pick',
  'variant.discard',
  'variant.combine',
  'board.pin',
  'board.remove',
];

// Literal set of methods requiring trusted UI connection.
const EXPECTED_NEEDS_UI = new Set([
  'core.stop',
  'settings.set',
  'needs.dismiss',
  'hooks.install',
  'hooks.uninstall',
  'plugin.install',
  'plugin.remove',
  'plugin.secret.set',
  'notify.sink.set',
  'notify.sink.test',
  'notify.sink.remove',
  'pane.open',
  'pane.close',
  'pane.url',
  'pane.assign',
  'pane.capture',
]);

// Seed a test session into the isolated core database.
function seedSession(db: DatabaseSync, dir: string, sessionId: string, projectId: string, state = 'idle', hidden = 0, startedAt?: string) {
  const at = startedAt ?? new Date().toISOString();
  db.prepare('INSERT OR IGNORE INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run(projectId, dir, 'test', at, at);
  db.prepare('INSERT OR IGNORE INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('codex', '{}', 1, 'local-cli');
  db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(sessionId, projectId, 'codex', 'pty', state, at, at, hidden);
}

test('each GENERATED entry matches file on disk and fails when hand-edited', () => {
  for (const g of GENERATED) {
    // Read raw file content from disk.
    const text = readFileSync(g.file, 'utf8');
    // Verify block content equals generated body.
    const body = g.body();
    assert.equal(block(text), body);
    // Extract block content and modify one row.
    const changed = block(text)!.replace('core.ping', 'core.ping_edited');
    // Splice modified block between markers.
    const edited = text.replace(/(<!-- methods:start -->\n)[\s\S]*?(\n<!-- methods:end -->)/, (_, a, b) => a + changed + b);
    // Verify edited block no longer matches generated body.
    assert.notEqual(block(edited), body);
  }
});

test('troop --help stdout lists every METHODS name and exits 0', async () => {
  // Execute CLI with --help flag.
  const result = await runNode(['core/cli.ts', '--help'], process.env);
  // Verify exit code is 0.
  assert.equal(result.code, 0, result.stderr);
  // Verify every expected method appears in help output.
  for (const name of EXPECTED_METHODS) {
    assert.ok(result.stdout.includes(name), `method ${name} missing from troop --help stdout`);
  }
});

test('buildMethods key set equals METHODS names minus ui.hello plus MOVED_METHODS with needsUi per declaration', () => {
  const dummyDb = new DatabaseSync(':memory:');
  const dummyCtl = { engines: () => [], stop: () => {}, uiKey: 'test_key' };
  // Build methods map for verification.
  const methods = buildMethods(dummyDb, dummyCtl);
  // Compute expected keys minus ui.hello plus moved methods.
  const expectedKeys = [...EXPECTED_METHODS.filter((m) => m !== 'ui.hello'), ...EXPECTED_MOVED].sort();
  // Verify returned method names match expected key set.
  assert.deepEqual([...methods.keys()].sort(), expectedKeys);
  // Verify needsUi flag matches declaration for every method.
  for (const [name, spec] of methods) {
    assert.equal(Boolean(spec.needsUi), EXPECTED_NEEDS_UI.has(name), `needsUi mismatch for ${name}`);
  }
  // Verify moved methods return error code -32601.
  for (const name of EXPECTED_MOVED) {
    const spec = methods.get(name)!;
    assert.throws(
      () => spec.handler({}, { ui: false, origin: 'test' }),
      (err: any) => err.code === -32601 && err.message === 'moved to the pipeline products',
    );
  }
  dummyDb.close();
});

test('session.wait over real pipe returns within 1 s of state change', async () => {
  const h = await harness();
  try {
    const db = new DatabaseSync(join(h.home, 'troop.db'));
    const sessionId = `ses_${randomUUID()}`;
    const projectId = `prj_${randomUUID()}`;
    // Insert initial session in starting state.
    seedSession(db, h.home, sessionId, projectId, 'starting');
    const pipe = await client(h.prefix);
    try {
      const start = performance.now();
      // Send session.wait request waiting for working state.
      const waitPromise = pipe.request('session.wait', { session_id: sessionId, states: ['working'], timeout_ms: 5000 }, { timeout: 10000 });
      // Wait roughly 500 ms before updating state in database.
      await sleep(500);
      // Flip session state in database to working.
      db.prepare("UPDATE session SET state = 'working' WHERE id = ?").run(sessionId);
      const reply = await waitPromise;
      const elapsed = performance.now() - start;
      // Verify session reached working state without timing out.
      assert.equal(reply.result?.timed_out, false);
      assert.equal(reply.result?.state, 'working');
      // Verify elapsed minus 500 ms is under 1000 ms.
      assert.ok(elapsed - 500 < 1000, `elapsed minus 500 was ${elapsed - 500} ms`);
    } finally {
      pipe.close();
      db.close();
    }
  } finally {
    await h.teardown();
  }
});

test('session.wait already in target state returns in under 300 ms', async () => {
  const h = await harness();
  try {
    const db = new DatabaseSync(join(h.home, 'troop.db'));
    const sessionId = `ses_${randomUUID()}`;
    const projectId = `prj_${randomUUID()}`;
    // Insert session already in working state.
    seedSession(db, h.home, sessionId, projectId, 'working');
    const pipe = await client(h.prefix);
    try {
      const start = performance.now();
      // Request wait for working state which is already active.
      const reply = await pipe.request('session.wait', { session_id: sessionId, states: ['working'], timeout_ms: 2000 }, { timeout: 5000 });
      const elapsed = performance.now() - start;
      // Verify immediate return in under 300 ms.
      assert.equal(reply.result?.timed_out, false);
      assert.equal(reply.result?.state, 'working');
      assert.ok(elapsed < 300, `elapsed was ${elapsed} ms, expected under 300 ms`);
    } finally {
      pipe.close();
      db.close();
    }
  } finally {
    await h.teardown();
  }
});

test('session.wait times out after timeout_ms when state is never reached', async () => {
  const h = await harness();
  try {
    const db = new DatabaseSync(join(h.home, 'troop.db'));
    const sessionId = `ses_${randomUUID()}`;
    const projectId = `prj_${randomUUID()}`;
    // Insert session in idle state.
    seedSession(db, h.home, sessionId, projectId, 'idle');
    const pipe = await client(h.prefix);
    try {
      const start = performance.now();
      // Request wait with 400 ms timeout for state that will not arrive.
      const reply = await pipe.request('session.wait', { session_id: sessionId, states: ['working'], timeout_ms: 400 }, { timeout: 3000 });
      const elapsed = performance.now() - start;
      // Verify response indicates timeout after at least 400 ms and under 1400 ms.
      assert.equal(reply.result?.timed_out, true);
      assert.equal(reply.result?.state, 'idle');
      assert.ok(elapsed >= 400, `elapsed was ${elapsed} ms, expected at least 400 ms`);
      assert.ok(elapsed < 1400, `elapsed was ${elapsed} ms, expected under 1400 ms`);
    } finally {
      pipe.close();
      db.close();
    }
  } finally {
    await h.teardown();
  }
});

test('session.wait returns -32602 for invalid parameters and -32002 for unknown session', async () => {
  const h = await harness();
  try {
    const db = new DatabaseSync(join(h.home, 'troop.db'));
    const sessionId = `ses_${randomUUID()}`;
    const projectId = `prj_${randomUUID()}`;
    // Insert session for parameter testing.
    seedSession(db, h.home, sessionId, projectId, 'idle');
    const pipe = await client(h.prefix);
    try {
      // Test empty states array returns -32602.
      const r1 = await pipe.request('session.wait', { session_id: sessionId, states: [], timeout_ms: 1000 });
      assert.equal(r1.error?.code, -32602);
      // Test invalid state name returns -32602.
      const r2 = await pipe.request('session.wait', { session_id: sessionId, states: ['nope'], timeout_ms: 1000 });
      assert.equal(r2.error?.code, -32602);
      // Test timeout_ms 0 returns -32602.
      const r3 = await pipe.request('session.wait', { session_id: sessionId, states: ['idle'], timeout_ms: 0 });
      assert.equal(r3.error?.code, -32602);
      // Test timeout_ms 600001 returns -32602.
      const r4 = await pipe.request('session.wait', { session_id: sessionId, states: ['idle'], timeout_ms: 600001 });
      assert.equal(r4.error?.code, -32602);
      // Test unknown session id returns -32002.
      const r5 = await pipe.request('session.wait', { session_id: 'unknown_session_id', states: ['idle'], timeout_ms: 1000 });
      assert.equal(r5.error?.code, -32002);
    } finally {
      pipe.close();
      db.close();
    }
  } finally {
    await h.teardown();
  }
});

test('session.list excludes hidden sessions by default, includes with all true, and filters by project_id', async () => {
  const h = await harness();
  try {
    const db = new DatabaseSync(join(h.home, 'troop.db'));
    const p1 = `prj_1_${randomUUID()}`;
    const p2 = `prj_2_${randomUUID()}`;
    const s1 = `ses_1_${randomUUID()}`;
    const s2 = `ses_2_${randomUUID()}`;
    const s3 = `ses_3_${randomUUID()}`;
    // Insert visible session in project 1 started earliest.
    seedSession(db, join(h.home, 'p1'), s1, p1, 'idle', 0, '2026-10-11T10:00:00.000Z');
    // Insert hidden session in project 1 started in middle.
    seedSession(db, join(h.home, 'p1'), s2, p1, 'idle', 1, '2026-10-11T10:01:00.000Z');
    // Insert visible session in project 2 started latest.
    seedSession(db, join(h.home, 'p2'), s3, p2, 'working', 0, '2026-10-11T10:02:00.000Z');

    const pipe = await client(h.prefix);
    try {
      // Default listing excludes hidden sessions.
      const def = await pipe.request('session.list');
      const defIds = def.result?.sessions.map((s: any) => s.id);
      assert.ok(defIds.includes(s3));
      assert.ok(defIds.includes(s1));
      assert.ok(!defIds.includes(s2), 'hidden session should be absent by default');

      // Listing with all true includes hidden sessions sorted newest first.
      const all = await pipe.request('session.list', { all: true });
      const allIds = all.result?.sessions.map((s: any) => s.id);
      assert.ok(allIds.includes(s2), 'hidden session should be present with all: true');
      const relevant = allIds.filter((id: string) => [s1, s2, s3].includes(id));
      assert.deepEqual(relevant, [s3, s2, s1]);

      // Project filter excludes sessions from other projects.
      const filtered = await pipe.request('session.list', { project_id: p1 });
      const filteredIds = filtered.result?.sessions.map((s: any) => s.id);
      assert.ok(filteredIds.includes(s1));
      assert.ok(!filteredIds.includes(s3), 'project filter should exclude other project session');
      assert.ok(!filteredIds.includes(s2), 'hidden session should still be excluded without all: true');

      // Project filter with all true returns all sessions of that project.
      const filteredAll = await pipe.request('session.list', { project_id: p1, all: true });
      const filteredAllIds = filteredAll.result?.sessions.map((s: any) => s.id);
      assert.deepEqual(filteredAllIds, [s2, s1]);

      // Verify exact fields returned for each session.
      const sample = def.result?.sessions.find((s: any) => s.id === s1);
      assert.deepEqual(Object.keys(sample).sort(), ['engine_id', 'host', 'id', 'parent_id', 'project_id', 'state', 'state_at']);
    } finally {
      pipe.close();
      db.close();
    }
  } finally {
    await h.teardown();
  }
});

test('core.ping returns protocol version 1', async () => {
  const h = await harness();
  try {
    const pipe = await client(h.prefix);
    try {
      // Send core.ping request over pipe.
      const reply = await pipe.request('core.ping');
      // Verify ping response fields including protocol 1.
      assert.equal(reply.result?.ok, true);
      assert.equal(reply.result?.protocol, 1);
      assert.equal(reply.result?.schema_version, 2);
      assert.equal(typeof reply.result?.pid, 'number');
    } finally {
      pipe.close();
    }
  } finally {
    await h.teardown();
  }
});

test('session.wait called via core/src/pipe/client.ts with waitMs larger than timeout_ms', async () => {
  const h = await harness();
  const oldPrefix = process.env.METATROOPER_PIPE_PREFIX;
  const oldHome = process.env.METATROOPER_HOME;
  process.env.METATROOPER_PIPE_PREFIX = h.prefix;
  process.env.METATROOPER_HOME = h.home;
  try {
    const db = new DatabaseSync(join(h.home, 'troop.db'));
    const sessionId = `ses_${randomUUID()}`;
    const projectId = `prj_${randomUUID()}`;
    // Insert session in working state.
    seedSession(db, h.home, sessionId, projectId, 'working');
    db.close();

    // Call session.wait through pipe client library passing waitMs larger than timeout_ms.
    const outcome = await call('session.wait', { session_id: sessionId, states: ['working'], timeout_ms: 1000 }, { waitMs: 5000 });
    // Verify outcome is a reply and not queued or offline.
    assert.equal(outcome.kind, 'reply');
    if (outcome.kind === 'reply') {
      assert.equal((outcome.reply.result as any)?.timed_out, false);
      assert.equal((outcome.reply.result as any)?.state, 'working');
    }
  } finally {
    if (oldPrefix === undefined) delete process.env.METATROOPER_PIPE_PREFIX;
    else process.env.METATROOPER_PIPE_PREFIX = oldPrefix;
    if (oldHome === undefined) delete process.env.METATROOPER_HOME;
    else process.env.METATROOPER_HOME = oldHome;
    await h.teardown();
  }
});
