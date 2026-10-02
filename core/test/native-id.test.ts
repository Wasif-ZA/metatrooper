import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CODEX_ID = '0199aaaa-1111-2222-3333-444455556666';

async function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-native-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { checkActivity } = await import('../src/sessions/watch.ts');
  const db = openCoreDb();
  syncEngines(db, BUILT_IN);
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(path.join(home, 'proj'));
  const addSession = (id: string, engine: string, startedMs: number) =>
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p', ?, 'wt', 'working', 'x', ?)").run(id, engine, new Date(startedMs).toISOString());
  const native = (id: string) => (db.prepare('SELECT native_id FROM session WHERE id = ?').get(id) as { native_id: string | null }).native_id;
  const done = () => {
    db.close();
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  };
  return { home, db, addSession, native, checkActivity, done };
}

test('M1-12 codex session gets native_id from the rollout file whose cwd matches', async () => {
  const t = await setup();
  try {
    const dir = path.join(t.home, '.codex', 'sessions', '2026', '09', '30');
    fs.mkdirSync(dir, { recursive: true });
    const proj = path.join(t.home, 'proj');
    fs.writeFileSync(path.join(dir, `rollout-2026-09-30T10-00-00-${CODEX_ID}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { cwd: proj } }) + '\n');
    fs.writeFileSync(path.join(dir, 'rollout-2026-09-30T10-00-01-0199bbbb-1111-2222-3333-444455556666.jsonl'), JSON.stringify({ type: 'session_meta', payload: { cwd: '/elsewhere' } }) + '\n');
    t.addSession('c1', 'codex', Date.now() - 1000);
    t.checkActivity(t.db);
    assert.equal(t.native('c1'), CODEX_ID);
  } finally { t.done(); }
});

test('M1-12 codex session with no matching rollout stays without native_id', async () => {
  const t = await setup();
  try {
    const dir = path.join(t.home, '.codex', 'sessions', '2026', '09', '30');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `rollout-x-${CODEX_ID}.jsonl`), JSON.stringify({ type: 'session_meta', payload: { cwd: '/other' } }) + '\n');
    t.addSession('c1', 'codex', Date.now() - 1000);
    t.checkActivity(t.db);
    assert.equal(t.native('c1'), null);
  } finally { t.done(); }
});

test('M1-12 agy gets the brain folder only when exactly one agy session launched in the window', async () => {
  const t = await setup();
  try {
    const brain = path.join(t.home, '.gemini', 'antigravity-cli', 'brain');
    fs.mkdirSync(path.join(brain, 'conv-one'), { recursive: true });
    t.addSession('a1', 'agy', Date.now() - 1000);
    t.checkActivity(t.db);
    assert.equal(t.native('a1'), 'conv-one');
  } finally { t.done(); }
});

test('M1-12 two agy launches in one window leave native_id NULL (state stays unknown)', async () => {
  const t = await setup();
  try {
    fs.mkdirSync(path.join(t.home, '.gemini', 'antigravity-cli', 'brain', 'conv-one'), { recursive: true });
    t.addSession('a1', 'agy', Date.now() - 1000);
    t.addSession('a2', 'agy', Date.now() - 500);
    t.checkActivity(t.db);
    assert.equal(t.native('a1'), null);
    assert.equal(t.native('a2'), null);
  } finally { t.done(); }
});

test('M1-12 an agy session whose transcript ends on an unanswered tool call goes blocked after 20 s quiet', async () => {
  const t = await setup();
  try {
    const logs = path.join(t.home, '.gemini', 'antigravity-cli', 'brain', 'conv-one', '.system_generated', 'logs');
    fs.mkdirSync(logs, { recursive: true });
    const transcript = path.join(logs, 'transcript.jsonl');
    fs.writeFileSync(transcript, '{"type":"USER_INPUT"}\n');
    t.addSession('agy-blocked', 'agy', Date.now() - 1000);
    const start = Date.now();
    t.checkActivity(t.db, start);
    fs.appendFileSync(transcript, '{"type":"PLANNER_RESPONSE","status":"DONE","tool_calls":[{"name":"run_command","args":{}}]}\n');
    t.checkActivity(t.db, start + 1000);
    t.checkActivity(t.db, start + 1000 + 20_000);
    const states = (t.db.prepare("SELECT payload FROM event WHERE session_id = 'agy-blocked' AND kind = 'core.activity' ORDER BY rowid").all() as Array<{ payload: string }>)
      .map((r) => JSON.parse(r.payload).state);
    assert.deepEqual(states, ['working', 'blocked']);
  } finally { t.done(); }
});
