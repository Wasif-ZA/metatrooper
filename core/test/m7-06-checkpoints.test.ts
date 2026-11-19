import './clean-env.mjs';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated } from './helpers.ts';
import { markTurnBase } from '../src/events/processor.ts';
import { gitIn, sessionChanges } from '../../workbench/src/handback.ts';

before(buildGenerated);

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

function fileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function gitRun(cwd: string, args: string[]): string {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  }
  return (res.stdout ?? '').trim();
}

function setupRepoFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'troop-ckpt-'));
  const repoDir = join(dir, 'repo');
  mkdirSync(repoDir);

  gitRun(repoDir, ['init']);
  gitRun(repoDir, ['config', 'user.name', 'Trooper']);
  gitRun(repoDir, ['config', 'user.email', 'trooper@example.com']);
  gitRun(repoDir, ['config', 'commit.gpgsign', 'false']);

  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  db.exec('PRAGMA foreign_keys = ON');

  const now = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', repoDir, 'repo', now, now);
  db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 3)").run();

  return {
    dir,
    repoDir,
    db,
    close: () => {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// protects=turn checkpoints save untracked files into refs/troop/turn/<session>/<n> surviving git gc without altering index
// fails_when=untracked files are omitted from turn ref tree, ref is pruned by gc, user index hash changes, or hide deletes ref
// no_claim=restoring working directory from saved turn refs
test('M7-06d untracked file preserved in turn ref tree, diff shows one-line change, survives git gc, index hash unchanged, hide keeps ref', async () => {
  const f = setupRepoFixture();
  try {
    const { repoDir, db } = f;
    // Initial commit
    writeFileSync(join(repoDir, 'tracked.txt'), 'tracked initial\n');
    gitRun(repoDir, ['add', 'tracked.txt']);
    gitRun(repoDir, ['commit', '-m', 'initial commit']);

    // Create session in DB
    const sessionId = 's_ckpt_1';
    const now = new Date().toISOString();
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, cwd, hidden) VALUES (?, 'p1', 'claude', 'pty', 'working', ?, ?, ?, 0)")
      .run(sessionId, now, now, repoDir);

    // Untracked file holding "a" before the turn
    writeFileSync(join(repoDir, 'untracked.txt'), 'a\n');

    // Hash of the user's index file before turn snapshot
    const indexPath = join(repoDir, '.git', 'index');
    assert.ok(existsSync(indexPath), 'git index must exist');
    const indexHashBefore = fileHash(indexPath);

    // Run markTurnBase
    await markTurnBase(db, sessionId);

    // 1. Verify index hash is unchanged
    const indexHashAfter = fileHash(indexPath);
    assert.equal(indexHashAfter, indexHashBefore, 'User index hash must remain unchanged');

    // 2. Verify turn ref created under refs/troop/turn/<session>/1
    const refName = `refs/troop/turn/${sessionId}/1`;
    const refSha = gitRun(repoDir, ['rev-parse', '--verify', refName]);
    assert.ok(refSha && refSha.length === 40, `Turn ref ${refName} must resolve to a valid commit SHA`);

    // Verify session.turn_base in DB holds this SHA
    const sessionRow = db.prepare('SELECT turn_base FROM session WHERE id = ?').get(sessionId) as any;
    assert.equal(sessionRow.turn_base, refSha, 'session.turn_base must match turn ref commit SHA');

    // 3. Verify untracked file holding "a" is in the turn ref tree
    const treeFileContent = gitRun(repoDir, ['show', `${refName}:untracked.txt`]);
    assert.equal(treeFileContent, 'a', 'Turn ref tree must hold the pre-turn content "a" of untracked file');

    // 4. Change untracked file to "b"
    writeFileSync(join(repoDir, 'untracked.txt'), 'b\n');

    // Changes computed from session.turn_base report untracked file with 1 added and 1 deleted line
    const changes = await sessionChanges(gitIn(repoDir), sessionRow.turn_base);
    const untrackedChange = changes.files.find((f) => f.path === 'untracked.txt');
    assert.ok(untrackedChange, 'untracked.txt must be reported in changes');
    assert.equal(untrackedChange.added, 1);
    assert.equal(untrackedChange.deleted, 1);

    // 5. After git gc --prune=now the ref still resolves
    gitRun(repoDir, ['gc', '--prune=now']);
    const refShaAfterGc = gitRun(repoDir, ['rev-parse', '--verify', refName]);
    assert.equal(refShaAfterGc, refSha, 'Turn ref must survive git gc --prune=now');

    // 6. Hiding the session leaves the ref in place
    db.prepare('UPDATE session SET hidden = 1 WHERE id = ?').run(sessionId);
    const refShaAfterHide = gitRun(repoDir, ['rev-parse', '--verify', refName]);
    assert.equal(refShaAfterHide, refSha, 'Hiding the session must leave the turn ref in place');

    // 7. Second turn increments turn counter n to 2
    await markTurnBase(db, sessionId);
    const refName2 = `refs/troop/turn/${sessionId}/2`;
    const refSha2 = gitRun(repoDir, ['rev-parse', '--verify', refName2]);
    assert.ok(refSha2 && refSha2.length === 40, `Second turn ref ${refName2} must resolve`);
    assert.notEqual(refSha2, refSha, 'Second turn ref commit should differ from first');
  } finally {
    f.close();
  }
});

// protects=unborn HEAD repository creates parentless turn checkpoint containing new files
// fails_when=turnSnapshot fails on unborn HEAD, produces a commit with parents, or omits new files from tree
// no_claim=branch creation on unborn HEAD repositories
test('M7-06m repo with no commits gets a turn ref with no parent and Diff shows agent new files', async () => {
  const f = setupRepoFixture();
  try {
    const { repoDir, db } = f;
    // Repository is freshly initialized with no commits (HEAD is unborn)
    const sessionId = 's_ckpt_unborn';
    const now = new Date().toISOString();
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, cwd, hidden) VALUES (?, 'p1', 'claude', 'pty', 'working', ?, ?, ?, 0)")
      .run(sessionId, now, now, repoDir);

    // Agent creates a new file in unborn HEAD repo
    writeFileSync(join(repoDir, 'agent_created.txt'), 'hello from unborn head\n');

    // markTurnBase should handle unborn HEAD by creating a parentless commit
    await markTurnBase(db, sessionId);

    const refName = `refs/troop/turn/${sessionId}/1`;
    const refSha = gitRun(repoDir, ['rev-parse', '--verify', refName]);
    assert.ok(refSha && refSha.length === 40, `Turn ref ${refName} must resolve on unborn HEAD`);

    // Verify commit has NO parents
    const commitParents = gitRun(repoDir, ['rev-list', '--parents', '-n', '1', refName]);
    assert.equal(commitParents, refSha, 'Commit on unborn HEAD must have no parents (only the commit SHA)');

    // Verify tree holds the agent's new file
    const contentInTree = gitRun(repoDir, ['show', `${refName}:agent_created.txt`]);
    assert.equal(contentInTree, 'hello from unborn head', 'Turn ref tree must contain agent new file');

    // session.turn_base holds commit SHA
    const sessionRow = db.prepare('SELECT turn_base FROM session WHERE id = ?').get(sessionId) as any;
    assert.equal(sessionRow.turn_base, refSha, 'session.turn_base must be set on unborn HEAD');
  } finally {
    f.close();
  }
});

