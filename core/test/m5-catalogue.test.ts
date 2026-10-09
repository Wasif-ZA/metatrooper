import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importMarketplace, importRegistry, mapRegistryServer } from '../src/plugins/importers.ts';
import { root } from './helpers.ts';

const fixtures = join(root, 'tests', 'fixtures', 'catalogue');

test('M5-13c imports the saved Supabase registry response with exact package version and HTTP remote', () => {
  const plan = importRegistry('com.supabase/mcp', join(fixtures, 'registry-supabase.json'));
  assert.deepEqual(plan.errors, []);
  assert.deepEqual(plan.manifest.mcp?.map((server) => ({
    id: server.id,
    command: server.command,
    args: server.args,
    transport: server.transport,
    url: server.url,
    env_keys: server.env_keys,
  })), [
    {
      id: 'npm', command: 'npx',
      args: ['-y', '@supabase/mcp-server-supabase@0.13.0'],
      transport: undefined, url: undefined, env_keys: ['SUPABASE_ACCESS_TOKEN'],
    },
    { id: 'remote', command: undefined, args: undefined, transport: 'http', url: 'https://mcp.supabase.com/mcp', env_keys: undefined },
  ]);
  assert.equal(plan.origin?.version, '0.13.0');
  assert.ok(plan.manifest.mcp?.every((server) => !server.args?.some((arg) => /@latest(?:$|\s)/.test(arg))));

  const skipped = importRegistry('ai.openmayhem/openmayhem', join(fixtures, 'registry-mcpb-skipped.json'));
  assert.deepEqual(skipped.manifest.mcp?.map((server) => server.transport), ['http']);
  assert.ok(!skipped.manifest.mcp?.some((server) => server.command || server.args));
  assert.ok(skipped.skipped.some((line) => line.includes('mcpb') && line.includes('skipped')));
});

