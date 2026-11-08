import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { auditRows, type AuditRow } from '../src/audit.ts';
import { buildMethods, METHODS } from '../src/methods.ts';
import { CommandRunner } from '../src/pipe/commands.ts';
import { E, RpcError } from '../src/pipe/errors.ts';

const schema = readFileSync(new URL('../../contracts/schema.sql', import.meta.url), 'utf8');
const UI = { ui: true, origin: 'workbench' };
const times = [0, 1, 2, 3, 4, 5].map((minute) => new Date(Date.UTC(2026, 9, 12, 0, minute)).toISOString());

function seed(db: DatabaseSync) {
  db.exec('PRAGMA foreign_keys = ON');
  for (const id of ['p1', 'p2', 'empty']) {
    db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)')
      .run(id, '/audit/' + id, id, times[0], times[0]);
  }
  for (const engine of ['claude', 'codex']) {
    db.prepare('INSERT INTO engine (id, spec_json, cost_rank) VALUES (?, ?, ?)').run(engine, '{}', 1);
  }
  for (const [id, project, engine] of [['s1', 'p1', 'claude'], ['s2', 'p1', 'codex'], ['other', 'p2', 'codex']]) {
    db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, project, engine, 'pty', 'working', times[0], times[0]);
  }
}

function approval(db: DatabaseSync, overrides: Record<string, string | null> = {}) {
  const row = {
    id: 'ap1', session_id: 's1', surface: 'browser', target: 'https://example.test', action: 'click',
    action_hash: 'fixture-hash', summary: 'Click Send', reason: 'User approved sending',
    status: 'approved', created_at: times[1], decided_at: times[3], ...overrides,
  };
  db.prepare('INSERT INTO approval (' + Object.keys(row).join(', ') + ') VALUES (' + Object.keys(row).map(() => '?').join(', ') + ')')
    .run(...Object.values(row));
}

function event(db: DatabaseSync, kind: string, at = times[2], source = 'core', session = 's2', payload = '{}') {
  db.prepare('INSERT INTO event (at, source, session_id, kind, payload) VALUES (?, ?, ?, ?, ?)')
    .run(at, source, session, kind, payload);
}

function api(db: DatabaseSync) {
  const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'audit-test-key' });
  const list = async (params: Record<string, unknown> = {}) => {
    const result = await methods.get('audit.list')!.handler({ project_id: 'p1', ...params }, UI);
    return (result as { rows: AuditRow[] }).rows;
  };
  return { methods, list };
}

function fixture(t: TestContext) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(schema);
  seed(db);
  return { db, ...api(db) };
}

const codeIs = (code: number) => (error: unknown) => {
  assert.ok(error instanceof RpcError);
  assert.equal(error.code, code);
  return true;
};

const ID_SHAPE = /^(a\d{12}[qd]|e\d{12})$/;
// Checks each row's id shape, then returns the rows without the id for whole-row comparison.
function plain(rows: AuditRow[]) {
  return rows.map(({ id, ...rest }) => {
    assert.match(id, ID_SHAPE);
    return rest;
  });
}

test('M8-F21a: every row names the session agent, action and time', async (t) => {
  const f = fixture(t);
  approval(f.db);
  event(f.db, 'codex.turn', times[2], 'codex-notify', 's2', '{"reply":"Done"}');
  assert.deepEqual(plain(await f.list()), [
    { at: times[3], session_id: 's1', agent: 'claude', action: 'gate approved', detail: 'User approved sending', source: 'system' },
    { at: times[2], session_id: 's2', agent: 'codex', action: 'codex.turn', detail: '{"reply":"Done"}', source: 'agent' },
    { at: times[1], session_id: 's1', agent: 'claude', action: 'asked to click on browser https://example.test', detail: 'Click Send', source: 'agent' },
  ]);
});