// protects=turn checkpoint falls back to HEAD and cleans lockfiles when git add fails
// fails_when=turn_base is not set to HEAD on git add failure or troop-index lockfile is leaked
// no_claim=automatic retry of failed checkpoint snapshot
test('defect 4: git add failure falls back turn_base to HEAD and leaves no troop-index lockfile', async () => {
  const f = setupRepoFixture();
  try {
    const { repoDir, db } = f;
    // Initial commit so HEAD exists
    writeFileSync(join(repoDir, 'tracked.txt'), 'tracked\n');
    gitRun(repoDir, ['add', 'tracked.txt']);
    gitRun(repoDir, ['commit', '-m', 'initial']);
    const headSha = gitRun(repoDir, ['rev-parse', 'HEAD']);

    const sessionId = 's_ckpt_fail';
    const now = new Date().toISOString();
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, cwd, hidden) VALUES (?, 'p1', 'claude', 'pty', 'working', ?, ?, ?, 0)")
      .run(sessionId, now, now, repoDir);

    // Make git add fail via a failing clean filter (unwritable case)
    gitRun(repoDir, ['config', 'filter.fail.clean', `${JSON.stringify(process.execPath)} -e "process.exit(1)"`]);
    gitRun(repoDir, ['config', 'filter.fail.required', 'true']);
    writeFileSync(join(repoDir, '.gitattributes'), 'fail.txt filter=fail\n');
    writeFileSync(join(repoDir, 'fail.txt'), 'trigger filter\n');

    await markTurnBase(db, sessionId);

    // turn_base must fall back to HEAD commit SHA
    const sessionRow = db.prepare('SELECT turn_base FROM session WHERE id = ?').get(sessionId) as any;
    assert.equal(sessionRow.turn_base, headSha, 'turn_base must fall back to HEAD on git add failure');

    // No troop-index-*.lock in temp dir
    const { tmpdir } = await import('node:os');
    const locks = readdirSync(tmpdir()).filter((name) => name.startsWith('troop-index-') && name.endsWith('.lock'));
    assert.equal(locks.length, 0, 'no troop-index-*.lock file must be left in temp dir');
  } finally {
    f.close();
  }
});

