import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dockerArgv, gitLayout, mapPath, containerName } from '../src/sandbox/launch.ts';
import { runSelftest } from '../src/sandbox/selftest.ts';
import { BUILT_IN } from '../src/engines/registry.ts';
import { withEnv } from './helpers.ts';

const checks = [
  ['write a host path outside the mounts', 'blocked'], ['write the image filesystem', 'blocked'],
  ['write .git/hooks', 'blocked'], ['write .git/config', 'blocked'], ['write the worktree .git pointer', 'blocked'],
  ['read the host home folder', 'blocked'], ['write a read-only login file', 'blocked'],
  ['HTTPS to a host not on the allow-list', 'blocked'], ['a request that bypasses the proxy', 'blocked'],
  ['reach the Docker socket', 'blocked'], ['gain root', 'blocked'], ['write in the worktree', 'allowed'],
  ['git commit on the worktree branch', 'allowed'], ['HTTPS to an allow-listed host', 'allowed'],
] as const;

test('sandbox selftest enforces all container boundaries', { skip: process.env.METATROOPER_DOCKER_E2E === '1' ? false : 'set METATROOPER_DOCKER_E2E=1 to run Docker sandbox tests' }, () => {
  const result = runSelftest(BUILT_IN);
  assert.equal(result.ok, true, result.error ?? JSON.stringify(result.results));
  assert.deepEqual(result.results.map(({ name, expect }) => [name, expect]).sort(), checks.map(x => [...x]).sort());
  for (const [name, expected] of checks) {
    const row = result.results.find(x => x.name === name);
    assert.ok(row, `missing selftest check: ${name}`);
    assert.equal(row.expect, expected, `${name} expectation`);
    assert.equal(row.ok, true, `${name}: ${row.detail}`);
  }
});

test('sandbox launch maps paths and names containers from the last eight id characters', () => {
  assert.equal(mapPath('C:\\a\\b'), '/host/c/a/b');
  assert.equal(containerName('session-0123456789'), 'troop-23456789');
});

test('gitLayout refuses missing pointers, external gitdirs, and mismatched back-pointers', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-layout-'));
  try {
    const missing = path.join(base, 'missing');
    fs.mkdirSync(missing);
    assert.match('refusal' in gitLayout(missing) ? gitLayout(missing).refusal! : '', /no \.git file/);
    const worktree = path.join(base, 'wt');
    const common = path.join(base, 'repo.git');
    const gitdir = path.join(common, 'worktrees', 'wt');
    fs.mkdirSync(gitdir, { recursive: true });
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(gitdir, 'commondir'), '../..');
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${gitdir}`);
    fs.writeFileSync(path.join(gitdir, 'gitdir'), path.join(base, 'other', '.git'));
    assert.match('refusal' in gitLayout(worktree) ? gitLayout(worktree).refusal! : '', /does not point back/);
    const outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'commondir'), common);
    fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${outside}`);
    assert.match('refusal' in gitLayout(worktree) ? gitLayout(worktree).refusal! : '', /not inside/);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('dockerArgv locks host mounts and container privileges down', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-argv-'));
  const home = path.join(base, 'home');
  const credential = path.join(home, '.sandbox-test-login');
  try {
    fs.mkdirSync(home);
    fs.writeFileSync(credential, 'credential');
    const repo = path.join(base, 'repo');
    const worktree = path.join(base, 'wt');
    fs.mkdirSync(path.join(repo, 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'config'), '');
    fs.mkdirSync(worktree);
    fs.writeFileSync(path.join(worktree, '.git'), 'gitdir: elsewhere');
    const engine = { id: 'test', sandbox: { logins: [{ file: '~/.sandbox-test-login' }] } } as never;
    const argv = withEnv({ HOME: home, USERPROFILE: home }, () => dockerArgv('session-abcdefgh', engine, worktree, { gitdir: path.join(repo, 'worktrees', 'wt'), common: repo }, [], 'docker'));
    const mounts = argv.filter((x, i) => argv[i - 1] === '--mount');
    for (const target of [`target=${mapPath(path.join(repo, 'hooks'))},readonly`, `target=${mapPath(path.join(repo, 'config'))},readonly`, `target=${mapPath(path.join(worktree, '.git'))},readonly`, 'target=/troop/logins/.sandbox-test-login,readonly']) {
      assert.ok(mounts.some(m => m.includes(target)), `missing readonly mount ${target}`);
    }
    assert.ok(argv.includes('--cap-drop') && argv[argv.indexOf('--cap-drop') + 1] === 'ALL');
    assert.ok(argv.includes('--security-opt') && argv[argv.indexOf('--security-opt') + 1] === 'no-new-privileges');
    assert.ok(argv.includes('--read-only'));
    assert.ok(argv.includes('--network') && argv[argv.indexOf('--network') + 1] === 'troop-egress');
    assert.ok(argv.includes(`GIT_DIR=${mapPath(path.join(repo, 'worktrees', 'wt'))}`));
    assert.ok(argv.includes(`GIT_WORK_TREE=${mapPath(worktree)}`));
  } finally {
    fs.rmSync(credential, { force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
});
