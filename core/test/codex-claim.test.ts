import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, runNode, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

test('a Codex turn end claims the tracked and new files it changed, from a base taken at launch and again after each turn', { timeout: 60000 }, async () => {
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{
    id: 'codex', command: process.execPath, prompt_arg: 'positional', state_source: 'notify',
    roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
  }]));
  const sleeper = join(iso.home, 'sleeper.js');
  writeFileSync(sleeper, 'setTimeout(() => {}, 600000);\n');
  const env = { ...iso.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...iso, env });
  const repo = join(iso.home, 'repo');
  mkdirSync(repo);
  const git = (...a: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@x.example', ...a], { cwd: repo, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  for (const f of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(join(repo, f), `${f}\n`);
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  const db = new DatabaseSync(join(iso.home, 'troop.db'));
  db.exec('PRAGMA busy_timeout = 2000');
  const base = (id: string) => (db.prepare('SELECT turn_base FROM session WHERE id = ?').get(id) as { turn_base: string | null } | undefined)?.turn_base ?? null;
  const claims = (id: string) => (db.prepare("SELECT payload FROM event WHERE kind = 'core.claim' AND session_id = ? ORDER BY seq").all(id) as Array<{ payload: string }>).map((r) => JSON.parse(r.payload));
  const notify = async (id: string) => {
    const r = await runNode(['core/codex-notify.js', JSON.stringify({ type: 'agent-turn-complete', 'thread-id': 't1' })], { ...env, TROOP_SESSION_ID: id });
    assert.equal(r.code, 0, r.stderr);
  };
  try {
    writeFileSync(join(repo, 'b.txt'), 'dirty before launch\n');
    const pipe = await client(iso.prefix);
    const opened = await pipe.request('project.open', { path: repo });
    const launched = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: 'codex', prompt: sleeper });
    pipe.close();
    const id = launched.result?.session_id as string;
    assert.ok(id, JSON.stringify(launched));
    const first = await until(() => base(id) ?? undefined, 10000);

    writeFileSync(join(repo, 'a.txt'), 'changed by codex\n');
    writeFileSync(join(repo, 'made.txt'), 'new\n');
    await notify(id);
    await until(() => claims(id).length === 1 || undefined, 10000);
    assert.deepEqual(claims(id)[0].files.map((f: { path: string }) => f.path), ['a.txt', 'made.txt']);
    assert.deepEqual(claims(id)[0].files.map((f: { owners: string[] }) => f.owners), [[id], [id]]);

    const r = await runNode(['core/cli.ts', 'owners', '--project', repo, '--json'], env);
    assert.equal(r.code, 0, r.stderr);
    const by = Object.fromEntries((JSON.parse(r.stdout) as Array<{ path: string; owners: Array<{ id: string }>; unclaimed: boolean }>).map((o) => [o.path, o]));
    assert.deepEqual(by['a.txt'].owners.map((o) => o.id), [id]);
    assert.equal(by['b.txt'].unclaimed, true, 'a file dirty before launch stays unclaimed');

    await until(() => (base(id) !== first) || undefined, 10000);
    writeFileSync(join(repo, 'c.txt'), 'second turn\n');
    await notify(id);
    await until(() => claims(id).length === 2 || undefined, 10000);
    assert.deepEqual(claims(id)[1].files.map((f: { path: string }) => f.path), ['c.txt']);
  } finally {
    db.close();
    await teardownCore(core, iso);
  }
});
