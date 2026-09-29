import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, startCore, teardownCore, until, uiHello } from './helpers.ts';

before(buildGenerated);

function db(home: string) {
  const connection = new DatabaseSync(join(home, 'troop.db'));
  connection.exec('PRAGMA busy_timeout = 2000');
  return connection;
}

function now() {
  return new Date().toISOString();
}

async function fakeHarness() {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{
    id: 'fake',
    command: process.execPath,
    args: [join(root, 'core/test/fake-engine.js')],
    prompt_arg: 'positional',
    state_source: 'hooks',
    roles: ['worker', 'verify', 'publish'],
    cost_rank: 1,
    usage_source: 'none',
    provider: 'local-cli',
    version_cmd: [process.execPath, '--version']
  }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry, TROOP_LAUNCHER: 'spawn' };
  const core = await startCore({ ...isolated, env });
  const store = db(isolated.home);
  try {
    await until(() => store.prepare("SELECT 1 FROM engine_check WHERE engine_id = 'fake' AND installed = 1").get(), 5000);
  } finally { store.close(); }
  return { ...isolated, env, core, async teardown() { await teardownCore(core, isolated); } };
}

async function openProject(h: Awaited<ReturnType<typeof fakeHarness>>, name = 'project') {
  const project = join(h.home, name);
  mkdirSync(project, { recursive: true });
  const pipe = await client(h.prefix);
  try {
    const opened = await pipe.request('project.open', { path: project });
    assert.ok(opened.result?.project_id, JSON.stringify(opened));
    return { project, projectId: opened.result.project_id as string };
  } finally { pipe.close(); }
}

