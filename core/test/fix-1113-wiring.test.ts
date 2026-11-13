import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { client, isolation, startCore, teardownCore, uiHello } from './helpers.ts';

async function core(args: string[] = []) {
  const iso = isolation();
  const project = join(iso.home, 'project');
  mkdirSync(project);
  const idle = join(iso.home, 'idle.cjs');
  writeFileSync(idle, 'setInterval(()=>{},1000);');
  const fake = (id: string) => ({ id, command: process.execPath, args: [idle], prompt_arg: 'positional', state_source: 'process', roles: [], cost_rank: 9, version_cmd: [process.execPath, '--version'], approval_profiles: { edits: [] } });
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([fake('claude'), fake('demo-fixture')]));
  const env = { ...iso.env, METATROOPER_ENGINES: registry };
  const child = await startCore({ ...iso, env, args });
  const pipe = await client(iso.prefix); await uiHello(pipe, iso.home);
  const projectId = (await pipe.request('project.open', { path: project })).result.project_id;
  return { iso, pipe, project, projectId, async close() { pipe.close(); await teardownCore(child, iso); } };
}

test('fix 1: a --demo core refuses a real engine and still launches demo-fixture', { timeout: 60_000 }, async () => {
  const c = await core(['--demo']);
  try {
    const real = await c.pipe.request('session.launch', { project_id: c.projectId, engine_id: 'claude', prompt: 'x' });
    assert.equal(real.error?.code, -32020, JSON.stringify(real));
    assert.match(real.error.message, /demo runs only demo-fixture/);
    const ok = await c.pipe.request('session.launch', { project_id: c.projectId, engine_id: 'demo-fixture', prompt: 'x' });
    assert.ok(ok.result?.session_id, JSON.stringify(ok));
  } finally { await c.close(); }
});

test('fix 5: launch and shell.open into a deleted project folder say the folder is gone', { timeout: 60_000 }, async () => {
  const c = await core();
  try {
    rmSync(c.project, { recursive: true, force: true });
    const launch = await c.pipe.request('session.launch', { project_id: c.projectId, engine_id: 'claude', prompt: 'x' });
    assert.equal(launch.error?.code, -32002, JSON.stringify(launch));
    assert.match(launch.error.message, /project folder is gone/);
    const shell = await c.pipe.request('shell.open', { project_id: c.projectId, kind: 'powershell' });
    assert.equal(shell.error?.code, -32002, JSON.stringify(shell));
    assert.match(shell.error.message, /project folder is gone/);
  } finally { await c.close(); }
});
