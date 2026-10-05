import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

const driverSource = String.raw`
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const argvFile = process.argv[2];
const received = process.argv.slice(3);
const prompt = received.find(value => value.startsWith('You are driving')) ?? '';
writeFileSync(argvFile, JSON.stringify(received));
const command = prompt.split(/\r?\n/).find(line => line.includes('print-timeout'));
if (!command) throw new Error('agy command not found in driver prompt');
const output = /The step is done when this file exists:\s*(.+)/i.exec(prompt)?.[1]?.trim().replace(/[.,]$/, '');
const followup = output.replace(/\.md$/, '.followup.md');
const commandArg = output.replace(/\.md$/, '.prompt.md');
const countFile = join(dirname(output), 'agy-turn-count');
const fake = process.env.FAKE_AGY_SCRIPT;
let promptFile = commandArg;
const requiredLine = prompt.split(/\r?\n/).find(line => line.includes('plus these keys:')) ?? '';
const required = requiredLine.split('plus these keys:')[1]?.trim().split(/,\s*/).filter(Boolean) ?? [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const frontMatter = text => /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1] ?? '';
const contractMissing = () => {
  let text;
  try { text = readFileSync(output, 'utf8'); } catch { return ['the output file']; }
  const matter = frontMatter(text);
  if (!matter) return ['a front matter block'];
  const fields = new Set(matter.split(/\r?\n/).map(line => line.match(/^([^:#]+):/)?.[1]?.trim()).filter(Boolean));
  const missing = [];
  if (!fields.has('status')) missing.push('status');
  missing.push(...required.filter(key => !fields.has(key)));
  return missing;
};
let missing = [];
for (let turn = 1; turn <= 3; turn += 1) {
  if (!fake) throw new Error('fake agy script not configured');
  spawnSync(process.execPath, [fake, promptFile, output], { env: process.env });
  missing = contractMissing();
  if (!missing.length) process.exit(0);
  if (turn < 3) {
    const currentPrompt = readFileSync(promptFile, 'utf8');
    writeFileSync(followup, currentPrompt + String.fromCharCode(10) + 'Missing: ' + missing.join(', ') + '.' + String.fromCharCode(10));
    if (process.env.FAKE_AGY_MODE === 'missing-then-full') await sleep(1000);
    promptFile = followup;
  }
}
writeFileSync(output, ['---', 'status: failed', 'reason: missing ' + missing.join(', '), '---', ''].join(String.fromCharCode(10)));
`;

function agyScript(mode: 'third' | 'never' | 'missing-then-full') {
  return String.raw`
import { readFileSync, writeFileSync } from 'node:fs';
const prompt = readFileSync(process.argv[2], 'utf8');
const output = process.argv[3];
let turn = 0;
try { turn = Number(readFileSync(process.env.FAKE_AGY_COUNT, 'utf8')); } catch {}
turn += 1;
writeFileSync(process.env.FAKE_AGY_COUNT, String(turn));
const keys = process.env.FAKE_AGY_KEYS.split(',');
const full = ['---', 'status: done', ...keys.map(key => key + ': value'), '---', ''].join(String.fromCharCode(10));
if ('${mode}' === 'third' && turn === 3) writeFileSync(output, full);
if ('${mode}' === 'missing-then-full') writeFileSync(output, turn === 1 ? ['---', 'status: done', keys[0] + ': partial', '---', ''].join(String.fromCharCode(10)) : full);
`;
}

function db(home: string) {
  const connection = new DatabaseSync(join(home, 'troop.db'));
  connection.exec('PRAGMA busy_timeout = 2000');
  return connection;
}

