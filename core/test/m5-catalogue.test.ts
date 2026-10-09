import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importMarketplace, importRegistry } from '../src/plugins/importers.ts';
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
