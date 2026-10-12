import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { appendEvent } from '../src/events/append.ts';
import { processEvents } from '../src/events/processor.ts';
import { RESUME_TEXT, earlyEnd, recordReadings, resumeAtReset } from '../src/sessions/limit-resume.ts';
import { noteTyped, typedAt } from '../src/terminal/index.ts';
import { nowIso } from '../src/time.ts';

const schema = readFileSync(join(import.meta.dirname, '..', '..', 'contracts', 'schema.sql'), 'utf8');
const MIN = 60_000;

function open(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout = 2000');
  return db;
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'troop-m6-24-'));
  const file = join(dir, 'troop.db');
  const db = open(file);
  db.exec(schema);
  const at = nowIso();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p', dir, 'p', at, at);
  db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1)").run();
  return { dir, file, db };
}

function session(db: DatabaseSync, id: string): void {
  const at = nowIso();
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, native_id, state, state_at, started_at) VALUES (?, 'p', 'claude', 'pty', ?, 'working', ?, ?)").run(id, `native-${id}`, at, at);
}

function hook(db: DatabaseSync, id: string, kind: string, extra: object = {}): void {
  db.prepare("INSERT INTO event (at, source, session_id, kind, payload) VALUES (?, 'claude-hook', ?, ?, ?)").run(nowIso(), id, kind, JSON.stringify({ session_id: `native-${id}`, ...extra }));
  processEvents(db);
}

function fakeTerm(open: string[]) {
  const typed: Array<[string, string]> = [];
  return {
    typed,
    t: {
      has: (id: string) => open.includes(id),
      paste: (id: string, text: string) => { typed.push([id, `paste:${text}`]); return true; },
      write: (id: string, data: string) => { typed.push([id, data]); return true; },
      typedAt: () => 0,
    },
  };
}

function limitAt(db: DatabaseSync, resetMs: number, used = 100): void {
  db.prepare("INSERT INTO limit_reading (provider, account, window, used_pct, resets_at, read_at, status) VALUES ('claude', 'default', '5h', ?, ?, ?, 'ok')").run(used, nowIso(new Date(resetMs)), nowIso());
}

test('M6-24a a rate-limit StopFailure pastes "Continue where you left off." once after resets_at, not again after a restart', () => {
  const { file, db } = setup();
  const reset = Date.now() + 60 * MIN;
  limitAt(db, reset);
  session(db, 's');
  hook(db, 's', 'claude.StopFailure', { error_type: 'rate_limit' });
  processEvents(db);

  assert.equal((db.prepare("SELECT state FROM session WHERE id = 's'").get() as { state: string }).state, 'waiting_for_you');
  const hit = JSON.parse((db.prepare("SELECT payload FROM event WHERE kind = 'core.limit-hit'").get() as { payload: string }).payload);
  assert.equal(hit.window, '5h');
  assert.equal(Date.parse(hit.resets_at), reset);

  const f = fakeTerm(['s']);
  assert.deepEqual(resumeAtReset(db, reset - 1000, f.t), []);
  assert.deepEqual(f.typed, []);
  assert.deepEqual(resumeAtReset(db, reset + 1000, f.t), ['s']);
  assert.deepEqual(f.typed, [['s', `paste:${RESUME_TEXT}`], ['s', '\r']]);
  assert.equal(RESUME_TEXT, 'Continue where you left off.');
  assert.deepEqual(resumeAtReset(db, reset + 6000, f.t), []);
  db.close();

  const again = open(file);
  try {
    assert.deepEqual(resumeAtReset(again, reset + 60_000, f.t), []);
    assert.equal(f.typed.length, 2);
    assert.equal((again.prepare("SELECT count(*) AS n FROM event WHERE kind = 'core.limit-resumed'").get() as { n: number }).n, 1);
  } finally { again.close(); }
});

