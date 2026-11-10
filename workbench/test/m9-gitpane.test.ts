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
  assert.deepEqual(recordedArgs, ['--literal-pathspecs', 'add', '--', 'file.ts']);

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
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, ['commit', '-F', '-']);
  assert.equal(calls[1].input, 'feat: first commit');

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
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, ['commit', '-F', '-']);
  assert.equal(calls[1].input, '--amend --no-verify -A push');
  assert.equal(calls[1].args.includes('--amend'), false);
  assert.equal(calls[1].args.includes('--no-verify'), false);
  assert.equal(calls[1].args.includes('-A'), false);
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
