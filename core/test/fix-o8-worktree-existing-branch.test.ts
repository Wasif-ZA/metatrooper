import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Environment variable keys preserved during tests.
const KEYS = ['HOME', 'USERPROFILE', 'METATROOPER_HOME', 'METATROOPER_CLAUDE_SETTINGS', 'METATROOPER_CODEX_CONFIG'] as const;

// Run a test function with an isolated temporary home directory.
async function withHome(fn: (home: string) => Promise<void> | void): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-worktree-'));
  const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  process.env.METATROOPER_CLAUDE_SETTINGS = path.join(home, '.claude', 'settings.json');
  process.env.METATROOPER_CODEX_CONFIG = path.join(home, '.codex', 'config.toml');
  try {
    await fn(home);
  } finally {
    for (const k of KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

// Setup core database, methods map, and a test git repository.
async function setupTestContext(home: string) {
  const { openCoreDb } = await import('../src/store/db.ts');
  const { buildMethods } = await import('../src/methods.ts');
  const list = path.join(home, 'trusted.json');
  fs.writeFileSync(list, JSON.stringify({ trusted: [] }));
  const engines = [{ id: 'a', trust: { kind: 'json-list', file: list, at: ['trusted'], path_style: 'posix' } }] as any[];
  const repo = path.join(home, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', repo], { stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.com'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'Test User'], { stdio: 'pipe' });
  fs.writeFileSync(path.join(repo, 'file.txt'), 'hello\n');
  execFileSync('git', ['-C', repo, 'add', '.'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repo, 'commit', '-m', 'initial commit'], { stdio: 'pipe' });
  const db = openCoreDb();
  const m = buildMethods(db, { engines: () => engines, stop: () => {}, uiKey: 'k' });
  const { project_id } = m.get('project.open')!.handler({ path: repo }, { ui: false, origin: 'test' }) as { project_id: string };
  return { db, m, repo, project_id };
}

// Test existing branch without worktree folder attaches to existing branch.
test('worktree.create attaches to existing branch when worktree folder does not exist', () => withHome(async (home) => {
  const { db, m, repo, project_id } = await setupTestContext(home);
  try {
    // Create branch feat at initial commit and read its sha.
    execFileSync('git', ['-C', repo, 'branch', 'feat'], { stdio: 'pipe' });
    const shaBefore = execFileSync('git', ['-C', repo, 'rev-parse', 'feat'], { encoding: 'utf8' }).trim();
    // Call worktree.create with existing feat branch.
    const result = m.get('worktree.create')!.handler({ project_id, branch: 'feat' }, { ui: false, origin: 'test' }) as any;
    // Verify result flag indicates an existing branch.
    assert.equal(result.existing_branch, true);
    // Verify worktree folder exists and is on feat branch.
    const folder = path.join(home, 'mt', 'worktrees', project_id, 'feat');
    assert.ok(fs.existsSync(folder));
    const worktreeBranch = execFileSync('git', ['-C', folder, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(worktreeBranch, 'feat');
    // Verify feat branch sha in main repository is unchanged.
    const shaAfter = execFileSync('git', ['-C', repo, 'rev-parse', 'feat'], { encoding: 'utf8' }).trim();
    assert.equal(shaAfter, shaBefore);
  } finally {
    db.close();
  }
}));

// Test branch checked out elsewhere throws validation error.
test('worktree.create throws validation error when branch is checked out elsewhere', () => withHome(async (home) => {
  const { db, m, repo, project_id } = await setupTestContext(home);
  try {
    // Read the current checked out branch of the main repository.
    const currentBranch = execFileSync('git', ['-C', repo, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
    // Verify worktree.create throws validation error code -32003 with git error message.
    assert.throws(
      () => m.get('worktree.create')!.handler({ project_id, branch: currentBranch }, { ui: false, origin: 'test' }),
      (err: any) => {
        assert.equal(err.code, -32003);
        assert.match(err.message, /already|checked out|used by worktree/i);
        return true;
      }
    );
  } finally {
    db.close();
  }
}));

// Test existing branch with base parameter throws invalid params error.
test('worktree.create throws invalid params error when base is passed for existing branch', () => withHome(async (home) => {
  const { db, m, repo, project_id } = await setupTestContext(home);
  try {
    // Create branch feat in the repository.
    execFileSync('git', ['-C', repo, 'branch', 'feat'], { stdio: 'pipe' });
    // Verify worktree.create throws invalid params error code -32602.
    assert.throws(
      () => m.get('worktree.create')!.handler({ project_id, branch: 'feat', base: 'HEAD' }, { ui: false, origin: 'test' }),
      (err: any) => {
        assert.equal(err.code, -32602);
        assert.match(err.message, /base only applies to a new branch/);
        return true;
      }
    );
  } finally {
    db.close();
  }
}));

// Test new branch creates worktree without existing_branch property.
test('worktree.create creates worktree for new branch without existing_branch flag', () => withHome(async (home) => {
  const { db, m, repo, project_id } = await setupTestContext(home);
  try {
    // Call worktree.create for a new branch named fresh.
    const result = m.get('worktree.create')!.handler({ project_id, branch: 'fresh' }, { ui: false, origin: 'test' }) as any;
    // Verify existing_branch is not defined in result.
    assert.equal('existing_branch' in result, false);
    // Verify worktree directory exists and is on branch fresh.
    const folder = path.join(home, 'mt', 'worktrees', project_id, 'fresh');
    assert.ok(fs.existsSync(folder));
    const worktreeBranch = execFileSync('git', ['-C', folder, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
    assert.equal(worktreeBranch, 'fresh');
  } finally {
    db.close();
  }
}));

// Test existing worktree folder returns existing true on second call.
test('worktree.create returns existing true when worktree folder already exists', () => withHome(async (home) => {
  const { db, m, repo, project_id } = await setupTestContext(home);
  try {
    // Call worktree.create the first time to create the worktree.
    const first = m.get('worktree.create')!.handler({ project_id, branch: 'fresh' }, { ui: false, origin: 'test' }) as any;
    assert.equal(first.branch, 'fresh');
    // Call worktree.create a second time with the same branch.
    const second = m.get('worktree.create')!.handler({ project_id, branch: 'fresh' }, { ui: false, origin: 'test' }) as any;
    // Verify the second call returns existing true and does not throw.
    assert.equal(second.existing, true);
    assert.equal(second.branch, 'fresh');
  } finally {
    db.close();
  }
}));
