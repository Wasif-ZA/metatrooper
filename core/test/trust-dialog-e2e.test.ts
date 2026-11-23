import './clean-env.mjs';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILT_IN, type EngineSpec } from '../src/engines/registry.ts';
import { buildGenerated, client, isolation, startCore, teardownCore, uiHello } from './helpers.ts';

before(buildGenerated);

// Real core, isolated registry, fake Node engine and authenticated UI pipe.
// All trust destinations stay inside the fixture.
async function withTrustCore(run: (ui: Awaited<ReturnType<typeof client>>, projectId: string) => Promise<void>) {
  const isolated = isolation();
  const trustedFile = join(isolated.home, 'trusted.json');
  const registry = join(isolated.home, 'engines.json');
  const script = join(isolated.home, 'trust-engine.mjs');
  writeFileSync(trustedFile, JSON.stringify({ trusted: [] }));
  writeFileSync(script, [
    "console.log('Do you trust this folder?\\n> Yes, I trust this folder\\n  No, exit');",
    'setTimeout(() => {}, 60_000);',
  ].join('\n'));
  const fake: EngineSpec = {
    id: 'fake-trust-engine', command: process.execPath, args: [script],
    version_cmd: [process.execPath, '--version'], state_source: 'process',
    roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
    trust_patterns: ['Yes, I trust this folder'],
  };
  writeFileSync(registry, JSON.stringify([...BUILT_IN, fake].map(engine => ({
    ...engine, trust: { kind: 'json-list', file: trustedFile, at: ['trusted'], path_style: 'posix' },
  }))));
  Object.assign(isolated.env, {
    METATROOPER_ENGINES: registry, METATROOPER_FAKE_DPAPI: '1',
    METATROOPER_CLAUDE_SETTINGS: join(isolated.home, 'claude-settings.json'),
    METATROOPER_CODEX_CONFIG: join(isolated.home, 'codex-config.toml'),
  });
  let core: Awaited<ReturnType<typeof startCore>> | undefined;
  try {
    core = await startCore(isolated);
    const ui = await client(isolated.prefix);
    try {
      await uiHello(ui, isolated.home);
      const projectDir = join(isolated.home, 'project');
      mkdirSync(projectDir);
      const opened = await ui.request('project.open', { path: projectDir });
      assert.equal(opened.error, undefined);
      assert.ok(opened.result?.project_id);
      await run(ui, opened.result.project_id);
    } finally { ui.close(); }
  } finally { await teardownCore(core, isolated); }
}

for (const prompt of ['Inspect this folder', undefined]) {
  test(`real core exposes folder trust ${prompt ? 'with a prompt' : 'without a prompt'}`, async () => {
    // protects=trust detection through real engine output, scheduled checks and session.wait over the UI pipe
    await withTrustCore(async (ui, projectId) => {
      const launched = await ui.request('session.launch', {
        project_id: projectId, engine_id: 'fake-trust-engine', approval: 'ask',
        ...(prompt === undefined ? {} : { prompt }),
      }, { timeout: 30_000 });
      assert.equal(launched.error, undefined);
      const sessionId = launched.result?.session_id;
      assert.ok(sessionId);
      try {
        const waited = await ui.request('session.wait', {
          session_id: sessionId, states: ['waiting_for_you'], timeout_ms: 30_000,
        }, { timeout: 35_000 });
        assert.equal(waited.error, undefined);
        assert.equal(waited.result?.timed_out, false);
        assert.equal(waited.result?.state, 'waiting_for_you');
        assert.equal(waited.result?.wait_reason, 'trust');
      } finally {
        const stopped = await ui.request('session.stop', { session_id: sessionId }, { timeout: 15_000 });
        assert.equal(stopped.error, undefined);
      }
    });
  });
}
