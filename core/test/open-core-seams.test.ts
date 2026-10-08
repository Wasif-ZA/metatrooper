import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { revisionHarness } from './ui-revision-helpers.ts';
import { capturingEngine } from './pipeline-fixup-helpers.ts';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, startCore, teardownCore, uiHello, until } from './helpers.ts';

before(buildGenerated);

async function seams() {
  const iso = isolation();
  const project = join(iso.home, 'project');
  mkdirSync(project);
  execFileSync('git', ['init', '-q', project]);
  const fake = join(root, 'core/test/fake-engine.js');
  const engine = (id: string, extra: object) => ({ id, command: process.execPath, args: [fake], prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], version_cmd: [process.execPath, '--version'], ...extra });
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([engine('gw', { provider: 'gateway', cost_rank: 0 }), engine('fake', { cost_rank: 1 })]));
  const env = { ...iso.env, METATROOPER_ENGINES: registry, METATROOPER_CLAUDE_SETTINGS: join(iso.home, 'claude-settings.json'), METATROOPER_CODEX_CONFIG: join(iso.home, 'codex-config.toml') };
  const core = await startCore({ ...iso, env });
  const db = new DatabaseSync(join(iso.home, 'troop.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  const pipe = await client(iso.prefix);
  await uiHello(pipe, iso.home);
  const projectId = (await pipe.request('project.open', { path: project })).result.project_id;
  const pipeline = (def: object) => {
    mkdirSync(join(project, '.troop/pipelines'), { recursive: true });
    writeFileSync(join(project, '.troop/pipelines', `${(def as any).id}.json`), JSON.stringify(def));
  };
  const counts = () => ['session', 'run', 'run_step', 'gate'].map((t) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as any).n);
  return { iso, core, db, pipe, project, projectId, pipeline, counts, async close() { pipe.close(); db.close(); await teardownCore(core, iso); } };
}

const step = (extra: object) => ({ id: 'work', kind: 'agent', role: 'worker', approval: 'edits', prompt: 'FAKE {"outputs":{"summary":"ok"}}\nWork.', outputs: ['summary'], ...extra });

test('M3-06 provider gateway and run_in cloud are refused with -32040 and leave no rows or run folders', async () => {
  const h = await seams();
  try {
    await until(() => h.db.prepare("SELECT 1 FROM engine_check WHERE engine_id = 'fake' AND installed = 1").get(), 15000);
    const before = h.counts();
    const launch = await h.pipe.request('session.launch', { project_id: h.projectId, engine_id: 'gw' });
    assert.equal(launch.error?.code, -32040);
    h.pipeline({ schema: 1, id: 'pinned-gateway', title: 'Pinned gateway', steps: [step({ engine: 'gw' })] });
    const pinned = await h.pipe.request('run.start', { pipeline_id: 'pinned-gateway', project_id: h.projectId });
    assert.equal(pinned.error?.code, -32040);
    assert.match(pinned.error.message, /step work: gateway engine gw/);
    h.pipeline({ schema: 1, id: 'cloud-run', title: 'Cloud run', run_in: 'cloud', steps: [step({ engine: 'fake' })] });
    assert.equal((await h.pipe.request('run.start', { pipeline_id: 'cloud-run', project_id: h.projectId })).error?.code, -32040);
    assert.deepEqual(h.counts(), before);
    assert.equal(existsSync(join(h.project, '.troop/runs')) ? readdirSync(join(h.project, '.troop/runs')).length : 0, 0);
  } finally { await h.close(); }
});

test('M3-06 a role step never binds a gateway engine, even when it is the cheapest', async () => {
  const h = await seams();
  try {
    await until(() => h.db.prepare("SELECT COUNT(*) n FROM engine_check WHERE installed = 1").get()?.n === 2, 15000);
    h.pipeline({ schema: 1, id: 'by-role', title: 'By role', steps: [step({})] });
    const runId = (await h.pipe.request('run.start', { pipeline_id: 'by-role', project_id: h.projectId })).result.run_id;
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any)?.status === 'done', 30000);
    assert.equal((h.db.prepare("SELECT engine_id FROM run_step WHERE run_id = ? AND step_id = 'work'").get(runId) as any).engine_id, 'fake');
  } finally { await h.close(); }
});

test('M3-06 signed out, a full spec-to-pr run makes no outbound connection from the core or its Node children', async () => {
  const log = join(isolation().home, 'outbound.log');
  const prev = { NODE_OPTIONS: process.env.NODE_OPTIONS, TROOP_NO_NET_LOG: process.env.TROOP_NO_NET_LOG };
  process.env.NODE_OPTIONS = `${prev.NODE_OPTIONS ?? ''} --import=${pathToFileURL(join(root, 'core/test/no-network-hook.mjs')).href}`;
  process.env.TROOP_NO_NET_LOG = log;
  let h: Awaited<ReturnType<typeof revisionHarness>>;
  try { h = await revisionHarness('spec-to-pr', capturingEngine); } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try {
    assert.deepEqual((await h.pipe.request('account.state', {})).result, { state: 'signed_out' });
    const def = JSON.parse(readFileSync(join(root, 'pipelines/spec-to-pr.json'), 'utf8'));
    for (const s of def.steps) {
      if (s.kind !== 'agent') continue;
      s.engine = 'fake';
      const d = s.id === 'spec' ? { outputs: { title: 'Add greet' } } : s.id === 'build' ? { files: { 'greet.js': 'export const greet = (n) => n;\n' }, commit: 'Add greet', outputs: { summary: 'Adds greet.' } } : { outputs: { summary: s.id } };
      s.prompt = `FAKE ${JSON.stringify(d)}\n${s.prompt}`;
    }
    const runId = await h.pipeline(def, { idea: readFileSync(join(h.project, 'idea.md'), 'utf8'), repo: 'fake/repo' });
    for (;;) {
      const status = await until(() => {
        const r = h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any;
        return r.status === 'paused' || r.status === 'done' || r.status === 'failed' ? r.status : null;
      }, 60000);
      if (status !== 'paused') { assert.equal(status, 'done'); break; }
      const gate: any = h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND status = 'waiting'").get(runId);
      assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined })).result, {});
      await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status !== 'paused', 10000);
    }
    assert.equal(existsSync(log) ? readFileSync(log, 'utf8') : '', '');
  } finally { await h.close(); }
});
