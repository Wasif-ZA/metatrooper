import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildMethods } from '../src/methods.ts';
import { CommandRunner } from '../src/pipe/commands.ts';
import { deliverPrompts, heldPrompts, launchSession, openBlockers } from '../src/sessions/launch.ts';
import { killAll } from '../src/terminal/index.ts';
import { setSetting } from '../src/settings.ts';
import { root, until } from './helpers.ts';

async function fixture(run: (db: DatabaseSync, methods: ReturnType<typeof buildMethods>, runner: CommandRunner) => Promise<void> | void) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-ny-blocks-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  let db: DatabaseSync | undefined;
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.METATROOPER_HOME = path.join(home, 'mt');
    const { openCoreDb } = await import('../src/store/db.ts');
    db = openCoreDb();
    const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'test_key' });
    await run(db, methods, new CommandRunner(db, methods));
  } finally {
    try { db?.close(); } finally {
      for (const [key, value] of Object.entries(prev)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
      fs.rmSync(home, { recursive: true, force: true });
    }
  }
}

function seed(db: DatabaseSync, ...ids: string[]) {
  const at = '2026-11-11T00:00:00.000Z';
  db.prepare("INSERT OR IGNORE INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/fixture/p1', 'p1', ?, ?)").run(at, at);
  db.prepare("INSERT OR IGNORE INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1)").run();
  for (const id of ids) db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p1', 'claude', 'pty', 'working', ?, ?)").run(id, at, at);
}

const call = (methods: ReturnType<typeof buildMethods>, name: string, params: Record<string, unknown>) => methods.get(name)!.handler(params, { ui: true, origin: 'workbench' });
const blockersOf = (db: DatabaseSync, id: string) => (db.prepare('SELECT blocker_id FROM session_block WHERE blocked_id = ? ORDER BY blocker_id').all(id) as Array<{ blocker_id: string }>).map((r) => r.blocker_id);

test('priority defaults to none and session.priority-set stores each allowed value', async () => {
  await fixture(async (db, methods) => {
    seed(db, 's1');
    assert.equal((db.prepare("SELECT priority FROM session WHERE id = 's1'").get() as { priority: string }).priority, 'none');
    for (const priority of ['low', 'medium', 'high', 'urgent', 'none']) {
      assert.deepEqual(await call(methods, 'session.priority-set', { session_id: 's1', priority }), { ok: true });
      assert.equal((db.prepare("SELECT priority FROM session WHERE id = 's1'").get() as { priority: string }).priority, priority);
    }
  });
});

test('session.priority-set refuses an unknown priority and an unknown session', async () => {
  await fixture(async (db, methods) => {
    seed(db, 's1');
    for (const priority of ['Urgent', 'p0', '', null, 3]) {
      await assert.rejects(async () => call(methods, 'session.priority-set', { session_id: 's1', priority }), (e: { code: number }) => e.code === -32602);
    }
    await assert.rejects(async () => call(methods, 'session.priority-set', { session_id: 'nope', priority: 'high' }), (e: { code: number }) => e.code === -32002);
  });
});

test('session.block-set replaces the blocker set and session.block-clear empties it', async () => {
  await fixture(async (db, methods) => {
    seed(db, 'a', 'b', 'c', 'x');
    assert.deepEqual(await call(methods, 'session.block-set', { session_id: 'x', blocker_ids: ['b', 'a', 'a'] }), { ok: true });
    assert.deepEqual(blockersOf(db, 'x'), ['a', 'b']);
    await call(methods, 'session.block-set', { session_id: 'x', blocker_ids: ['c'] });
    assert.deepEqual(blockersOf(db, 'x'), ['c']);
    assert.deepEqual(await call(methods, 'session.block-clear', { session_id: 'x' }), { ok: true });
    assert.deepEqual(blockersOf(db, 'x'), []);
  });
});

test('session.block-set refuses itself, a cycle, an unknown blocker and a bad list, leaving the old set', async () => {
  await fixture(async (db, methods) => {
    seed(db, 'a', 'b', 'c');
    await call(methods, 'session.block-set', { session_id: 'b', blocker_ids: ['a'] });
    await call(methods, 'session.block-set', { session_id: 'c', blocker_ids: ['b'] });
    const refused = async (params: Record<string, unknown>, code: number) => assert.rejects(async () => call(methods, 'session.block-set', params), (e: { code: number }) => e.code === code);
    await refused({ session_id: 'a', blocker_ids: ['a'] }, -32602);
    await refused({ session_id: 'a', blocker_ids: ['c'] }, -32602);
    await refused({ session_id: 'a', blocker_ids: ['b'] }, -32602);
    await refused({ session_id: 'b', blocker_ids: ['ghost'] }, -32002);
    await refused({ session_id: 'b', blocker_ids: 'a' }, -32602);
    await refused({ session_id: 'b', blocker_ids: [1] }, -32602);
    await refused({ session_id: 'ghost', blocker_ids: ['a'] }, -32002);
    assert.deepEqual(blockersOf(db, 'a'), []);
    assert.deepEqual(blockersOf(db, 'b'), ['a']);
  });
});

