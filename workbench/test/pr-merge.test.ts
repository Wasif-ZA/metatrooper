import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mergePr } from '../src/rowgit.ts';

const root = mkdtempSync(join(tmpdir(), 'pr-merge-'));
after(() => rmSync(root, { recursive: true, force: true }));
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=T', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

test('demo merge: the worktree branch lands in main with a merge commit and the PR reads MERGED', async () => {
  const main = join(root, 'shop');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  writeFileSync(join(main, 'a.txt'), 'one\n');
  git(main, 'add', '-A'); git(main, 'commit', '-qm', 'base');
  const wt = join(root, 'shop-fix');
  git(main, 'worktree', 'add', '-q', '-b', 'fix/x', wt);
  writeFileSync(join(wt, 'a.txt'), 'two\n');
  git(wt, 'commit', '-qam', 'fix');
  const file = join(root, 'github.json');
  writeFileSync(file, JSON.stringify({ prs: { 'fix/x': { number: 3, state: 'OPEN', url: '', checks: 'pass' } }, issues: {} }));

  assert.deepEqual(await mergePr(wt, file), { ok: true });
  assert.equal(git(main, 'show', 'main:a.txt'), 'two');
  assert.equal(git(main, 'rev-list', '--count', '--merges', 'main'), '1');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).prs['fix/x'].state, 'MERGED');
});

test('merge refuses a folder with no branch checked out', async () => {
  const bare = join(root, 'not-a-repo');
  mkdirSync(bare);
  const r = await mergePr(bare, join(root, 'github.json'));
  assert.ok('error' in r && /no branch/.test(r.error));
});

test('prMerge in main resolves the session folder and passes the demo file only in the demo', () => {
  const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(src, /on\('prMerge', async \(sessionId: unknown\) => \{\s*const cwd = cwdOf\(sessionId\);\s*if \(!cwd\) return \{ error: 'this session has no folder recorded' \};\s*return mergePr\(cwd, demo \? path\.join\(homeDir\(\), 'demo', 'github\.json'\) : null\);/);
  assert.match(readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8'), /prMerge: \(sessionId\) => ipcRenderer\.invoke\('prMerge', sessionId\)/);
});
