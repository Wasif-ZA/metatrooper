import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    copyFileSync(join(root, 'tests/fixtures/data-to-dashboard/input/orders.csv'), csv);
    const def = builtin('data-to-dashboard', {
      clean: { outputs: { table: 'clean', rows: 19 } },
      qa: { outputs: { passed: true } },
      readback: { outputs: { verdict: 'pass' } },
    });
    const runId = await h.pipeline(def, { csv });
    const gate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'signoff' AND status = 'waiting'").get(runId), 60000);
    assert.equal(gate.kind, 'handoff');
    assert.equal((h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status, 'paused');
    assert.deepEqual(steps(h, runId).filter((s) => !s.startsWith('signoff')), ['load', 'clean', 'qa', 'plan', 'build', 'readback', 'narrate'].map((s) => `${s}:done`));
    const load = JSON.parse((h.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'load'").get(runId) as any).outputs);
    const [header, ...body] = readFileSync(csv, 'utf8').trim().split(/\r?\n/);
    assert.equal(load.rows, body.length);
    assert.deepEqual(load.columns, header.split(','));
    const data = new DatabaseSync(load.db, { readOnly: true });
    try { assert.equal((data.prepare('SELECT COUNT(*) n FROM raw').get() as any).n, body.length); } finally { data.close(); }
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined })).result, {});
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status === 'done', 30000);
  } finally { await close(h); }
});

async function research(report: string) {
  const h = await revisionHarness(undefined, capturingEngine);
  const def = builtin('deep-research-cited', {
    decompose: { outputs: { summary: 'six items' }, run_files: { 'plan.md': 'search: green roof indoor temperature' } },
    draft: { outputs: { document: 'report.md', sources: '[]' }, run_files: { 'report.md': report } },
    critics: { outputs: { findings: 'critics.json' } },
  });
  // The search action needs Exa over the network, so a fake step stands in; the fixture sources are copied in at the plan gate.
  def.steps[def.steps.findIndex((s: any) => s.id === 'sweep')] = { id: 'sweep', title: 'Search and save sources', role: 'research', kind: 'agent', engine: 'fake', approval: 'edits', outputs: ['count'], prompt: 'FAKE {"outputs":{"count":2}}\nSearch.' };
  try {
    const question = readFileSync(join(root, 'tests/fixtures/deep-research-cited/input/question.md'), 'utf8').trim();
    const runId = await h.pipeline(def, { question });
    const gate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve-plan' AND status = 'waiting'").get(runId), 60000);
    const runDir = (h.db.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId) as any).run_dir;
    assert.equal(gate.kind, 'approve');
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'sweep' AND status <> 'pending'").get(runId) as any).n, 0);
    cpSync(join(root, 'tests/fixtures/deep-research-cited/input/sources'), join(runDir, 'sources'), { recursive: true });
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined })).result, {});
    return { h, runId, runDir };
  } catch (error) { await close(h); throw error; }
}

const realQuotes = '# Green roofs\n\nIn one trial "the green roof reduced peak indoor temperature by 2.1 degrees on the top floor" [s01]. A review found "the largest effects in buildings that had little or no roof insulation" [s02].\n';

test('M3-01 deep-research-cited stops at the plan gate, then cite-check passes a report quoting the fixture sources', async () => {
  const { h, runId } = await research(realQuotes);
  try {
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status === 'done', 60000);
    const check = JSON.parse((h.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'cite-check' ORDER BY iteration DESC").get(runId) as any).outputs);
    assert.deepEqual([check.passed, check.claims_total, check.bound], [true, 2, 2]);
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'depth' AND status = 'done'").get(runId) as any).n, 4);
  } finally { await close(h); }
});

test('M3-01 deep-research-cited pauses at loop-max when a planted quote is not in its source', async () => {
  const { h, runId } = await research(realQuotes.replace('by 2.1 degrees', 'by 6 degrees'));
  try {
    await until(() => h.db.prepare("SELECT 1 FROM run WHERE id = ? AND status = 'paused' AND paused_why = 'loop-max'").get(runId), 60000);
    const check = JSON.parse((h.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'cite-check' ORDER BY iteration DESC").get(runId) as any).outputs);
    assert.equal(check.passed, false);
    assert.deepEqual(check.unbound.map((u: any) => u.reason.split(':')[0]), ['quote not found in s01']);
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'cite-check'").get(runId) as any).n, 2);
  } finally { await close(h); }
});

function fakeVercel(h: Harness) {
  const log = join(h.iso.home, 'vercel.log');
  writeFileSync(join(h.iso.home, 'bin', process.platform === 'win32' ? 'vercel.cmd' : 'vercel'), process.platform === 'win32'
    ? `@echo off\r\necho %*>>"${log}"\r\necho https://prod.test/site\r\n`
    : `#!/bin/sh\necho "$@" >> '${log}'\necho https://prod.test/site\n`, { mode: 0o755 });
  return () => existsSync(log) ? readFileSync(log, 'utf8').trim().split(/\r?\n/) : [];
}

test('M3-01 seo-audit-fix audits five areas, fixes in a worktree and deploys only after approve', async () => {
  const h = await revisionHarness(undefined, capturingEngine);
  try {
    mkdirSync(join(h.project, '.vercel'), { recursive: true }); writeFileSync(join(h.project, '.vercel/project.json'), '{}');
    const calls = fakeVercel(h);
    const def = builtin('seo-audit-fix', {
      audit: { outputs: { findings: 'audit.json' } },
      prioritise: { outputs: { summary: 'ranked', key_pages: '/, /menu, /contact' } },
      fix: { outputs: { summary: 'titles and alt text fixed' } },
      speed: { outputs: { passed: true, scores: '/ 96, /menu 93, /contact 98' } },
    });
    // The crawl action refuses loopback hosts, so a fake step stands in for it; plugin unit tests cover crawl.
    def.steps[0] = { id: 'crawl', title: 'Crawl the site', role: 'ingest', kind: 'agent', engine: 'fake', approval: 'edits', outputs: ['pages'], prompt: 'FAKE {"outputs":{"pages":3},"run_files":{"crawl.json":"[]"}}\nCrawl.' };
    const runId = await h.pipeline(def, { url: 'https://bakery.example', market: 'bakery' });
    const gate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve' AND status = 'waiting'").get(runId), 60000);
    assert.equal(gate.guards_step, 'deploy'); assert.match(gate.action_hash, /^[0-9a-f]{64}$/);
    assert.match(gate.summary, /titles and alt text fixed/); assert.match(gate.summary, /\/menu 93/);
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'audit' AND status = 'done'").get(runId) as any).n, 5);
    assert.deepEqual(calls(), []);
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'deploy' AND status = 'done'").get(runId) as any).n, 0);
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash })).result, {});
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status === 'done', 30000);
    assert.deepEqual(calls(), ['deploy --yes --prod']);
  } finally { await close(h); }
});