async function harness(options: { removeDriver?: boolean; unavailableDriver?: boolean; agyPath?: string } = {}) {
  const isolated = isolation();
  const registryPath = join(isolated.home, 'engines.json');
  const claudeArgv = join(isolated.home, 'claude-argv.json');
  const fakeDriver = join(isolated.home, 'claude-driver.mjs');
  writeFileSync(fakeDriver, driverSource);
  const builtins = (await import('../src/engines/registry.ts')).BUILT_IN;
  const specs = builtins.map(engine => {
    if (engine.id === 'claude') return { ...engine, command: process.execPath, args: [fakeDriver, claudeArgv], auth_cmd: undefined };
    if (engine.id === 'agy') return {
      ...engine,
      command: process.execPath,
      args: [options.agyPath ?? join(isolated.home, 'noop-agy.mjs')],
      ...(options.removeDriver ? { driver: null } : {}),
    };
    return engine;
  });
  writeFileSync(registryPath, JSON.stringify(specs));
  const env = { ...isolated.env, METATROOPER_ENGINES: registryPath, ...(options.agyPath ? {
    FAKE_AGY_SCRIPT: options.agyPath,
    FAKE_AGY_MODE: options.agyPath.split('fake-agy-').at(-1)?.replace('.mjs', ''),
    FAKE_AGY_COUNT: join(isolated.home, 'agy-count'),
    FAKE_AGY_KEYS: options.agyPath.includes('missing-then-full') ? 'answer,summary' : 'answer',
  } : {}) };
  const core = await startCore({ ...isolated, env });
  const store = db(isolated.home);
  try {
    await until(() => store.prepare("SELECT 1 FROM engine_check WHERE engine_id = 'agy'").get(), 5000);
    if (options.unavailableDriver) {
      store.prepare("UPDATE engine_check SET installed = 0, checked_at = ? WHERE engine_id = 'claude'").run(new Date(Date.now() + 60000).toISOString());
    }
  } finally { store.close(); }
  return { ...isolated, env, core, claudeArgv, async teardown() { await teardownCore(core, isolated); } };
}

async function openProject(h: Awaited<ReturnType<typeof harness>>, name: string, acu = false) {
  const project = join(h.home, name);
  mkdirSync(acu ? join(project, 'work', 'ACU') : project, { recursive: true });
  const pipe = await client(h.prefix);
  try {
    const opened = await pipe.request('project.open', { path: project });
    assert.ok(opened.result?.project_id, JSON.stringify(opened));
    return { project, projectId: opened.result.project_id as string };
  } finally { pipe.close(); }
}

function writePipeline(project: string, id: string, outputs = ['answer']) {
  const dir = join(project, '.troop', 'pipelines');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({
    schema: 1, id, title: id, steps: [{ id: 'work', kind: 'agent', engine: 'agy', prompt: 'Do the work.', outputs }],
  }));
}

async function startRun(h: Awaited<ReturnType<typeof harness>>, pipelineId: string, projectId: string) {
  const pipe = await client(h.prefix);
  try {
    const started = await pipe.request('run.start', { pipeline_id: pipelineId, project_id: projectId }, { timeout: 5000 });
    assert.ok(started.result?.run_id, JSON.stringify(started));
    return started.result.run_id as string;
  } finally { pipe.close(); }
}

async function awaitRun(h: Awaited<ReturnType<typeof harness>>, runId: string, status: string) {
  const store = db(h.home);
  try {
    try { await until(() => store.prepare('SELECT status FROM run WHERE id = ?').get(runId)?.status === status, 15000); }
    catch (error) {
      const runDir = store.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId).run_dir;
      const row = store.prepare('SELECT status, output_path FROM run_step WHERE run_id = ?').get(runId);
      const files = readFileSync(join(runDir, 'log.jsonl'), 'utf8');
      throw new Error(`${(error as Error).message}; run=${JSON.stringify(store.prepare('SELECT status FROM run WHERE id = ?').get(runId))}; step=${JSON.stringify(row)}; log=${files}`);
    }
    return {
      run: store.prepare('SELECT status FROM run WHERE id = ?').get(runId) as { status: string },
      step: store.prepare('SELECT engine_id, status, output_path, session_id FROM run_step WHERE run_id = ?').get(runId) as { engine_id: string; status: string; output_path: string; session_id: string },
      session: store.prepare('SELECT engine_id, driven_engine FROM session WHERE id = (SELECT session_id FROM run_step WHERE run_id = ?)').get(runId) as { engine_id: string; driven_engine: string | null } | undefined,
      events: readFileSync(join(store.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId).run_dir, 'log.jsonl'), 'utf8'),
    };
  } finally { store.close(); }
}

