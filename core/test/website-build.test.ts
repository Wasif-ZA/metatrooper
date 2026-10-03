import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { delimiter, join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildGenerated, root, until } from './helpers.ts';
import { git, revisionHarness } from './ui-revision-helpers.ts';
import { capturingEngine } from './pipeline-fixup-helpers.ts';

before(buildGenerated);

function deploy(action: string, project: string, bin: string, target = project) {
  return spawnSync(process.execPath, [join(root, 'plugins/deploy/bin/deploy.js'), action], { input: JSON.stringify({ input: { path: target }, project }), encoding: 'utf8', env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, TROOP_PROJECT_DIR: project } });
}

test('deploy action runs preview and production safely and validates Vercel output', () => {
  const base = join(process.env.TEMP!, `deploy-test-${process.pid}-${Date.now()}`); const bin = join(base, 'bin'); const project = join(base, 'project');
  mkdirSync(join(project, '.vercel'), { recursive: true }); mkdirSync(bin, { recursive: true }); writeFileSync(join(project, '.vercel/project.json'), '{}');
  const log = join(base, 'calls.log'); const cmd = join(bin, process.platform === 'win32' ? 'vercel.cmd' : 'vercel');
  writeFileSync(cmd, process.platform === 'win32' ? `@echo off\r\necho %*>>"${log}"\r\necho preparing\r\necho https://fake.test/deploy\r\n` : `#!/bin/sh\necho "$@" >> '${log}'\necho preparing\necho https://fake.test/deploy\n`, { mode: 0o755 });
  assert.equal(JSON.parse(deploy('preview', project, bin).stdout).outputs.url, 'https://fake.test/deploy');
  assert.equal(JSON.parse(deploy('production', project, bin).stdout).outputs.url, 'https://fake.test/deploy');
  const calls = readFileSync(log, 'utf8'); assert.match(calls, /deploy --yes/); assert.match(calls, /deploy --yes --prod/);
  const worktree = join(base, 'worktree'); mkdirSync(worktree);
  writeFileSync(join(project, '.vercel/project.json'), JSON.stringify({ projectId: 'root-project', orgId: 'root-org' }));
  assert.equal(JSON.parse(deploy('preview', project, bin, worktree).stdout).ok, true);
  assert.equal(readFileSync(join(worktree, '.vercel/project.json'), 'utf8'), readFileSync(join(project, '.vercel/project.json'), 'utf8'));
  writeFileSync(join(worktree, '.vercel/project.json'), '{"projectId":"existing"}');
  assert.equal(JSON.parse(deploy('preview', project, bin, worktree).stdout).ok, true);
  assert.equal(readFileSync(join(worktree, '.vercel/project.json'), 'utf8'), '{"projectId":"existing"}');
  const unlinked = join(base, 'unlinked'); mkdirSync(unlinked); const before = readFileSync(log, 'utf8');
  assert.match(JSON.parse(deploy('preview', unlinked, bin).stdout).error.message, /link the project first/); assert.equal(readFileSync(log, 'utf8'), before);
  const unlinkedWorktree = join(base, 'unlinked-worktree'); mkdirSync(unlinkedWorktree);
  const missing = JSON.parse(deploy('preview', unlinked, bin, unlinkedWorktree).stdout);
  assert.ok(missing.error.message.endsWith(unlinked), missing.error.message);
  assert.equal(readFileSync(log, 'utf8'), before);
  const ansi = '\u001b';
  writeFileSync(cmd, process.platform === 'win32'
    ? `@echo off\r\necho ${ansi}[32mhttps://first.test/deploy${ansi}[0m\r\necho https://second.test/deploy\r\necho To deploy to production, run vercel --prod\r\n`
    : `#!/bin/sh\nprintf '${ansi}[32mhttps://first.test/deploy${ansi}[0m\\nhttps://second.test/deploy\\nTo deploy to production, run vercel --prod\\n'\n`, { mode: 0o755 });
  assert.equal(JSON.parse(deploy('preview', project, bin).stdout).outputs.url, 'https://first.test/deploy');
  writeFileSync(cmd, process.platform === 'win32' ? '@echo off\r\necho not-a-url\r\n' : '#!/bin/sh\necho not-a-url\n', { mode: 0o755 });
  assert.match(JSON.parse(deploy('preview', project, bin).stdout).error.message, /did not print a deployment URL/);
  writeFileSync(cmd, process.platform === 'win32' ? '@echo off\r\necho failed 1>&2\r\nexit /b 7\r\n' : '#!/bin/sh\necho failed >&2\nexit 7\n', { mode: 0o755 });
  assert.match(JSON.parse(deploy('preview', project, bin).stdout).error.message, /vercel deploy failed/);
});

