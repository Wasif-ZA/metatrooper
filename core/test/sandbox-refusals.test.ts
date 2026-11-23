import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, harness, root, withEnv } from './helpers.ts';
import { BUILT_IN } from '../src/engines/registry.ts';
import { sandboxRefusal } from '../src/sandbox/checks.ts';
import { dockerArgv } from '../src/sandbox/launch.ts';
import { RpcError } from '../src/pipe/errors.ts';

before(buildGenerated);

const claude = BUILT_IN.find(engine => engine.id === 'claude')!;
const fakeDocker = (dir: string, status: number) => writeFileSync(join(dir, 'image'), `process.exit(${status});\n`);

for (const [name, segment] of [['comma', 'work,tree'], ['quote', 'work"tree']]) {
  // protects=FIX-C9: Docker CSV metacharacters in worktree paths raise a validation RpcError naming the path.
  test(`FIX-C9 dockerArgv refuses a worktree path containing a ${name}`, () => {
    const dir = mkdtempSync(join(os.tmpdir(), 'sandbox-mount-refusal-'));
    try {
      const worktree = join(dir, segment);
      const common = join(dir, 'repo', '.git');
      const engine = { ...claude, sandbox: { ...claude.sandbox, logins: [] } };
      withEnv({ METATROOPER_HOME: join(dir, 'home') }, () => {
        assert.throws(() => dockerArgv('session-fix-c9', engine, worktree, {
          gitdir: join(common, 'worktrees', 'wt'), common,
        }, []), (error: unknown) => {
          assert.ok(error instanceof RpcError);
          assert.equal(error.code, -32003);
          assert.ok(error.message.includes(worktree), error.message);
          return true;
        });
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

// protects=FIX-C9: a normal worktree source survives parsing the --mount CSV fields.
test('FIX-C9 dockerArgv preserves a normal worktree source through a CSV split', () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'sandbox-mount-normal-'));
  try {
    const worktree = join(dir, 'work tree');
    const common = join(dir, 'repo', '.git');
    const engine = { ...claude, sandbox: { ...claude.sandbox, logins: [] } };
    const argv = withEnv({ METATROOPER_HOME: join(dir, 'home') }, () => dockerArgv(
      'session-fix-c9', engine, worktree, { gitdir: join(common, 'worktrees', 'wt'), common }, [],
    ));
    const mountIndex = argv.indexOf('--mount');
    assert.ok(mountIndex >= 0);
    const fields = argv[mountIndex + 1].split(',');
    assert.equal(fields[0], 'type=bind');
    const sources = fields.filter(field => field.startsWith('source='));
    assert.deepEqual(sources, [`source=${worktree.split(String.fromCharCode(92)).join('/')}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sandboxRefusal rejects ask paths and projects outside worktrees', () => {
  const home = mkdtempSync(join(os.tmpdir(), 'sandbox-refusal-'));
  try {
    process.env.METATROOPER_HOME = home;
    const runtime = () => 'docker';
    const outside = join(home, 'project');
    const inside = join(home, 'work', 'client', 'project');
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ sessions: { ask_paths: [join(home, 'work', 'client')] } }));
    assert.match(sandboxRefusal(claude, inside, { runtime, now: Date.now })!, /ask path/);
    assert.match(sandboxRefusal(claude, outside, { runtime, now: Date.now })!, /cc worktree/);
  } finally {
    delete process.env.METATROOPER_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('sandboxRefusal refuses when no container runtime answers', () => {
  const home = mkdtempSync(join(os.tmpdir(), 'sandbox-runtime-'));
  try {
    process.env.METATROOPER_HOME = home;
    assert.match(sandboxRefusal(claude, join(home, 'worktrees', 'repo'), { runtime: () => null, now: Date.now })!, /no container runtime/);
  } finally {
    delete process.env.METATROOPER_HOME;
    rmSync(home, { recursive: true, force: true });
  }
});

test('sandboxRefusal refuses an unbuilt image through a fake runtime', () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'sandbox-image-'));
  try {
    const home = join(dir, 'home');
    mkdirSync(join(home, 'worktrees', 'repo'), { recursive: true });
    process.env.METATROOPER_HOME = home;
    fakeDocker(dir, 1);
    const cwd = process.cwd();
    process.chdir(dir);
    const refusal = sandboxRefusal(claude, join(home, 'worktrees', 'repo'), { runtime: () => process.execPath, now: Date.now });
    process.chdir(cwd);
    assert.match(refusal!, /sandbox image .* is not built; run troop sandbox build/);
  } finally {
    delete process.env.METATROOPER_HOME;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sandboxRefusal requires Claude login to outlast its safety margin', () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'sandbox-login-'));
  const home = join(dir, 'home');
  const project = join(home, 'worktrees', 'repo');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(project, { recursive: true });
  const oldHome = process.env.HOME;
  const oldProfile = process.env.USERPROFILE;
  const oldMetaHome = process.env.METATROOPER_HOME;
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  fakeDocker(bin, 0);
  const cwd = process.cwd();
  process.chdir(bin);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = home;
  try {
    const now = Date.now();
    const creds = join(home, '.claude', '.credentials.json');
    writeFileSync(creds, JSON.stringify({ claudeAiOauth: { expiresAt: now + 30 * 60 * 1000 } }));
    assert.match(sandboxRefusal(claude, project, { runtime: () => process.execPath, now: () => now, label: () => "h", hash: () => "h" })!, /refresh its login/);
    writeFileSync(creds, JSON.stringify({ claudeAiOauth: { expiresAt: now + 2 * 60 * 60 * 1000 } }));
    assert.equal(sandboxRefusal(claude, project, { runtime: () => process.execPath, now: () => now, label: () => "h", hash: () => "h" }), null);
  } finally {
    process.chdir(cwd);
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome;
    if (oldProfile === undefined) delete process.env.USERPROFILE; else process.env.USERPROFILE = oldProfile;
    if (oldMetaHome === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = oldMetaHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('session.launch refuses isolated on pty and sandbox with contained approval without starting', async () => {
  const h = await harness();
  try {
    const project = join(h.home, 'project');
    mkdirSync(project);
    const pipe = await client(h.prefix);
    try {
      const opened = await pipe.request('project.open', { path: project });
      const db = new DatabaseSync(join(h.home, 'troop.db'));
      try {
        const count = () => db.prepare('SELECT COUNT(*) AS n FROM session').get().n;
        const beforeCount = count();
        for (const args of [
          { approval: 'isolated', host: 'pty' },
          { approval: 'contained', host: 'sandbox' },
        ]) {
          const reply = await pipe.request('session.launch', { ...args, engine_id: 'claude', project_id: opened.result.project_id });
          assert.equal(reply.error?.code, -32003);
          assert.match(reply.error.message, /isolated runs only on the sandbox host/);
          assert.equal(count(), beforeCount);
          assert.deepEqual(db.prepare('SELECT id FROM session').all(), []);
        }
      } finally { db.close(); }
    } finally { pipe.close(); }
  } finally { await h.teardown(); }
});

test('session.launch refuses isolated for a non-worktree project without a session or terminal', async () => {
  const h = await harness();
  try {
    const project = join(h.home, 'outside');
    mkdirSync(project);
    const pipe = await client(h.prefix);
    try {
      const opened = await pipe.request('project.open', { path: project });
      const db = new DatabaseSync(join(h.home, 'troop.db'));
      try {
        const before = db.prepare('SELECT COUNT(*) AS n FROM session').get().n;
        const reply = await pipe.request('session.launch', { approval: 'isolated', host: 'sandbox', engine_id: 'claude', project_id: opened.result.project_id });
        assert.equal(reply.error?.code, -32003);
        assert.match(reply.error.message, /isolated runs only in a cc worktree/);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session').get().n, before);
        assert.deepEqual(db.prepare('SELECT id FROM session').all(), []);
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM event WHERE kind = 'launch'").get().n, 0);
      } finally { db.close(); }
    } finally { pipe.close(); }
  } finally { await h.teardown(); }
});
