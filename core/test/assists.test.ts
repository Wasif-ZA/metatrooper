// tests by Codex
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, startCore, teardownCore, until, uiHello } from './helpers.ts';
import { assistErrors, detectAssists } from '../src/pipelines/assists.ts';

before(buildGenerated);

function db(home: string) {
  const connection = new DatabaseSync(join(home, 'troop.db'));
  connection.exec('PRAGMA busy_timeout = 5000');
  return connection;
}

async function harness() {
  const isolated = isolation();
  const engines = join(isolated.home, 'engines.json');
  const wrapper = join(isolated.home, 'fake-wrapper.mjs');
  writeFileSync(wrapper, `
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const prompt = process.argv[2] ?? '';
const dir = join(process.env.METATROOPER_HOME, 'captured-prompts');
const output = /^When you are done, write your result to:\\s*(.+)$/m.exec(prompt)?.[1]?.trim();
const { existsSync } = await import('node:fs');
const { dirname } = await import('node:path');
if (output) for (let i = 0; i < 140 && !existsSync(join(dirname(output), 'assists.json')); i++) await new Promise(r => setTimeout(r, 50));
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, process.env.TROOP_SESSION_ID + '.txt'), prompt);
await import(${JSON.stringify(new URL('./fake-engine.js', import.meta.url).pathname)});
`);
  writeFileSync(engines, JSON.stringify([{
    id: 'fake', command: process.execPath, args: [wrapper], prompt_arg: 'positional',
    state_source: 'hooks', roles: ['worker', 'review'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
    version_cmd: [process.execPath, '--version'],
  }]));
  const bin = join(isolated.home, 'bin');
  mkdirSync(bin);
  const env = { ...isolated.env, METATROOPER_ENGINES: engines, PATH: `${bin}${delimiter}${process.env.PATH}` };
  const core = await startCore({ ...isolated, env });
  const store = db(isolated.home);
  const pipe = await client(isolated.prefix);
  await uiHello(pipe, isolated.home);
  const project = join(isolated.home, 'project');
  mkdirSync(project);
  const opened = await pipe.request('project.open', { path: project });
  assert.ok(opened.result?.project_id, JSON.stringify(opened));
  return {
    ...isolated, env, core, store, pipe, project, projectId: opened.result.project_id as string, bin,
    async close() { pipe.close(); store.close(); await teardownCore(core, isolated); },
  };
}

function pipeline(id: string, assists: Array<{ tool: string; steps: string[]; use: string }> = [], steps = [{ id: 'review', kind: 'agent', engine: 'fake', prompt: 'Review this change.' }]) {
  return { schema: 1, id, title: id, assists, steps };
}

function writePipeline(project: string, definition: object) {
  const dir = join(project, '.troop', 'pipelines');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${(definition as { id: string }).id}.json`), JSON.stringify(definition));
}

async function run(h: Awaited<ReturnType<typeof harness>>, definition: object) {
  writePipeline(h.project, definition);
  const started = await h.pipe.request('run.start', { pipeline_id: (definition as { id: string }).id, project_id: h.projectId });
  assert.ok(started.result?.run_id, JSON.stringify(started));
  return started.result.run_id as string;
}

test('M4-14 pipeline.validate rejects unknown helper ids and step ids', async () => {
  const h = await harness();
  try {
    const unknownTool = await h.pipe.request('pipeline.validate', { json: pipeline('bad-tool', [{ tool: 'missing-helper', steps: ['review'], use: 'check it' }]) });
    assert.equal(unknownTool.result?.valid, false);
    assert.match(unknownTool.result?.errors?.join('\n') ?? '', /unknown helper missing-helper/);
    const unknownStep = await h.pipe.request('pipeline.validate', { json: pipeline('bad-step', [{ tool: 'semgrep', steps: ['missing-step'], use: 'check it' }]) });
    assert.equal(unknownStep.result?.valid, false);
    assert.match(unknownStep.result?.errors?.join('\n') ?? '', /step missing-step is not in the pipeline/);
  } finally { await h.close(); }
});

test('M4-14 pipeline.validate accepts all five built pipelines and requires registry egress', async () => {
  const h = await harness();
  try {
    for (const id of ['two-engine-review', 'spec-to-pr', 'e2e-browser-qa', 'website-build', 'design-variants']) {
      const definition = JSON.parse(readFileSync(join(root, 'pipelines', `${id}.json`), 'utf8'));
      const checked = await h.pipe.request('pipeline.validate', { json: definition });
      assert.equal(checked.result?.valid, true, `${id}: ${JSON.stringify(checked.result?.errors)}`);
    }
    const registryPath = join(root, 'pipelines', 'assists', 'registry.json');
    const registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    const withoutEgress = { ...registry.semgrep };
    delete withoutEgress.egress;
    assert.match(assistErrors(pipeline('missing-egress', [{ tool: 'semgrep', steps: ['review'], use: 'check it' }]), { semgrep: withoutEgress }).join('\n'), /has no egress/);
  } finally { await h.close(); }
});

test('M4-15 a detected semgrep helper is included in the agent prompt', async () => {
  const h = await harness();
  try {
    if (process.platform === 'win32') {
      writeFileSync(join(h.bin, 'semgrep.cmd'), '@echo off\necho semgrep 9.9.9\n');
    } else {
      const semgrep = join(h.bin, 'semgrep');
      writeFileSync(semgrep, '#!/bin/sh\necho semgrep 9.9.9\n', { mode: 0o755 });
    }
    const definition = pipeline('semgrep-prompt', [{ tool: 'semgrep', steps: ['review'], use: 'run rule checks on this change' }], [
      { id: 'review', kind: 'agent', engine: 'fake', prompt: 'Review this change.' },
    ]);
    const runId = await run(h, definition);
    const runDir = h.store.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId).run_dir as string;
    await until(() => existsSync(join(runDir, 'assists.json')), 8000);
    const step = await until(() => h.store.prepare("SELECT session_id FROM run_step WHERE run_id = ? AND step_id = 'review' AND session_id IS NOT NULL").get(runId) as { session_id: string } | undefined, 10000);
    const prompt = join(h.home, 'captured-prompts', `${step.session_id}.txt`);
    await until(() => existsSync(prompt), 5000);
    assert.match(readFileSync(prompt, 'utf8'), /Helpers installed on this machine[\s\S]*- Semgrep: run rule checks on this change/);
  } finally { await h.close(); }
});

test('M4-15 absent helpers leave the rendered prompt unchanged', async () => {
  const h = await harness();
  try {
    const definition = pipeline('no-helper-prompt', [{ tool: 'semgrep', steps: ['review'], use: 'run rule checks on this change' }]);
    const runId = await run(h, definition);
    const step = await until(() => h.store.prepare("SELECT session_id FROM run_step WHERE run_id = ? AND step_id = 'review' AND session_id IS NOT NULL").get(runId) as { session_id: string } | undefined, 10000);
    const prompt = join(h.home, 'captured-prompts', `${step.session_id}.txt`);
    await until(() => existsSync(prompt), 5000);
    const actual = readFileSync(prompt, 'utf8');
    assert.ok(!actual.includes('Helpers installed on this machine'));
    assert.ok(actual.startsWith('Review this change.'));
  } finally { await h.close(); }
});

test('M4-16 helper detection times out and records the helper as not installed', async () => {
  const h = await harness();
  try {
    if (process.platform === 'win32') {
      writeFileSync(join(h.bin, 'semgrep.cmd'), '@echo off\nping -n 30 127.0.0.1 > nul\necho late\n');
    } else {
      const semgrep = join(h.bin, 'semgrep');
      writeFileSync(semgrep, '#!/bin/sh\nwhile :; do :; done\n', { mode: 0o755 });
    }
    const registry = JSON.parse(readFileSync(join(root, 'pipelines/assists/registry.json'), 'utf8'));
    const definition = pipeline('semgrep-timeout', [{ tool: 'semgrep', steps: ['review'], use: 'run checks' }]);
    const runDir = join(h.project, '.troop/runs', 'timeout-test');
    mkdirSync(runDir, { recursive: true });
    const startedAt = Date.now();
    const result = await detectAssists({ ...definition, assists: definition.assists } as any, runDir, h.project);
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed <= 5500, `run start took ${elapsed} ms`);
    assert.deepEqual(result, [{ tool: 'semgrep', installed: false, version: null }]);
  } finally { await h.close(); }
});
