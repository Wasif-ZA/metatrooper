import './clean-env.mjs';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_IN, type EngineSpec } from '../src/engines/registry.ts';
import { canonicalPath } from '../src/project.ts';
import { buildGenerated, client, isolation, startCore, teardownCore, uiHello, until } from './helpers.ts';

before(buildGenerated);

function gitRun(cwd: string, args: string[]): string {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.error ?? res.stderr ?? res.stdout}`);
  return (res.stdout ?? '').trim();
}

// Adapted from m7-06-worktree-preserve.test.ts: real core, isolated home,
// committed fixture repository, real pipe clients, and teardownCore cleanup.
async function withWorktreeCore(run: (ctx: {
  ui: Awaited<ReturnType<typeof client>>;
  agent: Awaited<ReturnType<typeof client>>;
  isolated: ReturnType<typeof isolation>;
  projectId: string;
  projectDir: string;
  engines: EngineSpec[];
  trustedFile: string;
}) => Promise<void>) {
  const isolated = isolation();
  const trustedFile = join(isolated.home, 'trusted.json');
  const registry = join(isolated.home, 'engines.json');
  const recorder = join(isolated.home, 'recorder.mjs');
  writeFileSync(trustedFile, JSON.stringify({ trusted: [] }));
  // Like c2-session-secret.test.ts, read the secret only from the launched
  // child's environment. The engine stays alive until fixture teardown.
  writeFileSync(recorder, [
    "import { writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    `const home = ${JSON.stringify(isolated.home)};`,
    "writeFileSync(join(home, process.env.TROOP_SESSION_ID + '-secret.txt'), process.env.TROOP_SESSION_SECRET ?? '');",
    'setInterval(() => {}, 1000);',
  ].join('\n'));
  const fake: EngineSpec = {
    id: 'fake-engine', command: process.execPath, args: [recorder],
    version_cmd: [process.execPath, '--version'], state_source: 'process',
    roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
  };
  // Every engine's trust destination is absolute and inside the fixture,
  // including engines used by project.open (see launch-trust-dialog.test.ts).
  const engines: EngineSpec[] = [...BUILT_IN, fake].map((engine) => ({
    ...engine,
    trust: { kind: 'json-list', file: trustedFile, at: ['trusted'], path_style: 'posix' },
  }));
  writeFileSync(registry, JSON.stringify(engines));
  writeFileSync(join(isolated.home, 'settings.json'), JSON.stringify({ worktree: { preserve: [] } }));
  Object.assign(isolated.env, {
    HOME: isolated.home, USERPROFILE: isolated.home,
    METATROOPER_ENGINES: registry, METATROOPER_FAKE_DPAPI: '1',
    METATROOPER_CLAUDE_SETTINGS: join(isolated.home, 'claude-settings.json'),
    METATROOPER_CODEX_CONFIG: join(isolated.home, 'codex-config.toml'),
  });

  let core: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    core = await startCore(isolated);
    const projectDir = join(isolated.home, 'main-repo');
    mkdirSync(projectDir);
    gitRun(projectDir, ['init']);
    gitRun(projectDir, ['config', 'user.name', 'TestUser']);
    gitRun(projectDir, ['config', 'user.email', 'test@example.com']);
    gitRun(projectDir, ['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(projectDir, 'README.md'), '# Main Repo\n');
    gitRun(projectDir, ['add', 'README.md']);
    gitRun(projectDir, ['commit', '-m', 'initial']);

    const ui = await client(isolated.prefix);
    try {
      await uiHello(ui, isolated.home);
      const opened = await ui.request('project.open', { path: projectDir });
      assert.equal(opened.error, undefined);
      assert.ok(opened.result?.project_id);
      // This separate connection NEVER sends ui.hello, even in the success case.
      const agent = await client(isolated.prefix);
      try {
        await run({ ui, agent, isolated, projectId: opened.result.project_id, projectDir, engines, trustedFile });
      } finally { agent.close(); }
    } finally { ui.close(); }
  } finally { await teardownCore(core, isolated); }
}

test('non-UI worktree.create without a session secret returns -32012', async () => {
  // protects=f5daee82/43c97ce6 reject unauthenticated worktree creation over the real pipe
  await withWorktreeCore(async ({ agent, isolated, projectId, projectDir, trustedFile }) => {
    const branch = 'missing-secret';
    const trustBefore = readFileSync(trustedFile, 'utf8');
    const reply = await agent.request('worktree.create', { project_id: projectId, branch });
    assert.equal(reply.error?.code, -32012);
    assert.equal(reply.result, undefined);
    assert.equal(gitRun(projectDir, ['branch', '--list', branch]), '');
    assert.equal(existsSync(join(isolated.home, 'worktrees', projectId, branch)), false);
    assert.equal(readFileSync(trustedFile, 'utf8'), trustBefore);
  });
});

test('non-UI worktree.create with a made-up session secret returns -32012', async () => {
  // protects=f5daee82/43c97ce6 require proof of a live secret rather than mere session_secret presence
  await withWorktreeCore(async ({ agent, isolated, projectId, projectDir, trustedFile }) => {
    const branch = 'unknown-secret';
    const trustBefore = readFileSync(trustedFile, 'utf8');
    const reply = await agent.request('worktree.create', {
      project_id: projectId, branch, session_secret: '0123456789abcdef'.repeat(4),
    });
    assert.equal(reply.error?.code, -32012);
    assert.equal(reply.result, undefined);
    assert.equal(gitRun(projectDir, ['branch', '--list', branch]), '');
    assert.equal(existsSync(join(isolated.home, 'worktrees', projectId, branch)), false);
    assert.equal(readFileSync(trustedFile, 'utf8'), trustBefore);
  });
});

test('non-UI worktree.create succeeds with a live engine child session secret', async () => {
  // protects=f5daee82/43c97ce6 allow a real launched session to create and trust a worktree without ui.hello
  await withWorktreeCore(async ({ ui, agent, isolated, projectId, engines, trustedFile }) => {
    const launched = await ui.request('session.launch', {
      project_id: projectId, engine_id: 'fake-engine', approval: 'ask',
    }, { timeout: 30_000 });
    assert.equal(launched.error, undefined);
    assert.ok(launched.result?.session_id);
    const sessionId = launched.result.session_id;
    const secretFile = join(isolated.home, `${sessionId}-secret.txt`);
    const secret = await until(() => existsSync(secretFile) && readFileSync(secretFile, 'utf8').trim(), 10_000);
    assert.ok(secret, 'launched child must receive TROOP_SESSION_SECRET');
    const listed = await ui.request('session.list', { project_id: projectId });
    assert.equal(listed.error, undefined);
    const session = listed.result.sessions.find((row: { id: string }) => row.id === sessionId);
    assert.ok(session, 'launched session must exist');
    assert.ok(!['done', 'exited'].includes(session.state), 'session must still be live');

    const branch = 'troop/live-secret';
    const reply = await agent.request('worktree.create', {
      project_id: projectId, branch, session_secret: secret,
    }, { timeout: 60_000 });
    assert.equal(reply.error, undefined);
    assert.ok(reply.result?.path, 'worktree.create must return a path');
    assert.equal(reply.result.branch, branch);
    assert.equal(gitRun(reply.result.path, ['branch', '--show-current']), branch);
    assert.equal(readFileSync(join(reply.result.path, 'README.md'), 'utf8').replace(/\r\n/g, '\n'), '# Main Repo\n');
    assert.deepEqual(reply.result.trusted, engines.map((engine) => engine.id));
    const trusted = JSON.parse(readFileSync(trustedFile, 'utf8')).trusted;
    assert.ok(trusted.includes(canonicalPath(realpathSync.native(reply.result.path))), 'new worktree must be trusted');
  });
});
