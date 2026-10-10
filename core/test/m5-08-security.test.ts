import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { allowSandbox, openCoreDb } from '../src/store/db.ts';

const root = resolve(import.meta.dirname, '../..');
const schema = readFileSync(join(root, 'contracts/schema.sql'), 'utf8');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'metatrooper-m5-08-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  db.exec('PRAGMA user_version = 2');
  db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '2')").run();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', dir, 'project', '2026-10-09T00:00:00.000Z', '2026-10-09T00:00:00.000Z');
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('e1', '{}', 1, 'local-cli');
  return { dir, db };
}

function staleCheck(db: DatabaseSync, table: string, check: string, extra: string, value: string | null) {
  const at = schema.indexOf(`CREATE TABLE ${table} (`);
  const end = schema.indexOf('\n);', at);
  const create = schema.slice(at, end + 3);
  assert.ok(create);
  const old = create.replace(check, check === "host IN ('pty','sandbox','external')" ? "host IN ('pty','sandbox')" : check.replace(/'[^']+'/g, "'old'"));
  db.exec(`DROP TABLE ${table}`);
  const withExtra = old.replace(`CREATE TABLE ${table} (`, `CREATE TABLE ${table} (\n  ${extra} TEXT,`);
  db.exec(withExtra);
  if (table === 'session') {
    db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('s1', 'p1', 'e1', 'pty', 'working', '2026-10-09T00:00:00.000Z', '2026-10-09T00:00:00.000Z', value);
  } else if (table === 'comment') {
    db.exec("DROP TABLE comment");
    const start = schema.indexOf('CREATE TABLE comment (');
    const finish = schema.indexOf('\n);', start);
    db.exec(schema.slice(start, finish + 3).replace("'notice'", "'old'").replace('CREATE TABLE comment (', 'CREATE TABLE comment (\n  note TEXT,'));
    db.prepare("INSERT INTO comment (id, at, session_id, kind, body, note) VALUES (?, ?, ?, 'element', 'body', ?)").run('c1', '2026-10-09T00:00:00.000Z', 's1', value);
  } else {
    db.exec("DROP TABLE needs_you");
    const start = schema.indexOf('CREATE TABLE needs_you (');
    const finish = schema.indexOf('\n);', start);
    db.exec(schema.slice(start, finish + 3).replace("'uncommitted'", "'old'").replace('CREATE TABLE needs_you (', 'CREATE TABLE needs_you (\n  note TEXT,'));
    db.prepare("INSERT INTO needs_you (id, at, kind, text, note) VALUES (?, ?, 'gate', 'text', ?)").run('n1', '2026-10-09T00:00:00.000Z', value);
  }
}

test('M5-08a rebuild keeps extra session data and every existing value', () => {
  const { dir, db } = fixture();
  try {
    staleCheck(db, 'session', "host IN ('pty','sandbox','external')", 'note', 'session note');
    db.close();
    const priorHome = process.env.METATROOPER_HOME;
    process.env.METATROOPER_HOME = dir;
    try {
      const opened = openCoreDb();
      try {
        assert.deepEqual({ ...opened.prepare('SELECT id, project_id, engine_id, host, state, state_at, started_at, note FROM session').get() as object }, {
          id: 's1', project_id: 'p1', engine_id: 'e1', host: 'pty', state: 'working', state_at: '2026-10-09T00:00:00.000Z', started_at: '2026-10-09T00:00:00.000Z', note: 'session note',
        });
      } finally { opened.close(); }
    } finally { if (priorHome === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = priorHome; }
  } finally { try { db.close(); } catch {} rmSync(dir, { recursive: true, force: true }); }
});

test('M5-08a rebuild keeps an extra column containing only NULL', () => {
  const { dir, db } = fixture();
  try {
    staleCheck(db, 'session', "host IN ('pty','sandbox','external')", 'note', null);
    allowSandbox(db);
    assert.ok(db.prepare('PRAGMA table_info(session)').all().some((c: any) => c.name === 'note'));
    assert.equal((db.prepare('SELECT note FROM session WHERE id = ?').get('s1') as any).note, null);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

for (const [table, check] of [['comment', "kind IN ('element','diff-line','file','notice')"], ['needs_you', "kind IN ('gate','interrupted-command','missed-schedule','run-failed','missing-secret','handoff','budget','done','failed','spool-too-large','uncommitted','other')"]] as const) {
  test(`M5-08a rebuild keeps extra ${table} column and data`, () => {
    const { dir, db } = fixture();
    try {
      if (table === 'comment') {
        db.exec("DROP TABLE session");
        db.exec("CREATE TABLE session (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES project(id), engine_id TEXT NOT NULL REFERENCES engine(id), driven_engine TEXT, host TEXT NOT NULL CHECK (host IN ('pty','sandbox','external')), pid INTEGER, native_id TEXT, run_id TEXT REFERENCES run(id), step_id TEXT, state TEXT NOT NULL, state_at TEXT NOT NULL, last_tool TEXT, cwd TEXT, title TEXT, started_at TEXT NOT NULL, ended_at TEXT, parent_id TEXT)");
        db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s1','p1','e1','pty','working','2026-10-09T00:00:00.000Z','2026-10-09T00:00:00.000Z')").run();
      }
      staleCheck(db, table, check, 'note', `${table} note`);
      allowSandbox(db);
      const row: any = table === 'comment' ? db.prepare('SELECT note FROM comment WHERE id = ?').get('c1') : db.prepare('SELECT note FROM needs_you WHERE id = ?').get('n1');
      assert.equal(row.note, `${table} note`);
    } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
  });
}

test('M5-08a rebuild failure rolls back table and data', () => {
  const { dir, db } = fixture();
  try {
    const create = schema.slice(schema.indexOf('CREATE TABLE session ('), schema.indexOf('\n);', schema.indexOf('CREATE TABLE session (')) + 3);
    db.exec('DROP TABLE session');
    db.exec(create.replace("'external'", "'obsolete'").replace('\n);', ',\n note TEXT\n);'));
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, note) VALUES ('s1','p1','e1','pty','working','2026-10-09T00:00:00.000Z','2026-10-09T00:00:00.000Z','keep')").run();
    allowSandbox(db);
    assert.equal((db.prepare('SELECT note FROM session WHERE id = ?').get('s1') as any).note, 'keep');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

function launch(args: string[], cwd: string) {
  const encoded = Buffer.from(JSON.stringify(args)).toString('base64');
  return spawnSync(process.execPath, [join(root, 'core/dist/hook/launch.js'), '--session', randomUUID(), '--engine', 'fake', '--args-b64', encoded], { cwd, encoding: 'utf8', env: { ...process.env, METATROOPER_HOME: join(cwd, 'home'), PATH: process.env.PATH } });
}

test('M5-08c unresolved command fails with 127 and does not run shell metacharacters', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metatrooper-launch-'));
  try {
    const marker = join(dir, 'marker.txt');
    const command = `x&echo hit>${marker}`;
    const result = launch([command], dir);
    assert.equal(result.status, 127);
    assert.ok(result.stderr.includes(`could not find ${command} on PATH`));
    assert.equal(existsSync(marker), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('M5-08c resolved command runs and passes its exit code through', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metatrooper-launch-'));
  try {
    const result = launch([process.execPath, '-e', "console.log('launch-ok'); process.exit(23)"], dir);
    assert.equal(result.status, 23);
    assert.equal(result.stdout, 'launch-ok\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