// protects=turn checkpoint writes ref even when repo and environment lack git user identity
// fails_when=commit-tree fails and omits turn ref when user.email is not configured
// no_claim=using user identity over fallback identity when configured
test('defect 8: checkpoint writes ref when repo has no user.email and global/system configs are empty', async () => {
  const f = setupRepoFixture();
  const emptyGlobal = join(f.dir, 'empty_global_config');
  const emptySystem = join(f.dir, 'empty_system_config');
  writeFileSync(emptyGlobal, '');
  writeFileSync(emptySystem, '');

  const oldGlobal = process.env.GIT_CONFIG_GLOBAL;
  const oldSystem = process.env.GIT_CONFIG_SYSTEM;
  const oldNoSystem = process.env.GIT_CONFIG_NOSYSTEM;
  const oldAuthorEmail = process.env.GIT_AUTHOR_EMAIL;
  const oldAuthorName = process.env.GIT_AUTHOR_NAME;
  const oldCommitterEmail = process.env.GIT_COMMITTER_EMAIL;
  const oldCommitterName = process.env.GIT_COMMITTER_NAME;

  try {
    const { repoDir, db } = f;
    // Remove user.email and user.name from local repo config
    gitRun(repoDir, ['config', '--unset', 'user.email']);
    gitRun(repoDir, ['config', '--unset', 'user.name']);

    process.env.GIT_CONFIG_GLOBAL = emptyGlobal;
    process.env.GIT_CONFIG_SYSTEM = emptySystem;
    process.env.GIT_CONFIG_NOSYSTEM = '1';
    delete process.env.GIT_AUTHOR_EMAIL;
    delete process.env.GIT_AUTHOR_NAME;
    delete process.env.GIT_COMMITTER_EMAIL;
    delete process.env.GIT_COMMITTER_NAME;

    const sessionId = 's_ckpt_no_ident';
    const now = new Date().toISOString();
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, cwd, hidden) VALUES (?, 'p1', 'claude', 'pty', 'working', ?, ?, ?, 0)")
      .run(sessionId, now, now, repoDir);

    writeFileSync(join(repoDir, 'work.txt'), 'some work\n');

    await markTurnBase(db, sessionId);

    const refName = `refs/troop/turn/${sessionId}/1`;
    const refSha = gitRun(repoDir, ['rev-parse', '--verify', refName]);
    assert.ok(refSha && refSha.length === 40, `Turn ref ${refName} must resolve to a valid commit SHA even with no user.email`);

    const sessionRow = db.prepare('SELECT turn_base FROM session WHERE id = ?').get(sessionId) as any;
    assert.equal(sessionRow.turn_base, refSha, 'session.turn_base must match turn ref commit SHA');
  } finally {
    if (oldGlobal !== undefined) process.env.GIT_CONFIG_GLOBAL = oldGlobal; else delete process.env.GIT_CONFIG_GLOBAL;
    if (oldSystem !== undefined) process.env.GIT_CONFIG_SYSTEM = oldSystem; else delete process.env.GIT_CONFIG_SYSTEM;
    if (oldNoSystem !== undefined) process.env.GIT_CONFIG_NOSYSTEM = oldNoSystem; else delete process.env.GIT_CONFIG_NOSYSTEM;
    if (oldAuthorEmail !== undefined) process.env.GIT_AUTHOR_EMAIL = oldAuthorEmail; else delete process.env.GIT_AUTHOR_EMAIL;
    if (oldAuthorName !== undefined) process.env.GIT_AUTHOR_NAME = oldAuthorName; else delete process.env.GIT_AUTHOR_NAME;
    if (oldCommitterEmail !== undefined) process.env.GIT_COMMITTER_EMAIL = oldCommitterEmail; else delete process.env.GIT_COMMITTER_EMAIL;
    if (oldCommitterName !== undefined) process.env.GIT_COMMITTER_NAME = oldCommitterName; else delete process.env.GIT_COMMITTER_NAME;
    f.close();
  }
});

