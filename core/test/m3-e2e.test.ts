import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, root, until } from './helpers.ts';
import { revisionHarness } from './ui-revision-helpers.ts';
import { capturingEngine } from './pipeline-fixup-helpers.ts';

before(buildGenerated);

type Harness = Awaited<ReturnType<typeof revisionHarness>>;

function builtin(id: string, fake: Record<string, unknown>) {
  const def = JSON.parse(readFileSync(join(root, `pipelines/${id}.json`), 'utf8'));
  for (const step of def.steps) {
    if (step.kind !== 'agent') continue;
    step.engine = 'fake';
    step.prompt = `FAKE ${JSON.stringify(fake[step.id] ?? { outputs: { summary: step.id } })}\n${step.prompt}`;
    if (step.dev_command) step.dev_command = `"${process.execPath}" -e "require('http').createServer((q,s)=>s.end('ok')).listen({{port}})"`;
  }
  return def;
}

const steps = (h: Harness, runId: string) =>
  h.db.prepare('SELECT step_id, status FROM run_step WHERE run_id = ? ORDER BY rowid').all(runId).map((r: any) => `${r.step_id}:${r.status}`);

async function close(h: Harness) {
  try { await h.close(); } catch (error: any) { if (error?.code !== 'EPERM') throw error; }
}

test('M3-01 data-to-dashboard loads the CSV, runs every step and stops at the signoff gate', async () => {
  const h = await revisionHarness(undefined, capturingEngine);
  try {
    const csv = join(h.project, 'orders.csv');
    writeFileSync(csv, 'order_id,date,region,qty,unit_price\nT-1,2026-09-21,north,2,14.50\nT-2,21/09/2026,South,1,$18.00\nT-2,21/09/2026,South,1,$18.00\nT-3,2026-09-22,,3,9.80\n');
    const def = builtin('data-to-dashboard', {
      clean: { outputs: { table: 'clean', rows: 3 } },
      qa: { outputs: { passed: true } },
      readback: { outputs: { verdict: 'pass' } },
    });
    const runId = await h.pipeline(def, { csv });
    const gate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'signoff' AND status = 'waiting'").get(runId), 60000);
    assert.equal(gate.kind ?? 'handoff', 'handoff');
    assert.equal((h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status, 'paused');
    assert.deepEqual(steps(h, runId).filter((s) => !s.startsWith('signoff')), ['load', 'clean', 'qa', 'plan', 'build', 'readback', 'narrate'].map((s) => `${s}:done`));
    const load = JSON.parse((h.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'load'").get(runId) as any).outputs);
    assert.equal(load.rows, 4);
    assert.deepEqual(load.columns, ['order_id', 'date', 'region', 'qty', 'unit_price']);
    const data = new DatabaseSync(load.db, { readOnly: true });
    try { assert.equal((data.prepare('SELECT COUNT(*) n FROM raw').get() as any).n, 4); } finally { data.close(); }
    assert.equal(readFileSync(csv, 'utf8').split('\n').length, 6);
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined })).result, {});
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status === 'done', 30000);
  } finally { await close(h); }
});
