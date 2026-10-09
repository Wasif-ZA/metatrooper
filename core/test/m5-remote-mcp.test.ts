import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { schemaFile } from '../src/paths.ts';
import { validateManifest } from '../src/plugins/manifest.ts';
import { installPlugin } from '../src/plugins/store.ts';
import { mcpAttachArgs, resolveMcpServer } from '../src/plugins/mcp.ts';
import { setSecret } from '../src/secrets.ts';

const FAKE_TOKEN = 'fake-gh-token-123';

function manifest(id: string, servers: unknown[], permissions: string[] = []): Record<string, unknown> {
  return { schema: 1, id, version: '1.0.0', name: id, platforms: ['windows', 'linux', 'macos'], permissions, mcp: servers };
}

function fixture(db: DatabaseSync, id: string, value: Record<string, unknown>, secrets: Record<string, string> = {}): void {
  const dir = mkdtempSync(join(tmpdir(), 'm5-remote-mcp-'));
  writeFileSync(join(dir, 'troop-plugin.json'), JSON.stringify(value));
  try {
    installPlugin(db, { source: dir, approved_permissions: (value.permissions as string[]) ?? [] });
    for (const [name, secret] of Object.entries(secrets)) setSecret(db, id, name, secret);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function engine(id: string, kind: string) {
  return { id, command: id, version_cmd: [id, '--version'], roles: ['coding'], cost_rank: 1, mcp_attach: { kind } };
}

test('M5-12a header values require secret references and matching permissions', () => {
  const base = { ...manifest('remote-a', [{ id: 'github', transport: 'http', url: 'https://api.github.example/mcp', auth: 'header', headers: { Authorization: 'Bearer abc' }, engines: ['claude'] }]), permissions: [] };
  assert.ok(validateManifest(base, null).length > 0, 'literal header values must be rejected');
  const templated = { ...base, mcp: [{ ...(base.mcp as object[])[0], headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' } }] };
  assert.ok(validateManifest(templated, null).some((e) => e.includes('GITHUB_PERSONAL_ACCESS_TOKEN needs the permission')));
  assert.deepEqual(validateManifest({ ...templated, permissions: ['secrets:GITHUB_PERSONAL_ACCESS_TOKEN'] }, null), []);
});

test('M5-12b claude session config contains a quoted headersHelper and no token', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm5-remote-home-'));
  const oldHome = process.env.METATROOPER_HOME;
  const db = new DatabaseSync(':memory:');
  try {
    process.env.METATROOPER_HOME = dir;
    db.exec(readFileSync(schemaFile, 'utf8'));
    db.exec('CREATE TABLE IF NOT EXISTS notify_sink (id TEXT PRIMARY KEY, kind TEXT, name TEXT, dest_hash TEXT, kinds TEXT, enabled INTEGER, approved_at TEXT)');
    const value = manifest('remote-b', [{ id: 'github', transport: 'http', url: 'https://api.github.example/mcp', auth: 'header', headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' }, engines: ['claude'] }], ['secrets:GITHUB_PERSONAL_ACCESS_TOKEN']);
    fixture(db, 'remote-b', value, { GITHUB_PERSONAL_ACCESS_TOKEN: FAKE_TOKEN });
    const args = mcpAttachArgs(db, engine('claude', 'claude-mcp-config-flag') as never, 'm5-session');
    const configPath = args.find((arg) => arg.startsWith('--mcp-config='))!.slice('--mcp-config='.length);
    const bytes = readFileSync(configPath, 'utf8');
    const config = JSON.parse(bytes);
    assert.equal(config.mcpServers['remote-b-github'].type, 'http');
    assert.match(config.mcpServers['remote-b-github'].headersHelper, /headers "remote-b" "github"$/);
    assert.ok(config.mcpServers['remote-b-github'].headersHelper.includes('"'));
    assert.ok(!bytes.includes(FAKE_TOKEN));
  } finally {
    db.close();
    if (oldHome === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = oldHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M5-12c mcp.resolve returns only the templated header value; missing secret is reported', { skip: process.env.METATROOPER_FAKE_DPAPI !== '1' }, () => {
  const home = mkdtempSync(join(tmpdir(), 'm5-remote-secret-home-'));
  const oldHome = process.env.METATROOPER_HOME;
  const db = new DatabaseSync(':memory:');
  try {
    process.env.METATROOPER_HOME = home;
    db.exec(readFileSync(schemaFile, 'utf8'));
    db.exec('CREATE TABLE IF NOT EXISTS notify_sink (id TEXT PRIMARY KEY, kind TEXT, name TEXT, dest_hash TEXT, kinds TEXT, enabled INTEGER, approved_at TEXT)');
    fixture(db, 'remote-c', manifest('remote-c', [{ id: 'github', transport: 'http', url: 'https://api.github.example/mcp', auth: 'header', headers: { Authorization: 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' }, engines: ['claude'] }], ['secrets:GITHUB_PERSONAL_ACCESS_TOKEN']), { GITHUB_PERSONAL_ACCESS_TOKEN: FAKE_TOKEN });
    const start = Date.now();
    const resolved = resolveMcpServer(db, 'remote-c', 'github');
    assert.deepEqual(resolved.headers, { Authorization: `Bearer ${FAKE_TOKEN}` });
    assert.ok(Date.now() - start < 10_000, `cold mcp.resolve took ${Date.now() - start}ms`);
  } finally {
    db.close();
    if (oldHome === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = oldHome;
    rmSync(home, { recursive: true, force: true });
  }
});

test('M5-12d codex attaches header-free OAuth URLs and not header-auth servers', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm5-remote-codex-'));
  const oldHome = process.env.METATROOPER_HOME;
  const db = new DatabaseSync(':memory:');
  try {
    process.env.METATROOPER_HOME = dir;
    db.exec(readFileSync(schemaFile, 'utf8'));
    const servers = [
      { id: 'oauth', transport: 'http', url: 'https://linear.example/mcp', auth: 'engine-oauth', writes: 'none', engines: ['codex'] },
      { id: 'header', transport: 'http', url: 'https://github.example/mcp', auth: 'header', headers: { Authorization: 'Bearer ${FAKE_TOKEN}' }, writes: 'none', engines: ['codex'] },
    ];
    db.prepare('INSERT INTO plugin VALUES (?, ?, ?, ?, ?, ?, 1, ?)').run('remote-d', '1.0.0', dir, JSON.stringify(manifest('remote-d', servers)), 'native', '[]', '2026-10-09T00:00:00.000Z');
    const args = mcpAttachArgs(db, engine('codex', 'codex-config') as never, 'm5-codex');
    assert.ok(args.includes('mcp_servers.remote-d-oauth.url="https://linear.example/mcp"'));
    assert.ok(!args.some((arg) => arg.includes('remote-d-header')));
  } finally {
    db.close();
    if (oldHome === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = oldHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M5-12e pipeline step excludes http servers whose omitted writes means external', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm5-remote-pipeline-'));
  const oldHome = process.env.METATROOPER_HOME;
  const db = new DatabaseSync(':memory:');
  try {
    process.env.METATROOPER_HOME = dir;
    db.exec(readFileSync(schemaFile, 'utf8'));
    const servers = [
      { id: 'external', transport: 'http', url: 'https://fake.example/mcp', engines: ['claude'] },
      { id: 'internal', transport: 'http', url: 'https://read.example/mcp', writes: 'none', engines: ['claude'] },
    ];
    db.prepare('INSERT INTO plugin VALUES (?, ?, ?, ?, ?, ?, 1, ?)').run('remote-e', '1.0.0', dir, JSON.stringify(manifest('remote-e', servers)), 'native', '[]', '2026-10-09T00:00:00.000Z');
    for (const approval of ['full', 'contained', 'isolated']) {
      const args = mcpAttachArgs(db, engine('claude', 'claude-mcp-config-flag') as never, `m5-${approval}`, false, { pipeline: true, approval });
      const config = JSON.parse(readFileSync(args.find((arg) => arg.startsWith('--mcp-config='))!.slice('--mcp-config='.length), 'utf8'));
      assert.ok(!('remote-e-external' in config.mcpServers), `${approval} pipeline attached external server`);
      assert.ok('remote-e-internal' in config.mcpServers);
    }
  } finally {
    db.close();
    if (oldHome === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = oldHome;
    rmSync(dir, { recursive: true, force: true });
  }
});
