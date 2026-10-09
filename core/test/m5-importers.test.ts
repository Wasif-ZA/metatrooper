import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { importClaude } from '../src/plugins/importers.ts';

const FAKE_GITHUB_TOKEN = 'ghp_FAKE_fixture_token_123';

function fixture(pluginName: string, mcp: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), `m5-import-${pluginName}-`));
  const pluginDir = join(root, pluginName);
  const metadata = join(pluginDir, '.claude-plugin');
  mkdirSync(metadata, { recursive: true });
  writeFileSync(join(metadata, 'plugin.json'), JSON.stringify({ name: pluginName, version: '1.0.0', description: 'fixture' }));
  writeFileSync(join(pluginDir, '.mcp.json'), JSON.stringify(mcp));
  return { root, pluginDir };
}

test('M5-13a imports Linear streamable-http fixture as engine OAuth', () => {
  const f = fixture('linear', { mcpServers: { linear: { type: 'streamable-http', url: 'https://mcp.linear.app/mcp' } } });
  try {
    const plan = importClaude(f.pluginDir);
    assert.deepEqual(plan.errors, []);
    assert.equal(plan.manifest.mcp?.length, 1);
    assert.deepEqual(plan.manifest.mcp?.[0], {
      id: 'linear', transport: 'http', url: 'https://mcp.linear.app/mcp', auth: 'engine-oauth', writes: 'external', engines: ['claude'],
    });
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('M5-13 rejects an insecure http MCP URL and names its server in the plan error', () => {
  const f = fixture('insecure-mcp', { mcpServers: { insecure_server: { type: 'http', url: 'http://127.0.0.1:43210/mcp' } } });
  try {
    const plan = importClaude(f.pluginDir);
    assert.deepEqual(plan.manifest.mcp ?? [], []);
    assert.ok(plan.errors.some((error) => error.includes('insecure_server')), `expected error naming insecure_server, got ${JSON.stringify(plan.errors)}`);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('M5-13b imports GitHub fixture secret template without persisting a literal token', () => {
  const f = fixture('github', { mcpServers: { github: {
    type: 'http', url: 'https://api.githubcopilot.com/mcp/',
    headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' },
  } } });
  try {
    const plan = importClaude(f.pluginDir);
    assert.ok(plan.manifest.permissions?.includes('secrets:GITHUB_PERSONAL_ACCESS_TOKEN'));
    assert.deepEqual(plan.manifest.mcp?.[0]?.headers, { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' });
    assert.ok(!JSON.stringify(plan).includes(FAKE_GITHUB_TOKEN));
    const storedShape = JSON.stringify({ manifest: plan.manifest, env: plan.env, errors: plan.errors });
    assert.ok(!storedShape.includes(FAKE_GITHUB_TOKEN));
    assert.equal(readFileSync(join(f.pluginDir, '.mcp.json'), 'utf8').includes(FAKE_GITHUB_TOKEN), false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
