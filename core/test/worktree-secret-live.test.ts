import './clean-env.mjs';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isolation } from './helpers.ts';
import { openCoreDb } from '../src/store/db.ts';
import { BUILT_IN, syncEngines, type EngineSpec } from '../src/engines/registry.ts';
import { buildMethods, METHODS } from '../src/methods.ts';
import { dropSecret, issueSecret } from '../src/sessions/secret.ts';
import { RpcError } from '../src/pipe/errors.ts';
import { canonicalPath } from '../src/project.ts';

function fixture(t: TestContext) {
  const iso = isolation();
  const trustedFile = join(iso.home, 'trusted.json');
  const enginesFile = join(iso.home, 'engines.json');
  const engines: EngineSpec[] = BUILT_IN.map(engine => ({ ...engine,
    trust: { kind: 'json-list', file: trustedFile, at: ['trusted'], path_style: 'posix' },
  }));
  writeFileSync(trustedFile, JSON.stringify({ trusted: [] }));
  writeFileSync(enginesFile, JSON.stringify(engines));
  const vars = {
    HOME: iso.home, USERPROFILE: iso.home, METATROOPER_HOME: iso.home,
    METATROOPER_ENGINES: enginesFile, METATROOPER_FAKE_DPAPI: '1',
    METATROOPER_CLAUDE_SETTINGS: join(iso.home, 'claude-settings.json'),
    METATROOPER_CODEX_CONFIG: join(iso.home, 'codex-config.toml'),
    GIT_AUTHOR_NAME: 'Secret Test', GIT_AUTHOR_EMAIL: 'secret@test.invalid',
    GIT_COMMITTER_NAME: 'Secret Test', GIT_COMMITTER_EMAIL: 'secret@test.invalid',
  };
  const previous = new Map(Object.keys(vars).map(key => [key, process.env[key]]));
  Object.assign(process.env, vars);
  const db = openCoreDb();
  const id = randomUUID();
  t.after(() => {
    dropSecret(id);
    db.close();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(iso.home, { recursive: true, force: true });
  });
  syncEngines(db, engines);
  const at = '2026-11-23T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)')
    .run('p', iso.home, 'secret fixture', at, at);
  db.prepare(`INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at)
    VALUES (?, 'p', 'claude', 'pty', 'starting', ?, ?)`).run(id, at, at);
  const methods = buildMethods(db, { engines: () => engines, stop: () => {}, uiKey: 'fixture-key' });
  const git = (...args: string[]) => execFileSync('git', ['-C', iso.home, ...args], {
    encoding: 'utf8', stdio: 'pipe', windowsHide: true, timeout: 15_000,
  }).trim();
  return { ...iso, db, id, methods, engines, trustedFile, git };
}

for (const invalid of ['dropped', 'exited', 'isolated']) {
  test(`worktree.create rejects a ${invalid} session secret with -32012`, {
    skip: METHODS.find((m) => m.name === 'worktree.create')?.needsUi ? 'worktree.create secret path parked (Q1)' : false,
  }, async t => {
    // protects=worktree secret proof, live session row and non-isolated approval before any side effects
    const h = fixture(t);
    const secret = issueSecret(h.id, invalid === 'isolated' ? 'isolated' : 'ask');
    if (invalid === 'dropped') dropSecret(h.id);
    if (invalid === 'exited') h.db.prepare("UPDATE session SET state = 'exited' WHERE id = ?").run(h.id);
    await assert.rejects(async () => h.methods.get('worktree.create')!.handler({
      project_id: 'p', branch: `${invalid}-secret`, session_secret: secret,
    }, { ui: false, origin: 'test' }), (error: unknown) => error instanceof RpcError && error.code === -32012);
    assert.equal(readFileSync(h.trustedFile, 'utf8'), JSON.stringify({ trusted: [] }));
    assert.equal(existsSync(join(h.home, 'worktrees')), false);
  });
}

test('worktree.create accepts a live non-isolated session secret without UI', {
  skip: METHODS.find((m) => m.name === 'worktree.create')?.needsUi ? 'worktree.create secret path parked (Q1)' : false,
}, async t => {
  // protects=live ask sessions create and trust a worktree through the non-UI secret path
  const h = fixture(t);
  h.git('init', '-q');
  h.git('config', 'commit.gpgSign', 'false');
  h.git('config', 'core.autocrlf', 'false');
  h.git('config', 'core.hooksPath', join(h.home, 'no-hooks'));
  writeFileSync(join(h.home, 'seed.txt'), 'fixture\n');
  h.git('add', 'seed.txt');
  h.git('commit', '-qm', 'seed');
  const secret = issueSecret(h.id, 'ask');
  const branch = 'live-secret';
  const result = await h.methods.get('worktree.create')!.handler({
    project_id: 'p', branch, session_secret: secret,
  }, { ui: false, origin: 'test' }) as { path: string; branch: string; trusted: string[] };
  assert.equal(result.branch, branch);
  assert.equal(execFileSync('git', ['-C', result.path, 'branch', '--show-current'], {
    encoding: 'utf8', windowsHide: true, timeout: 15_000,
  }).trim(), branch);
  assert.equal(readFileSync(join(result.path, 'seed.txt'), 'utf8'), 'fixture\n');
  assert.deepEqual(result.trusted, h.engines.filter(engine => engine.trust).map(engine => engine.id));
  const trusted = JSON.parse(readFileSync(h.trustedFile, 'utf8')).trusted;
  assert.ok(trusted.includes(canonicalPath(realpathSync.native(result.path))));
});
