import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { light, OFFLINE_AFTER_MS, snapshot, withLiveText, type Snapshot } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-queries-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  db.exec('PRAGMA foreign_keys = ON');
  return { dir, db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const iso = (ms: number) => new Date(ms).toISOString();

test('engine lights: green only when installed and signed in; never checked is grey; missing or failed is red', () => {
  assert.equal(light({ installed: 1, auth: 'ok' }), 'green');
  assert.equal(light({ installed: 1, auth: 'unknown' }), 'grey');
  assert.equal(light(null), 'grey');
  assert.equal(light({ installed: 0, auth: 'unknown' }), 'red');
  assert.equal(light({ installed: 1, auth: 'missing' }), 'red');
});

test('the core reads as offline when its heartbeat is older than 6 s or absent', () => {
  const f = fixture();
  try {
    const now = Date.now();
    assert.equal(snapshot(f.db, null, now).core.online, false);
    f.db.prepare("INSERT INTO meta (key, value) VALUES ('core_heartbeat', ?), ('core_pid', '42')").run(iso(now - 1000));
    assert.deepEqual(snapshot(f.db, null, now).core, { online: true, pid: 42, heartbeat_age_ms: 1000 });
    assert.equal(snapshot(f.db, null, now + OFFLINE_AFTER_MS).core.online, false);
  } finally {
    f.close();
  }
});

test('snapshot scopes sessions to the project and keeps plugin engines only while enabled', () => {
  const f = fixture();
  try {
    const d = f.db;
    const now = iso(Date.now());
    d.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', '/a', 'a', now, now);
    d.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p2', '/b', 'b', now, now);
    d.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{\"roles\":[\"worker\"]}', 3)").run();
    d.prepare("INSERT INTO plugin (id, version, path, manifest, source, permissions, enabled, installed_at) VALUES ('pl', '1.0.0', '/x', '{}', 'native', '[]', 0, ?)").run(now);
    d.prepare("INSERT INTO engine (id, plugin_id, spec_json, cost_rank) VALUES ('plug-eng', 'pl', '{}', 1)").run();
    d.prepare("INSERT INTO engine_check (engine_id, checked_at, installed, version, auth) VALUES ('claude', ?, 1, '2.1.284', 'ok')").run(now);
    for (const [id, p, hidden] of [['s1', 'p1', 0], ['s2', 'p2', 0], ['s3', 'p1', 1]] as const) {
      d.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES (?, ?, 'claude', 'pty', 'working', ?, ?, ?)").run(id, p, now, now, hidden);
    }
    d.prepare("INSERT INTO needs_you (id, at, kind, ref, text, resolved_at) VALUES ('n1', ?, 'other', NULL, 'open', NULL), ('n2', ?, 'other', NULL, 'closed', ?)").run(now, now, now);

    const s = snapshot(d, 'p1');
    assert.deepEqual(s.sessions.map((x) => x.id), ['s1']);
    assert.equal(s.sessions[0].host, 'pty');
    assert.deepEqual(s.engines.map((e) => [e.id, e.light]), [['claude', 'green']]);
    assert.deepEqual(s.needs_you.map((n) => n.id), ['n1']);
    assert.deepEqual(snapshot(d, 'p2').sessions.map((x) => x.id), ['s2']);
  } finally {
    f.close();
  }
});

test('snapshot lists working and waiting sessions from every project, so the picker and need-you chip see past the open one', () => {
  const f = fixture();
  try {
    const d = f.db;
    const now = iso(Date.now());
    for (const p of ['p1', 'p2']) d.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run(p, `/${p}`, p, now, now);
    d.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 3)").run();
    for (const [id, p, state, hidden] of [['a', 'p1', 'working', 0], ['b', 'p2', 'waiting_for_you', 0], ['c', 'p2', 'working', 0], ['d', 'p2', 'done', 0], ['e', 'p2', 'waiting_for_you', 1]] as const) {
      d.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES (?, ?, 'claude', 'pty', ?, ?, ?, ?)").run(id, p, state, now, now, hidden);
    }
    const s = snapshot(d, 'p1');
    assert.deepEqual(s.sessions.map((x) => x.id), ['a']);
    assert.deepEqual(s.live.map((x) => [x.id, x.project_id, x.state]).sort(), [['a', 'p1', 'working'], ['b', 'p2', 'waiting_for_you'], ['c', 'p2', 'working']]);
  } finally {
    f.close();
  }
});