test('M6-24a with the tile toggle off nothing is pasted', () => {
  const { db } = setup();
  const reset = Date.now() + 60 * MIN;
  limitAt(db, reset);
  session(db, 's');
  db.prepare("UPDATE session SET limit_resume = 0 WHERE id = 's'").run();
  hook(db, 's', 'claude.StopFailure', { error_type: 'rate_limit' });
  const f = fakeTerm(['s']);
  assert.deepEqual(resumeAtReset(db, reset + 1000, f.t), []);
  assert.deepEqual(f.typed, []);
});

test('M6-24a no paste after a later prompt, with the pty closed, or for a failure that is not a rate limit', () => {
  const { db } = setup();
  const reset = Date.now() + 60 * MIN;
  limitAt(db, reset);
  for (const id of ['typed', 'closed', 'other']) session(db, id);
  hook(db, 'typed', 'claude.StopFailure', { error_type: 'rate_limit' });
  hook(db, 'typed', 'claude.Notification', { notification_type: 'idle_prompt', message: 'waiting' });
  hook(db, 'typed', 'claude.UserPromptSubmit', { prompt: 'go' });
  hook(db, 'closed', 'claude.StopFailure', { error_type: 'rate_limit' });
  hook(db, 'other', 'claude.StopFailure', { error_type: 'server_error' });
  const f = fakeTerm(['typed', 'other']);
  assert.deepEqual(resumeAtReset(db, reset + 1000, f.t), []);
  assert.deepEqual(f.typed, []);
});

test('M6-24a an idle notification after the failure does not stop the paste', () => {
  const { db } = setup();
  const reset = Date.now() + 60 * MIN;
  limitAt(db, reset);
  session(db, 's');
  hook(db, 's', 'claude.StopFailure', { error_type: 'rate_limit' });
  hook(db, 's', 'claude.Notification', { notification_type: 'idle_prompt', message: 'waiting' });
  assert.deepEqual(resumeAtReset(db, reset + 1000, fakeTerm(['s']).t), ['s']);
});

test('M6-24a no paste once the session has left waiting_for_you without a Claude event', () => {
  const { db } = setup();
  const reset = Date.now() + 60 * MIN;
  limitAt(db, reset);
  session(db, 's');
  hook(db, 's', 'claude.StopFailure', { error_type: 'rate_limit' });
  appendEvent('term.bell', 's', {}, db);
  appendEvent('term.output', 's', {}, db);
  processEvents(db);
  assert.equal((db.prepare("SELECT state FROM session WHERE id = 's'").get() as { state: string }).state, 'working');
  const f = fakeTerm(['s']);
  assert.deepEqual(resumeAtReset(db, reset + 1000, f.t), []);
  assert.deepEqual(f.typed, []);
});

test('M6-24a no paste onto a draft typed after the hit; typing before the hit still resumes', () => {
  const { db } = setup();
  const reset = Date.now() + 60 * MIN;
  limitAt(db, reset);
  for (const id of ['draft', 'before']) session(db, id);
  hook(db, 'before', 'claude.StopFailure', { error_type: 'rate_limit' });
  hook(db, 'draft', 'claude.StopFailure', { error_type: 'rate_limit' });
  const f = fakeTerm(['draft', 'before']);
  const at: Record<string, number> = { draft: Date.now() + 1000, before: Date.now() - 60_000 };
  assert.deepEqual(resumeAtReset(db, reset + 1000, { ...f.t, typedAt: (id: string) => at[id] ?? 0 }), ['before']);
  assert.deepEqual(f.typed.map(([id]) => id), ['before', 'before']);
});

test('M6-24a terminal replies and keys are not typing; text, Enter and a paste are', () => {
  const t0 = Date.now();
  for (const data of ['\x1b[I', '\x1b[O', '\x1b[?1;2c', '\x1b[>0;276;0c', '\x1b[12;40R', '\x1b[A', '\x1bOB', '\x1b']) {
    noteTyped('k', data);
    assert.equal(typedAt('k'), 0, JSON.stringify(data));
  }
  for (const [id, data] of [['a', 'h'], ['b', '\r'], ['c', '\x1b[200~text\x1b[201~']]) {
    noteTyped(id, data);
    assert.ok(typedAt(id) >= t0, JSON.stringify(data));
  }
});