test('agy steps launch claude and persist the driver prompt and step prompt file', async () => {
  const h = await harness();
  try {
    const { project, projectId } = await openProject(h, 'driver-prompt');
    writePipeline(project, 'agy-driver-prompt', ['answer', 'summary']);
    const runId = await startRun(h, 'agy-driver-prompt', projectId);
    const result = await awaitRun(h, runId, 'failed');
  assert.equal(result.session?.engine_id, 'claude');
    assert.equal(result.session?.driven_engine, 'agy');
    assert.equal(result.step.engine_id, 'claude');
  const prompt = (JSON.parse(readFileSync(h.claudeArgv, 'utf8')) as string[]).at(-1)!;
    assert.ok(prompt.includes(result.step.output_path));
    assert.match(prompt, /answer, summary/);
    assert.match(prompt, /--print/);
    assert.match(prompt, /--print-timeout 0/);
    assert.match(prompt, /--output-format text/);
    assert.match(prompt, /--add-dir/);
    assert.match(prompt, /--mode accept-edits --sandbox/);
    assert.doesNotMatch(prompt, /--permission-mode/);
    assert.ok(readFileSync(result.step.output_path.replace(/\.md$/, '.prompt.md'), 'utf8').includes('Do the work.'));
  } finally { await h.teardown(); }
});

test('agy driver uses ask approval in a work/ACU folder', async () => {
  const h = await harness();
  try {
    const { project, projectId } = await openProject(h, 'acu-driver', true);
    writePipeline(project, 'agy-acu-driver');
    const runId = await startRun(h, 'agy-acu-driver', projectId);
    const result = await awaitRun(h, runId, 'failed');
    const prompt = JSON.parse(readFileSync(h.claudeArgv, 'utf8')) as string[];
    assert.equal(result.session?.driven_engine, 'agy');
    assert.doesNotMatch(prompt.at(-1)!, /--mode|--sandbox/);
    assert.doesNotMatch(prompt.at(-1)!, /--permission-mode/);
  } finally { await h.teardown(); }
});

test('removing agy driver launches agy directly', async () => {
  const h = await harness({ removeDriver: true });
  try {
    const { project, projectId } = await openProject(h, 'direct-agy');
    writePipeline(project, 'agy-direct');
    const runId = await startRun(h, 'agy-direct', projectId);
    const result = await awaitRun(h, runId, 'failed');
    assert.equal(result.session?.engine_id, 'agy');
    assert.equal(result.session?.driven_engine, null);
    assert.equal(result.step.engine_id, 'agy');
  } finally { await h.teardown(); }
});

test('unusable claude driver falls back to agy and records the unavailable driver', async () => {
  const h = await harness({ unavailableDriver: true });
  try {
    const { project, projectId } = await openProject(h, 'missing-driver');
    writePipeline(project, 'agy-missing-driver');
    const runId = await startRun(h, 'agy-missing-driver', projectId);
    const result = await awaitRun(h, runId, 'failed');
    assert.equal(result.session?.engine_id, 'agy');
    assert.equal(result.session?.driven_engine, null);
    assert.match(result.events, /"event":"driver unavailable"/);
  } finally { await h.teardown(); }
});

async function loopCase(mode: 'third' | 'never' | 'missing-then-full') {
  const isolated = isolation();
  const agyPath = join(isolated.home, `fake-agy-${mode}.mjs`);
  writeFileSync(agyPath, agyScript(mode));
  const h = await harness({ agyPath });
  const { project, projectId } = await openProject(h, `loop-${mode}`);
  writePipeline(project, `agy-loop-${mode}`, mode === 'missing-then-full' ? ['answer', 'summary'] : ['answer']);
  const runId = await startRun(h, `agy-loop-${mode}`, projectId);
  return { h, runId };
}

test('driver retries agy until its third turn writes the required output', async () => {
  const { h, runId } = await loopCase('third');
  try {
    const result = await awaitRun(h, runId, 'done');
    assert.equal(result.step.status, 'done');
    const output = readFileSync(result.step.output_path, 'utf8');
    assert.match(output, /answer: value/);
  } finally { await h.teardown(); }
});

test('driver fails after three agy turns and preserves its failure reason', async () => {
  const { h, runId } = await loopCase('never');
  try {
    const result = await awaitRun(h, runId, 'failed');
    assert.equal(readFileSync(join(h.home, 'agy-count'), 'utf8'), String(3));
    assert.match(result.events, /wrote status: failed/);
  } finally { await h.teardown(); }
});

test('driver waits for a missing required key while agy remains active', async () => {
  const { h, runId } = await loopCase('missing-then-full');
  try {
    const result = await awaitRun(h, runId, 'done');
    assert.match(readFileSync(result.step.output_path, 'utf8'), /summary: value/);
    assert.equal(result.step.status, 'done');
  } finally { await h.teardown(); }
});