test('M8-F21b: pending requests are agent rows and decisions are system rows', async (t) => {
  const f = fixture(t);
  approval(f.db, { status: 'waiting', decided_at: null });
  for (const status of ['approved', 'rejected', 'expired']) {
    approval(f.db, { id: status, status, summary: status + ' request', reason: status + ' reason' });
  }
  const rows = await f.list();
  assert.equal(rows.length, 7);
  const requests = rows.filter((r) => r.action.startsWith('asked to '));
  assert.equal(requests.length, 4);
  assert.ok(requests.every((r) => r.source === 'agent'));
  assert.ok(!rows.some((r) => r.action === 'gate waiting'));
  for (const status of ['approved', 'rejected', 'expired']) {
    assert.deepEqual(plain([rows.find((r) => r.action === 'gate ' + status)!]), [{
      at: times[3], session_id: 's1', agent: 'claude', action: 'gate ' + status, detail: status + ' reason', source: 'system',
    }]);
  }
});

test('M8-F21b: hook and notify events are agent words, launch and core events are system rows', async (t) => {
  const f = fixture(t);
  const sources = ['claude-hook', 'codex-notify', 'launch', 'core'];
  sources.forEach((source, i) => event(f.db, 'fixture.' + source, times[i], source, i === 0 ? 's1' : 's2', JSON.stringify({ text: source })));
  const rows = await f.list();
  assert.equal(rows.length, 4);
  for (const source of sources) {
    const row = rows.find((r) => r.action === 'fixture.' + source)!;
    assert.equal(row.source, ['claude-hook', 'codex-notify'].includes(source) ? 'agent' : 'system');
    assert.equal(row.detail, JSON.stringify({ text: source }));
  }
});

test('M8-F21c: audit.list is the only audit method and requires a trusted UI', async (t) => {
  const f = fixture(t);
  approval(f.db);
  event(f.db, 'codex.turn');
  assert.deepEqual(METHODS.filter((m) => m.name.startsWith('audit.')).map((m) => m.name), ['audit.list']);
  assert.equal(METHODS.find((m) => m.name === 'audit.list')?.needsUi, true);
  assert.deepEqual([...f.methods.keys()].filter((name) => name.startsWith('audit.')), ['audit.list']);
  assert.equal(f.methods.get('audit.list')!.needsUi, true);
  const before = await f.list();
  const runner = new CommandRunner(f.db, f.methods);
  await assert.rejects(runner.call({ id: 'agent-audit', method: 'audit.list', params: { project_id: 'p1' }, origin: 'cli' }, { ui: false, origin: 'cli' }), codeIs(E.NEEDS_UI));
  assert.deepEqual(await f.list(), before);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM command').get()!.n, 0);
  const result = await runner.call({ id: 'ui-audit', method: 'audit.list', params: { project_id: 'p1' }, origin: 'workbench' }, UI);
  assert.deepEqual(result, { rows: before });
  assert.deepEqual(await f.list(), before);
});

test('M8-F21c: listing changes no stored row', async (t) => {
  const f = fixture(t);
  approval(f.db);
  event(f.db, 'codex.turn');
  const snapshot = () => f.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
    .map(({ name }) => ({ name, rows: f.db.prepare('SELECT * FROM "' + name + '"').all() }));
  const before = snapshot();
  assert.equal((await f.list()).length, 3);
  await f.list({ limit: 1, before: times[3] });
  assert.deepEqual(snapshot(), before);
});

test('M8-F21d: explicit secret values and credential strings never appear in audit rows', (t) => {
  const f = fixture(t);
  const secret = 'fixture-private-phrase';
  const credential = 'ghp_' + 'a'.repeat(36);
  const text = 'Visible ' + secret + ' ' + credential;
  approval(f.db, { action: text, target: text, summary: text, reason: text });
  event(f.db, text, times[2], 'claude-hook', 's1', JSON.stringify({ text }));
  const rows = auditRows(f.db, 'p1', {}, [secret]);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.ok(!JSON.stringify(row).includes(secret));
    assert.ok(!JSON.stringify(row).includes(credential));
    assert.ok(row.detail.includes('Visible [secret] [secret]'));
  }
  assert.equal(rows.find((r) => r.source === 'agent' && r.action.startsWith('asked to '))!.action,
    'asked to Visible [secret] [secret] on browser Visible [secret] [secret]');
  assert.equal(rows.find((r) => r.at === times[2])!.action, 'Visible [secret] [secret]');
});

