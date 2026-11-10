import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { gitAct, gitView, runIn, type Run } from '../src/gitpane.ts';

const source = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const extract = (re: RegExp) => { const m = source.match(re); assert.ok(m, String(re)); return m[0]; };

// What: initialize a temporary git repo with local user identity and safe cleanup.
async function initRepo(): Promise<{ dir: string; git: ReturnType<typeof runIn>; cleanup: () => void }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitpane-m9-'));
  const git = runIn(dir);
  await git(['init', '-q']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'test']);
  const cleanup = () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {}
  };
  return { dir, git, cleanup };
}

// What: in a no-HEAD repo, unstage-paths unstages a named file while leaving other staged files intact and on disk.
test('no-HEAD repo: stage a.txt and b.txt, unstage-paths a.txt leaves a.txt untracked, b.txt staged, and a.txt on disk', async () => {
  const { dir, git, cleanup } = await initRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'content of a\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'content of b\n');
    await gitAct(git, 'stage-paths', ['a.txt', 'b.txt']);
    let view = await gitView(git);
    assert.deepEqual(view.staged.map((f) => f.path).sort(), ['a.txt', 'b.txt']);
    await gitAct(git, 'unstage-paths', ['a.txt']);
    view = await gitView(git);
    assert.deepEqual(view.staged.map((f) => f.path), ['b.txt']);
    assert.deepEqual(view.changes.map((f) => [f.path, f.code]), [['a.txt', 'U']]);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'content of a\n');
    assert.equal(fs.readFileSync(path.join(dir, 'b.txt'), 'utf8'), 'content of b\n');
  } finally {
    cleanup();
  }
});

// What: in a no-HEAD repo, unstage with no path unstages all files while leaving them on disk.
test('no-HEAD repo: unstage with no path unstages all files while keeping them on disk', async () => {
  const { dir, git, cleanup } = await initRepo();
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'alpha content\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'beta content\n');
    await gitAct(git, 'stage-paths', ['a.txt', 'b.txt']);
    let view = await gitView(git);
    assert.deepEqual(view.staged.map((f) => f.path).sort(), ['a.txt', 'b.txt']);
    await gitAct(git, 'unstage', '');
    view = await gitView(git);
    assert.deepEqual(view.staged, []);
    assert.deepEqual(view.changes.map((f) => [f.path, f.code]).sort(), [['a.txt', 'U'], ['b.txt', 'U']]);
    assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'alpha content\n');
    assert.equal(fs.readFileSync(path.join(dir, 'b.txt'), 'utf8'), 'beta content\n');
  } finally {
    cleanup();
  }
});

// What: in a repo with a commit, unstage keeps modifications in the worktree instead of deleting them from the index.
test('repo with a commit: modify and stage a tracked file, unstage keeps change in worktree and not in index', async () => {
  const { dir, git, cleanup } = await initRepo();
  try {
    fs.writeFileSync(path.join(dir, 'tracked.txt'), 'version 1\n');
    await gitAct(git, 'stage', 'tracked.txt');
    await gitAct(git, 'commit', 'initial commit');
    fs.writeFileSync(path.join(dir, 'tracked.txt'), 'version 2\n');
    await gitAct(git, 'stage', 'tracked.txt');
    let view = await gitView(git);
    assert.deepEqual(view.staged.map((f) => [f.path, f.code]), [['tracked.txt', 'M']]);
    assert.deepEqual(view.changes, []);
    await gitAct(git, 'unstage', 'tracked.txt');
    view = await gitView(git);
    assert.deepEqual(view.staged, []);
    assert.deepEqual(view.changes.map((f) => [f.path, f.code]), [['tracked.txt', 'M']]);
    assert.equal(fs.readFileSync(path.join(dir, 'tracked.txt'), 'utf8'), 'version 2\n');

    // What: verify unstage-paths on a repo with a commit also uses git restore --staged.
    await gitAct(git, 'stage-paths', ['tracked.txt']);
    view = await gitView(git);
    assert.deepEqual(view.staged.map((f) => [f.path, f.code]), [['tracked.txt', 'M']]);
    await gitAct(git, 'unstage-paths', ['tracked.txt']);
    view = await gitView(git);
    assert.deepEqual(view.staged, []);
    assert.deepEqual(view.changes.map((f) => [f.path, f.code]), [['tracked.txt', 'M']]);
    assert.equal(fs.readFileSync(path.join(dir, 'tracked.txt'), 'utf8'), 'version 2\n');
  } finally {
    cleanup();
  }
});

