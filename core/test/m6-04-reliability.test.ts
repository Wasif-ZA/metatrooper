import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate, openCoreDb } from '../src/store/db.ts';
import { settings, settingsError } from '../src/settings.ts';
import { client, isolation, root, startCore, stopCore, teardownCore, uiHello, until, withEnv } from './helpers.ts';

function fixture(t) {
  const isolated = isolation();
  const engines = join(isolated.home, 'engines.json');
  writeFileSync(engines, '[]');
  isolated.env.METATROOPER_ENGINES = engines;
  const resources: Array<() => void> = [];
  const cores = [];
  t.after(async () => {
    for (const close of resources.reverse()) close();
    for (const core of cores) await stopCore(core, isolated);
    if (cores.length) await teardownCore(null, isolated);
    rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { ...isolated, resources, cores };
}

function openDb(isolated) {
  return withEnv({ METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix }, openCoreDb);
}

function migrationRows(db) {
  return db.prepare('SELECT id, applied_at FROM schema_migration ORDER BY id').all().map(row => ({ ...row }));
}

async function running(t, isolated) {
  const core = await startCore(isolated);
  isolated.cores.push(core);
  const pipe = await client(isolated.prefix);
  isolated.resources.push(() => pipe.close());
  return { core, pipe };
}

function contender(isolated) {
  const child = spawn(process.execPath, ['core/src/main.ts'], { cwd: root, env: isolated.env, windowsHide: true });
  let stderr = '';
  child.stdout.resume();
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve({ code, stderr }));
  });
  return { child, done };
}

test('M6-04a second core exits 1 with the owner pid and leaves the database unchanged', { timeout: 15000 }, async t => {
  const isolated = fixture(t);
  const { core, pipe } = await running(t, isolated);
  const db = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
  isolated.resources.push(() => db.close());
  const beforeCommands = db.prepare('SELECT * FROM command ORDER BY id').all();
  const before = statSync(join(isolated.home, 'troop.db'));
  const second = contender(isolated);
  isolated.resources.push(() => { if (second.child.exitCode === null && !isolated.cores.includes(second.child)) second.child.kill(); });
  const result = await second.done;
  const after = statSync(join(isolated.home, 'troop.db'));
  assert.equal(result.code, 1);
  assert.ok(result.stderr.includes('core already running (pid ' + core.pid + ')'), result.stderr);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(after.size, before.size);
  assert.deepEqual(db.prepare('SELECT * FROM command ORDER BY id').all(), beforeCommands);
  assert.equal((await pipe.request('core.ping')).result.pid, core.pid);
});

test('M6-04a simultaneous starts recover one accepted project.open exactly once before replying', { timeout: 20000 }, async t => {
  const isolated = fixture(t);
  const project = join(isolated.home, 'project');
  mkdirSync(project);
  const seed = openDb(isolated);
  seed.exec("CREATE TABLE project_effect (kind TEXT NOT NULL); CREATE TRIGGER count_project_insert AFTER INSERT ON project BEGIN INSERT INTO project_effect VALUES ('insert'); END; CREATE TRIGGER count_project_update AFTER UPDATE ON project BEGIN INSERT INTO project_effect VALUES ('update'); END;");
  seed.prepare("INSERT INTO command (id, at, origin, method, params, status) VALUES ('accepted-fixture', '2026-10-11T00:00:00+00:00', 'cli', 'project.open', ?, 'accepted')").run(JSON.stringify({ path: project }));
  seed.close();
  const first = contender(isolated);
  const second = contender(isolated);
  isolated.cores.push(first.child, second.child);
  // Connect while startup and recovery are in progress.
  const pipe = await until(() => client(isolated.prefix), 5000);
  isolated.resources.push(() => pipe.close());
  const ping = await pipe.request('core.ping', {}, { timeout: 5000 });
  const db = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
  isolated.resources.push(() => db.close());
  assert.equal(db.prepare("SELECT status FROM command WHERE id = 'accepted-fixture'").get().status, 'ok');
  await until(() => first.child.exitCode !== null || second.child.exitCode !== null, 5000);
  const loser = first.child.exitCode !== null ? first : second;
  const winner = loser === first ? second : first;
  const result = await loser.done;
  assert.equal(result.code, 1);
  assert.ok(result.stderr.includes('core already running (pid ' + winner.child.pid + ')'), result.stderr);
  assert.equal(ping.result.pid, winner.child.pid);
  assert.equal(db.prepare('SELECT count(*) AS n FROM project').get().n, 1);
  assert.deepEqual(db.prepare('SELECT kind FROM project_effect').all().map(row => row.kind), ['insert']);
  assert.equal(db.prepare('SELECT count(*) AS n FROM command').get().n, 1);
});

