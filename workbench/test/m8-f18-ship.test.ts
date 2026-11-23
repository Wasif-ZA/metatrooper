import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes } from 'node:module';
import { ship, runIn, type Run } from '../src/gitpane.ts';

const prUrl = 'https://example.invalid/pull/18';

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm8-f18-ship-'));
  const saved = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('GIT_')));
  for (const key of Object.keys(saved)) delete process.env[key];
  const config = path.join(root, 'gitconfig');
  fs.writeFileSync(config, '');
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: 'Ship Test', GIT_AUTHOR_EMAIL: 'ship@test.invalid',
    GIT_COMMITTER_NAME: 'Ship Test', GIT_COMMITTER_EMAIL: 'ship@test.invalid',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: config,
    GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file',
  });
  t.after(() => {
    for (const key of Object.keys(process.env)) if (key.startsWith('GIT_')) delete process.env[key];
    Object.assign(process.env, saved);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  const origin = path.join(root, 'origin.git');
  const local = path.join(root, 'local');
  const at = (cwd: string, args: string[]) => execFileSync('git', args, {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  at(root, ['init', '--bare', '--initial-branch=main', origin]);
  at(root, ['clone', origin, local]);
  const git = (args: string[]) => at(local, args);
  const remote = (args: string[]) => at(origin, args);
  git(['config', 'commit.gpgSign', 'false']);
  git(['config', 'core.autocrlf', 'false']);
  git(['config', 'core.hooksPath', path.join(root, 'no-hooks')]);
  const write = (name: string, content: string) => fs.writeFileSync(path.join(local, name), content);
  write('first.txt', 'first\n');
  write('second.txt', 'second\n');
  write('deleted.txt', 'delete me\n');
  git(['add', '-A']);
  git(['commit', '-m', 'seed']);
  git(['push', '--set-upstream', 'origin', 'main']);
  git(['remote', 'set-head', 'origin', 'main']);
  const base = git(['rev-parse', 'HEAD']);
  const branch = 'feature/ship';
  git(['checkout', '-b', branch]);
  const calls: string[][] = [];
  const realGit = runIn(local);
  const recordedGit: Run = async (args, input, options) => {
    calls.push([...args]);
    return realGit(args, input, options);
  };
  return { root, local, origin, at, git, remote, write, base, branch, calls, run: recordedGit };
}

function fakeGh(existing = '', createError?: string) {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push([...args]);
    if (args[0] === 'pr' && args[1] === 'view') {
      if (existing) return JSON.stringify({ url: existing });
      throw new Error('no PR exists');
    }
    assert.equal(args[0], 'pr');
    assert.equal(args[1], 'create');
    if (createError) throw Object.assign(new Error('gh failed'), { stderr: createError });
    return `Created pull request\n${prUrl}\n`;
  };
  return { run, calls };
}

// protects=gitpane.ts ship: reject an empty message before staging/committing/pushing (F18c).
test('F18c empty message with changes makes no commit, push or PR', async t => {
  const f = fixture(t);
  f.write('first.txt', 'changed\n');
  const gh = fakeGh();
  const before = f.remote(['show-ref']);
  for (const message of ['', ' \t\r\n ']) {
    await assert.rejects(ship(f.run, gh.run, message), {
      message: 'commit failed: write a commit message first',
    });
  }
  assert.equal(f.git(['rev-parse', 'HEAD']), f.base);
  assert.equal(f.remote(['show-ref']), before);
  assert.equal(f.git(['diff', '--cached', '--name-only']), '');
  assert.ok(!f.calls.some(args => ['add', 'commit', 'push'].includes(args[0])));
  assert.deepEqual(gh.calls, []);
});

// protects=gitpane.ts ship: add -A fallback, commit stdin, upstream push, explicit PR head/title/body and result.
test('ship commits every change when nothing is staged and opens a PR', async t => {
  const f = fixture(t);
  f.write('first.txt', 'changed\n');
  f.write('untracked file.txt', 'new\n');
  fs.unlinkSync(path.join(f.local, 'deleted.txt'));
  const gh = fakeGh();
  const message = 'feat: ship everything\n\nBody line one\nBody line two';
  const result = await ship(f.run, gh.run, message);
  assert.deepEqual(result, { commit: f.git(['rev-parse', '--short', 'HEAD']), url: prUrl });
  assert.notEqual(f.git(['rev-parse', 'HEAD']), f.base);
  assert.equal(f.git(['log', '-1', '--format=%B']), message);
  assert.deepEqual(f.git(['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']).split('\n').sort(),
    ['deleted.txt', 'first.txt', 'untracked file.txt']);
  assert.equal(f.git(['status', '--porcelain']), '');
  assert.equal(f.remote(['rev-parse', `refs/heads/${f.branch}`]), f.git(['rev-parse', 'HEAD']));
  assert.equal(f.git(['rev-parse', '--abbrev-ref', '@{upstream}']), `origin/${f.branch}`);
  assert.deepEqual(gh.calls, [
    ['pr', 'view', f.branch, '--json', 'url'],
    ['pr', 'create', '--head', f.branch, '--title', 'feat: ship everything', '--body', 'Body line one\nBody line two'],
  ]);
});

// protects=gitpane.ts ship: preserve an existing staged selection instead of always adding -A.
test('ship commits only staged files and leaves the second file unstaged', async t => {
  const f = fixture(t);
  f.write('first.txt', 'staged\n');
  f.git(['add', 'first.txt']);
  f.write('second.txt', 'unstaged\n');
  await ship(f.run, fakeGh().run, 'selected change');
  assert.equal(f.git(['show', 'HEAD:first.txt']), 'staged');
  assert.equal(f.git(['show', 'HEAD:second.txt']), 'second');
  assert.equal(fs.readFileSync(path.join(f.local, 'second.txt'), 'utf8'), 'unstaged\n');
  assert.equal(f.git(['diff', '--name-only']), 'second.txt');
  assert.equal(f.git(['diff', '--cached', '--name-only']), '');
  assert.ok(!f.calls.some(args => args[0] === 'add'));
});

for (const mode of ['origin/HEAD', 'fallback main', 'fallback master']) {
  // protects=gitpane.ts ship: refuse origin/HEAD and main/master fallback before side effects (F18d).
  test(`F18d refuses default branch: ${mode}`, async t => {
    const f = fixture(t);
    f.git(['checkout', 'main']);
    if (mode !== 'origin/HEAD') f.git(['remote', 'set-head', 'origin', '--delete']);
    if (mode === 'fallback master') f.git(['branch', '-m', 'master']);
    f.write('first.txt', 'must stay local\n');
    const gh = fakeGh();
    const before = f.remote(['show-ref']);
    await assert.rejects(ship(f.run, gh.run, 'do not ship'), /^Error: push failed: .*default branch/);
    assert.equal(f.remote(['show-ref']), before);
    assert.equal(f.git(['rev-parse', 'HEAD']), f.base);
    assert.ok(!f.calls.some(args => ['add', 'commit', 'push'].includes(args[0])));
    assert.deepEqual(gh.calls, []);
  });
}

// protects=gitpane.ts ship: plain push must reject divergence; first failed step prevents gh (F18c/F18d).
test('F18d non-fast-forward push never overwrites origin and stops before gh', async t => {
  const f = fixture(t);
  f.git(['push', '--set-upstream', 'origin', f.branch]);
  const other = path.join(f.root, 'other');
  f.at(f.root, ['clone', '--branch', f.branch, f.origin, other]);
  f.at(other, ['config', 'commit.gpgSign', 'false']);
  f.at(other, ['config', 'core.hooksPath', path.join(f.root, 'no-hooks')]);
  fs.writeFileSync(path.join(other, 'remote.txt'), 'remote change\n');
  f.at(other, ['add', '-A']);
  f.at(other, ['commit', '-m', 'remote only']);
  f.at(other, ['push', 'origin', f.branch]);
  const remoteHead = f.remote(['rev-parse', `refs/heads/${f.branch}`]);
  f.write('local.txt', 'local change\n');
  const gh = fakeGh();
  await assert.rejects(ship(f.run, gh.run, 'local only'), /^Error: push failed:/);
  assert.equal(f.remote(['rev-parse', `refs/heads/${f.branch}`]), remoteHead);
  assert.notEqual(f.git(['rev-parse', 'HEAD']), f.base, 'commit succeeded before the push failed');
  assert.equal(f.git(['rev-list', '--count', 'HEAD']), '2');
  assert.deepEqual(gh.calls, []);
});

// protects=gitpane.ts ship: clean tree skips commit/message validation and returns the existing PR.
test('clean already-pushed branch reuses its PR without a commit or create', async t => {
  const f = fixture(t);
  f.git(['push', '--set-upstream', 'origin', f.branch]);
  const gh = fakeGh(prUrl);
  assert.deepEqual(await ship(f.run, gh.run, ''), { commit: undefined, url: prUrl });
  assert.equal(f.git(['rev-parse', 'HEAD']), f.base);
  assert.equal(f.remote(['rev-parse', `refs/heads/${f.branch}`]), f.base);
  assert.ok(!f.calls.some(args => ['add', 'commit'].includes(args[0])));
  assert.deepEqual(gh.calls, [['pr', 'view', f.branch, '--json', 'url']]);
});

// protects=gitpane.ts ship: PR creation failure names the step and uses only stderr's first line.
test('gh create failure reports open PR failed and the first stderr line', async t => {
  const f = fixture(t);
  const gh = fakeGh('', 'permission denied\nprivate diagnostic\n');
  await assert.rejects(ship(f.run, gh.run, 'open PR'), { message: 'open PR failed: permission denied' });
  assert.equal(f.remote(['rev-parse', `refs/heads/${f.branch}`]), f.base);
  assert.equal(gh.calls.length, 2);
  assert.equal(gh.calls[1][1], 'create');
});

// protects=gitpane.ts ship: detached HEAD is refused before commit, push and gh.
test('detached HEAD reports no branch is checked out', async t => {
  const f = fixture(t);
  f.git(['checkout', '--detach', 'HEAD']);
  const before = f.remote(['show-ref']);
  const gh = fakeGh();
  await assert.rejects(ship(f.run, gh.run, 'detached'), { message: 'push failed: no branch is checked out' });
  assert.equal(f.remote(['show-ref']), before);
  assert.ok(!f.calls.some(args => ['commit', 'push'].includes(args[0])));
  assert.deepEqual(gh.calls, []);
});

// protects=gitpane.ts ship body: no --force variant, -f push flag or + refspec can be introduced (F18d).
test('source guard: ship contains no force push flags or positive refspec', () => {
  const source = fs.readFileSync(new URL('../src/gitpane.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function ship(');
  assert.ok(start >= 0, 'ship declaration must exist');
  const body = source.slice(start).match(/^[^{]*\{[^]*?^\}/m)?.[0];
  assert.ok(body, 'ship body must be found');
  assert.doesNotMatch(body, /--force/);
  assert.doesNotMatch(body, /(['"`])-f\1/);
  assert.doesNotMatch(body, /(['"`])\+[^'"`]*\1/);
});

// Evaluate the actual registration with injected dependencies; never import Electron's main module.
function ipcHarness(options: { demo?: boolean; failure?: Error } = {}) {
  const source = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const registration = source.match(/  on\('git', async[^]*?\n  \}\);/)?.[0];
  assert.ok(registration, 'git IPC registration must exist');
  let handler: (project: unknown, op: unknown, arg: unknown) => Promise<any>;
  const cwd = path.join(os.tmpdir(), 'm8-f18-ipc-injected-only');
  const git: Run = async () => { throw new Error('unexpected git invocation'); };
  const calls: Array<{ git: Run; message: string }> = [];
  const executions: Array<{ file: string; args: string[]; options: any }> = [];
  const gitViews = new Map([[cwd, 'cached view']]);
  const refreshed: string[] = [];
  const deps = {
    on: (name: string, callback: typeof handler) => { assert.equal(name, 'git'); handler = callback; },
    db: () => ({ prepare: () => ({ get: () => ({ path: cwd }) }) }),
    runIn: (dir: string) => { assert.equal(dir, cwd); return git; },
    demo: options.demo ?? false,
    ship: async (actualGit: Run, gh: (args: string[]) => Promise<string>, message: string) => {
      calls.push({ git: actualGit, message });
      // This exercises main.ts's gh adapter without spawning any process.
      const url = await gh(['pr', 'view', 'feature/ship', '--json', 'url']);
      return { commit: 'abc1234', url };
    },
    execFile: (file: string, args: string[], opts: unknown, done: Function) => {
      executions.push({ file, args, options: opts });
      done(options.failure ?? null, prUrl, 'first stderr line\nsecond stderr line');
    },
    gitAct: () => { throw new Error('ship must not dispatch through gitAct'); },
    gitViews,
    viewOf: async (dir: string) => { refreshed.push(dir); return { branch: 'feature/ship', changes: [] }; },
    repoOfAsync: async () => null,
  };
  new Function(...Object.keys(deps), stripTypeScriptTypes(registration))(...Object.values(deps));
  return { call: (arg: unknown) => handler('project', 'ship', arg), cwd, git, calls, executions, gitViews, refreshed };
}

// protects=main.ts git ship op: dispatch to ship, pass message/runner, return commit/url, invalidate and refresh view.
test('git IPC ship returns commit and URL and refreshes the Git view', async () => {
  const h = ipcHarness();
  const result = await h.call('feat: through IPC');
  assert.equal(result.commit, 'abc1234');
  assert.equal(result.url, prUrl);
  assert.equal(result.error, undefined);
  assert.equal(result.branch, 'feature/ship');
  assert.deepEqual(h.calls, [{ git: h.git, message: 'feat: through IPC' }]);
  assert.deepEqual(h.executions, [{ file: 'gh', args: ['pr', 'view', 'feature/ship', '--json', 'url'],
    options: { cwd: h.cwd, encoding: 'utf8', windowsHide: true, timeout: 60000 } }]);
  assert.equal(h.gitViews.has(h.cwd), false);
  assert.deepEqual(h.refreshed, [h.cwd]);
});

// protects=main.ts git ship op: non-string IPC arguments are normalized to an empty message.
test('git IPC ship normalizes non-string message arguments', async () => {
  const h = ipcHarness();
  await h.call({ message: 'not a string' });
  assert.equal(h.calls[0].message, '');
});

// protects=main.ts git ship op: demo refuses shipping before invoking ship/gh while still refreshing.
test('git IPC ship is disabled in the demo', async () => {
  const h = ipcHarness({ demo: true });
  const result = await h.call('demo');
  assert.equal(result.error, 'Commit, push, open PR is off in the demo');
  assert.equal(result.commit, undefined);
  assert.equal(result.url, undefined);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(h.executions, []);
  assert.equal(h.gitViews.has(h.cwd), false);
  assert.deepEqual(h.refreshed, [h.cwd]);
});

// protects=main.ts git ship op: missing gh gets an actionable error and still invalidates/refreshes the view.
test('git IPC ship reports missing gh without a real CLI invocation', async () => {
  const h = ipcHarness({ failure: new Error('spawn gh ENOENT') });
  const result = await h.call('message');
  assert.equal(result.error, 'GitHub CLI (gh) is not installed or not on PATH');
  assert.equal(result.url, undefined);
  assert.equal(h.gitViews.has(h.cwd), false);
  assert.deepEqual(h.refreshed, [h.cwd]);
});
