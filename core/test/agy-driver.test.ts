import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

type Mode = 'never' | 'second' | 'vary' | 'same' | 'denied' | 'partial-then-full';

const agySource = String.raw`
import { readFileSync, writeFileSync } from 'node:fs';
const argv = process.argv.slice(2);
writeFileSync(process.env.FAKE_AGY_ARGV, JSON.stringify(argv));
const at = argv.indexOf('--print');
const prompt = at >= 0 ? argv[at + 1] : '';
const output = /^When you are done, write your result to:\s*(.+)$/m.exec(prompt)?.[1]?.trim();
const keys = /containing these keys:\s*(.*?)\s*and status:/m.exec(prompt)?.[1]?.split(',').map(k => k.trim()).filter(Boolean) ?? [];
let turn = 0;
try { turn = Number(readFileSync(process.env.FAKE_AGY_COUNT, 'utf8')); } catch {}
turn += 1;
writeFileSync(process.env.FAKE_AGY_COUNT, String(turn));
const nl = String.fromCharCode(10);
const full = ['---', 'status: done', ...keys.map(key => key + ': value'), '---', ''].join(nl);
const mode = process.env.FAKE_AGY_MODE;
if (mode === 'second' && turn === 2) writeFileSync(output, full);
if (mode === 'vary') console.log('attempt ' + turn + ' wrote nothing');
if (mode === 'same') console.log('Error: quota exhausted');
if (mode === 'denied') console.log('Error: run_command was auto-denied');
if (mode === 'partial-then-full') {
  writeFileSync(output, ['---', 'status: done', keys[0] + ': partial', '---', ''].join(nl));
  await new Promise(resolve => setTimeout(resolve, 1500));
  writeFileSync(output, full);
}
await new Promise(resolve => setTimeout(resolve, 300));
`;

function db(home: string) {
  const connection = new DatabaseSync(join(home, 'troop.db'));
  connection.exec('PRAGMA busy_timeout = 2000');
  return connection;
}

async function harness(mode: Mode, options: { plain?: boolean } = {}) {
  const isolated = isolation();
  const registryPath = join(isolated.home, 'engines.json');
  const agyArgv = join(isolated.home, 'agy-argv.json');
  const fakeAgy = join(isolated.home, 'fake-agy.mjs');
  writeFileSync(fakeAgy, agySource);
  const builtins = (await import('../src/engines/registry.ts')).BUILT_IN;
  const specs = builtins.map(engine => engine.id === 'agy'
    ? { ...engine, command: process.execPath, args: [fakeAgy], ...(options.plain ? { print_args: undefined } : {}) }
    : engine);
  writeFileSync(registryPath, JSON.stringify(specs));
  const env = { ...isolated.env, METATROOPER_ENGINES: registryPath, FAKE_AGY_ARGV: agyArgv, FAKE_AGY_MODE: mode, FAKE_AGY_COUNT: join(isolated.home, 'agy-count') };
  const core = await startCore({ ...isolated, env });
  const store = db(isolated.home);
  try { await until(() => store.prepare("SELECT 1 FROM engine_check WHERE engine_id = 'agy'").get(), 5000); }
  finally { store.close(); }
  return {
    ...isolated, env, core, agyArgv,
    count: () => { try { return readFileSync(join(isolated.home, 'agy-count'), 'utf8'); } catch { return '0'; } },
    async teardown() { await teardownCore(core, isolated); },
  };
}

type Harness = Awaited<ReturnType<typeof harness>>;

async function openProject(h: Harness, name: string, inside = false, near = false) {
  const project = near ? join(h.home, 'vault', 'projects', name) : join(h.home, name);
  const askPath = near ? join(h.home, 'vault', 'work', 'client') : join(project, 'work', 'client');
  if (inside || near) writeFileSync(join(h.home, 'settings.json'), JSON.stringify({ sessions: { ask_paths: [askPath] } }));
  mkdirSync(inside || near ? askPath : project, { recursive: true });
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

async function startRun(h: Harness, pipelineId: string, projectId: string) {
  const pipe = await client(h.prefix);
  try {
    const started = await pipe.request('run.start', { pipeline_id: pipelineId, project_id: projectId }, { timeout: 5000 });
    assert.ok(started.result?.run_id, JSON.stringify(started));
    return started.result.run_id as string;
  } finally { pipe.close(); }
}

async function awaitRun(h: Harness, runId: string, status: string) {
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
      step: store.prepare('SELECT engine_id, status, output_path, session_id FROM run_step WHERE run_id = ?').get(runId) as { engine_id: string; status: string; output_path: string; session_id: string },
      session: store.prepare('SELECT engine_id, driven_engine FROM session WHERE id = (SELECT session_id FROM run_step WHERE run_id = ?)').get(runId) as { engine_id: string; driven_engine: string | null } | undefined,
    };
  } finally { store.close(); }
}

async function runCase(mode: Mode, outputs = ['answer'], options: { plain?: boolean; inside?: boolean; near?: boolean } = {}) {
  const h = await harness(mode, options);
  const { project, projectId } = await openProject(h, `case-${mode}`, options.inside, options.near);
  writePipeline(project, `agy-${mode}`, outputs);
  return { h, runId: await startRun(h, `agy-${mode}`, projectId) };
}