test('migrate records baseline id 1 once and a second open applies nothing', t => {
  const isolated = fixture(t);
  let db = openDb(isolated);
  const before = migrationRows(db);
  assert.deepEqual(before.map(row => row.id), [1]);
  assert.equal(typeof before[0].applied_at, 'string');
  assert.ok(Number.isFinite(Date.parse(before[0].applied_at)));
  assert.deepEqual(migrate(db), []);
  db.close();
  db = openDb(isolated);
  try {
    assert.deepEqual(migrationRows(db), before);
    assert.deepEqual(migrate(db), []);
  } finally { db.close(); }
});

test('migrate applies only numbered SQL files and returns applied ids', t => {
  const isolated = fixture(t);
  const dir = join(isolated.home, 'migrations');
  mkdirSync(dir);
  writeFileSync(join(dir, '002-add.sql'), 'CREATE TABLE added (id INTEGER PRIMARY KEY);');
  for (const name of ['notes.sql', '02-short.sql', '0004-long.sql', '003-space name.sql', '004-upper.SQL']) writeFileSync(join(dir, name), 'THIS MUST NOT RUN;');
  const db = openDb(isolated);
  try {
    assert.deepEqual(migrate(db, dir), [2]);
    assert.deepEqual(migrationRows(db).map(row => row.id), [1, 2]);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'added'").get().name, 'added');
    assert.deepEqual(migrate(db, dir), []);
  } finally { db.close(); }
});

test('migrate rolls back all statements and its record when 003 fails', t => {
  const isolated = fixture(t);
  const dir = join(isolated.home, 'migrations');
  mkdirSync(dir);
  writeFileSync(join(dir, '002-add.sql'), 'CREATE TABLE retained (id INTEGER PRIMARY KEY); INSERT INTO retained VALUES (7);');
  writeFileSync(join(dir, '003-bad.sql'), 'CREATE TABLE partial (id INTEGER); INSERT INTO retained VALUES (8); BAD SQL;');
  const db = openDb(isolated);
  try {
    assert.throws(() => migrate(db, dir), /syntax error/i);
    assert.deepEqual(migrationRows(db).map(row => row.id), [1, 2]);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'partial'").get(), undefined);
    assert.deepEqual(db.prepare('SELECT id FROM retained').all().map(row => row.id), [7]);
    writeFileSync(join(dir, '003-bad.sql'), 'CREATE TABLE repaired (id INTEGER);');
    assert.deepEqual(migrate(db, dir), [3]);
    assert.deepEqual(migrate(db, dir), []);
  } finally { db.close(); }
});

test('migrate executes ids in numeric order despite reverse fixture creation order', t => {
  const isolated = fixture(t);
  const dir = join(isolated.home, 'migrations');
  mkdirSync(dir);
  writeFileSync(join(dir, '010-last.sql'), "INSERT INTO ordered VALUES (10);");
  writeFileSync(join(dir, '003-middle.sql'), "INSERT INTO ordered VALUES (3);");
  writeFileSync(join(dir, '002-first.sql'), 'CREATE TABLE ordered (id INTEGER); INSERT INTO ordered VALUES (2);');
  const readDirectory = fs.readdirSync;
  t.mock.method(fs, 'readdirSync', (folder, ...options) => {
    const entries = readDirectory(folder, ...options);
    return folder === dir ? entries.reverse() : entries;
  });
  const db = openDb(isolated);
  try {
    assert.deepEqual(migrate(db, dir), [2, 3, 10]);
    assert.deepEqual(db.prepare('SELECT id FROM ordered ORDER BY rowid').all().map(row => row.id), [2, 3, 10]);
  } finally { db.close(); }
});

