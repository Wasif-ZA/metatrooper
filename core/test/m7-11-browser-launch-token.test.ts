import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { client, isolation, startCore, teardownCore, until } from './helpers.ts';

test('M7-11h launch stores a token hash and gives only browser sessions a token', async () => {
  const iso = isolation();
  const inherited = 'f'.repeat(64);
  iso.env.TROOP_BROWSER_TOKEN = inherited;
  const script = join(iso.home, 'engine.mjs');
  writeFileSync(script, `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(join(process.env.METATROOPER_HOME, process.env.TROOP_SESSION_ID + '.env.json'), JSON.stringify({ token: process.env.TROOP_BROWSER_TOKEN ?? null }));
setTimeout(() => process.exit(0), 1200);
`);
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{
    id: 'token-engine', command: process.execPath, args: [script], prompt_arg: 'positional',
    state_source: 'process', roles: ['worker'], cost_rank: 1, usage_source: 'none',
    provider: 'local-cli', version_cmd: [process.execPath, '--version'],
    mcp_attach: { kind: 'claude-mcp-config-flag' },
  }]));
  iso.env.METATROOPER_ENGINES = registry;
  const core = await startCore(iso);
  const pipe = await client(iso.prefix);
  const db = new DatabaseSync(join(iso.home, 'troop.db'), { readOnly: true });
  try {
    const project = join(iso.home, 'project');
    mkdirSync(project);
    const opened = await pipe.request('project.open', { path: project });
    assert.ok(opened.result?.project_id, JSON.stringify(opened));
    const launch = async (browser: boolean) => {
      const reply = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: 'token-engine', browser });
      assert.ok(reply.result?.session_id, JSON.stringify(reply));
      const id = reply.result.session_id as string;
      const envFile = join(iso.home, `${id}.env.json`);
      await until(() => existsSync(envFile), 8000);
      const env = JSON.parse(readFileSync(envFile, 'utf8')) as { token: string | null };
      const row = db.prepare('SELECT browser_token_hash FROM session WHERE id = ?').get(id) as { browser_token_hash: string | null };
      return { env, row };
    };
    const enabled = await launch(true);
    assert.match(enabled.env.token ?? '', /^[a-f0-9]{64}$/);
    assert.notEqual(enabled.env.token, inherited);
    assert.equal(enabled.row.browser_token_hash, createHash('sha256').update(enabled.env.token!).digest('hex'));
    const disabled = await launch(false);
    assert.equal(disabled.env.token, null);
    assert.equal(disabled.row.browser_token_hash, null);
  } finally {
    db.close();
    pipe.close();
    await teardownCore(core, iso);
  }
});
