import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-wt-sweep-'));
process.env.METATROOPER_HOME = home;
const { openCoreDb } = await import('../src/store/db.ts');
const { resolveProjectPath, worktreesRoot } = await import('../src/project.ts');
const { sweepWorktrees } = await import('../src/worktree.ts');

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.email=t@x.example', '-c', 'user.name=T', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const iso = (ms: number) => new Date(ms).toISOString();

test('the sweep hides gone worktrees, removes stale clean merged ones, keeps dirty or unmerged ones as older, and leaves fresh, live and outside ones alone', async () => {
  const now = Date.now();
  const old = iso(now - 30 * 86_400_000);
  const db = openCoreDb();
  try {
    db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 3)").run();
    const repo = path.join(home, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'init');
    const parentPath = resolveProjectPath(repo);
    const row = (id: string, p: string, at = old) => db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run(id, p, id, at, at);
    row('parent', parentPath);
    const add = (name: string, dir = path.join(home, 'worktrees', 'parent', name)) => { git(repo, 'worktree', 'add', '-q', dir, '-b', name); return resolveProjectPath(dir); };

    const merged = add('merged');
    row('merged', merged);
    const dirty = add('dirty');
    fs.writeFileSync(path.join(dirty, 'new.txt'), 'wip');
    row('dirty', dirty);
    const unmerged = add('unmerged');
    fs.writeFileSync(path.join(unmerged, 'b.txt'), 'b');
    git(unmerged, 'add', '-A');
    git(unmerged, 'commit', '-q', '-m', 'work');
    row('unmerged', unmerged);
    const fresh = add('fresh');
    row('fresh', fresh, iso(now));
    const live = add('live');
    row('live', live);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s1', 'live', 'claude', 'pty', 'idle', ?, ?)").run(old, old);
    const gone = worktreesRoot() + 'parent/gone';
    row('gone', gone);
    const outside = add('outside', path.join(home, 'elsewhere', 'outside'));
    row('outside', outside);

    const late = add('late');
    row('late', late);

    // The sweep must not block the core's event loop: a timer has to fire while git runs.
    let ticks = 0;
    const timer = setInterval(() => ticks++, 1);
    const sweeping = sweepWorktrees(db, []);
    // A session that starts after the sweep read its rows still keeps its worktree.
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s2', 'late', 'claude', 'pty', 'idle', ?, ?)").run(old, old);
    const r = await sweeping;
    clearInterval(timer);
    assert.ok(ticks > 0, 'timers ran during the sweep');
    assert.ok(fs.existsSync(late), 'a worktree whose session started mid-sweep is kept');
    const state = (id: string) => db.prepare('SELECT hidden, older FROM project WHERE id = ?').get(id) as { hidden: number; older: number };

    assert.deepEqual(r.hidden, [gone]);
    assert.deepEqual({ ...state('gone') }, { hidden: 1, older: 0 });

    assert.deepEqual(r.removed, [merged]);
    assert.equal(fs.existsSync(merged), false);
    assert.doesNotMatch(git(repo, 'worktree', 'list'), /\/merged /);
    assert.deepEqual({ ...state('merged') }, { hidden: 1, older: 0 });

    assert.deepEqual(r.older.sort(), [dirty, unmerged].sort());
    for (const id of ['dirty', 'unmerged']) assert.deepEqual({ ...state(id) }, { hidden: 0, older: 1 });
    assert.ok(fs.existsSync(path.join(dirty, 'new.txt')));
    assert.ok(fs.existsSync(unmerged));

    for (const [id, dir] of [['fresh', fresh], ['live', live], ['late', late], ['outside', outside], ['parent', parentPath]]) {
      assert.deepEqual({ ...state(id) }, { hidden: 0, older: 0 }, id);
      assert.ok(fs.existsSync(dir), id);
    }

    db.prepare("UPDATE session SET state = 'exited' WHERE id = 's1'").run();
    db.prepare('UPDATE project SET last_opened = ? WHERE id = ?').run(iso(now), 'dirty');
    const again = await sweepWorktrees(db, []);
    assert.deepEqual(again.removed, [live], 'an exited session no longer keeps an idle worktree');
    assert.deepEqual({ ...state('dirty') }, { hidden: 0, older: 0 }, 'new activity brings an older worktree back');
  } finally {
    db.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
