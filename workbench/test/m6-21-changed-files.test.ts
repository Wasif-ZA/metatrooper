import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { owners } from '../../core/src/sessions/owners.ts';
import { isQueueable } from '../../core/src/pipe/commands.ts';
import { fileDiff, gitIn } from '../src/handback.ts';
import { ownedBy, ownedIn, refreshRowGit, rowGit } from '../src/rowgit.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');
const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const termSource = readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8');

const fn = (name: string) => appSource.match(new RegExp(`^function ${name}\\([^]*?\\r?\\n}\\r?\\n`, 'm'))![0];

function tileLabel(git: Record<string, { changed: string[] }>, id: string): string {
  const changedFiles = new Function('ui', `${fn('changedFiles')}; return changedFiles;`)({ snap: { git } });
  const n = changedFiles(id).length;
  return n ? `${n} changed` : '';
}

test('M6-21a a session that edits 3 files shows "3 changed"; committing one shows "2 changed"', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-changed-'));
  const repo = join(dir, 'repo');
  const db = new DatabaseSync(join(dir, 'troop.db'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    const past = new Date(Date.now() - 3_600_000).toISOString();
    git('config', 'user.email', 't@x.example');
    git('config', 'user.name', 'T');
    for (const f of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) writeFileSync(join(repo, f), 'one\n');
    git('add', '-A');
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo, stdio: 'ignore', env: { ...process.env, GIT_COMMITTER_DATE: past, GIT_AUTHOR_DATE: past } });
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: repo, encoding: 'utf8' }).trim();

    db.exec(schema);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', repo, 'p1', now, now);
    db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1)").run();
    const session = db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, cwd, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)');
    session.run('s_edit', 'p1', 'claude', 'pty', 'idle', now, now, repo);
    session.run('s_other', 'p1', 'claude', 'pty', 'idle', now, now, repo);

    for (const f of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) writeFileSync(join(repo, f), 'two\n');
    const at = new Date(Date.now() - 10_000).toISOString();
    const claim = (id: string, files: string[]) => db.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.claim', ?, 1)")
      .run(at, id, JSON.stringify({ repo: root, turn_base: null, from: at, at, files: files.map((path) => ({ path, owners: [id], shared: false })) }));
    claim('s_edit', ['a.txt', 'b.txt', 'c.txt']);
    claim('s_other', ['d.txt']);

    const live = [{ id: 's_edit', cwd: repo }, { id: 's_other', cwd: repo }];
    assert.equal(await refreshRowGit(live, ownedBy(owners(db, root))), true);
    assert.deepEqual(rowGit().s_edit.changed.sort(), ['a.txt', 'b.txt', 'c.txt']);
    assert.equal(tileLabel(rowGit(), 's_edit'), '3 changed');
    assert.equal(tileLabel(rowGit(), 's_other'), '1 changed');

    git('add', 'a.txt');
    git('commit', '-q', '-m', 'a');
    assert.equal(await refreshRowGit(live, ownedBy(owners(db, root))), true);
    assert.deepEqual(rowGit().s_edit.changed.sort(), ['b.txt', 'c.txt']);
    assert.equal(tileLabel(rowGit(), 's_edit'), '2 changed');
    assert.equal(await refreshRowGit(live, ownedBy(owners(db, root))), false, 'no push when nothing moved');

    assert.equal(tileLabel({}, 's_none'), '');
    assert.match(mainSource, /refreshRowGit\(live, d \? await ownedIn\(d, all\.map\(\(x\) => x\.cwd\)\) : \{\}\)/);
    assert.equal(isQueueable('session.owners'), false, 'a git-tick read is never spooled while the core is down');
    assert.match(termSource, /set\('\.tile-changed', x\.changed \? `\$\{x\.changed\} changed` : ''\)/);
    assert.match(termSource, /data-action="changed-menu"/);
    assert.match(appSource, /case 'changed-open':[^]*?ui\.diffScope = 'uncommitted';[^]*?ui\.sdFile = el\.dataset\.file;[^]*?openTab\('diff'\)/);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M6-21 a session working in its own git worktree gets its claimed files, not the main checkout\'s', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-changed-wt-'));
  const repo = join(dir, 'repo');
  const wt = join(dir, 'wt');
  const db = new DatabaseSync(join(dir, 'troop.db'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    const past = new Date(Date.now() - 3_600_000).toISOString();
    git('config', 'user.email', 't@x.example');
    git('config', 'user.name', 'T');
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    git('add', '-A');
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo, stdio: 'ignore', env: { ...process.env, GIT_COMMITTER_DATE: past, GIT_AUTHOR_DATE: past } });
    git('worktree', 'add', '-q', '-b', 'side', wt);
    const top = (cwd: string) => execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();

    db.exec(schema);
    const now = new Date().toISOString();
    db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', repo, 'p1', now, now);
    db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1)").run();
    db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, cwd, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)').run('s_wt', 'p1', 'claude', 'pty', 'idle', now, now, wt);

    writeFileSync(join(wt, 'a.txt'), 'two\n');
    const at = new Date(Date.now() - 10_000).toISOString();
    db.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.claim', ?, 1)")
      .run(at, 's_wt', JSON.stringify({ repo: top(wt), turn_base: null, from: at, at, files: [{ path: 'a.txt', owners: ['s_wt'], shared: false }] }));

    assert.deepEqual(ownedBy(owners(db, top(repo))), {}, 'the project root holds none of the worktree claims');
    assert.deepEqual(await ownedIn(db, [repo, wt, wt, null]), { s_wt: ['a.txt'] });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M6-21 a claimed untracked file opens from the changed menu and shows as all new lines', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-changed-new-'));
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', dir]);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    git('config', 'user.email', 't@x.example');
    git('config', 'user.name', 'T');
    writeFileSync(join(dir, 'a.txt'), 'one\n');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    writeFileSync(join(dir, 'new.txt'), 'fresh line\n');
    assert.match(await fileDiff(gitIn(dir), 'HEAD', 'new.txt'), /^\+fresh line$/m);
    assert.equal(await fileDiff(gitIn(dir), 'HEAD', 'a.txt'), '', 'a clean tracked file is not shown as new');

    const asked: string[] = [];
    const ui: Record<string, any> = { diffScope: 'uncommitted', sdFile: 'new.txt', sdiff: { at: 1, data: { files: [{ path: 'a.txt', added: 1, deleted: 1 }], untracked: ['new.txt'] } } };
    const api = { sessionDiffFile: (_id: string, file: string) => { asked.push(file); return new Promise(() => {}); } };
    const renderDiffTab = new Function('ui', 'api', 'esc', 'renderAllChanges', 'loadSessionDiff', 'renderDiff', `${fn('renderDiffTab')}; return renderDiffTab;`)(ui, api, String, () => '', () => {}, () => '');
    renderDiffTab({ id: 's1' });
    assert.equal(ui.sdFile, 'new.txt');
    assert.deepEqual(asked, ['new.txt']);
    assert.match(appSource, /case 'changed-open':[^]*?ui\.sdFile = el\.dataset\.file;\s*ui\.sdiff = null;[^]*?openTab\('diff'\)/, 'a pick inside the 10 s cache refetches the list');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