test('M6-04c M5 database gets baseline once and reopening preserves schema and rows', t => {
  const isolated = fixture(t);
  let db = openDb(isolated);
  db.exec('DROP TABLE schema_migration');
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('m5-project', '/fixture', 'kept', '2026-10-10T00:00:00+00:00', '2026-10-10T00:00:00+00:00')").run();
  const schema = db.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const project = db.prepare('SELECT * FROM project').all();
  db.close();
  db = openDb(isolated);
  const applied = migrationRows(db);
  try {
    assert.deepEqual(applied.map(row => row.id), [1]);
    assert.deepEqual(db.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != 'schema_migration' ORDER BY name").all(), schema);
    assert.deepEqual(db.prepare('SELECT * FROM project').all(), project);
  } finally { db.close(); }
  db = openDb(isolated);
  try {
    assert.deepEqual(migrationRows(db), applied);
    assert.deepEqual(db.prepare('SELECT * FROM project').all(), project);
    assert.deepEqual(migrate(db), []);
  } finally { db.close(); }
});

for (const [name, text, line] of [
  ['unexpected token', "{\n  \"ui\": {\"theme\": \"charcoal\"},\n  \"sessions\": !\n}\n", 3],
  ['truncated JSON', "{\n  \"ui\": {\"theme\": \"charcoal\"},\n  \"sessions\": {\n", 4],
] as const) {
  test('M6-04b invalid settings ' + name + ' preserves bytes and reports line ' + line, { timeout: 15000 }, async t => {
    const isolated = fixture(t);
    const file = join(isolated.home, 'settings.json');
    writeFileSync(file, text);
    const before = readFileSync(file);
    const { pipe } = await running(t, isolated);
    await uiHello(pipe, isolated.home);
    const reply = await pipe.request('settings.set', { key: 'ui.theme', value: 'charcoal' });
    assert.equal(reply.error?.code, -32003);
    assert.equal(reply.error?.message, 'settings.json does not parse, line ' + line);
    assert.deepEqual(readFileSync(file), before);
    withEnv({ METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix }, () => {
      assert.equal(settingsError(), 'settings.json does not parse, line ' + line);
      const defaults = settings();
      assert.equal(defaults.ui.theme, 'dither');
      assert.equal(defaults.sessions.approval, 'ask');
      assert.deepEqual(defaults.sessions.ask_paths, []);
      assert.equal(defaults.projects.default, '');
      assert.equal(defaults.worktree.npm_ci, true);
      assert.equal(defaults.terminal.cols, 120);
      assert.equal(defaults.terminal.rows, 30);
      assert.equal(defaults.ui.rail_width, 290);
    });
    assert.deepEqual(readdirSync(isolated.home).filter(name => name.startsWith('settings.json.tmp-')), []);
  });
}

test('M6-04b settings.set changes only ui.theme and preserves other file keys', { timeout: 15000 }, async t => {
  const isolated = fixture(t);
  const file = join(isolated.home, 'settings.json');
  writeFileSync(file, '{"ui":{"theme":"dither","rail_width":333,"custom":"kept"},"sessions":{"approval":"ask","ask_paths":["/fixture"]},"extra":{"value":7}}');
  const { pipe } = await running(t, isolated);
  await uiHello(pipe, isolated.home);
  assert.deepEqual((await pipe.request('settings.set', { key: 'ui.theme', value: 'charcoal' })).result, {});
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { ui: { theme: 'charcoal', rail_width: 333, custom: 'kept' }, sessions: { approval: 'ask', ask_paths: ['/fixture'] }, extra: { value: 7 } });
  withEnv({ METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix }, () => {
    assert.equal(settingsError(), null);
    assert.equal(settings().ui.theme, 'charcoal');
    assert.equal(settings().ui.rail_width, 333);
    assert.equal(settings().terminal.cols, 120);
  });
  assert.deepEqual(readdirSync(isolated.home).filter(name => name.startsWith('settings.json.tmp-')), []);
});

test('settings.set creates a missing file with sessions.approval ask', { timeout: 15000 }, async t => {
  const isolated = fixture(t);
  const file = join(isolated.home, 'settings.json');
  withEnv({ METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix }, () => assert.equal(settingsError(), null));
  const { pipe } = await running(t, isolated);
  assert.equal(existsSync(file), false);
  await uiHello(pipe, isolated.home);
  assert.deepEqual((await pipe.request('settings.set', { key: 'ui.theme', value: 'charcoal' })).result, {});
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { sessions: { approval: 'ask' }, ui: { theme: 'charcoal' } });
});

