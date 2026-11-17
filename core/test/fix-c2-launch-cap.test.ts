import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGenerated, client, isolation, startCore, teardownCore, uiHello } from './helpers.ts';

before(buildGenerated);

const engine = {
  id: 'capeng', command: process.execPath, args: ['-e', 'setTimeout(()=>process.exit(0),30000)'], prompt_arg: 'positional',
  state_source: 'process', roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
  version_cmd: [process.execPath, '--version'], approval_profiles: { contained: ['--fake-contained'] },
};

async function withCore(fn: (ctx: { project_id: string; plain: any; ui: any }) => Promise<void>) {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([engine]));
  writeFileSync(join(isolated.home, 'settings.json'), JSON.stringify({ sessions: { approval: 'ask' } }));
  const core = await startCore({ ...isolated, env: { ...isolated.env, METATROOPER_ENGINES: registry } });
  const plain = await client(isolated.prefix);
  const ui = await client(isolated.prefix);
  try {
    await uiHello(ui, isolated.home);
    const project = join(isolated.home, 'ordinary-project');
    mkdirSync(project);
    const opened = await plain.request('project.open', { path: project });
    await fn({ project_id: opened.result.project_id, plain, ui });
  } finally { plain.close(); ui.close(); await teardownCore(core, isolated); }
}

const launch = (c: any, params: object) => c.request('session.launch', { engine_id: 'capeng', ...params });

test('a non-UI launch cannot exceed the approval of its parent session', async () => {
  await withCore(async ({ project_id, plain }) => {
    const parent = await launch(plain, { project_id });
    assert.ok(parent.result?.session_id, JSON.stringify(parent));
    const child = await launch(plain, { project_id, parent_id: parent.result.session_id, approval: 'contained' });
    assert.ok(child.error && [-32012, -32003].includes(child.error.code), JSON.stringify(child));
  });
});

test('the same launch over a ui.hello connection succeeds', async () => {
  await withCore(async ({ project_id, plain, ui }) => {
    const parent = await launch(plain, { project_id });
    const child = await launch(ui, { project_id, parent_id: parent.result.session_id, approval: 'contained' });
    assert.ok(child.result?.session_id, JSON.stringify(child));
  });
});

test('a child at or below the parent level still launches', async () => {
  await withCore(async ({ project_id, plain }) => {
    const ask = await launch(plain, { project_id });
    const low = await launch(plain, { project_id, parent_id: ask.result.session_id });
    assert.ok(low.result?.session_id, JSON.stringify(low));
    const parent = await launch(plain, { project_id, approval: 'contained' });
    const same = await launch(plain, { project_id, parent_id: parent.result.session_id, approval: 'contained' });
    assert.ok(same.result?.session_id, JSON.stringify(same));
    const lower = await launch(plain, { project_id, parent_id: parent.result.session_id, approval: 'ask' });
    assert.ok(lower.result?.session_id, JSON.stringify(lower));
  });
});
