import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, runNode, sleep, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

async function harness(engineId: string, source: string) {
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{
    id: engineId, command: process.execPath, prompt_arg: 'positional', state_source: source,
    roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
  }]));
  const sleeper = join(iso.home, 'sleeper.js');
  writeFileSync(sleeper, 'setTimeout(() => {}, 600000);\n');
  const env = { ...iso.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...iso, env });
  const repo = join(iso.home, 'repo');
  mkdirSync(repo);
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'T');
  git('config', 'user.email', 't@x.example');
  for (const f of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(join(repo, f), `${f}\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  writeFileSync(join(repo, 'b.txt'), 'dirty before launch\n');
  const db = new DatabaseSync(join(iso.home, 'troop.db'));
  db.exec('PRAGMA busy_timeout = 2000');
  const pipe = await client(iso.prefix);
  const opened = await pipe.request('project.open', { path: repo });
  const launched = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: engineId, prompt: sleeper });
  pipe.close();
  const id = launched.result?.session_id as string;
  assert.ok(id, JSON.stringify(launched));
  const insert = db.prepare("INSERT INTO event (at, source, session_id, kind, payload) VALUES (?, 'core', ?, ?, ?)");
  return {
    env, repo, id,
    write: (f: string, text: string) => writeFileSync(join(repo, f), text),
    base: () => (db.prepare('SELECT turn_base FROM session WHERE id = ?').get(id) as { turn_base: string | null }).turn_base,
    state: () => (db.prepare('SELECT state FROM session WHERE id = ?').get(id) as { state: string }).state,
    put: (kind: string, payload: Record<string, unknown> = {}) => insert.run(new Date().toISOString(), id, kind, JSON.stringify(payload)),
    claims: () => (db.prepare("SELECT payload FROM event WHERE kind = 'core.claim' AND session_id = ? ORDER BY seq").all(id) as Array<{ payload: string }>).map((r) => JSON.parse(r.payload)),
    async owners() {
      const r = await runNode(['core/cli.ts', 'owners', '--project', repo, '--json'], env);
      assert.equal(r.code, 0, r.stderr);
      return Object.fromEntries((JSON.parse(r.stdout) as Array<{ path: string; owners: Array<{ id: string }>; unclaimed: boolean }>).map((o) => [o.path, o]));
    },
    async teardown() {
      db.close();
      await teardownCore(core, iso);
    },
  };
}

const paths = (claim: { files: Array<{ path: string }> }) => claim.files.map((f) => f.path);

test('a Claude permission wait preserves the turn base and claims edits from before and after the ask', { timeout: 60000 }, async () => {
  const h = await harness('claude-like', 'hooks');
  try {
    h.put('claude.UserPromptSubmit');
    const first = await until(() => h.state() === 'working' && h.base() || undefined, 10000);
    h.write('a.txt', 'changed before permission\n');
    h.put('claude.PermissionRequest', { tool_use_id: 'permission-tool' });
    await until(() => h.state() === 'waiting_for_you' || undefined, 10000);
    const atAsk = h.base();
    assert.equal(atAsk, first);
    h.put('claude.PostToolUse', { tool_use_id: 'permission-tool' });
    await until(() => h.state() === 'working' || undefined, 10000);
    await sleep(500);
    const beforeStop = h.base();
    h.write('c.txt', 'changed after permission\n');
    h.put('claude.Stop');
    await until(() => h.claims().length === 1 || undefined, 10000);
    const claim = h.claims()[0];
    assert.deepEqual(paths(claim), ['a.txt', 'c.txt']);
    assert.equal(beforeStop, atAsk, 'answering permission must not retake the turn base');
    assert.equal(claim.turn_base, atAsk, 'Stop must claim from the base used before the ask');
    assert.equal(h.base(), atAsk);
  } finally { await h.teardown(); }
});

test('a Codex turn end (notify, then a Stop hook) claims the tracked and new files it changed, from a base taken at launch and again after each turn', { timeout: 60000 }, async () => {
  const h = await harness('codex', 'notify');
  try {
    const first = await until(() => h.base() ?? undefined, 10000);
    h.write('a.txt', 'changed by codex before an approval\n');
    h.put('term.bell');
    await until(() => h.state() === 'waiting_for_you' || undefined, 10000);
    h.put('term.output');
    await until(() => h.state() === 'working' || undefined, 10000);
    await sleep(500);
    h.write('made.txt', 'new, after the approval\n');
    const r = await runNode(['core/codex-notify.js', JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 't1' })], { ...h.env, TROOP_SESSION_ID: h.id });
    assert.equal(r.code, 0, r.stderr);
    await until(() => h.claims().length === 1 || undefined, 10000);
    assert.deepEqual(paths(h.claims()[0]), ['a.txt', 'made.txt']);
    assert.deepEqual(h.claims()[0].files.map((f: { owners: string[] }) => f.owners), [[h.id], [h.id]]);
    const by = await h.owners();
    assert.deepEqual(by['a.txt'].owners.map((o) => o.id), [h.id]);
    assert.equal(by['b.txt'].unclaimed, true, 'a file dirty before launch stays unclaimed');

    await until(() => (h.base() !== first) || undefined, 10000);
    h.write('early.txt', 'new, before activity moved\n');
    await sleep(50);
    h.put('core.activity', { state: 'working', changed_at: Date.now() });
    h.write('c.txt', 'second turn\n');
    h.put('codex.Stop');
    await until(() => h.claims().length === 2 || undefined, 10000);
    assert.deepEqual(paths(h.claims()[1]), ['c.txt', 'early.txt'], 'mid-turn activity does not move the turn start');
  } finally { await h.teardown(); }
});

test('an agy turn that goes quiet claims its files, and a wait answered mid-turn does not move the base', { timeout: 60000 }, async () => {
  const h = await harness('agy', 'file-activity');
  try {
    h.put('core.activity', { state: 'working', changed_at: Date.now() });
    await until(() => h.base() ?? undefined, 10000);
    h.write('a.txt', 'changed by agy before a wait\n');
    h.put('core.activity', { state: 'blocked' });
    await until(() => h.state() === 'waiting_for_you' || undefined, 10000);
    await sleep(50);
    h.put('core.activity', { state: 'working', changed_at: Date.now() });
    await until(() => h.state() === 'working' || undefined, 10000);
    await sleep(500);
    h.write('made.txt', 'new, after the wait\n');
    h.put('core.activity', { state: 'quiet' });
    await until(() => h.claims().length === 1 || undefined, 10000);
    assert.deepEqual(paths(h.claims()[0]), ['a.txt', 'made.txt']);
    const by = await h.owners();
    assert.deepEqual(by['made.txt'].owners.map((o) => o.id), [h.id]);
    assert.equal(by['b.txt'].unclaimed, true);
  } finally { await h.teardown(); }
});
