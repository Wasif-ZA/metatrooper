import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { validate } from '../src/jsonschema.ts';
import { BUILT_IN, bindRole, dataEngines, syncEngines, type EngineSpec } from '../src/engines/registry.ts';
import { mcpAttachArgs, mcpAttachEnv } from '../src/plugins/mcp.ts';
import { root } from './helpers.ts';

function tempDir(prefix: string): string { return mkdtempSync(join(tmpdir(), prefix)); }
function writeJson(file: string, value: unknown): void {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 2));
}

test('M5-14a/b built-in and OpenCode engine data validate and OpenCode wiring is pinned', () => {
  const schema = JSON.parse(readFileSync(join(root, 'contracts', 'plugin-manifest.schema.json'), 'utf8'));
  for (const engine of BUILT_IN) assert.deepEqual(validate({ $ref: '#/$defs/engine' }, engine, schema), [], engine.id);
  const opencode = JSON.parse(readFileSync(join(root, 'engines', 'opencode.json'), 'utf8')) as EngineSpec;
  assert.deepEqual(validate({ $ref: '#/$defs/engine' }, opencode, schema), []);
  assert.deepEqual(opencode.mcp_attach, { kind: 'env-json', env: 'OPENCODE_CONFIG_CONTENT', format: 'opencode-mcp' });
});

test('M5-14d data engines without cost override cannot outrank a built-in role engine', () => {
  const dir = tempDir('troop-engine-data-');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
    const builtIn = BUILT_IN.find((engine) => engine.roles.includes('review'))!;
    const plugin: EngineSpec = {
      id: 'plugin-reviewer', command: 'reviewer', version_cmd: ['reviewer', '--version'],
      state_source: 'process', roles: ['review'], cost_rank: 1,
    };
    writeJson(join(dir, 'plugin-reviewer.json'), plugin);
    const loadedPlugin = dataEngines(dir)[0];
    assert.equal(loadedPlugin.cost_rank, 5);
    syncEngines(db, [builtIn, loadedPlugin]);
    const check = db.prepare("INSERT INTO engine_check (engine_id, checked_at, installed, auth) VALUES (?, ?, 1, 'ok')");
    check.run(builtIn.id, '2026-10-09T12:00:00.000Z');
    check.run(loadedPlugin.id, '2026-10-09T12:00:00.000Z');
    assert.equal(bindRole(db, 'review')?.id, builtIn.id);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M5-14c env-json and config-dir expose shim commands only; launch leaves user OpenCode config byte-identical', () => {
  const dir = tempDir('troop-engine-attach-');
  const home = join(dir, 'home');
  const previousHome = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = home;
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
    writeJson(join(dir, 'plugin', 'troop-plugin.json'), {
      schema: 1, id: 'fixture-plugin', version: '1.0.0', name: 'Fixture', permissions: ['secrets:FIXTURE_TOKEN'],
      mcp: [{ id: 'server', command: 'real-server', args: ['--token', 'FIXTURE_SECRET_VALUE'], env_keys: ['FIXTURE_TOKEN'], engines: ['*'] }],
    });
    db.prepare(`INSERT INTO plugin (id, version, path, manifest, source, permissions, enabled, installed_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)`)
      .run('fixture-plugin', '1.0.0', join(dir, 'plugin'), JSON.stringify({
        schema: 1, id: 'fixture-plugin', version: '1.0.0', name: 'Fixture', permissions: ['secrets:FIXTURE_TOKEN'],
        mcp: [{ id: 'server', command: 'real-server', args: ['--token', 'FIXTURE_SECRET_VALUE'], env_keys: ['FIXTURE_TOKEN'], engines: ['*'] }],
      }), 'native', JSON.stringify(['secrets:FIXTURE_TOKEN']), '2026-10-09T12:00:00.000Z');

    const opencode = JSON.parse(readFileSync(join(root, 'engines', 'opencode.json'), 'utf8')) as EngineSpec;
    const before = Buffer.from('{"provider":"user config","untouched":true}\r\n', 'utf8');
    const config = join(home, 'opencode.json');
    mkdirSync(home, { recursive: true });
    writeFileSync(config, before);
    const env = mcpAttachEnv(db, opencode, 'opencode-session');
    const json = JSON.parse(env.OPENCODE_CONFIG_CONTENT) as { mcp: Record<string, { type: string; command?: string[] }> };
    assert.deepEqual(json.mcp['fixture-plugin-server'], {
      type: 'local', command: [process.execPath.replaceAll('\\', '/'), expectShim(), 'fixture-plugin', 'server'], enabled: true,
    });
    assert.ok(!JSON.stringify(env).includes('FIXTURE_SECRET_VALUE'));
    assert.ok(!JSON.stringify(env).includes('real-server'));
    assert.deepEqual(readFileSync(config), before);

    const configDirEngine: EngineSpec = {
      ...opencode, id: 'config-dir-fixture', mcp_attach: { kind: 'config-dir', env: 'FIXTURE_CONFIG_DIR', format: 'mcpServers' },
    };
    const configDirEnv = mcpAttachEnv(db, configDirEngine, 'config-dir-session');
    const configText = readFileSync(join(configDirEnv.FIXTURE_CONFIG_DIR, 'mcp-config.json'), 'utf8');
    const configJson = JSON.parse(configText) as { mcpServers: Record<string, { command: string; args: string[] }> };
    assert.deepEqual(configJson.mcpServers['fixture-plugin-server'], {
      command: process.execPath.replaceAll('\\', '/'), args: [expectShim(), 'fixture-plugin', 'server'],
    });
    assert.ok(!configText.includes('FIXTURE_SECRET_VALUE'));
    assert.ok(!configText.includes('real-server'));

    const argsEngine: EngineSpec = {
      ...opencode, id: 'args-template-fixture', mcp_attach: { kind: 'args-template', template: ['--mcp={node}:{shim}:{plugin}:{server}'] },
    };
    const args = mcpAttachArgs(db, argsEngine, 'args-session');
    assert.deepEqual(args, [`--mcp=${process.execPath.replaceAll('\\', '/')}:${expectShim()}:fixture-plugin:server`]);
    assert.ok(!JSON.stringify(args).includes('FIXTURE_SECRET_VALUE'));
  } finally {
    db.close();
    if (previousHome === undefined) delete process.env.METATROOPER_HOME;
    else process.env.METATROOPER_HOME = previousHome;
    rmSync(dir, { recursive: true, force: true });
  }
});

function expectShim(): string {
  return join(root, 'core', 'mcp-shim.js').replaceAll('\\', '/');
}