test('M5-13d refuses an unpinned marketplace source and checks out the listed SHA', () => {
  const dir = mkdtempSync(join(tmpdir(), 'troop-marketplace-fixture-'));
  const previousHome = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = join(dir, 'metatrooper-home');
  try {
    const repo = join(dir, 'market');
    mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
    mkdirSync(join(repo, 'plugin', '.claude-plugin'), { recursive: true });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' }).toString().trim();
    git('init', '-q');
    git('config', 'user.email', 'fixture@example.test');
    git('config', 'user.name', 'Fixture');
    writeFileSync(join(repo, '.claude-plugin', 'marketplace.json'), JSON.stringify({
      plugins: [{ name: 'fixture', version: '1.2.3', source: { source: 'git-subdir', url: repo, path: 'plugin', sha: 'TO_BE_PINNED' } }],
    }));
    writeFileSync(join(repo, 'plugin', 'troop-plugin.json'), JSON.stringify({
      schema: 1, id: 'fixture-plugin', version: '1.2.3', name: 'Fixture pinned',
    }));
    writeFileSync(join(repo, 'plugin', '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'Fixture pinned' }));
    git('add', '.');
    git('commit', '-qm', 'pinned fixture');
    const pinned = git('rev-parse', 'HEAD');
    const marketFile = join(repo, '.claude-plugin', 'marketplace.json');
    writeFileSync(marketFile, readFileSync(marketFile, 'utf8').replace('TO_BE_PINNED', pinned));
    git('add', '.');
    git('commit', '-qm', 'add listed pin');

    const plan = importMarketplace(repo);
    assert.equal(plan.origin?.sha, pinned);
    assert.equal(plan.origin?.version, '1.2.3');
    assert.equal(plan.manifest.name, 'Fixture pinned');
    assert.notEqual(git('rev-parse', 'HEAD'), pinned);

    const uppercase = importMarketplace(repo);
    assert.equal(uppercase.origin?.sha, pinned.toLowerCase());

    const unpinnedRepo = join(dir, 'unpinned');
    mkdirSync(join(unpinnedRepo, '.claude-plugin'), { recursive: true });
    writeFileSync(join(unpinnedRepo, '.claude-plugin', 'marketplace.json'), JSON.stringify({
      plugins: [{ name: 'unsafe', source: { source: 'git-subdir', url: repo, path: 'plugin' } }],
    }));
    const ugit = (...args: string[]) => execFileSync('git', args, { cwd: unpinnedRepo, stdio: 'pipe' });
    ugit('init', '-q');
    ugit('-c', 'user.email=f@example.test', '-c', 'user.name=F', 'add', '.');
    ugit('-c', 'user.email=f@example.test', '-c', 'user.name=F', 'commit', '-qm', 'unpinned');
    assert.throws(() => importMarketplace(unpinnedRepo), /no pinned sha listed/);
  } finally {
    if (previousHome === undefined) delete process.env.METATROOPER_HOME;
    else process.env.METATROOPER_HOME = previousHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

function gitRepo(dir: string): (...args: string[]) => string {
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' }).toString().trim();
  git('init', '-q');
  git('config', 'user.email', 'fixture@example.test');
  git('config', 'user.name', 'Fixture');
  return git;
}

test('M5-13e rejects remote-style marketplace URLs before git fetch while local absolute plugin paths work', () => {
  const dir = mkdtempSync(join(tmpdir(), 'troop-marketplace-urls-'));
  const previousHome = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = join(dir, 'home');
  try {
    const repo = join(dir, 'market');
    const git = gitRepo(repo);
    mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
    const malicious = join(dir, 'pwned');
    for (const url of ['ext::sh -c touch%20pwned', 'file:///etc', 'git@github.com:a/b.git']) {
      writeFileSync(join(repo, '.claude-plugin', 'marketplace.json'), JSON.stringify({
        plugins: [{ name: 'unsafe', source: { source: 'git-subdir', url, path: '.', sha: 'a'.repeat(40) } }],
      }));
      git('add', '.');
      git('commit', '-qm', `marketplace ${url}`);
      assert.throws(() => importMarketplace(repo), /only https/);
      assert.equal(existsSync(malicious), false);
    }

    const plugin = join(dir, 'local-plugin');
    mkdirSync(join(plugin, '.claude-plugin'), { recursive: true });
    writeFileSync(join(plugin, 'troop-plugin.json'), JSON.stringify({ schema: 1, id: 'local-source', version: '1.0.0', name: 'Local source' }));
    writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'Local source' }));
    writeFileSync(join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'Local source', mcpServers: { local: { command: 'local', args: [], engines: ['*'] } } }));
    gitRepo(plugin)('add', '.');
    execFileSync('git', ['-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', 'commit', '-qm', 'plugin'], { cwd: plugin, stdio: 'pipe' });
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: plugin, stdio: 'pipe' }).toString().trim();
    writeFileSync(join(repo, '.claude-plugin', 'marketplace.json'), JSON.stringify({
      plugins: [{ name: 'local', source: { source: 'url', url: plugin, sha } }],
    }));
    git('add', '.');
    git('commit', '-qm', 'local absolute source');
    assert.equal(importMarketplace(repo).manifest.id, 'claude-local-source');
  } finally {
    if (previousHome === undefined) delete process.env.METATROOPER_HOME;
    else process.env.METATROOPER_HOME = previousHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M5-13f local marketplaces require a clean git repository and reject non-git folders', () => {
  const dir = mkdtempSync(join(tmpdir(), 'troop-marketplace-clean-'));
  try {
    const repo = join(dir, 'market');
    const git = gitRepo(repo);
    mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
    writeFileSync(join(repo, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [] }));
    git('add', '.');
    git('commit', '-qm', 'clean marketplace');
    writeFileSync(join(repo, 'dirty.txt'), 'uncommitted');
    assert.throws(() => importMarketplace(repo), /uncommitted changes/);

    const plain = join(dir, 'plain');
    mkdirSync(join(plain, '.claude-plugin'), { recursive: true });
    writeFileSync(join(plain, '.claude-plugin', 'marketplace.json'), JSON.stringify({ plugins: [] }));
    assert.throws(() => importMarketplace(plain), /not a git repository/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M5-13g rejects a git-subdir symlink that resolves outside the checkout', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'troop-marketplace-symlink-'));
  const previousHome = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = join(dir, 'home');
  try {
    const repo = join(dir, 'market');
    const git = gitRepo(repo);
    const outside = join(dir, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'troop-plugin.json'), JSON.stringify({ schema: 1, id: 'outside', version: '1.0.0', name: 'Outside' }));
    mkdirSync(join(outside, '.claude-plugin'), { recursive: true });
    writeFileSync(join(outside, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'Outside' }));
    try { symlinkSync(outside, join(repo, 'escape'), 'junction'); }
    catch (error) {
      const e = error as NodeJS.ErrnoException;
      if (['EPERM', 'EACCES', 'ENOTSUP', 'UNKNOWN'].includes(e.code ?? '')) { t.skip(`Windows symlink/junction creation unavailable: ${e.code}`); return; }
      throw error;
    }
    mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
    writeFileSync(join(repo, '.claude-plugin', 'marketplace.json'), JSON.stringify({
      plugins: [{ name: 'escape', source: 'escape', sha: 'TO_BE_PINNED' }],
    }));
    git('add', '.');
    git('commit', '-qm', 'symlink source');
    const head = git('rev-parse', 'HEAD');
    writeFileSync(join(repo, '.claude-plugin', 'marketplace.json'), readFileSync(join(repo, '.claude-plugin', 'marketplace.json'), 'utf8').replace('TO_BE_PINNED', head));
    git('add', '.');
    git('commit', '-qm', 'pin symlink marketplace');
    assert.throws(() => importMarketplace(repo), /leaves the repository/);
  } finally {
    if (previousHome === undefined) delete process.env.METATROOPER_HOME;
    else process.env.METATROOPER_HOME = previousHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M5-13h registry package versions must be exact and identifiers must be package names', () => {
  for (const version of ['^1.2.0', 'latest']) {
    const plan = mapRegistryServer({
      name: 'example/server', version: '1.0.0', packages: [{ registryType: 'npm', identifier: 'example-server', version }],
    }, 'fixture');
    assert.ok(plan.skipped.some((line) => line.includes('no exact version')));
    assert.deepEqual(plan.manifest.mcp, []);
  }
  const bad = mapRegistryServer({
    name: 'example/server', version: '1.0.0', packages: [{ registryType: 'npm', identifier: '--registry=evil', version: '1.2.3' }],
  }, 'fixture');
  assert.ok(bad.errors.some((line) => line.includes('not a package name')));
});