test('M8-F21d: audit.list scrubs credential strings on the public API', async (t) => {
  const f = fixture(t);
  const credential = 'sk-' + 'b'.repeat(32);
  approval(f.db, { action: credential, summary: credential, reason: credential });
  event(f.db, credential, times[2], 'codex-notify', 's2', credential);
  const rows = await f.list();
  assert.equal(rows.length, 3);
  assert.ok(!JSON.stringify(rows).includes(credential));
  assert.ok(rows.every((row) => row.detail === '[secret]'));
});

test('M8-F21d: a known secret longer than 2000 characters in an event payload never appears, not even a prefix', (t) => {
  const f = fixture(t);
  const secret = 'SECRET' + 'k'.repeat(2494);
  assert.equal(secret.length, 2500);
  event(f.db, 'claude.tool', times[2], 'claude-hook', 's1', JSON.stringify({ text: secret }));
  const rows = auditRows(f.db, 'p1', {}, [secret]);
  assert.equal(rows.length, 1);
  const prefix = secret.slice(0, 20);
  for (const row of rows) {
    assert.ok(!row.detail.includes(prefix));
    assert.ok(!row.action.includes(prefix));
    assert.ok(!JSON.stringify(row).includes(prefix));
  }
});

test('M8-F21d: a known secret with a quote and a backslash stored JSON-escaped never appears', (t) => {
  const f = fixture(t);
  const secret = 'fixture"pass\\word';
  event(f.db, 'codex.turn', times[2], 'codex-notify', 's2', JSON.stringify({ text: secret }));
  const rows = auditRows(f.db, 'p1', {}, [secret]);
  assert.equal(rows.length, 1);
  const escaped = JSON.stringify(secret).slice(1, -1);
  for (const row of rows) {
    for (const text of [row.detail, row.action]) {
      assert.ok(!text.includes(secret));
      assert.ok(!text.includes(escaped));
      assert.ok(!text.includes('pass\\word'));
    }
  }
});

test('M8-F21: actions and details are capped at 300 characters', async (t) => {
  const f = fixture(t);
  const long = 'x'.repeat(450);
  approval(f.db, { action: long, summary: long, reason: long });
  event(f.db, long, times[2], 'core', 's2', long);
  const rows = await f.list();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.action.length <= 300 && row.detail.length <= 300));
  assert.ok(rows.every((row) => row.detail === long.slice(0, 300)));
  assert.equal(rows.find((r) => r.at === times[2])!.action, long.slice(0, 300));
  assert.equal(rows.find((r) => r.at === times[1])!.action, ('asked to ' + long).slice(0, 300));
});

test('M8-F21e: audit rows survive closing and reopening a file database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'm8-f21-'));
  const file = join(dir, 'audit.db');
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file);
    db.exec(schema);
    seed(db);
    approval(db);
    event(db, 'codex.turn', times[2], 'codex-notify', 's2', '{"text":"Persist me"}');
    const before = await api(db).list();
    assert.equal(before.length, 3);
    db.close();
    db = undefined;
    db = new DatabaseSync(file);
    assert.deepEqual(await api(db).list(), before);
  } finally {
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M8-F21: other projects and sessions without a project match are excluded', async (t) => {
  const f = fixture(t);
  approval(f.db);
  approval(f.db, { id: 'other-approval', session_id: 'other' });
  event(f.db, 'wanted', times[2]);
  event(f.db, 'other-project', times[4], 'core', 'other');
  event(f.db, 'orphan', times[4], 'core', 'missing');
  f.db.prepare('INSERT INTO event (at, source, session_id, kind, payload) VALUES (?, ?, NULL, ?, ?)').run(times[4], 'core', 'no-session', '{}');
  const rows = await f.list();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => ['s1', 's2'].includes(row.session_id)));
  assert.deepEqual(await f.list({ project_id: 'empty' }), []);
  assert.equal((await f.list({ project_id: 'p2' })).length, 3);
});