test('the new methods need the UI key', async () => {
  await fixture(async (db, methods, runner) => {
    seed(db, 's1');
    for (const [method, params] of [['session.priority-set', { session_id: 's1', priority: 'high' }], ['session.block-set', { session_id: 's1', blocker_ids: [] }], ['session.block-clear', { session_id: 's1' }]] as const) {
      assert.equal(Boolean(methods.get(method)!.needsUi), true, method);
      await assert.rejects(async () => runner.call({ id: `c-${method}`, method, params, origin: 'cli' }, { ui: false, origin: 'cli' }));
    }
  });
});

test('openBlockers lists blockers until they exit with outcome succeeded', async () => {
  await fixture(async (db, methods) => {
    seed(db, 'a', 'b', 'x');
    await call(methods, 'session.block-set', { session_id: 'x', blocker_ids: ['a', 'b'] });
    assert.deepEqual(openBlockers(db, 'x'), ['a', 'b']);
    db.prepare("UPDATE session SET state = 'exited', outcome = 'failed' WHERE id = 'a'").run();
    db.prepare("UPDATE session SET state = 'exited', outcome = 'succeeded' WHERE id = 'b'").run();
    assert.deepEqual(openBlockers(db, 'x'), ['a']);
    db.prepare("UPDATE session SET outcome = 'cancelled' WHERE id = 'a'").run();
    assert.deepEqual(openBlockers(db, 'x'), ['a']);
    db.prepare("UPDATE session SET outcome = 'succeeded' WHERE id = 'a'").run();
    assert.deepEqual(openBlockers(db, 'x'), []);
  });
});

test('an older database gains session.priority and session_block on open', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-ny-old-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  try {
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    process.env.METATROOPER_HOME = path.join(home, 'mt');
    const { openCoreDb } = await import('../src/store/db.ts');
    const { dbFile } = await import('../src/paths.ts');
    fs.mkdirSync(path.dirname(dbFile()), { recursive: true });
    const old = new DatabaseSync(dbFile());
    const schema = fs.readFileSync(path.join(root, 'contracts', 'schema.sql'), 'utf8');
    old.exec(schema.replace(/,\n\s*priority[^\n]*/, '').replace(/CREATE TABLE session_block \([\s\S]*?\n\);\nCREATE INDEX session_block_blocker[^\n]*\n/, ''));
    old.exec("PRAGMA user_version = 2; INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2')");
    for (let id = 1; id <= 13; id++) old.prepare('INSERT INTO schema_migration (id, applied_at) VALUES (?, ?)').run(id, '2026-11-01T00:00:00Z');
    old.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', 'x', 'x')").run();
    old.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1)").run();
    old.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s_old', 'p1', 'claude', 'pty', 'idle', 'x', 'x')").run();
    assert.equal((old.prepare('PRAGMA table_info(session)').all() as Array<{ name: string }>).some((c) => c.name === 'priority'), false);
    old.close();
    const db = openCoreDb();
    try {
      assert.equal((db.prepare("SELECT priority FROM session WHERE id = 's_old'").get() as { priority: string }).priority, 'none');
      assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_block'").get());
      assert.deepEqual((db.prepare('SELECT id FROM schema_migration WHERE id >= 14 ORDER BY id').all() as Array<{ id: number }>).map((r) => r.id), [14, 15]);
      assert.throws(() => db.prepare("UPDATE session SET priority = 'p0' WHERE id = 's_old'").run(), /CHECK/);
    } finally { db.close(); }
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
  }
});

const recorder = "import{appendFileSync,writeFileSync}from'node:fs';writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(4)));process.stdin.on('data',(d)=>appendFileSync(process.argv[3],d));setTimeout(()=>process.exit(0),20000);";

