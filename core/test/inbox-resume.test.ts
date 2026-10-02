import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, harness, isolation, root, startCore, teardownCore, until } from './helpers.ts';
import { processEvents } from '../src/events/processor.ts';

before(buildGenerated);

function database(home: string, readOnly = false): DatabaseSync {
  const db = readOnly
    ? new DatabaseSync(join(home, 'troop.db'), { readOnly: true })
    : new DatabaseSync(join(home, 'troop.db'));
  if (!readOnly) db.exec('PRAGMA busy_timeout = 2000');
  return db;
}

function insertSession(db: DatabaseSync, id: string, projectId: string, engineId: string, state: string, cwd: string, nativeId: string | null = null): void {
  const at = new Date().toISOString();
  db.prepare(
    'INSERT INTO session (id, project_id, engine_id, host, native_id, state, state_at, cwd, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(id, projectId, engineId, 'pty', nativeId, state, at, cwd, at);
}

async function openProject(prefix: string, path: string): Promise<string> {
  mkdirSync(path, { recursive: true });
  const pipe = await client(prefix);
  try {
    const response = await pipe.request('project.open', { path });
    assert.ok(response.result?.project_id, JSON.stringify(response));
    return response.result.project_id;
  } finally { pipe.close(); }
}

async function fakeHarness(engines: object[]) {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify(engines));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  return { ...isolated, env, core };
}

test("11 session.focus upserts the 'main' ui_selection row to the requested session", async () => {
  const h = await harness();
  try {
    const projectPath = join(h.home, 'focus-project');
    const projectId = await openProject(h.prefix, projectPath);
    const first = `focus-${randomUUID()}`;
    const second = `focus-${randomUUID()}`;
    const db = database(h.home);
    try {
      insertSession(db, first, projectId, 'claude', 'idle', projectPath);
      insertSession(db, second, projectId, 'claude', 'idle', projectPath);
    } finally { db.close(); }

    const pipe = await client(h.prefix);
    try {
      assert.deepEqual((await pipe.request('session.focus', { session_id: first })).result, { focused: true });
      assert.deepEqual((await pipe.request('session.focus', { session_id: second })).result, { focused: true });
    } finally { pipe.close(); }

    const check = database(h.home, true);
    try {
      const rows = check.prepare('SELECT window_id, session_id, at FROM ui_selection').all();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].window_id, 'main');
      assert.equal(rows[0].session_id, second);
      assert.ok(!Number.isNaN(Date.parse(rows[0].at)));
    } finally { check.close(); }
  } finally { await h.teardown(); }
});