test('M1-05 withLiveText fills last_line and title from core memory and blanks sessions it does not know', () => {
  const row = (id: string) => ({ id, title: 'stale', last_line: 'stale' });
  const s = { sessions: [row('a'), row('b')], live: [row('a')] } as unknown as Snapshot;
  const out = withLiveText(s, { a: { line: 'ls', title: 'Fix bug' } });
  assert.deepEqual(out.sessions.map((x) => [x.last_line, x.title]), [['ls', 'Fix bug'], [null, null]]);
  assert.deepEqual(out.live.map((x) => [x.last_line, x.title]), [['ls', 'Fix bug']]);
});

test('M1-06 every query the window runs per snapshot has p95 under 1 ms (3 live sessions, a running run, 2,000 events)', () => {
  const f = fixture();
  try {
    const at = iso(Date.now());
    f.db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p', f.dir, 'p', at, at);
    f.db.prepare("INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES ('e', '{}', 1, 'local-cli')").run();
    f.db.prepare("INSERT INTO pipeline (id, source, path, version, valid) VALUES ('pl', 'project', 'x.json', 1, 1)").run();
    f.db.prepare("INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at) VALUES ('r', 'pl', 'p', '{}', 'd', 'running', 'manual', 1000, 1, 10, ?)").run(at);
    for (let i = 0; i < 3; i++) f.db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, run_id) VALUES (?, 'p', 'e', 'pty', 'working', ?, ?, 'r')").run(`s${i}`, at, at);
    const ev = f.db.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', 's0', 'term.output', '{}', 1)");
    for (let i = 0; i < 2000; i++) ev.run(at);
    const times = new Map<string, number[]>();
    const prepare = f.db.prepare.bind(f.db);
    (f.db as { prepare: typeof prepare }).prepare = (sql: string) => {
      const stmt = prepare(sql);
      const timed = (fn: (...a: unknown[]) => unknown) => (...a: unknown[]) => {
        const t = performance.now();
        try { return fn.apply(stmt, a); } finally { (times.get(sql) ?? times.set(sql, []).get(sql)!).push(performance.now() - t); }
      };
      return Object.assign(Object.create(stmt), { all: timed(stmt.all), get: timed(stmt.get) });
    };
    for (let i = 0; i < 200; i++) snapshot(f.db, 'p');
    const slow = [...times].map(([sql, ms]) => [sql.replace(/\s+/g, ' ').slice(0, 80), ms.sort((a, b) => a - b)[Math.floor(ms.length * 0.95)]] as const).filter(([, p]) => p >= 1);
    assert.ok(times.size > 5, `only ${times.size} queries timed`);
    assert.deepEqual(slow, []);
  } finally {
    f.close();
  }
});

test('the project menu leaves out gone folders and worktrees with no .git, but keeps plain folders and the open one', () => {
  const f = fixture();
  try {
    const d = f.db;
    const now = iso(Date.now());
    const wt = join(f.dir, '.metatrooper', 'worktrees', 'h');
    const live = join(wt, 'live');
    const empty = join(wt, 'empty');
    mkdirSync(live, { recursive: true });
    writeFileSync(join(live, '.git'), 'gitdir: x');
    mkdirSync(empty, { recursive: true });
    const add = d.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)');
    add.run('live', live, 'live', now, now);
    add.run('empty', empty, 'empty', now, now);
    add.run('gone', join(wt, 'gone'), 'gone', now, now);
    add.run('plain', f.dir, 'plain', now, now);
    add.run('missing', join(f.dir, 'nope'), 'missing', now, now);
    assert.deepEqual(snapshot(d, null).projects.map((p) => p.id).sort(), ['live', 'plain']);
    assert.deepEqual(snapshot(d, 'gone').projects.map((p) => p.id).sort(), ['gone', 'live', 'plain']);
  } finally {
    f.close();
  }
});