test('agy steps run agy itself in print mode with the step prompt, run folder and contained flags', async () => {
  const { h, runId } = await runCase('never', ['answer', 'summary']);
  try {
    const result = await awaitRun(h, runId, 'failed');
    assert.equal(result.session?.engine_id, 'agy');
    assert.equal(result.session?.driven_engine, null);
    assert.equal(result.step.engine_id, 'agy');
    const argv = JSON.parse(readFileSync(h.agyArgv, 'utf8')) as string[];
    const prompt = argv[argv.indexOf('--print') + 1];
    assert.ok(prompt.includes(result.step.output_path));
    assert.match(prompt, /answer, summary/);
    const flat = argv.join(' ');
    assert.match(flat, /--print-timeout 0/);
    assert.match(flat, /--output-format text/);
    assert.match(flat, /--mode accept-edits --sandbox/);
    assert.ok(argv.includes(result.step.output_path.slice(0, result.step.output_path.lastIndexOf('/'))));
    assert.ok(!argv.includes('--prompt-interactive'));
    assert.ok(readFileSync(result.step.output_path.replace(/\.md$/, '.prompt.md'), 'utf8').includes('Do the work.'));
  } finally { await h.teardown(); }
});

test('agy print steps use ask approval in a project holding an ask path', async () => {
  const { h, runId } = await runCase('never', ['answer'], { inside: true });
  try {
    await awaitRun(h, runId, 'failed');
    const argv = JSON.parse(readFileSync(h.agyArgv, 'utf8')) as string[];
    assert.ok(argv.includes('--print'));
    assert.ok(!argv.includes('--mode') && !argv.includes('--sandbox'));
  } finally { await h.teardown(); }
});

test('M1-39 agy print steps use ask approval in a project beside an ask path', async () => {
  const { h, runId } = await runCase('never', ['answer'], { near: true });
  try {
    await awaitRun(h, runId, 'failed');
    const argv = JSON.parse(readFileSync(h.agyArgv, 'utf8')) as string[];
    assert.ok(argv.includes('--print'));
    assert.ok(!argv.includes('--mode') && !argv.includes('--sandbox'), argv.join(' '));
  } finally { await h.teardown(); }
});

test('an engine without print_args launches interactive and is not retried', async () => {
  const { h, runId } = await runCase('never', ['answer'], { plain: true });
  try {
    const result = await awaitRun(h, runId, 'failed');
    assert.equal(result.session?.engine_id, 'agy');
    const argv = JSON.parse(readFileSync(h.agyArgv, 'utf8')) as string[];
    assert.ok(argv.includes('--prompt-interactive'));
    assert.ok(!argv.includes('--print'));
    assert.equal(h.count(), '1');
  } finally { await h.teardown(); }
});

test('a print step retries once and passes when the second run writes the output', async () => {
  const { h, runId } = await runCase('second');
  try {
    const result = await awaitRun(h, runId, 'done');
    assert.equal(result.step.status, 'done');
    assert.match(readFileSync(result.step.output_path, 'utf8'), /answer: value/);
    assert.equal(h.count(), '2');
  } finally { await h.teardown(); }
});

test('a print step fails after two runs and records the last error', async () => {
  const { h, runId } = await runCase('vary');
  try {
    const result = await awaitRun(h, runId, 'failed');
    assert.equal(h.count(), '2');
    assert.match(readFileSync(result.step.output_path, 'utf8'), /status: failed\nreason: .*attempt 2 wrote nothing/);
  } finally { await h.teardown(); }
});

test('an auto-denied print step is not retried', async () => {
  const { h, runId } = await runCase('denied');
  try {
    const result = await awaitRun(h, runId, 'failed');
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(h.count(), '1');
    assert.match(readFileSync(result.step.output_path, 'utf8'), /reason: .*auto-denied/);
  } finally { await h.teardown(); }
});

test('a resumed print step does not retry an error that repeats the previous attempt', async () => {
  const { h, runId } = await runCase('same');
  try {
    await awaitRun(h, runId, 'failed');
    assert.equal(h.count(), '2');
    const pipe = await client(h.prefix);
    try { assert.deepEqual((await pipe.request('run.resume', { run_id: runId })).result, {}); }
    finally { pipe.close(); }
    const store = db(h.home);
    try { await until(() => h.count() === '3' && store.prepare('SELECT status FROM run WHERE id = ?').get(runId)?.status === 'failed', 15000); }
    finally { store.close(); }
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(h.count(), '3');
  } finally { await h.teardown(); }
});

test('a print step waits for a missing required key while agy is still running', async () => {
  const { h, runId } = await runCase('partial-then-full', ['answer', 'summary']);
  try {
    const result = await awaitRun(h, runId, 'done');
    assert.match(readFileSync(result.step.output_path, 'utf8'), /summary: value/);
    assert.equal(h.count(), '1');
  } finally { await h.teardown(); }
});

test('M5-17 S3: the retry restarts the step clock at the second session', async () => {
  const { h, runId } = await runCase('second');
  try {
    await awaitRun(h, runId, 'done');
    const store = db(h.home);
    try {
      const sessions = store.prepare('SELECT started_at FROM session WHERE run_id = ? ORDER BY started_at').all(runId) as Array<{ started_at: string }>;
      const step = store.prepare('SELECT started_at FROM run_step WHERE run_id = ?').get(runId) as { started_at: string };
      assert.equal(sessions.length, 2);
      assert.ok(step.started_at > sessions[0].started_at, `${step.started_at} should be after ${sessions[0].started_at}`);
    } finally { store.close(); }
  } finally { await h.teardown(); }
});
