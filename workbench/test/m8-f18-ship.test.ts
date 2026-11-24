import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { ship, runIn, gitAct, type Run } from '../src/gitpane.ts';

const prUrl = 'https://example.invalid/pull/18';

function fixture(t: TestContext, defaultBranch = 'main') {
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
  at(root, ['init', '--bare', `--initial-branch=${defaultBranch}`, origin]);
  at(origin, ['symbolic-ref', 'HEAD', `refs/heads/${defaultBranch}`]);
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
  git(['push', '--set-upstream', 'origin', defaultBranch]);
  git(['remote', 'set-head', 'origin', defaultBranch]);
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
    if (args[0] === 'pr' && args[1] === 'list') {
      return JSON.stringify(existing ? [{ url: existing }] : []);
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
  f.git(['add', 'first.txt']);
  const gh = fakeGh();
  const before = f.remote(['show-ref']);
  for (const message of ['', ' \t\r\n ']) {
    await assert.rejects(ship(f.run, gh.run, message), {
      message: 'commit failed: write a commit message first',
    });
  }
  assert.equal(f.git(['rev-parse', 'HEAD']), f.base);
  assert.equal(f.remote(['show-ref']), before);
  assert.equal(f.git(['diff', '--cached', '--name-only']), 'first.txt');
  assert.ok(!f.calls.some(args => ['add', 'commit', 'push'].includes(args[0])));
  assert.deepEqual(gh.calls, []);
});

// protects=gitpane.ts ship: add -A fallback, commit stdin, upstream push, explicit PR head/title/body and result.
// The former add -A fallback is forbidden; shipping requires an explicit staged selection.
test('ship commits explicitly staged changes and opens a PR', async t => {
  const f = fixture(t);
  f.write('first.txt', 'changed\n');
  f.write('untracked file.txt', 'new\n');
  fs.unlinkSync(path.join(f.local, 'deleted.txt'));
  f.git(['add', '-A']);
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
    ['pr', 'list', '--state', 'open', `--head=${f.branch}`, '--limit', '1', '--json', 'url'],
    ['pr', 'create', `--head=${f.branch}`, '--title', 'feat: ship everything', '--body', 'Body line one\nBody line two'],
  ]);
});

// protects=gitpane.ts ship: preserve an existing staged selection instead of always adding -A.
test('ship commits only staged files and leaves the second file unstaged', async t => {
  const f = fixture(t);
  f.write('first.txt', 'staged\n');
  f.git(['add', 'first.txt']);
  f.write('first.txt', 'later unstaged edit\n');
  f.write('second.txt', 'unstaged\n');
  await ship(f.run, fakeGh().run, 'selected change');
  assert.equal(f.git(['show', 'HEAD:first.txt']), 'staged');
  assert.equal(f.git(['show', 'HEAD:second.txt']), 'second');
  assert.equal(fs.readFileSync(path.join(f.local, 'second.txt'), 'utf8'), 'unstaged\n');
  assert.equal(fs.readFileSync(path.join(f.local, 'first.txt'), 'utf8'), 'later unstaged edit\n');
  assert.deepEqual(f.git(['diff', '--name-only']).split('\n').sort(), ['first.txt', 'second.txt']);
  assert.equal(f.git(['diff', '--cached', '--name-only']), '');
  assert.ok(!f.calls.some(args => args[0] === 'add'));
});

test('dirty tree with nothing staged refuses without a commit, push or PR', async t => {
  const f = fixture(t);
  f.write('first.txt', 'unstaged\n');
  f.write('untracked.txt', 'untracked\n');
  fs.unlinkSync(path.join(f.local, 'deleted.txt'));
  const before = f.git(['status', '--porcelain']);
  const remoteBefore = f.remote(['show-ref']);
  const gh = fakeGh();
  await assert.rejects(ship(f.run, gh.run, 'do not stage everything'), {
    message: 'commit failed: nothing is staged; stage the files to ship first',
  });
  assert.equal(f.git(['rev-parse', 'HEAD']), f.base);
  assert.equal(f.git(['rev-list', '--count', 'HEAD']), '1');
  assert.equal(f.git(['status', '--porcelain']), before);
  assert.equal(f.git(['diff', '--cached', '--name-only']), '');
  assert.equal(f.remote(['show-ref']), remoteBefore);
  assert.ok(!f.calls.some(args => ['add', 'commit', 'push'].includes(args[0])));
  assert.deepEqual(gh.calls, []);
});

