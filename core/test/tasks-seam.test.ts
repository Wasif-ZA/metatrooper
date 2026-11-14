import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const AT = '2026-11-15T00:00:00.000Z';
const FORWARD = ['TROOP_SESSION_ID', 'METATROOPER_HOME', 'METATROOPER_PIPE_PREFIX'];

test('codex attach forwards the session id, home and pipe prefix to every stdio shim server, never to an http one', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-tasks-seam-'));
  const prev = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const db = openCoreDb();
  try {
    const manifest = { schema: 1, id: 'tasks', version: '1.0.0', name: 'tasks', mcp: [
      { id: 'tasks', command: 'node', args: ['x.mjs'], engines: ['codex'] },
      { id: 'web', transport: 'http', url: 'https://example.com/mcp', writes: 'none', engines: ['codex'] },
    ] };
    db.prepare("INSERT INTO plugin (id, enabled, manifest, path, source, permissions, version, installed_at) VALUES ('tasks', 1, ?, ?, 'native', '[]', '1.0.0', ?)").run(JSON.stringify(manifest), home, AT);
    const { mcpAttachArgs } = await import('../src/plugins/mcp.ts');
    const codex = { id: 'codex', command: 'codex', version_cmd: ['codex'], state_source: 'notify' as const, roles: ['worker'], cost_rank: 2, mcp_attach: { kind: 'codex-config' } };
    const args = mcpAttachArgs(db, codex, 's1');
    const values = (name: string) => args.filter((a, i) => args[i - 1] === '-c' && a.startsWith(`mcp_servers.${name}.`));
    for (const name of ['ouros-steps', 'ouros-ui', 'tasks-tasks']) {
      const env = values(name).find((a) => a.startsWith(`mcp_servers.${name}.env_vars=`));
      assert.ok(env, `${name} has no env_vars: ${JSON.stringify(values(name))}`);
      assert.deepEqual(JSON.parse(env.slice(env.indexOf('=') + 1)), FORWARD);
    }
    assert.ok(values('tasks-web').length, 'the http server still attaches');
    assert.ok(!values('tasks-web').some((a) => a.includes('env_vars')), 'an http server gets no env_vars');
  } finally {
    db.close();
    if (prev === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prev;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
