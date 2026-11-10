import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseStatusV2, namedPaths, gitAct, GIT_SAFE_ENV, runIn, type Run } from '../src/gitpane.ts';
import { fileDiff } from '../src/handback.ts';

function createTempGitRepo(t: any): string {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-git-'));
  t.after(() => {
    try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  });
  execFileSync('git', ['init'], { cwd: temp, windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Ouros Test'], { cwd: temp, windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'ouros@test.local'], { cwd: temp, windowsHide: true });
  return temp;
}

test('step 3: parseStatusV2 parses branch, renames, conflicts, untracked, and spaces', (t) => {
  const porcelainV2Z = [
    '# branch.oid 1234567890abcdef',
    '# branch.head feature/branch-x',
    '# branch.upstream origin/feature/branch-x',
    '# branch.ab +3 -2',
    '1 M. N... 100644 100644 100644 1111111 2222222 src/index.ts',
    '1 .M N... 100644 100644 100644 1111111 2222222 path with/spaces in name.ts',
    '2 R. N... 100644 100644 100644 1111111 2222222 R100 dest_file.ts',
    'orig_file.ts',
    'u UU N... 100644 100644 100644 100644 1111111 2222222 3333333 conflicted.ts',
    '? untracked_file.txt',
    '? untracked with spaces.txt',
    ''
  ].join('\0');

  const status = parseStatusV2(porcelainV2Z);
  assert.equal(status.branch, 'feature/branch-x');
  assert.equal(status.upstream, 'origin/feature/branch-x');
  assert.equal(status.ahead, 3);
  assert.equal(status.behind, 2);

  assert.deepEqual(status.files, [
    { path: 'src/index.ts', index: 'M', worktree: '.' },
    { path: 'path with/spaces in name.ts', index: '.', worktree: 'M' },
    { path: 'dest_file.ts', from: 'orig_file.ts', index: 'R', worktree: '.' },
    { path: 'conflicted.ts', index: 'U', worktree: 'U', conflict: true },
    { path: 'untracked_file.txt', index: '?', worktree: '?' },
    { path: 'untracked with spaces.txt', index: '?', worktree: '?' },
  ]);
});

test('step 3: namedPaths refuses whole-tree paths, absolute paths, and git dirs', (t) => {
  assert.equal(namedPaths('.'), null);
  assert.equal(namedPaths(['.']), null);
  assert.equal(namedPaths(['']), null);
  assert.equal(namedPaths(['..']), null);
  assert.equal(namedPaths(['a/..']), null);
  assert.equal(namedPaths(['/abs/path']), null);
  assert.equal(namedPaths(['C:/abs/path']), null);
  assert.equal(namedPaths(['C:\\abs\\path']), null);
  assert.equal(namedPaths(['.git']), null);
  assert.equal(namedPaths(['.git/config']), null);
  assert.equal(namedPaths(['sub/.git']), null);
  assert.equal(namedPaths(['sub/.git/config']), null);
  assert.equal(namedPaths([]), null);
  assert.equal(namedPaths(['valid.ts', '.']), null);

  assert.deepEqual(namedPaths(['src/valid.ts']), ['src/valid.ts']);
});

test('step 3: stage-paths and unstage-paths refuse invalid paths with name the files', async (t) => {
  let invoked = false;
  const mockGit: Run = async () => { invoked = true; return ''; };

  const refusedCases = [['.'], [''], ['..'], ['a/..'], ['/abs'], ['C:/abs'], ['.git'], ['.git/config'], []];
  for (const bad of refusedCases) {
    await assert.rejects(async () => gitAct(mockGit, 'stage-paths', bad), /name the files/);
    await assert.rejects(async () => gitAct(mockGit, 'unstage-paths', bad), /name the files/);
  }
  assert.equal(invoked, false);

  let recordedArgs: string[] = [];
  const recordingGit: Run = async (args: string[]) => { recordedArgs = args; return ''; };
  await gitAct(recordingGit, 'stage-paths', ['file.ts']);
  assert.deepEqual(recordedArgs, ['--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul']);

  await gitAct(recordingGit, 'unstage-paths', ['file.ts']);
  assert.deepEqual(recordedArgs, ['--literal-pathspecs', 'restore', '--staged', '--', 'file.ts']);
});

test('step 3: commit passes message on stdin with -F - and refuses empty message or empty staged', async (t) => {
  const calls: Array<{ args: string[]; input?: string }> = [];
  const mockGit: Run = async (args: string[], input?: string) => {
    calls.push({ args, input });
    if (args[0] === 'diff' && args.includes('--cached')) return 'staged.txt\n';
    return '';
  };

  // Valid commit passes -F - and message on stdin
  await gitAct(mockGit, 'commit', 'feat: first commit');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].args, ['commit', '-F', '-']);
  assert.equal(calls[1].input, 'feat: first commit');
  assert.deepEqual(calls[2].args, ['rev-parse', '--short', 'HEAD']);

  // Refusal of empty messages
  await assert.rejects(async () => gitAct(mockGit, 'commit', ''), /write a commit message first/);
  await assert.rejects(async () => gitAct(mockGit, 'commit', '   \t\n '), /write a commit message first/);
  await assert.rejects(async () => gitAct(mockGit, 'commit', 'msg\0null'), /write a commit message first/);
  await assert.rejects(async () => gitAct(mockGit, 'commit', 'x'.repeat(65537)), /write a commit message first/);

  // Refusal when nothing is staged
  const mockEmptyStaged: Run = async (args: string[]) => {
    if (args[0] === 'diff' && args.includes('--cached')) return '';
    return '';
  };
  await assert.rejects(async () => gitAct(mockEmptyStaged, 'commit', 'valid message'), /nothing staged/);
});

