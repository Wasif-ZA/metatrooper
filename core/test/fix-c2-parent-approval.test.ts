import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGenerated, client, isolation, startCore, teardownCore, uiHello } from './helpers.ts';

// Build generated fixtures before running tests.
before(buildGenerated);

const recorder = "setTimeout(() => process.exit(0), 500);";

const fakeEngine = (recorderPath: string) => ({
  id: 'fake-engine',
  command: process.execPath,
  args: [recorderPath],
  prompt_arg: 'positional',
  state_source: 'process',
  roles: ['worker'],
  cost_rank: 1,
  usage_source: 'none',
  provider: 'local-cli',
  version_cmd: [process.execPath, '--version'],
  approval_profiles: {
    edits: ['--edits'],
    contained: ['--contained'],
  },
});

let isolated: ReturnType<typeof isolation>;
let core: any;
let projectId: string;
let parentId: string;

before(async () => {
  // Set up isolated home and registry with fake engine and settings.
  isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const recorderPath = join(isolated.home, 'recorder.mjs');
  writeFileSync(recorderPath, recorder);
  writeFileSync(registry, JSON.stringify([fakeEngine(recorderPath)]));
  writeFileSync(join(isolated.home, 'settings.json'), JSON.stringify({ sessions: { approval: 'contained' } }));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  core = await startCore({ ...isolated, env });
  const project = join(isolated.home, 'project');
  mkdirSync(project, { recursive: true });
  const pipe = await client(isolated.prefix);
  try {
    const opened = await pipe.request('project.open', { path: project });
    projectId = opened.result.project_id;
    const parentLaunch = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      approval: 'ask',
    });
    parentId = parentLaunch.result.session_id;
  } finally {
    pipe.close();
  }
});

after(async () => {
  // Teardown the core instance and clean up.
  if (core) {
    await teardownCore(core, isolated);
  }
});

test('C2a: non-UI launch with parent ask requesting contained fails with -32012', async () => {
  // Connect a non-UI pipe client.
  const pipe = await client(isolated.prefix);
  try {
    // Attempt child launch requesting contained approval under an ask parent.
    const reply = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      parent_id: parentId,
      approval: 'contained',
    });
    // Verify the request fails with needs UI error code.
    const expectedErrorCode = -32012;
    assert.equal(reply.error?.code, expectedErrorCode);
  } finally {
    pipe.close();
  }
});

test('C2b: UI launch with parent ask requesting contained succeeds', async () => {
  // Connect a pipe client and authenticate with ui.hello.
  const pipe = await client(isolated.prefix);
  try {
    // Send ui.hello to establish UI trust.
    await uiHello(pipe, isolated.home);
    // Launch child session requesting contained approval under an ask parent.
    const reply = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      parent_id: parentId,
      approval: 'contained',
    });
    // Verify child launch succeeds with contained approval.
    assert.ok(reply.result?.session_id);
    assert.equal(reply.result?.approval, 'contained');
  } finally {
    pipe.close();
  }
});

test('C2c: non-UI child requesting ask under ask parent succeeds', async () => {
  // Connect a non-UI pipe client.
  const pipe = await client(isolated.prefix);
  try {
    // Launch child session requesting ask approval matching parent level.
    const reply = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      parent_id: parentId,
      approval: 'ask',
    });
    // Verify child launch succeeds with ask approval.
    assert.ok(reply.result?.session_id);
    assert.equal(reply.result?.approval, 'ask');
  } finally {
    pipe.close();
  }
});

test('Plus: non-UI launch with no parent_id and no approval gets settings default', async () => {
  // Connect a non-UI pipe client.
  const pipe = await client(isolated.prefix);
  try {
    // Launch session without parent or approval to verify settings default.
    const reply = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
    });
    // Verify launch gets contained approval from sessions.approval setting.
    assert.ok(reply.result?.session_id);
    assert.equal(reply.result?.approval, 'contained');
  } finally {
    pipe.close();
  }
});