function reading(db: DatabaseSync, used: number, at: number, reset: number): void {
  db.prepare(
    `INSERT INTO limit_reading (provider, account, window, used_pct, resets_at, read_at, status) VALUES ('claude', 'default', '5h', ?, ?, ?, 'ok')
     ON CONFLICT(provider, account, window) DO UPDATE SET used_pct = excluded.used_pct, resets_at = excluded.resets_at, read_at = excluded.read_at`,
  ).run(used, nowIso(new Date(reset)), nowIso(new Date(at)));
  recordReadings(db);
}

const hhmm = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const items = (db: DatabaseSync) => db.prepare("SELECT kind, text FROM needs_you WHERE ref LIKE 'limit-early:%'").all().map((r) => ({ ...r }));

test('M6-24b six readings 40% to 90%, 10 minutes apart, reset 2 h after the last: one early-end item 10 minutes after the last reading', () => {
  const { db } = setup();
  const t0 = Date.now() - 50 * MIN;
  const last = t0 + 50 * MIN;
  const reset = last + 120 * MIN;
  for (let i = 0; i < 6; i++) {
    reading(db, 40 + i * 10, t0 + i * 10 * MIN, reset);
    earlyEnd(db, t0 + i * 10 * MIN);
    if (i < 5) assert.deepEqual(items(db), [], `no item after ${i + 1} readings`);
  }
  assert.deepEqual(items(db), [{ kind: 'other', text: `Claude 5h window ends early at about ${hhmm(last + 10 * MIN)}` }]);
  reading(db, 90, last, reset);
  earlyEnd(db, last + MIN);
  assert.equal(items(db).length, 1);
  assert.equal((db.prepare('SELECT count(*) AS n FROM limit_history').get() as { n: number }).n, 6);
});

test('M6-24b no item when the slope runs out after the reset, and only the last 6 readings are kept', () => {
  const { db } = setup();
  const t0 = Date.now() - 70 * MIN;
  const reset = t0 + 80 * MIN;
  for (let i = 0; i < 8; i++) reading(db, 10 + i, t0 + i * 10 * MIN, reset);
  earlyEnd(db, t0 + 70 * MIN);
  assert.deepEqual(items(db), []);
  const kept = db.prepare('SELECT used_pct FROM limit_history ORDER BY julianday(read_at)').all().map((r) => r.used_pct);
  assert.deepEqual(kept, [12, 13, 14, 15, 16, 17]);
});

test('M6-24a a hit with no live reading takes its reset from the first reading after it, and still resumes once the next window has started', () => {
  const { db } = setup();
  session(db, 's');
  hook(db, 's', 'claude.StopFailure', { error_type: 'rate_limit' });
  const hit = JSON.parse((db.prepare("SELECT payload FROM event WHERE kind = 'core.limit-hit'").get() as { payload: string }).payload);
  assert.equal(hit.resets_at, null);
  const f = fakeTerm(['s']);
  assert.deepEqual(resumeAtReset(db, Date.now() + 1000, f.t), []);

  const reset = Date.now() + 60 * MIN;
  reading(db, 100, Date.now(), reset);
  assert.deepEqual(resumeAtReset(db, reset - 1000, f.t), []);
  reading(db, 2, reset + 500, reset + 300 * MIN);
  assert.deepEqual(resumeAtReset(db, reset + 1000, f.t), ['s']);
  assert.deepEqual(f.typed, [['s', `paste:${RESUME_TEXT}`], ['s', '\r']]);
});

test('M6-24a a rate-limit stop clears the unfinished tool, so the wait is not shown as its permission prompt', () => {
  const { db } = setup();
  session(db, 's');
  hook(db, 's', 'claude.PreToolUse', { tool_name: 'Bash' });
  assert.equal((db.prepare("SELECT last_tool FROM session WHERE id = 's'").get() as { last_tool: string | null }).last_tool, 'Bash');
  hook(db, 's', 'claude.StopFailure', { error_type: 'rate_limit' });
  assert.equal((db.prepare("SELECT last_tool FROM session WHERE id = 's'").get() as { last_tool: string | null }).last_tool, null);
});