test('13 repeated done transitions create one unread open done inbox row', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metatrooper-done-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  try {
    db.exec(readFileSync(join(root, 'contracts/schema.sql'), 'utf8'));
    const at = new Date().toISOString();
    db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p', dir, 'p', at, at);
    db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, 1, ?)').run('fake', '{}', 'local-cli');
    insertSession(db, 's', 'p', 'fake', 'working', dir);
    const event = db.prepare("INSERT INTO event (at, source, session_id, kind, payload) VALUES (?, 'claude-hook', 's', ?, '{}')");

    event.run(new Date().toISOString(), 'claude.Stop');
    processEvents(db);
    event.run(new Date().toISOString(), 'claude.PreToolUse');
    processEvents(db);
    event.run(new Date().toISOString(), 'claude.Stop');
    processEvents(db);

    const rows = db.prepare("SELECT kind, ref, resolved_at, read_at FROM needs_you WHERE kind = 'done' AND ref = 's'").all();
    assert.deepEqual(rows.map((row) => ({ ...row })), [{ kind: 'done', ref: 's', resolved_at: null, read_at: null }]);
    assert.equal(db.prepare("SELECT state FROM session WHERE id = 's'").get().state, 'done');
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('14 a PTY exit with a non-zero code creates a failed row naming that code', async () => {
  const isolated = isolation();
  const exitScript = join(isolated.home, 'exit-23.mjs');
  writeFileSync(exitScript, 'process.exit(23);');
  const h = await fakeHarness([{
    id: 'failing', command: process.execPath, args: [exitScript], prompt_arg: 'positional', state_source: 'process',
    roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
  }]);
  try {
    const project = join(h.home, 'failed-project');
    const projectId = await openProject(h.prefix, project);
    const pipe = await client(h.prefix);
    let sessionId: string;
    try {
      sessionId = (await pipe.request('session.launch', { project_id: projectId, engine_id: 'failing' })).result.session_id;
    } finally { pipe.close(); }
    const db = database(h.home, true);
    try {
      const row = await until(() => db.prepare("SELECT kind, ref, text, resolved_at, read_at FROM needs_you WHERE kind = 'failed' AND ref = ?").get(sessionId), 4000);
      assert.equal(row.kind, 'failed');
      assert.equal(row.ref, sessionId);
      assert.match(row.text, /23/);
      assert.equal(row.resolved_at, null);
      assert.equal(row.read_at, null);
      assert.equal(db.prepare('SELECT state FROM session WHERE id = ?').get(sessionId).state, 'exited');
    } finally { db.close(); }
  } finally { await teardownCore(h.core, h); }
});

test('15 needs_you mark-read and mark-unread toggle read_at and reject an unknown id', async () => {
  const h = await harness();
  try {
    const id = `need-${randomUUID()}`;
    const db = database(h.home);
    db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'other', NULL, 'test row')").run(id, new Date().toISOString());
    db.close();
    const pipe = await client(h.prefix);
    try {
      assert.deepEqual((await pipe.request('needs_you.mark-read', { id })).result, {});
      let check = database(h.home, true);
      assert.ok(check.prepare('SELECT read_at FROM needs_you WHERE id = ?').get(id).read_at);
      check.close();

      assert.deepEqual((await pipe.request('needs_you.mark-unread', { id })).result, {});
      check = database(h.home, true);
      assert.equal(check.prepare('SELECT read_at FROM needs_you WHERE id = ?').get(id).read_at, null);
      check.close();

      const missing = await pipe.request('needs_you.mark-read', { id: 'not-present' });
      assert.equal(missing.error?.code, -32002);
    } finally { pipe.close(); }
  } finally { await h.teardown(); }
});

test("16 session.focus marks that session's done and failed inbox rows read", async () => {
  const h = await harness();
  try {
    const projectPath = join(h.home, 'focus-inbox-project');
    const projectId = await openProject(h.prefix, projectPath);
    const focused = `focus-${randomUUID()}`;
    const other = `focus-${randomUUID()}`;
    const db = database(h.home);
    try {
      insertSession(db, focused, projectId, 'claude', 'done', projectPath);
      insertSession(db, other, projectId, 'claude', 'done', projectPath);
      const add = db.prepare('INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, ?, ?, ?)');
      add.run('done-focused', new Date().toISOString(), 'done', focused, 'done');
      add.run('failed-focused', new Date().toISOString(), 'failed', focused, 'failed');
      add.run('done-other', new Date().toISOString(), 'done', other, 'other done');
    } finally { db.close(); }

    const pipe = await client(h.prefix);
    try { assert.deepEqual((await pipe.request('session.focus', { session_id: focused })).result, { focused: true }); }
    finally { pipe.close(); }

    const check = database(h.home, true);
    try {
      const focusedRows = check.prepare('SELECT read_at FROM needs_you WHERE ref = ? ORDER BY id').all(focused);
      assert.equal(focusedRows.length, 2);
      assert.ok(focusedRows.every((row) => row.read_at !== null));
      assert.equal(check.prepare("SELECT read_at FROM needs_you WHERE id = 'done-other'").get().read_at, null);
    } finally { check.close(); }
  } finally { await h.teardown(); }
});