async function ptyFixture(run: (f: { db: DatabaseSync; dir: string; engine: never; argv: () => Promise<string[]>; stdin: () => string; written: (id: string) => boolean }) => Promise<void>, promptArg: string | null = 'positional') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-ny-pty-'));
  const prevHome = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = path.join(dir, 'mt');
  const argvFile = path.join(dir, 'argv.json');
  const stdinFile = path.join(dir, 'stdin.txt');
  const recorderPath = path.join(dir, 'recorder.mjs');
  fs.writeFileSync(recorderPath, recorder);
  fs.writeFileSync(stdinFile, '');
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(path.join(root, 'contracts', 'schema.sql'), 'utf8'));
  const at = new Date().toISOString();
  db.prepare("INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES ('claude', '{}', 1, 'local-cli')").run();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', dir, 'p1', at, at);
  for (const id of ['a', 'b']) db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p1', 'claude', 'pty', 'working', ?, ?)").run(id, at, at);
  const engine = { id: 'claude', command: process.execPath, args: [recorderPath, argvFile, stdinFile], ...(promptArg ? { prompt_arg: promptArg } : {}), state_source: 'process', roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli' } as never;
  try {
    await run({
      db, dir, engine,
      argv: () => until(() => { try { return JSON.parse(fs.readFileSync(argvFile, 'utf8')) as string[]; } catch { return undefined; } }),
      stdin: () => fs.readFileSync(stdinFile, 'utf8'),
      written: (id) => Boolean(db.prepare("SELECT 1 FROM event WHERE session_id = ? AND kind = 'core.prompt-written'").get(id)),
    });
  } finally {
    killAll();
    db.close();
    if (prevHome === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prevHome;
  }
}

test('a session launched with blockers holds its prompt until every blocker exits ok, then delivers it', async () => {
  await ptyFixture(async ({ db, dir, engine, argv, stdin, written }) => {
    const prompt = 'PROMPT-HELD-42';
    const r = launchSession(db, { projectId: 'p1', projectPath: dir, projectName: 'p1', engine, prompt, blockerIds: ['a', 'b'] });
    assert.equal(r.prompt_delivered, false);
    assert.deepEqual(blockersOf(db, r.session_id), ['a', 'b']);
    assert.equal((await argv()).includes(prompt), false);
    db.prepare("UPDATE session SET state = 'idle' WHERE id = ?").run(r.session_id);

    deliverPrompts(db);
    assert.equal(written(r.session_id), false);
    assert.ok(heldPrompts().includes(r.session_id));

    db.prepare("UPDATE session SET state = 'exited', outcome = 'succeeded' WHERE id = 'a'").run();
    db.prepare("UPDATE session SET state = 'exited', outcome = 'failed' WHERE id = 'b'").run();
    deliverPrompts(db);
    assert.equal(written(r.session_id), false);
    assert.ok(heldPrompts().includes(r.session_id));

    db.prepare("UPDATE session SET outcome = 'succeeded' WHERE id = 'b'").run();
    deliverPrompts(db);
    assert.equal(written(r.session_id), true);
    assert.equal(heldPrompts().includes(r.session_id), false);
    await until(() => stdin().includes(prompt) || undefined);
  });
});

test('a blocker that outlasts terminal.prompt_wait_ms still releases the prompt', async () => {
  await ptyFixture(async ({ db, dir, engine, argv, stdin, written }) => {
    setSetting('terminal', 'prompt_wait_ms', 50);
    const r = launchSession(db, { projectId: 'p1', projectPath: dir, projectName: 'p1', engine, prompt: 'PROMPT-LATE-9', blockerIds: ['a'] });
    await argv();
    db.prepare("UPDATE session SET state = 'idle' WHERE id = ?").run(r.session_id);
    deliverPrompts(db);
    await new Promise((done) => setTimeout(done, 150));
    deliverPrompts(db);
    db.prepare("UPDATE session SET state = 'exited', outcome = 'succeeded' WHERE id = 'a'").run();
    deliverPrompts(db);
    assert.equal(written(r.session_id), true);
    await until(() => stdin().includes('PROMPT-LATE-9') || undefined);
  });
});

test('block-set holds a prompt not yet written and block-clear releases it', async () => {
  await ptyFixture(async ({ db, dir, engine, argv, stdin, written }) => {
    const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'test_key' });
    const r = launchSession(db, { projectId: 'p1', projectPath: dir, projectName: 'p1', engine, prompt: 'PROMPT-SET-5' });
    assert.equal(r.prompt_delivered, false);
    await argv();
    await call(methods, 'session.block-set', { session_id: r.session_id, blocker_ids: ['a'] });
    db.prepare("UPDATE session SET state = 'idle' WHERE id = ?").run(r.session_id);
    deliverPrompts(db);
    assert.equal(written(r.session_id), false);
    assert.ok(heldPrompts().includes(r.session_id));
    await call(methods, 'session.block-clear', { session_id: r.session_id });
    deliverPrompts(db);
    assert.equal(written(r.session_id), true);
    await until(() => stdin().includes('PROMPT-SET-5') || undefined);
  }, null);
});

test('a session launched without blockers still gets its prompt on the command line', async () => {
  await ptyFixture(async ({ db, dir, engine, argv }) => {
    const r = launchSession(db, { projectId: 'p1', projectPath: dir, projectName: 'p1', engine, prompt: 'PROMPT-FREE-7' });
    assert.equal(r.prompt_delivered, true);
    assert.ok((await argv()).includes('PROMPT-FREE-7'));
    assert.equal(heldPrompts().includes(r.session_id), false);
  });
});
