import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BUILT_IN, type EngineSpec } from '../src/engines/registry.ts';
import { buildGenerated, client, isolation, startCore, teardownCore, uiHello, until } from './helpers.ts';

// Exercise main.ts's autoDeps.followUp through the real pipe and monitor delivery,
// with a contained default that would loosen either parent's explicit approval.
test('real core monitor follow-ups preserve their parent approval', async t => {
  await buildGenerated();
  const isolated = isolation();
  let core: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    const trustedFile = join(isolated.home, 'trusted.json');
    const registry = join(isolated.home, 'engines.json');
    const script = join(isolated.home, 'followup-engine.mjs');
    writeFileSync(trustedFile, JSON.stringify({ trusted: [] }));
    writeFileSync(script, 'process.exit(0);');
    const engine: EngineSpec = {
      id: 'fake-followup-engine', command: process.execPath, args: [script],
      version_cmd: [process.execPath, '--version'], state_source: 'process',
      roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
      prompt_arg: 'positional', approval_profiles: { edits: [], contained: [] },
    };
    writeFileSync(registry, JSON.stringify([...BUILT_IN, engine].map(spec => ({
      ...spec, trust: { kind: 'json-list', file: trustedFile, at: ['trusted'], path_style: 'posix' },
    }))));
    writeFileSync(join(isolated.home, 'settings.json'), JSON.stringify({ sessions: { approval: 'contained' } }));
    Object.assign(isolated.env, {
      METATROOPER_ENGINES: registry, METATROOPER_FAKE_DPAPI: '1',
      METATROOPER_CLAUDE_SETTINGS: join(isolated.home, 'claude-settings.json'),
      METATROOPER_CODEX_CONFIG: join(isolated.home, 'codex-config.toml'),
    });
    core = await startCore(isolated);
    const ui = await client(isolated.prefix);
    try {
      await uiHello(ui, isolated.home);
      const projectDir = join(isolated.home, 'project');
      mkdirSync(projectDir);
      // Exit 2 delivers a monitor failure without launching an unrelated automation agent.
      writeFileSync(join(projectDir, 'check.mjs'), 'process.exit(2);');
      const opened = await ui.request('project.open', { path: projectDir });
      assert.equal(opened.error, undefined);
      const projectId = opened.result?.project_id;
      assert.ok(projectId);
      const db = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
      try {
        for (const approval of ['ask', 'edits'] as const) {
          await t.test(`${approval} parent produces an ${approval} follow-up`, async () => {
            const launched = await ui.request('session.launch', {
              project_id: projectId, engine_id: engine.id, approval, prompt: 'Finish the parent session',
            }, { timeout: 30_000 });
            assert.equal(launched.error, undefined);
            const parentId = launched.result?.session_id;
            assert.ok(parentId);
            assert.equal(db.prepare('SELECT approval FROM session WHERE id = ?').get(parentId)?.approval, approval);
            await until(() => db.prepare('SELECT state FROM session WHERE id = ?').get(parentId)?.state === 'exited', 15_000);

            const saved = await ui.request('automation.set', {
              project_id: projectId, name: `${approval} parent check`, every_min: 60,
              engine_id: engine.id, prompt: 'Fix the failing check',
              runner: [process.execPath], script: 'check.mjs',
            });
            assert.equal(saved.error, undefined);
            assert.ok(saved.result?.id);
            const linked = await ui.request('session.monitor-set', {
              session_id: parentId, automation_id: saved.result.id,
            });
            assert.equal(linked.error, undefined);
            const ran = await ui.request('automation.run', { id: saved.result.id }, { timeout: 30_000 });
            assert.equal(ran.error, undefined);
            assert.equal(ran.result?.outcome, 'failed');
            assert.equal(ran.result?.detail, 'check exited 2');
            const children = db.prepare('SELECT approval, engine_id, cwd, project_id FROM session WHERE parent_id = ?').all(parentId);
            assert.equal(children.length, 1, 'the failed monitor check must launch one follow-up child');
            assert.equal(children[0].engine_id, engine.id);
            assert.equal(children[0].project_id, projectId);
            assert.equal(children[0].cwd, db.prepare('SELECT cwd FROM session WHERE id = ?').get(parentId)?.cwd);
            assert.equal(children[0].approval, approval, `follow-up must respect its ${approval} parent despite the contained default`);
          });
        }
      } finally { db.close(); }
    } finally { ui.close(); }
  } finally { await teardownCore(core, isolated); }
});