test('missing origin/HEAD discovers remote trunk and ships a feature branch', async t => {
  const f = fixture(t, 'trunk');
  f.git(['remote', 'set-head', 'origin', '--delete']);
  assert.throws(() => f.git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']));
  const gh = fakeGh();
  assert.deepEqual(await ship(f.run, gh.run, 'feature on trunk'), { commit: undefined, url: prUrl });
  assert.ok(f.calls.some(args => JSON.stringify(args) === JSON.stringify(['ls-remote', '--symref', 'origin', 'HEAD'])));
  assert.equal(f.remote(['rev-parse', `refs/heads/${f.branch}`]), f.base);
  assert.equal(f.remote(['rev-parse', 'refs/heads/trunk']), f.base);
});

test('unknown remote default refuses before commit, push or PR', async t => {
  const f = fixture(t);
  f.write('first.txt', 'staged but unsafe to ship\n');
  f.git(['add', 'first.txt']);
  const calls: string[][] = [];
  const unavailableDefault: Run = async (args, input, options) => {
    calls.push([...args]);
    if (args[0] === 'symbolic-ref' || args[0] === 'ls-remote') throw new Error('default unavailable');
    return f.run(args, input, options);
  };
  const gh = fakeGh();
  const before = f.remote(['show-ref']);
  await assert.rejects(ship(unavailableDefault, gh.run, 'unsafe default'), /push failed: cannot tell the default branch/);
  assert.deepEqual(calls, [
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'],
    ['ls-remote', '--symref', 'origin', 'HEAD'],
  ]);
  assert.equal(f.git(['rev-parse', 'HEAD']), f.base);
  assert.equal(f.git(['diff', '--cached', '--name-only']), 'first.txt');
  assert.equal(f.remote(['show-ref']), before);
  assert.deepEqual(gh.calls, []);
});

function assertSafePush(calls: string[][], branch: string) {
  const pushes = calls.filter(args => args[0] === 'push');
  assert.equal(pushes.length, 1);
  const args = pushes[0];
  const refspec = `refs/heads/${branch}:refs/heads/${branch}`;
  assert.deepEqual(args, ['push', '--set-upstream', 'origin', '--end-of-options', refspec]);
  assert.ok(args.indexOf('--end-of-options') < args.indexOf(refspec));
  assert.ok(!args.some(arg => arg.startsWith('--force') || arg === '-f' || arg.startsWith('+')));
}

test('push puts --end-of-options before a fully qualified non-forcing refspec', async t => {
  const f = fixture(t);
  await ship(f.run, fakeGh().run, 'safe push');
  assertSafePush(f.calls, f.branch);
  assert.equal(f.remote(['rev-parse', `refs/heads/${f.branch}`]), f.base);
});

test('literal +main branch cannot force-update origin main', async t => {
  const f = fixture(t);
  let allowed = false;
  try {
    assert.equal(f.git(['check-ref-format', '--branch', '+main']), '+main');
    allowed = true;
  } catch (error) {
    // Only a real Git rejection selects the argument-recording fallback.
    assert.equal((error as { status?: number }).status, 128);
  }
  const mainBefore = f.remote(['rev-parse', 'refs/heads/main']);
  if (allowed) {
    f.git(['checkout', '-b', '+main']);
    f.write('first.txt', 'feature must not replace main\n');
    f.git(['add', 'first.txt']);
    await ship(f.run, fakeGh().run, 'literal plus branch');
    assert.notEqual(f.git(['rev-parse', 'HEAD']), mainBefore);
    assert.equal(f.remote(['rev-parse', 'refs/heads/+main']), f.git(['rev-parse', 'HEAD']));
    assertSafePush(f.calls, '+main');
  } else {
    const calls: string[][] = [];
    const plusBranch: Run = async (args, input, options) => {
      calls.push([...args]);
      if (args[0] === 'rev-parse' && args[1] === '--abbrev-ref') return '+main\n';
      if (args[0] === 'push') return '';
      return f.run(args, input, options);
    };
    await ship(plusBranch, fakeGh().run, 'literal plus branch');
    assertSafePush(calls, '+main');
  }
  assert.equal(f.remote(['rev-parse', 'refs/heads/main']), mainBefore);
});

test('closed PR is excluded by open-only list and a new PR is created', async t => {
  const f = fixture(t);
  // No open PR remains for this branch: gh list returns [], even if a closed PR exists.
  const gh = fakeGh();
  assert.deepEqual(await ship(f.run, gh.run, ''), { commit: undefined, url: prUrl });
  assert.deepEqual(gh.calls, [
    ['pr', 'list', '--state', 'open', `--head=${f.branch}`, '--limit', '1', '--json', 'url'],
    ['pr', 'create', `--head=${f.branch}`, '--fill'],
  ]);
});

for (const mode of ['origin/HEAD', 'fallback main', 'fallback master', 'fallback trunk', 'case MAIN']) {
  // protects=gitpane.ts ship: refuse origin/HEAD and main/master fallback before side effects (F18d).
  // Fallback now discovers the remote default with ls-remote, including nonstandard names.
  test(`F18d refuses default branch: ${mode}`, async t => {
    const defaultBranch = mode === 'fallback master' ? 'master' : mode === 'fallback trunk' ? 'trunk' : 'main';
    const f = fixture(t, defaultBranch);
    f.git(['checkout', defaultBranch]);
    if (mode !== 'origin/HEAD') f.git(['remote', 'set-head', 'origin', '--delete']);
    if (mode === 'case MAIN') f.git(['branch', '-M', 'MAIN']);
    f.write('first.txt', 'must stay local\n');
    const gh = fakeGh();
    const before = f.remote(['show-ref']);
    await assert.rejects(ship(f.run, gh.run, 'do not ship'), /^Error: push failed: .*default branch/);
    if (mode !== 'origin/HEAD') {
      assert.ok(f.calls.some(args => JSON.stringify(args) === JSON.stringify(['ls-remote', '--symref', 'origin', 'HEAD'])));
    }
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
  f.git(['add', 'local.txt']);
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
  assert.deepEqual(gh.calls, [['pr', 'list', '--state', 'open', `--head=${f.branch}`, '--limit', '1', '--json', 'url']]);
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
      // Mirror ship's gh error reporting so the IPC adapter must supply stderr.
      const url = await gh(['pr', 'list', '--state', 'open', '--head=feature/ship', '--limit', '1', '--json', 'url']).catch((error: Error & { stderr?: string }) => {
        throw new Error(`open PR failed: ${error.stderr || error.message}`);
      });
      return { commit: 'abc1234', url };
    },
    execFile: (file: string, args: string[], opts: unknown, done: Function) => {
      executions.push({ file, args, options: opts });
      done(options.failure ?? null, prUrl, 'first stderr line\nsecond stderr line');
    },
    gitAct,
    gitViews,
    viewOf: async (dir: string) => { refreshed.push(dir); return { branch: 'feature/ship', changes: [] }; },
    repoOfAsync: async () => null,
  };
  new Function(...Object.keys(deps), stripTypeScriptTypes(registration))(...Object.values(deps));
  return { call: (arg: unknown) => handler('project', 'ship', arg), cwd, git, calls, executions, gitViews, refreshed };
}

// protects=main.ts git ship op: dispatch, results, gh execution and view refresh.
test('git IPC ship dispatches the runner and message, returns commit and URL, and refreshes', async () => {
  const h = ipcHarness();
  const result = await h.call('feat: through IPC');
  assert.equal(result.error, undefined);
  assert.equal(result.commit, 'abc1234');
  assert.equal(result.url, prUrl);
  assert.equal(result.branch, 'feature/ship');
  assert.deepEqual(h.calls, [{ git: h.git, message: 'feat: through IPC' }]);
  assert.deepEqual(h.executions, [{
    file: 'gh',
    args: ['pr', 'list', '--state', 'open', '--head=feature/ship', '--limit', '1', '--json', 'url'],
    options: { cwd: h.cwd, encoding: 'utf8', windowsHide: true, timeout: 60000 },
  }]);
  assert.equal(h.gitViews.has(h.cwd), false);
  assert.deepEqual(h.refreshed, [h.cwd]);
});

test('git IPC ship normalizes a non-string message to an empty string', async () => {
  const h = ipcHarness();
  const result = await h.call({ message: 'not a string' });
  assert.equal(result.error, undefined);
  assert.deepEqual(h.calls, [{ git: h.git, message: '' }]);
  assert.equal(result.url, prUrl);
});

test('git IPC ship refuses the demo before ship or gh and still refreshes', async () => {
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

test('git IPC ship reports missing gh with installation guidance and still refreshes', async () => {
  const h = ipcHarness({ failure: new Error('spawn gh ENOENT') });
  const result = await h.call('message');
  assert.equal(result.error, 'open PR failed: GitHub CLI (gh) is not installed or not on PATH');
  assert.equal(result.commit, undefined);
  assert.equal(result.url, undefined);
  assert.deepEqual(h.calls, [{ git: h.git, message: 'message' }]);
  assert.equal(h.executions.length, 1);
  assert.equal(h.executions[0].file, 'gh');
  assert.equal(h.gitViews.has(h.cwd), false);
  assert.deepEqual(h.refreshed, [h.cwd]);
});

// Read production JSX without importing the editor or starting Electron. Evaluate
// the real component and callbacks; only UI controls and external effects are stubs.
const requireUI = createRequire(new URL('../ui/package.json', import.meta.url));
const { transformSync } = requireUI('esbuild');
function reviewHarness(realShip = false) {
  const source = fs.readFileSync(new URL('../ui/src/ide.jsx', import.meta.url), 'utf8');
  const fragment = (name: string) => {
    const body = source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?^\\}`, 'm'))?.[0];
    assert.ok(body, `${name} must exist in ide.jsx`);
    return body;
  };
  const calls: any[][] = [];
  const deps = {
    h: (type: any, props: any, ...children: any[]) => ({ type, props: props || {}, children }),
    Button: 'Button', Verdict: 'Verdict',
    ui: { snap: { sessions: [] } }, ownerOf: () => null,
    statusLetter: (index: string, worktree: string, staged: boolean) => staged ? index : worktree,
    bump: () => calls.push(['bump']), toast: (...args: any[]) => calls.push(['toast', ...args]),
    api: { git: async (...args: any[]) => { calls.push(['git', ...args]); return { url: prUrl }; } },
    loadGitStatus: async () => { calls.push(['loadGitStatus']); },
    ...(realShip ? {} : { gitShip: (st: any) => { calls.push(['gitShip', st]); } }),
  };
  const code = [fragment('gitFiles'), ...(realShip ? [fragment('gitShip')] : []), fragment('ReviewHeader')].join('\n');
  const compiled = transformSync(code, { loader: 'jsx', jsxFactory: 'h', format: 'cjs' }).code;
  const ReviewHeader = new Function(...Object.keys(deps), compiled + '\nreturn ReviewHeader;')(...Object.values(deps));
  const st = { pid: 'project-18', git: { branch: 'feature/ship', files: [] as any[] }, commitMsg: '', shipping: false, committing: false, side: 'files' };
  const render = () => ReviewHeader({ st, tab: { path: 'first.txt', gitDiff: true } });
  const nodes = (node: any): any[] => node && typeof node === 'object' ? [node, ...(node.children || []).flatMap(nodes)] : [];
  const button = () => {
    const root = render();
    assert.equal(root.props['data-part'], 'shipbar');
    const found = nodes(root).find(n => n.type === 'Button');
    assert.ok(found, 'ReviewHeader renders its ship button');
    return found.props;
  };
  return { st, calls, render, nodes, button };
}

test('ReviewHeader disables shipping when changes are unstaged and nothing is staged', () => {
  const h = reviewHarness();
  h.st.git.files = [{ path: 'first.txt', index: '.', worktree: 'M' }];
  assert.equal(h.button().isDisabled, true);
  h.st.git.files[0].index = 'M';
  assert.equal(h.button().isDisabled, false);
});

test('ReviewHeader ships through api.git with the project and trimmed message', async () => {
  const h = reviewHarness(true);
  h.st.git.files = [{ path: 'first.txt', index: 'M', worktree: '.' }];
  h.st.commitMsg = '  feat: review header  ';
  assert.equal(h.button().isDisabled, false);
  h.button().onClick();
  // gitShip awaits the API stub; let its continuation finish without timers.
  await Promise.resolve();
  assert.deepEqual(h.calls.filter(c => c[0] === 'git'), [['git', 'project-18', 'ship', 'feat: review header']]);
  assert.equal(h.st.shipping, false);
  assert.equal(h.st.commitMsg, '');
  assert.ok(h.calls.some(c => c[0] === 'loadGitStatus'));
});

test('ReviewHeader with staged files and an empty message does not call gitShip', () => {
  const h = reviewHarness();
  h.st.git.files = [{ path: 'first.txt', index: 'M', worktree: '.' }];
  for (const message of ['', '   ']) {
    h.st.commitMsg = message;
    h.button().onClick();
  }
  assert.equal(h.st.side, 'changes');
  assert.equal(h.calls.filter(c => c[0] === 'gitShip').length, 0);
  assert.equal(h.calls.filter(c => c[0] === 'toast' && c[1] === 'Write a commit message in Source Control first.' && c[2] === true).length, 2);
  // Positive control: the same callback can reach the ship stub with a message.
  h.st.commitMsg = 'selected change';
  h.button().onClick();
  assert.equal(h.calls.filter(c => c[0] === 'gitShip').length, 1);
});

test('ReviewHeader checks row says no check has run when no agent owns the file', () => {
  const h = reviewHarness();
  const row = h.nodes(h.render()).find(n => n.props.className === 'ou-ide-shipck');
  assert.ok(row, 'checks row exists');
  assert.ok(h.nodes(row).some(n => n.type === 'span' && n.children.includes('No check has run on these files.')));
  assert.equal(h.nodes(row).some(n => n.type === 'Verdict'), false);
});