// What: unstage-paths with an empty list rejects with name the files and executes no git command.
test('unstage-paths with an empty list rejects with name the files without invoking git', async () => {
  let gitInvoked = false;
  const mockGit: Run = async () => {
    gitInvoked = true;
    return '';
  };
  // What: reject immediately when given empty array without calling git runner.
  await assert.rejects(gitAct(mockGit, 'unstage-paths', []), {
    name: 'Error',
    message: 'name the files',
  });
  assert.equal(gitInvoked, false);

  // What: reject in a real repository context as well.
  const { git, cleanup } = await initRepo();
  try {
    await assert.rejects(gitAct(git, 'unstage-paths', []), {
      name: 'Error',
      message: 'name the files',
    });
  } finally {
    cleanup();
  }
});

// What: a git command with stdout exceeding 1 MiB succeeds due to 64 MiB maxBuffer.
test('git command whose output exceeds 1 MiB succeeds due to 64 MiB maxBuffer', async () => {
  const { dir, git, cleanup } = await initRepo();
  try {
    const size = 2 * 1024 * 1024;
    const blob = 'y'.repeat(size);
    fs.writeFileSync(path.join(dir, 'big.txt'), blob);
    await git(['add', 'big.txt']);
    await git(['commit', '-qm', 'store 2 MiB blob']);
    // What: show of a 2 MiB blob succeeds without throwing maxBuffer error.
    const out = await git(['show', 'HEAD:big.txt']);
    assert.equal(out.length, size);
    assert.equal(out, blob);
  } finally {
    cleanup();
  }
});

// What: native unload question uses unsavedMessage with dirtySummary when set, and generic fallback when empty.
test('unload question uses unsavedMessage with dirtySummary when set and generic text when empty', () => {
  let capturedMessage = '';
  const listeners: Record<string, Function> = {};
  let setDirty: Function = () => {};
  const c: any = vm.createContext({
    closing: false,
    dirtyFiles: true,
    dirtySummary: '',
    on: (name: string, fn: Function) => {
      if (name === 'setDirty') setDirty = fn;
    },
    dialog: {
      showMessageBoxSync: (_win: unknown, options: { message?: string }) => {
        capturedMessage = options.message ?? '';
        return 1;
      },
    },
    win: {
      isDestroyed: () => false,
      webContents: {
        on: (name: string, fn: Function) => {
          listeners[name] = fn;
        },
      },
    },
  });
  const code = [
    extract(/^const unsavedMessage[^\n]+/m),
    extract(/  on\('setDirty'[^\n]+/),
    extract(/  win\.webContents\.on\('will-prevent-unload', \(e\) => \{[^]*?\n  \}\);/),
  ].join('\n');
  vm.runInContext(stripTypeScriptTypes(code), c);

  // What: unload question without dirtySummary displays the generic message.
  listeners['will-prevent-unload']({ preventDefault() {} });
  assert.equal(capturedMessage, 'Some files in the IDE have unsaved changes.');

  // What: unload question with dirtySummary displays the summary specific message.
  setDirty(true, 'workbench/src/main.ts');
  listeners['will-prevent-unload']({ preventDefault() {} });
  assert.equal(capturedMessage, 'Unsaved changes in workbench/src/main.ts.');

  // What: unload question when dirtySummary is reset to empty string reverts to generic message.
  setDirty(true, '');
  listeners['will-prevent-unload']({ preventDefault() {} });
  assert.equal(capturedMessage, 'Some files in the IDE have unsaved changes.');
});