test('17 session.clear-status idles a live session, records the event, reads open rows, and rejects exited sessions', async () => {
  const h = await harness();
  try {
    const projectPath = join(h.home, 'clear-project');
    const projectId = await openProject(h.prefix, projectPath);
    const live = `clear-${randomUUID()}`;
    const exited = `clear-${randomUUID()}`;
    const db = database(h.home);
    try {
      insertSession(db, live, projectId, 'claude', 'waiting_for_you', projectPath);
      insertSession(db, exited, projectId, 'claude', 'exited', projectPath);
      const add = db.prepare('INSERT INTO needs_you (id, at, kind, ref, text, resolved_at) VALUES (?, ?, ?, ?, ?, ?)');
      add.run('clear-open-done', new Date().toISOString(), 'done', live, 'done', null);
      add.run('clear-open-other', new Date().toISOString(), 'other', live, 'other', null);
      add.run('clear-resolved', new Date().toISOString(), 'other', live, 'resolved', new Date().toISOString());
    } finally { db.close(); }

    const pipe = await client(h.prefix);
    try {
      assert.deepEqual((await pipe.request('session.clear-status', { session_id: live })).result, {});
      const invalid = await pipe.request('session.clear-status', { session_id: exited });
      assert.equal(invalid.error?.code, -32602);
    } finally { pipe.close(); }

    const check = database(h.home, true);
    try {
      assert.equal(check.prepare('SELECT state FROM session WHERE id = ?').get(live).state, 'idle');
      assert.equal(check.prepare("SELECT count(*) AS n FROM event WHERE session_id = ? AND kind = 'core.status-cleared'").get(live).n, 1);
      assert.ok(check.prepare("SELECT read_at FROM needs_you WHERE id = 'clear-open-done'").get().read_at);
      assert.ok(check.prepare("SELECT read_at FROM needs_you WHERE id = 'clear-open-other'").get().read_at);
      assert.equal(check.prepare("SELECT read_at FROM needs_you WHERE id = 'clear-resolved'").get().read_at, null);
      assert.equal(check.prepare("SELECT count(*) AS n FROM event WHERE session_id = ? AND kind = 'core.status-cleared'").get(exited).n, 0);
    } finally { check.close(); }
  } finally { await h.teardown(); }
});

test('18 session.resume substitutes native_id, falls back to a plain launch, preserves cwd, and rejects live sessions', async () => {
  const isolated = isolation();
  const writer = join(isolated.home, 'argv-engine.mjs');
  const resumedArgs = join(isolated.home, 'resumed-args.json');
  const plainArgs = join(isolated.home, 'plain-args.json');
  writeFileSync(writer, "import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));setTimeout(()=>process.exit(0),500);");
  const h = await fakeHarness([
    {
      id: 'resumable', command: process.execPath, args: [writer, resumedArgs], prompt_arg: 'positional', resume_args: ['--resume', '{native_id}'],
      state_source: 'process', roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
    },
    {
      id: 'plain', command: process.execPath, args: [writer, plainArgs], prompt_arg: 'positional', state_source: 'process',
      roles: ['worker'], cost_rank: 2, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
    },
  ]);
  try {
    const projectPath = join(h.home, 'resume-project');
    const resumedCwd = join(projectPath, 'resumed-cwd');
    const plainCwd = join(projectPath, 'plain-cwd');
    mkdirSync(resumedCwd, { recursive: true });
    mkdirSync(plainCwd, { recursive: true });
    const projectId = await openProject(h.prefix, projectPath);
    const db = database(h.home);
    try {
      insertSession(db, 'old-resumable', projectId, 'resumable', 'exited', resumedCwd, 'native-42');
      insertSession(db, 'old-plain', projectId, 'plain', 'exited', plainCwd, 'native-unused');
      insertSession(db, 'still-live', projectId, 'resumable', 'working', projectPath, 'native-live');
    } finally { db.close(); }

    const pipe = await client(h.prefix);
    try {
      const resumed = await pipe.request('session.resume', { session_id: 'old-resumable' });
      assert.equal(resumed.result.resumed, true);
      assert.equal(resumed.result.prompt_delivered, true);
      await until(() => existsSync(resumedArgs), 4000);
      assert.deepEqual(JSON.parse(readFileSync(resumedArgs, 'utf8')), ['--resume', 'native-42']);

      const plain = await pipe.request('session.resume', { session_id: 'old-plain' });
      assert.equal(plain.result.resumed, false);
      assert.equal(plain.result.prompt_delivered, true);
      await until(() => existsSync(plainArgs), 4000);
      assert.deepEqual(JSON.parse(readFileSync(plainArgs, 'utf8')), []);

      const invalid = await pipe.request('session.resume', { session_id: 'still-live' });
      assert.equal(invalid.error?.code, -32602);

      const check = database(h.home, true);
      try {
        const resumedRow = check.prepare('SELECT engine_id, cwd FROM session WHERE id = ?').get(resumed.result.session_id);
        const plainRow = check.prepare('SELECT engine_id, cwd FROM session WHERE id = ?').get(plain.result.session_id);
        assert.deepEqual({ ...resumedRow }, { engine_id: 'resumable', cwd: resumedCwd });
        assert.deepEqual({ ...plainRow }, { engine_id: 'plain', cwd: plainCwd });
      } finally { check.close(); }
    } finally { pipe.close(); }
  } finally { await teardownCore(h.core, h); }
});