test('settings.set requires ui.hello and rejects unknown keys and wrong scalar types', { timeout: 15000 }, async t => {
  const isolated = fixture(t);
  const { pipe } = await running(t, isolated);
  assert.equal((await pipe.request('settings.set', { key: 'ui.theme', value: 'charcoal' })).error?.code, -32012);
  await uiHello(pipe, isolated.home);
  for (const params of [{ key: 'ui', value: 'charcoal' }, { key: 'nope.x', value: 'charcoal' }, { key: 'ui.theme.x', value: 'charcoal' }, { key: 'ui.theme', value: 3 }, { key: 'ui.theme', value: null }]) {
    assert.equal((await pipe.request('settings.set', params)).error?.code, -32602, JSON.stringify(params));
  }
  assert.equal(existsSync(join(isolated.home, 'settings.json')), false);
});

for (const params of [{ key: 'sessions.ask_paths', value: {} }, { key: 'ui.themes', value: [] }]) {
  test('settings.set rejects the wrong JSON type for ' + params.key, { timeout: 15000 }, async t => {
    const isolated = fixture(t);
    const { pipe } = await running(t, isolated);
    await uiHello(pipe, isolated.home);
    assert.equal((await pipe.request('settings.set', params)).error?.code, -32602);
    assert.equal(existsSync(join(isolated.home, 'settings.json')), false);
  });
}

test('M6-04b startup removes abandoned settings temp files and preserves the valid file', { timeout: 15000 }, async t => {
  const isolated = fixture(t);
  const file = join(isolated.home, 'settings.json');
  writeFileSync(file, "{\n  \"sessions\": {\"approval\": \"ask\"},\n  \"ui\": {\"theme\": \"charcoal\"}\n}\n");
  const before = readFileSync(file);
  writeFileSync(file + '.tmp-12345', '{"ui":{"theme":"paper"');
  writeFileSync(file + '.tmp-67890', '{"ui":{"theme":"slate"}}');
  const unrelated = join(isolated.home, 'settings.json.backup');
  writeFileSync(unrelated, 'keep');
  const { pipe } = await running(t, isolated);
  assert.deepEqual(readdirSync(isolated.home).filter(name => name.startsWith('settings.json.tmp-')), []);
  assert.deepEqual(readFileSync(file), before);
  assert.equal(readFileSync(unrelated, 'utf8'), 'keep');
  await uiHello(pipe, isolated.home);
  assert.deepEqual((await pipe.request('settings.set', { key: 'ui.rail_width', value: 310 })).result, {});
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { sessions: { approval: 'ask' }, ui: { theme: 'charcoal', rail_width: 310 } });
});

test('core.ping reports the D63 fields and stable started_at without queueing', { timeout: 15000 }, async t => {
  const isolated = fixture(t);
  const { core, pipe } = await running(t, isolated);
  const first = (await pipe.request('core.ping')).result;
  assert.deepEqual(Object.keys(first).sort(), ['ok', 'pid', 'protocol', 'schema_version', 'started_at', 'version']);
  assert.equal(first.ok, true);
  assert.equal(typeof first.pid, 'number');
  assert.equal(first.pid, core.pid);
  assert.equal(typeof first.version, 'string');
  assert.equal(first.version, JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
  assert.equal(first.protocol, 1);
  assert.equal(first.schema_version, 2);
  assert.equal(typeof first.started_at, 'string');
  assert.match(first.started_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);
  assert.ok(Number.isFinite(Date.parse(first.started_at)));
  const second = (await pipe.request('core.ping')).result;
  assert.equal(second.started_at, first.started_at);
  const db = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
  try { assert.equal(db.prepare("SELECT count(*) AS n FROM command WHERE method = 'core.ping'").get().n, 0); }
  finally { db.close(); }
});


test('core.ping keeps started_at fixed across pings separated beyond clock resolution', { timeout: 15000 }, async t => {
  const isolated = fixture(t);
  const { pipe } = await running(t, isolated);
  const firstPingTime = Date.now();
  const first = (await pipe.request('core.ping')).result;
  // nowIso() in src/time.ts includes milliseconds; wait well beyond its 1 ms resolution.
  await new Promise(resolve => setTimeout(resolve, 50));
  const second = (await pipe.request('core.ping')).result;
  assert.equal(second.started_at, first.started_at);
  assert.ok(Date.parse(first.started_at) <= firstPingTime, 'started_at must not be later than the first ping');
  assert.ok(Date.parse(second.started_at) <= firstPingTime, 'started_at must not advance after the first ping');
});
