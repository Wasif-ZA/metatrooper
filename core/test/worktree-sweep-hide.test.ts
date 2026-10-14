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
const { sweepWorktrees } = await import('../src/worktree.ts');

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@x.example', '-c', 'user.name=T', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

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
    fs.rmSync(home, { recursive: true, force: true });
  }
});
