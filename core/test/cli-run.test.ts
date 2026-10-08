import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGenerated, isolation, runNode, startCore, teardownCore } from './helpers.ts';

before(buildGenerated);

test('M1-31 troop run start --json from an agent session starts a run and run wait returns at its first gate', async () => {
  const isolated = isolation();
  const core = await startCore(isolated);
  try {
    const project = join(isolated.home, 'cli-run');
    const dir = join(project, '.troop', 'pipelines');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'gate-only.json'), JSON.stringify({
      schema: 1, id: 'gate-only', title: 'Gate only',
      inputs: { topic: { type: 'text' } },
      steps: [{ id: 'approve', kind: 'gate', gate: 'approve', gate_summary: 'approve {{inputs.topic}}' }],
    }));
    const env = { ...isolated.env, TROOP_SESSION_ID: 'agent-session-1' };
    const started = await runNode(['core/cli.ts', 'run', 'start', 'gate-only', '--project', project, '--input', 'topic=abc', '--json'], env);
    assert.equal(started.code, 0, started.stderr || started.stdout);
    const lines = started.stdout.trim().split('\n');
    const runId = JSON.parse(lines[lines.length - 1]).run_id;
    assert.ok(runId);

    const waited = await runNode(['core/cli.ts', 'run', 'wait', runId, '--timeout', '10', '--json'], env);
    assert.equal(waited.code, 0, waited.stderr || waited.stdout);
    const out = JSON.parse(waited.stdout.trim());
    assert.equal(out.status, 'paused');
    assert.equal(out.paused_why, 'gate');
    assert.equal(out.gates.length, 1);
    assert.equal(out.gates[0].summary, 'approve abc');
  } finally { await teardownCore(core, isolated); }
});

test('M4-07 F7 troop run cancel prints the cancelled run id', async () => {
  const isolated = isolation();
  const core = await startCore(isolated);
  try {
    const project = join(isolated.home, 'cli-cancel');
    mkdirSync(join(project, '.troop', 'pipelines'), { recursive: true });
    writeFileSync(join(project, '.troop', 'pipelines', 'gate-only.json'), JSON.stringify({
      schema: 1, id: 'gate-only', title: 'Gate only',
      steps: [{ id: 'approve', kind: 'gate', gate: 'approve', gate_summary: 'approve' }],
    }));
    const env = isolated.env;
    const started = await runNode(['core/cli.ts', 'run', 'start', 'gate-only', '--project', project, '--json'], env);
    assert.equal(started.code, 0, started.stderr || started.stdout);
    const runId = JSON.parse(started.stdout.trim()).run_id;
    const cancelled = await runNode(['core/cli.ts', 'run', 'cancel', runId], env);
    assert.equal(cancelled.code, 0, cancelled.stderr || cancelled.stdout);
    assert.match(cancelled.stdout, new RegExp(`cancelled ${runId}`));
  } finally { await teardownCore(core, isolated); }
});

test('M4-07 F7 troop run cancel --json prints an empty object', async () => {
  const isolated = isolation();
  const core = await startCore(isolated);
  try {
    const project = join(isolated.home, 'cli-cancel-json');
    mkdirSync(join(project, '.troop', 'pipelines'), { recursive: true });
    writeFileSync(join(project, '.troop', 'pipelines', 'gate-only.json'), JSON.stringify({
      schema: 1, id: 'gate-only', title: 'Gate only',
      steps: [{ id: 'approve', kind: 'gate', gate: 'approve', gate_summary: 'approve' }],
    }));
    const env = isolated.env;
    const started = await runNode(['core/cli.ts', 'run', 'start', 'gate-only', '--project', project, '--json'], env);
    assert.equal(started.code, 0, started.stderr || started.stdout);
    const runId = JSON.parse(started.stdout.trim()).run_id;
    const cancelled = await runNode(['core/cli.ts', 'run', 'cancel', runId, '--json'], env);
    assert.equal(cancelled.code, 0, cancelled.stderr || cancelled.stdout);
    assert.deepEqual(JSON.parse(cancelled.stdout.trim()), {});
  } finally { await teardownCore(core, isolated); }
});

test('M4-07 F7 troop run cancel reports an unknown run error', async () => {
  const isolated = isolation();
  const core = await startCore(isolated);
  try {
    const cancelled = await runNode(['core/cli.ts', 'run', 'cancel', 'missing-run'], isolated.env);
    assert.equal(cancelled.code, 1);
    assert.match(cancelled.stderr, /error -32002: run not found/i);
  } finally { await teardownCore(core, isolated); }
});