test('step 3: commit never injects --amend, --no-verify, -A, or push arguments', async (t) => {
  const calls: Array<{ args: string[]; input?: string }> = [];
  const mockGit: Run = async (args: string[], input?: string) => {
    calls.push({ args, input });
    if (args[0] === 'diff' && args.includes('--cached')) return 'staged.txt\n';
    return '';
  };

  // Potentially hostile message remains on stdin and does not become argv flags
  await gitAct(mockGit, 'commit', '--amend --no-verify -A push');
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[1].args, ['commit', '-F', '-']);
  assert.equal(calls[1].input, '--amend --no-verify -A push');
  assert.equal(calls[1].args.includes('--amend'), false);
  assert.equal(calls[1].args.includes('--no-verify'), false);
  assert.equal(calls[1].args.includes('-A'), false);
  assert.deepEqual(calls[2].args, ['rev-parse', '--short', 'HEAD']);
});

test('step 3: GIT_SAFE_ENV is applied on git spawns', async (t) => {
  assert.deepEqual(GIT_SAFE_ENV, {
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.fsmonitor',
    GIT_CONFIG_VALUE_0: 'false'
  });

  const temp = createTempGitRepo(t);
  fs.writeFileSync(path.join(temp, 'file.txt'), 'hello', 'utf8');

  // Override repo config with failing command
  execFileSync('git', ['config', 'core.fsmonitor', 'exit 1'], { cwd: temp, windowsHide: true });

  const git = runIn(temp);
  const status = await git(['status', '--porcelain']);
  assert.ok(status.includes('file.txt'));
});

test('step 3: diffs carry --no-ext-diff and --no-textconv', async (t) => {
  const diffCalls: string[][] = [];
  const mockGit = async (args: string[]) => {
    diffCalls.push(args);
    return 'unified diff output';
  };

  const res = await fileDiff(mockGit, 'HEAD', 'src/file.ts');
  assert.equal(res, 'unified diff output');
  assert.ok(diffCalls[0].includes('--no-ext-diff'));
  assert.ok(diffCalls[0].includes('--no-textconv'));
});

// Protects gitpane.ts:119-121: paths are literal NUL-separated stdin, never argv.
test('fix-05 stage-paths sends spaces, leading dash and pathspec syntax only on stdin', async () => {
  const calls: any[] = [];
  await gitAct(async (args, input) => { calls.push([args, input]); return ''; }, 'stage-paths', ['a b.ts', '-x', ':(top)y']);
  assert.deepEqual(calls, [[['--literal-pathspecs', 'add', '--pathspec-from-file=-', '--pathspec-file-nul'], 'a b.ts\0-x\0:(top)y']]);
});
// Protects gitpane.ts:110, :120: a NUL cannot inject an additional stdin path.
test('fix-05 NUL path is refused before git runs', async () => {
  let calls = 0;
  await assert.rejects(gitAct(async () => { calls++; return ''; }, 'stage-paths', ['safe\0victim']), /name the files/);
  assert.equal(calls, 0);
});
// Protects gitpane.ts:107, :121 and runIn stdin forwarding; uses a throwaway repo only.
test('fix-05 1500 untracked paths stage in one call, including a literal -x', async t => {
  const repo = createTempGitRepo(t);
  const names = ['-x', 'a b.ts', ...Array.from({ length: 1498 }, (_, i) => 'file-' + i + '.txt')];
  // Windows cannot create a colon in a file name; exercise this literal on POSIX too.
  if (process.platform !== 'win32') names.push(':(top)y');
  for (const name of names) fs.writeFileSync(path.join(repo, name), 'test');
  let calls = 0;
  await gitAct(async (args, input) => { calls++; return runIn(repo)(args, input); }, 'stage-paths', names);
  assert.equal(calls, 1);
  const staged = (await runIn(repo)(['diff', '--cached', '--name-only', '-z'])).split('\0').filter(Boolean).sort();
  assert.deepEqual(staged, [...names].sort());
});
