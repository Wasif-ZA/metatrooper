import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-WT-Hide-'));
process.env.METATROOPER_HOME = home;
const { openCoreDb } = await import('../src/store/db.ts');
const { resolveProjectPath } = await import('../src/project.ts');
const { removing, sweepWorktrees } = await import('../src/worktree.ts');
const { launchSession } = await import('../src/sessions/launch.ts');

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@x.example', '-c', 'user.name=T', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('a project hidden by hand while the sweep runs stays hidden', async () => {
  // protects=project.hide during a sweep: the sweep's older writes do not reset hidden from rows read before the hide
  // fails_when=the sweep writes hidden = 0 for a stale or fresh worktree that project.hide hid after the sweep read its rows
  // no_claim=which worktrees the sweep removes or marks older, which worktree-sweep.test.ts covers
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const db = openCoreDb();
  try {
    const repo = path.join(home, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    const row = (id: string, p: string, at: string, older = 0) => db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened, older) VALUES (?, ?, ?, ?, ?, ?)').run(id, p, id, at, at, older);
    row('parent', resolveProjectPath(repo), old);
    const add = (name: string) => { const dir = path.join(home, 'worktrees', 'parent', name); git(repo, 'worktree', 'add', '-q', dir, '-b', name); return resolveProjectPath(dir); };
    const dirty = add('dirty');
    fs.writeFileSync(path.join(dirty, 'new.txt'), 'wip');
    row('dirty', dirty, old);
    row('fresh', add('fresh'), new Date().toISOString(), 1);

    const sweeping = sweepWorktrees(db, []);
    db.prepare("UPDATE project SET hidden = 1 WHERE id IN ('dirty', 'fresh')").run();
    await sweeping;
    const state = (id: string) => ({ ...(db.prepare('SELECT hidden FROM project WHERE id = ?').get(id) as { hidden: number }) });
    assert.deepEqual(state('dirty'), { hidden: 1 });
    assert.deepEqual(state('fresh'), { hidden: 1 });
  } finally {
    db.close();
  }
});

test('a launch while the sweep removes a worktree is refused, so no session runs in a deleted folder', async () => {
  // protects=a session started during git worktree remove: it is refused instead of losing its folder
  // fails_when=launchSession starts a session for a project whose worktree the sweep is removing, or the project stays blocked after the sweep
  // no_claim=when the sweep decides a worktree is stale and merged, which worktree-sweep.test.ts covers
  const old = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const db = openCoreDb();
  try {
    const repo = path.join(home, 'repo2');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    const row = (id: string, p: string) => db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run(id, p, id, old, old);
    row('parent2', resolveProjectPath(repo));
    const dir = path.join(home, 'worktrees', 'parent2', 'merged');
    git(repo, 'worktree', 'add', '-q', dir, '-b', 'merged');
    const merged = resolveProjectPath(dir);
    row('merged', merged);

    const sweeping = sweepWorktrees(db, []);
    while (!removing.has('merged')) {
      assert.ok(!(await Promise.race([sweeping.then(() => true), new Promise((r) => setImmediate(() => r(false)))])), 'the sweep finished before its removal was seen');
    }
    assert.throws(() => launchSession(db, { projectId: 'merged', projectPath: merged, projectName: 'merged', engine: { id: 'claude' } as any }), /being removed/);
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM session WHERE project_id = 'merged'").get() as { n: number }).n, 0);
    const r = await sweeping;
    assert.deepEqual(r.removed, [merged]);
    assert.equal(removing.size, 0);
  } finally {
    db.close();
  }
});
