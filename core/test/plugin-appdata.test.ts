import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

const AT = '2026-11-15T00:00:00.000Z';

async function withDb(run: (db: DatabaseSync, home: string, tmp: string) => Promise<void> | void) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-appdata-'));
  const prev = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = path.join(tmp, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const db = openCoreDb();
  try {
    await run(db, process.env.METATROOPER_HOME, tmp);
  } finally {
    db.close();
    if (prev === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prev;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function addPlugin(db: DatabaseSync, dir: string, id: string, mcp: object[]) {
  const manifest = { schema: 1, id, version: '1.0.0', name: id, mcp };
  db.prepare("INSERT INTO plugin (id, enabled, manifest, path, source, permissions, version, installed_at) VALUES (?, 1, ?, ?, 'native', '[]', '1.0.0', ?)").run(id, JSON.stringify(manifest), dir, AT);
}

const engines = {
  claude: { id: 'claude', command: 'claude', version_cmd: ['claude'], state_source: 'hooks' as const, roles: ['worker'], cost_rank: 3, mcp_attach: { kind: 'claude-mcp-config-flag' } },
  codex: { id: 'codex', command: 'codex', version_cmd: ['codex'], state_source: 'notify' as const, roles: ['worker'], cost_rank: 2, mcp_attach: { kind: 'codex-config' } },
};

test('the manifest schema and the install screen accept writes: appdata', async () => {
  const { validateManifest, mcpWrites, installScreen } = await import('../src/plugins/manifest.ts');
  const m = { schema: 1, id: 'notes', version: '1.0.0', name: 'notes', mcp: [{ id: 's', command: 'node', args: ['x.mjs'], engines: ['claude'], writes: 'appdata' }] };
  assert.deepEqual(validateManifest(m, null), []);
  assert.equal(mcpWrites(m.mcp[0] as never), 'appdata');
  const screen = installScreen(m as never, null);
  assert.equal(screen.mcp_servers[0].writes, 'appdata');
});

test('an appdata server attaches to contained sessions on Claude and Codex; an external one does not', async () => {
  await withDb(async (db, home) => {
    addPlugin(db, home, 'notes', [
      { id: 'board', command: 'node', args: ['b.mjs'], engines: ['claude', 'codex'], writes: 'appdata' },
      { id: 'post', command: 'node', args: ['p.mjs'], engines: ['claude', 'codex'], writes: 'external' },
    ]);
    const { mcpAttachArgs } = await import('../src/plugins/mcp.ts');
    const claudeArgs = mcpAttachArgs(db, engines.claude, 'c1', false, { approval: 'contained' });
    const config = JSON.parse(fs.readFileSync(claudeArgs[0].slice('--mcp-config='.length), 'utf8'));
    assert.ok(config.mcpServers['notes-board'], Object.keys(config.mcpServers).join(', '));
    assert.ok(!config.mcpServers['notes-post']);
    const codexArgs = mcpAttachArgs(db, engines.codex, 'x1', false, { approval: 'contained' }).join(' ');
    assert.match(codexArgs, /mcp_servers\.notes-board\.command/);
    assert.doesNotMatch(codexArgs, /notes-post/);
    for (const ctx of [{ approval: 'isolated' }, { pipeline: true }]) {
      const again = mcpAttachArgs(db, engines.codex, 'x2', false, ctx).join(' ');
      assert.match(again, /notes-board/, `appdata still attaches with ${JSON.stringify(ctx)}`);
    }
  });
});

test('each plugin gets its own data folder under the cc home, handed to its servers as CC_PLUGIN_DATA, which a manifest cannot override', async () => {
  await withDb(async (db, home) => {
    addPlugin(db, home, 'alpha', [{ id: 's', command: 'node', args: ['a.mjs'], engines: ['claude'], writes: 'appdata', env: { CC_PLUGIN_DATA: path.join(home, 'plugin-data', 'beta') } }]);
    addPlugin(db, home, 'beta', [{ id: 's', command: 'node', args: ['b.mjs'], engines: ['claude'], writes: 'appdata' }]);
    const { resolveMcpServer } = await import('../src/plugins/mcp.ts');
    const a = resolveMcpServer(db, 'alpha', 's');
    const b = resolveMcpServer(db, 'beta', 's');
    assert.equal(a.env.CC_PLUGIN_DATA, path.join(home, 'plugin-data', 'alpha'), 'the manifest env cannot point alpha at beta');
    assert.equal(b.env.CC_PLUGIN_DATA, path.join(home, 'plugin-data', 'beta'));
    assert.ok(fs.statSync(a.env.CC_PLUGIN_DATA).isDirectory());
    assert.deepEqual(a.missing, []);
  });
});

test('a server without writes: appdata gets no data folder', async () => {
  await withDb(async (db, home) => {
    addPlugin(db, home, 'plain', [{ id: 's', command: 'node', args: ['a.mjs'], engines: ['claude'] }]);
    const { resolveMcpServer } = await import('../src/plugins/mcp.ts');
    assert.equal(resolveMcpServer(db, 'plain', 's').env.CC_PLUGIN_DATA, undefined);
    assert.ok(!fs.existsSync(path.join(home, 'plugin-data', 'plain')));
  });
});

test('a data folder redirected out of the cc home by a junction is refused, so the server does not start', async () => {
  await withDb(async (db, home, tmp) => {
    addPlugin(db, home, 'gamma', [{ id: 's', command: 'node', args: ['g.mjs'], engines: ['claude'], writes: 'appdata' }]);
    const outside = path.join(tmp, 'outside');
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(home, 'plugin-data'), { recursive: true });
    fs.symlinkSync(outside, path.join(home, 'plugin-data', 'gamma'), 'junction');
    const { resolveMcpServer } = await import('../src/plugins/mcp.ts');
    const r = resolveMcpServer(db, 'gamma', 's');
    assert.equal(r.env.CC_PLUGIN_DATA, undefined);
    assert.ok(r.missing.includes('CC_PLUGIN_DATA'), JSON.stringify(r.missing));
  });
});