async function website(verdicts = ['fixed', 'fixed', 'pass']) {
  const h = await revisionHarness('website-build', capturingEngine);
  try {
    mkdirSync(join(h.project, '.vercel'), { recursive: true }); writeFileSync(join(h.project, '.vercel/project.json'), '{}');
    assert.equal(git(h.project, 'ls-files', '.vercel/project.json'), '');
    const log = join(h.iso.home, 'vercel.log');
    writeFileSync(join(h.iso.home, 'bin', process.platform === 'win32' ? 'vercel.cmd' : 'vercel'), process.platform === 'win32'
      ? `@echo off\r\necho %*>>"${log}"\r\necho https://preview.test/site\r\n`
      : `#!/bin/sh\necho "$@" >> '${log}'\necho https://preview.test/site\n`, { mode: 0o755 });
    const def = JSON.parse(readFileSync(join(root, 'pipelines/website-build.json'), 'utf8'));
    for (const step of def.steps) {
      if (step.kind === 'agent') {
        step.engine = 'fake';
        step.prompt = `FAKE ${JSON.stringify(step.id === 'critique' ? { verdicts, outputs: { verdict: 'fixed' } } : { outputs: { summary: step.id } })}\n${step.prompt}`;
      }
    }
    const runId = await h.pipeline(def, { brief: 'small site' });
    return { h, runId, calls: () => existsSync(log) ? readFileSync(log, 'utf8').trim().split(/\r?\n/) : [] };
  } catch (error) { await h.close(); throw error; }
}

function critiques(h: Awaited<ReturnType<typeof revisionHarness>>, runId: string) {
  return h.db.prepare("SELECT iteration,status,outputs FROM run_step WHERE run_id=? AND step_id='critique' ORDER BY iteration").all(runId)
    .map((r: any) => ({ iteration: r.iteration, status: r.status, verdict: JSON.parse(r.outputs).verdict }));
}

test('M2-01 website build loops three critiques, gates production, then deploys once', async () => {
  const { h, runId, calls } = await website();
  try {
    const gate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id=? AND step_id='approve' AND status='waiting'").get(runId), 60000);
    assert.deepEqual(critiques(h, runId), ['fixed', 'fixed', 'pass'].map((verdict, iteration) => ({ iteration, verdict, status: 'done' })));
    assert.equal(JSON.parse(readFileSync(join(h.iso.home, 'critique-count.json'), 'utf8')), 3);
    assert.equal(gate.guards_step, 'production'); assert.match(gate.action_hash, /^[0-9a-f]{64}$/); assert.match(gate.summary, /https:\/\/preview\.test\/site/);
    assert.equal(h.db.prepare('SELECT status FROM run WHERE id=?').get(runId).status, 'paused');
    assert.deepEqual(calls(), ['deploy --yes']);
    const build = JSON.parse(h.db.prepare("SELECT outputs FROM run_step WHERE run_id=? AND step_id='build'").get(runId).outputs as string);
    assert.equal(git(build.worktree, 'ls-files', '.vercel/project.json'), '');
    assert.equal(readFileSync(join(build.worktree, '.vercel/project.json'), 'utf8'), readFileSync(join(h.project, '.vercel/project.json'), 'utf8'));
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id=? AND step_id='production' AND status='done'").get(runId).n, 0);
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash })).result, {});
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id=?').get(runId) as any).status === 'done', 30000);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id=? AND step_id='production' AND status='done'").get(runId).n, 1);
    assert.deepEqual(calls(), ['deploy --yes', 'deploy --yes --prod']);
  } finally { try { await h.close(); } catch (error: any) { if (error?.code !== 'EPERM') throw error; } }
});

test('website build reject cancels before production', async () => {
  const { h, runId, calls } = await website();
  try {
    const gate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id=? AND step_id='approve' AND status='waiting'").get(runId), 60000);
    assert.deepEqual(calls(), ['deploy --yes']);
    await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'reject', action_hash: gate.action_hash ?? undefined });
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id=?').get(runId) as any).status === 'cancelled');
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id=? AND step_id='production' AND status='done'").get(runId).n, 0);
    assert.deepEqual(calls(), ['deploy --yes']);
  } finally { try { await h.close(); } catch (error: any) { if (error?.code !== 'EPERM') throw error; } }
});

test('website critique never passing pauses at loop-max after three attempts without deploying', async () => {
  const { h, runId, calls } = await website(['fixed']);
  try {
    await until(() => h.db.prepare("SELECT 1 FROM run WHERE id=? AND status='paused' AND paused_why='loop-max'").get(runId), 60000);
    assert.deepEqual(critiques(h, runId), [0, 1, 2].map(iteration => ({ iteration, status: 'done', verdict: 'fixed' })));
    assert.equal(JSON.parse(readFileSync(join(h.iso.home, 'critique-count.json'), 'utf8')), 3);
    assert.deepEqual(calls(), []);
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM gate WHERE run_id=?').get(runId).n, 0);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id=? AND step_id IN ('preview','production') AND status='done'").get(runId).n, 0);
  } finally { try { await h.close(); } catch (error: any) { if (error?.code !== 'EPERM') throw error; } }
});