test('M8-F21: all five noise kinds are excluded regardless of event source', async (t) => {
  const f = fixture(t);
  const noise = ['term.output', 'term.bell', 'core.activity', 'core.title-state', 'core.seen'];
  for (const source of ['claude-hook', 'codex-notify', 'launch', 'core']) {
    for (const kind of noise) event(f.db, kind, times[4], source);
  }
  event(f.db, 'browser.tool', times[1]);
  event(f.db, 'codex.turn', times[2], 'codex-notify');
  assert.deepEqual((await f.list()).map((r) => r.action), ['codex.turn', 'browser.tool']);
});

test('M8-F21: newest first and exclusive before use instants across timestamp offsets', async (t) => {
  const f = fixture(t);
  approval(f.db);
  event(f.db, 'older-offset', '2026-10-12T10:00:00.000+10:00');
  event(f.db, 'newest', times[4]);
  event(f.db, 'middle', times[2]);
  const rows = await f.list();
  assert.deepEqual(rows.map((r) => r.action), ['newest', 'gate approved', 'middle', 'asked to click on browser https://example.test', 'older-offset']);
  assert.deepEqual(await f.list({ before: '2026-10-12T10:03:00.000+10:00' }), rows.slice(2));
  assert.deepEqual(await f.list({ before: times[0] }), []);
  assert.deepEqual(await f.list({ before: times[3], limit: 1 }), rows.slice(2, 3));
});

test('M8-F21: default limit is 100 and inclusive bounds are 1 and 500', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 505; i++) {
    event(f.db, 'event.' + i, new Date(Date.UTC(2026, 9, 12, 0, 0, i)).toISOString());
  }
  const rows = await f.list({ limit: 500 });
  assert.equal(rows.length, 500);
  assert.equal(rows[0].action, 'event.504');
  assert.equal(rows[499].action, 'event.5');
  assert.deepEqual(await f.list(), rows.slice(0, 100));
  assert.deepEqual(await f.list({ limit: 1 }), rows.slice(0, 1));
});

for (const limit of [0, 501, 1.5, '2']) {
  test('M8-F21: invalid limit ' + JSON.stringify(limit) + ' returns -32602', async (t) => {
    const f = fixture(t);
    await assert.rejects(f.list({ limit }), codeIs(E.INVALID_PARAMS));
  });
}

test('M8-F21: unknown project returns NOT_FOUND', async (t) => {
  const f = fixture(t);
  await assert.rejects(f.list({ project_id: 'unknown' }), codeIs(E.NOT_FOUND));
});

test('M8-F21: paging over rows sharing one timestamp skips none', async (t) => {
  const f = fixture(t);
  for (const kind of ['page.a', 'page.b', 'page.c']) event(f.db, kind, times[2]);
  const seen: AuditRow[] = [];
  let cursor: { before?: string; before_id?: string } = {};
  for (let page = 0; page < 10; page++) {
    const rows = await f.list({ limit: 1, ...cursor });
    if (rows.length === 0) break;
    seen.push(...rows);
    const last = rows[rows.length - 1];
    cursor = { before: last.at, before_id: last.id };
  }
  assert.deepEqual(seen.map((r) => r.action), ['page.c', 'page.b', 'page.a']);
  assert.ok(seen.every((r) => r.at === times[2]));
  const ids = seen.map((r) => r.id);
  assert.deepEqual(ids, [...ids].sort().reverse());
  assert.equal(new Set(ids).size, 3);
});

test('M8-F21: before_id without before is -32602', async (t) => {
  const f = fixture(t);
  event(f.db, 'codex.turn');
  await assert.rejects(f.list({ before_id: 'e000000000001' }), codeIs(E.INVALID_PARAMS));
});
