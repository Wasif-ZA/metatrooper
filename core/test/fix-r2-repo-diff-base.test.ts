import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root } from './helpers.ts';

function withRepo(fn: (repo: string, runDir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'fix-r2-'));
  const repo = join(dir, 'repo');
  const runDir = join(dir, 'run');
  try {
    mkdirSync(repo);
    mkdirSync(runDir);
    const git = (...args: string[]) => {
      const result = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgSign=false', ...args], {
        cwd: repo, encoding: 'utf8', windowsHide: true, timeout: 20_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
    };
    git('init', '-q', '--initial-branch=main');
    writeFileSync(join(repo, 'tracked.txt'), 'original\n');
    git('add', 'tracked.txt');
    git('commit', '-q', '-m', 'initial');
    writeFileSync(join(repo, 'history.txt'), 'second commit\n');
    git('add', 'history.txt');
    git('commit', '-q', '-m', 'second');
    writeFileSync(join(repo, 'tracked.txt'), 'changed\n');
    fn(repo, runDir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function diff(repo: string, runDir: string, base: string) {
  const result = spawnSync(process.execPath, [join(root, 'plugins', 'repo', 'bin', 'repo.js'), 'diff'], {
    cwd: repo,
    env: { ...process.env, TROOP_PROJECT_DIR: repo, TROOP_RUN_DIR: runDir },
    input: JSON.stringify({ input: { base } }),
    encoding: 'utf8', windowsHide: true, timeout: 20_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

// protects=FIX-R2a: --output=x is refused without creating x.
test('FIX-R2a repo diff refuses --output=x without writing x', () => {
  withRepo((repo, runDir) => {
    const reply = diff(repo, runDir, '--output=x');
    assert.equal(existsSync(join(repo, 'x')), false);
    assert.equal(existsSync(join(runDir, 'x')), false);
    assert.equal(reply.ok, false);
    assert.match(reply.error.message, /base must name a commit/);
  });
});

// protects=FIX-R2c: a short option cannot be used as a diff base.
test('FIX-R2c repo diff refuses -p', () => {
  withRepo((repo, runDir) => {
    const reply = diff(repo, runDir, '-p');
    assert.equal(reply.ok, false);
    assert.match(reply.error.message, /base must name a commit/);
  });
});

for (const [base, files] of [
  ['main', ['tracked.txt']],
  ['HEAD~1', ['history.txt', 'tracked.txt']],
] as const) {
  // protects=FIX-R2b: branch names and relative revisions retain their changed-file results.
  test(`FIX-R2b repo diff accepts ${base} and returns expected changed files`, () => {
    withRepo((repo, runDir) => {
      const reply = diff(repo, runDir, base);
      assert.equal(reply.ok, true, JSON.stringify(reply));
      assert.deepEqual(reply.outputs.files.sort(), [...files]);
      const patch = readFileSync(reply.outputs.patch_path, 'utf8');
      for (const file of files) assert.ok(patch.includes(`diff --git a/${file} b/${file}`), patch);
    });
  });
}