function writePipeline(project: string, pipeline: object) {
  const dir = join(project, '.troop', 'pipelines');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${(pipeline as { id: string }).id}.json`), JSON.stringify(pipeline, null, 2) + '\n');
}

async function startRun(h: Awaited<ReturnType<typeof fakeHarness>>, pipelineId: string, projectId: string, inputs = {}) {
  const pipe = await client(h.prefix);
  try {
    const started = await pipe.request('run.start', { pipeline_id: pipelineId, project_id: projectId, inputs }, { timeout: 5000 });
    assert.ok(started.result?.run_id, JSON.stringify(started));
    return started.result.run_id as string;
  } finally { pipe.close(); }
}

async function trustedPipe(h: Awaited<ReturnType<typeof fakeHarness>>) {
  const pipe = await client(h.prefix);
  await uiHello(pipe, h.home);
  return pipe;
}

async function approveGate(h: Awaited<ReturnType<typeof fakeHarness>>, runId: string, where = '') {
  const store = db(h.home);
  let gate: { id: string; action_hash: string | null };
  try {
    gate = await until(() => {
      const row = store.prepare("SELECT id, action_hash FROM gate WHERE run_id = ? AND status = 'waiting' ORDER BY rowid DESC").get(runId) as { id: string; action_hash: string | null } | undefined;
      return row;
    }, 5000);
  } finally { store.close(); }
  const pipe = await trustedPipe(h);
  try {
    const resolved = await pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined }, { meta: { origin: 'workbench', sent_at: now() }, timeout: 5000 });
    assert.deepEqual(resolved.result, {}, `${where}${JSON.stringify(resolved)}`);
  } finally { pipe.close(); }
  return gate.id;
}

function initGitProject(project: string) {
  writeFileSync(join(project, 'README.md'), 'fixture\n');
  execFileSync('git', ['init'], { cwd: project, stdio: 'ignore' });
  execFileSync('git', ['add', 'README.md'], { cwd: project, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Metatrooper Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'initial'], { cwd: project, stdio: 'ignore' });
}

function serverScript(delayMs = 0) {
  return `
import http from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const port = Number(process.argv[2]);
writeFileSync('server-parent-' + port + '.pid', String(process.pid));
const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync('server-child-' + port + '.pid', String(child.pid));
setTimeout(() => {
  http.createServer((_req, res) => res.end('ok')).listen(port, '127.0.0.1');
}, ${delayMs});
setInterval(() => {}, 1000);
`;
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

test('M1-18 validates publish gates, publish fanout, and pinned publish engines from file and form view', async () => {
  const h = await fakeHarness();
  try {
    const { project, projectId } = await openProject(h, 'm1-18');
    const invalid = {
      schema: 1, id: 'm1-18-invalid', title: 'Invalid publish',
      steps: [
        { id: 'publish', kind: 'agent', role: 'publish', engine: 'fake', destination: 'repo', prompt: 'publish' }
      ]
    };
    writePipeline(project, invalid);
    const pipe = await client(h.prefix);
    try {
      const form = await pipe.request('pipeline.validate', { json: invalid });
      assert.equal(form.result.valid, false);
      assert.ok(form.result.errors.some((e: string) => e.includes('publish rule')));
      const fanoutPublish = await pipe.request('pipeline.validate', { json: {
        schema: 1, id: 'm1-18-pub-fanout', title: 'Publish fanout',
        steps: [
          { id: 'approve', kind: 'gate', gate: 'approve' },
          { id: 'publish', kind: 'agent', role: 'publish', engine: 'fake', destination: 'repo', fanout: 2, prompt: 'publish' }
        ]
      } });
      assert.equal(fanoutPublish.result.valid, false);
      assert.ok(fanoutPublish.result.errors.some((e: string) => e.includes('excluded shape')));
      const externalFanout = await pipe.request('pipeline.validate', { json: {
        schema: 1, id: 'm1-18-ext-fanout', title: 'External fanout', requires: ['demo'],
        steps: [
          { id: 'approve', kind: 'gate', gate: 'approve' },
          { id: 'send', kind: 'action', uses: 'plugin:demo/send', external: true, fanout: 2 }
        ]
      } });
      assert.equal(externalFanout.result.valid, false);
      assert.ok(externalFanout.result.errors.some((e: string) => e.includes('excluded shape')));
      const unpinned = await pipe.request('pipeline.validate', { json: {
        schema: 1, id: 'm1-18-unpinned', title: 'Unpinned publish',
        steps: [
          { id: 'approve', kind: 'gate', gate: 'approve' },
          { id: 'publish', kind: 'agent', role: 'publish', engine: ['fake'], destination: 'repo', prompt: 'publish' }
        ]
      } });
      assert.equal(unpinned.result.valid, false);
      assert.ok(unpinned.result.errors.some((e: string) => e.includes('/engine') && e.includes('must be string')));
      const started = await pipe.request('run.start', { pipeline_id: 'm1-18-invalid', project_id: projectId });
      assert.equal(started.error?.code, -32003);
    } finally { pipe.close(); }
    const store = db(h.home);
    try {
      await until(() => store.prepare("SELECT valid FROM pipeline WHERE id = 'm1-18-invalid'").get());
      const row = store.prepare("SELECT valid, errors FROM pipeline WHERE id = 'm1-18-invalid'").get() as { valid: number; errors: string };
      assert.equal(row.valid, 0);
      assert.ok(JSON.parse(row.errors).some((e: string) => e.includes('publish rule')));
    } finally { store.close(); }
  } finally { await h.teardown(); }
});

test('M1-18a runs a child pipeline with remaining budget, parent-visible gates, and last-step outputs', async () => {
  const h = await fakeHarness();
  try {
    const { project, projectId } = await openProject(h, 'm1-18a');
    writePipeline(project, {
      schema: 1, id: 'm1-18a-child', title: 'Child',
      inputs: { topic: { type: 'text' } },
      steps: [
        { id: 'approve', kind: 'gate', gate: 'approve', gate_summary: 'child gate {{inputs.topic}}' },
        { id: 'child-last', kind: 'agent', engine: 'fake', prompt: 'FAKE {"outputs":{"answer":"child-ok"}}', outputs: ['answer'] }
      ]
    });
    writePipeline(project, {
      schema: 1, id: 'm1-18a-parent', title: 'Parent', budget: { max_tokens: 2000 },
      steps: [
        { id: 'prep', kind: 'agent', engine: 'fake', prompt: 'FAKE {"outputs":{"topic":"from-parent"},"usage_tokens":600}', outputs: ['topic'] },
        { id: 'child', kind: 'pipeline', uses: 'pipeline:m1-18a-child', with: { topic: '{{steps.prep.outputs.topic}}' } }
      ]
    });
    const selfCheck = await client(h.prefix);
    try {
      const self = await selfCheck.request('pipeline.validate', { json: {
        schema: 1, id: 'm1-18a-self', title: 'Self',
        steps: [{ id: 'again', kind: 'pipeline', uses: 'pipeline:m1-18a-self' }]
      } });
      assert.equal(self.result.valid, false);
      assert.ok(self.result.errors.some((e: string) => e.includes('includes itself')));
    } finally { selfCheck.close(); }
    const runId = await startRun(h, 'm1-18a-parent', projectId);
    const store = db(h.home);
    try {
      const childRun = await until(() => {
        const row = store.prepare("SELECT id, status, paused_why, max_tokens, inputs FROM run WHERE parent_run = ? AND parent_step = 'child'").get(runId) as
          | { id: string; status: string; paused_why: string | null; max_tokens: number; inputs: string }
          | undefined;
        return row?.paused_why === 'gate' ? row : null;
      }, 5000);
      assert.equal(childRun.max_tokens, 1400);
      assert.deepEqual(JSON.parse(childRun.inputs), { topic: 'from-parent' });
      await until(() => store.prepare("SELECT status, paused_why FROM run WHERE id = ?").get(runId)?.paused_why === 'gate');
      const gate = store.prepare("SELECT summary FROM gate WHERE run_id = ? AND status = 'waiting'").get(childRun.id) as { summary: string };
      assert.equal(gate.summary, 'child gate from-parent');
      await approveGate(h, childRun.id, 'child gate: ');
      await until(() => store.prepare("SELECT status FROM run WHERE id = ?").get(runId)?.status === 'done', 8000);
      const parentStep = store.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'child'").get(runId) as { outputs: string };
      assert.deepEqual(JSON.parse(parentStep.outputs), { answer: 'child-ok' });
    } finally { store.close(); }
  } finally { await h.teardown(); }
});

test('M1-19 marks changed approvals stale and refuses non-UI or code gate resolution', async () => {
  const h = await fakeHarness();
  try {
    const { project, projectId } = await openProject(h, 'm1-19');
    mkdirSync(join(project, '.troop', 'pipelines'), { recursive: true });
    writeFileSync(join(project, '.troop', 'pipelines', 'code-step.mjs'), 'export async function run(ctx) { return { hasGate: Boolean(ctx.gate), gateResolve: Boolean(ctx.gate?.resolve) }; }\n');
    writePipeline(project, {
      schema: 1, id: 'm1-19-pipe', title: 'Gates',
      steps: [
        { id: 'code', kind: 'code', code: 'code-step.mjs' },
        { id: 'approve', kind: 'gate', gate: 'approve' },
        { id: 'build', kind: 'agent', engine: 'fake', prompt: 'FAKE {"outputs":{"dest":"repo-a"}}', outputs: ['dest'] },
        { id: 'publish', kind: 'agent', role: 'publish', engine: 'fake', destination: '{{steps.build.outputs.dest}}', prompt: 'FAKE {"outputs":{"sent":"yes"}} publish {{steps.build.outputs.dest}}', outputs: ['sent'] }
      ]
    });
    const runId = await startRun(h, 'm1-19-pipe', projectId);
    const store = db(h.home);
    try {
      await until(() => store.prepare("SELECT status FROM run WHERE id = ?").get(runId)?.status === 'paused');
      const codeRow = store.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'code'").get(runId) as { outputs: string };
      assert.deepEqual(JSON.parse(codeRow.outputs), { hasGate: false, gateResolve: false });
      const gate = store.prepare("SELECT id FROM gate WHERE run_id = ? AND status = 'waiting'").get(runId) as { id: string };
      const untrusted = await client(h.prefix);
      try {
        const denied = await untrusted.request('gate.resolve', { gate_id: gate.id, decision: 'approve' }, { meta: { origin: 'cli', sent_at: now() } });
        assert.equal(denied.error?.code, -32012);
      } finally { untrusted.close(); }
      await approveGate(h, runId);
      await until(() => {
        const stale = store.prepare("SELECT status FROM gate WHERE id = ?").get(gate.id) as { status: string };
        const waiting = store.prepare("SELECT 1 FROM gate WHERE run_id = ? AND guards_step = 'publish' AND status = 'waiting'").get(runId);
        return stale.status === 'stale' && waiting;
      }, 8000);
      await approveGate(h, runId, 'new publish gate: ');
      await until(() => store.prepare("SELECT status FROM run WHERE id = ?").get(runId)?.status === 'done', 8000);
      const gates = store.prepare("SELECT status, note FROM gate WHERE run_id = ? ORDER BY rowid").all(runId) as Array<{ status: string; note: string | null }>;
      assert.equal(gates[0].status, 'stale');
      assert.ok(gates.at(-1)?.note?.includes('approval used by publish'));
    } finally { store.close(); }
  } finally { await h.teardown(); }
});

test('M1-20 enforces loop max, resumes failed steps with prior outputs, and trips the breaker', async () => {
  const h = await fakeHarness();
  try {
    const opened = await openProject(h, 'm1-20');
    writePipeline(opened.project, {
      schema: 1, id: 'm1-20-loop', title: 'Loop max',
      steps: [
        { id: 'verify', kind: 'agent', engine: 'fake', prompt: 'FAKE {"outputs":{"passed":false,"note":"still-bad"}}', outputs: ['passed', 'note'], loop: { steps: ['verify'], until: 'steps.verify.passed', max: 2 } },
        { id: 'after', kind: 'agent', engine: 'fake', prompt: 'FAKE {"outputs":{"kept":"{{steps.verify.outputs.note}}"}}', outputs: ['kept'] }
      ]
    });
    writePipeline(opened.project, {
      schema: 1, id: 'm1-20-resume', title: 'Resume',
      steps: [
        { id: 'first', kind: 'agent', engine: 'fake', prompt: 'FAKE {"outputs":{"value":"kept"}}', outputs: ['value'] },
        { id: 'flaky', kind: 'agent', engine: 'fake', prompt: 'FAKE {"fail_until":1,"outputs":{"value":"fixed"}}', outputs: ['value'] }
      ]
    });
    writePipeline(opened.project, {
      schema: 1, id: 'm1-20-breaker', title: 'Breaker',
      steps: [
        { id: 'bad', kind: 'agent', engine: 'fake', prompt: 'FAKE {"fail_until":5,"outputs":{"value":"nope"}}', outputs: ['value'] }
      ]
    });
    const store = db(h.home);
    try {
      const loopRun = await startRun(h, 'm1-20-loop', opened.projectId);
      await until(() => store.prepare("SELECT paused_why FROM run WHERE id = ?").get(loopRun)?.paused_why === 'loop-max', 8000);
      assert.equal(store.prepare("SELECT count(*) AS n FROM run_step WHERE run_id = ? AND step_id = 'verify'").get(loopRun).n, 2);
      const pipe = await client(h.prefix);
      try { assert.deepEqual((await pipe.request('run.resume', { run_id: loopRun })).result, {}); }
      finally { pipe.close(); }
      await until(() => store.prepare("SELECT status FROM run WHERE id = ?").get(loopRun)?.status === 'done', 8000);
      const after = store.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'after'").get(loopRun) as { outputs: string };
      assert.deepEqual(JSON.parse(after.outputs), { kept: 'still-bad' });

      const resumeRun = await startRun(h, 'm1-20-resume', opened.projectId);
      await until(() => store.prepare("SELECT status FROM run WHERE id = ?").get(resumeRun)?.status === 'failed', 8000);
      const first = store.prepare("SELECT session_id, outputs FROM run_step WHERE run_id = ? AND step_id = 'first'").get(resumeRun) as { session_id: string; outputs: string };
      const retry = await client(h.prefix);
      try { assert.deepEqual((await retry.request('run.resume', { run_id: resumeRun })).result, {}); }
      finally { retry.close(); }
      await until(() => store.prepare("SELECT status FROM run WHERE id = ?").get(resumeRun)?.status === 'done', 8000);
      const firstAfter = store.prepare("SELECT session_id, outputs FROM run_step WHERE run_id = ? AND step_id = 'first'").get(resumeRun) as { session_id: string; outputs: string };
      assert.equal(firstAfter.session_id, first.session_id);
      assert.equal(firstAfter.outputs, first.outputs);
      const flaky = store.prepare("SELECT outputs, fail_count FROM run_step WHERE run_id = ? AND step_id = 'flaky'").get(resumeRun) as { outputs: string; fail_count: number };
      assert.equal(flaky.fail_count, 1);
      assert.deepEqual(JSON.parse(flaky.outputs), { value: 'fixed' });

      const breakerRun = await startRun(h, 'm1-20-breaker', opened.projectId);
      for (let attempt = 1; attempt <= 3; attempt++) {
        await until(() => {
          const row = store.prepare("SELECT status, paused_why FROM run WHERE id = ?").get(breakerRun) as { status: string; paused_why: string | null };
          return attempt < 3 ? row.status === 'failed' : row.paused_why === 'breaker';
        }, 8000);
        if (attempt < 3) {
          const again = await client(h.prefix);
          try { assert.deepEqual((await again.request('run.resume', { run_id: breakerRun })).result, {}); }
          finally { again.close(); }
        }
      }
      const refused = await client(h.prefix);
      try {
        const r = await refused.request('run.resume', { run_id: breakerRun });
        assert.equal(r.error?.code, -32003);
      } finally { refused.close(); }
    } finally { store.close(); }
  } finally { await h.teardown(); }
});

test('M1-21 stops new steps at max_tokens with overshoot bounded by max_parallel running agents', async () => {
  const h = await fakeHarness();
  try {
    const { project, projectId } = await openProject(h, 'm1-21');
    writePipeline(project, {
      schema: 1, id: 'm1-21-budget', title: 'Budget', budget: { max_tokens: 1000, max_parallel: 2 },
      steps: [
        { id: 'work', kind: 'agent', engine: 'fake', fanout: 3, prompt: 'FAKE {"delay_ms":300,"usage_tokens":1000,"outputs":{"done":"yes"}}', outputs: ['done'] },
        { id: 'after', kind: 'agent', engine: 'fake', prompt: 'FAKE {"outputs":{"done":"after"}}', outputs: ['done'] }
      ]
    });
    const runId = await startRun(h, 'm1-21-budget', projectId);
    const store = db(h.home);
    try {
      await until(() => store.prepare("SELECT paused_why FROM run WHERE id = ?").get(runId)?.paused_why === 'budget', 8000);
      const rows = store.prepare("SELECT fanout_index, status, session_id FROM run_step WHERE run_id = ? AND step_id = 'work' ORDER BY fanout_index").all(runId) as
        Array<{ fanout_index: number; status: string; session_id: string | null }>;
      assert.deepEqual(rows.map(row => row.status), ['done', 'done', 'pending']);
      assert.equal(rows.filter(row => row.session_id).length, 2);
      assert.equal(store.prepare("SELECT status FROM run_step WHERE run_id = ? AND step_id = 'after'").get(runId)?.status, 'pending');
      const usage = store.prepare("SELECT SUM(tokens_in + tokens_out + cache_write) AS tokens FROM usage WHERE run_id = ?").get(runId) as { tokens: number };
      assert.equal(usage.tokens, 2000);
      assert.ok(usage.tokens - 1000 <= 2 * 1000);
    } finally { store.close(); }
  } finally { await h.teardown(); }
});

test('M1-22 creates fanout worktrees, leases ports from 3001 around an occupied port, and opens one pane per variant', async () => {
  const occupied = createServer();
  await new Promise<void>((resolve, reject) => occupied.once('error', reject).listen(3001, '127.0.0.1', () => resolve()));
  const h = await fakeHarness();
  try {
    const { project, projectId } = await openProject(h, 'm1-22');
    initGitProject(project);
    writeFileSync(join(project, 'server.mjs'), serverScript(0));
    execFileSync('git', ['add', 'server.mjs'], { cwd: project, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.name=Metatrooper Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'server'], { cwd: project, stdio: 'ignore' });
    writePipeline(project, {
      schema: 1, id: 'm1-22-fanout', title: 'Fanout',
      steps: [
        { id: 'build', kind: 'agent', engine: 'fake', fanout: 3, worktree: true, browser: true, dev_command: 'node server.mjs {{port}}', prompt: 'FAKE {"outputs":{"ok":"yes"}}', outputs: ['ok'] },
        { id: 'hold', kind: 'gate', gate: 'handoff' }
      ]
    });
    const runId = await startRun(h, 'm1-22-fanout', projectId);
    const store = db(h.home);
    try {
      await until(() => store.prepare("SELECT paused_why FROM run WHERE id = ?").get(runId)?.paused_why === 'handoff', 12000);
      const variants = store.prepare('SELECT idx, worktree, branch, dev_port, pane_id, status FROM variant WHERE run_id = ? ORDER BY idx').all(runId) as
        Array<{ idx: number; worktree: string; branch: string; dev_port: number; pane_id: string; status: string }>;
      assert.equal(variants.length, 3);
      assert.deepEqual(variants.map(v => v.idx), [0, 1, 2]);
      assert.deepEqual(variants.map(v => v.dev_port), [3002, 3003, 3004]);
      assert.equal(new Set(variants.map(v => v.worktree)).size, 3);
      for (const variant of variants) {
        assert.ok(existsSync(join(variant.worktree, '.git')), variant.worktree);
        assert.ok(variant.branch.startsWith('troop/'));
        assert.equal(variant.status, 'ready');
      }
      const leases = (store.prepare('SELECT idx, port FROM port_lease WHERE run_id = ? ORDER BY idx').all(runId) as Array<{ idx: number; port: number }>)
        .map(row => ({ idx: row.idx, port: row.port }));
      assert.deepEqual(leases, [{ idx: 0, port: 3002 }, { idx: 1, port: 3003 }, { idx: 2, port: 3004 }]);
      const panes = store.prepare('SELECT variant, session_id, url, dev_port, open FROM browser_pane WHERE run_id = ? ORDER BY variant').all(runId) as
        Array<{ variant: number; session_id: string | null; url: string; dev_port: number; open: number }>;
      assert.equal(panes.length, 3);
      assert.deepEqual(panes.map(p => p.variant), [0, 1, 2]);
      assert.deepEqual(panes.map(p => p.dev_port), [3002, 3003, 3004]);
      assert.ok(panes.every(p => p.session_id && p.url === `http://127.0.0.1:${p.dev_port}/` && p.open === 1));
    } finally { store.close(); }
  } finally {
    await h.teardown();
    await new Promise<void>(resolve => occupied.close(() => resolve()));
  }
});

test('M1-25c shows a dev_command variant only after readiness and discard kills its process tree and lease', async () => {
  const h = await fakeHarness();
  try {
    const { project, projectId } = await openProject(h, 'm1-25c');
    initGitProject(project);
    writeFileSync(join(project, 'slow-server.mjs'), serverScript(900));
    execFileSync('git', ['add', 'slow-server.mjs'], { cwd: project, stdio: 'ignore' });
    execFileSync('git', ['-c', 'user.name=Metatrooper Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'slow server'], { cwd: project, stdio: 'ignore' });
    writePipeline(project, {
      schema: 1, id: 'm1-25c-dev', title: 'Dev command',
      steps: [
        { id: 'build', kind: 'agent', engine: 'fake', fanout: 2, worktree: true, browser: true, dev_command: 'node slow-server.mjs {{port}}', prompt: 'FAKE {"outputs":{"ok":"yes"}}', outputs: ['ok'] },
        { id: 'hold', kind: 'gate', gate: 'handoff' }
      ]
    });
    const runId = await startRun(h, 'm1-25c-dev', projectId);
    const store = db(h.home);
    try {
      const starting = await until(() => {
        const row = store.prepare("SELECT v.worktree, v.dev_port, v.pane_id, p.url FROM variant v JOIN browser_pane p ON p.id = v.pane_id WHERE v.run_id = ? AND v.idx = 0 AND v.status = 'building'").get(runId) as
          | { worktree: string; dev_port: number; pane_id: string; url: string | null }
          | undefined;
        return row && row.dev_port > 0 ? row : null;
      }, 5000);
      assert.equal(starting.url, null);
      const ready = await until(() => {
        const row = store.prepare("SELECT v.worktree, v.dev_port, v.pane_id, p.url, d.pid FROM variant v JOIN browser_pane p ON p.id = v.pane_id JOIN dev_server d ON d.run_id = v.run_id AND d.idx = v.idx WHERE v.run_id = ? AND v.idx = 0 AND v.status = 'ready'").get(runId) as
          | { worktree: string; dev_port: number; pane_id: string; url: string; pid: number }
          | undefined;
        return row?.url ? row : null;
      }, 12000);
      assert.equal(ready.url, `http://127.0.0.1:${ready.dev_port}/`);
      const parentPid = Number(readFileSync(join(ready.worktree, `server-parent-${ready.dev_port}.pid`), 'utf8'));
      const childPid = Number(readFileSync(join(ready.worktree, `server-child-${ready.dev_port}.pid`), 'utf8'));
      assert.ok(alive(ready.pid));
      assert.ok(alive(parentPid));
      assert.ok(alive(childPid));
      const pipe = await client(h.prefix);
      try {
        const discarded = await pipe.request('variant.discard', { run_id: runId, idx: 0 }, { timeout: 8000 });
        assert.deepEqual(discarded.result, {});
      } finally { pipe.close(); }
      await until(() => !alive(ready.pid) && !alive(parentPid) && !alive(childPid), 5000);
      assert.equal(store.prepare('SELECT 1 FROM dev_server WHERE run_id = ? AND idx = 0').get(runId), undefined);
      assert.equal(store.prepare('SELECT 1 FROM port_lease WHERE run_id = ? AND idx = 0').get(runId), undefined);
      assert.equal((store.prepare('SELECT open FROM browser_pane WHERE id = ?').get(ready.pane_id) as { open: number }).open, 0);
      assert.equal((store.prepare('SELECT status FROM variant WHERE run_id = ? AND idx = 0').get(runId) as { status: string }).status, 'discarded');
    } finally { store.close(); }
  } finally { await h.teardown(); }
});
