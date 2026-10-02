import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

const FANOUT = 2;
const TRACKED_FILE = 'variant-tracked.txt';
const TRACKED_BASE = 'fixture baseline\n';
const TRACKED_EDIT = 'tracked edit from variant zero\n';
const UNTRACKED_FILE = 'variant-new.txt';
const UNTRACKED_CONTENT = 'new file from variant one\n';
const FAKE_MARKER = 'FAKE_WRITE_VARIANT';

type Harness = Awaited<ReturnType<typeof fakeHarness>>;
type VariantRow = {
  idx: number;
  worktree: string;
  branch: string;
  dev_port: number;
  pane_id: string | null;
  status: string;
};

function db(home: string) {
  const connection = new DatabaseSync(join(home, 'troop.db'));
  connection.exec('PRAGMA busy_timeout = 2000');
  return connection;
}

function fakeEngineWrapper(fakeEngineUrl: string) {
  return `
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const prompt = process.argv[2] ?? '';
const home = process.env.METATROOPER_HOME;
const cwdName = basename(process.cwd());
const promptDir = join(home, 'captured-prompts');
mkdirSync(promptDir, { recursive: true });
writeFileSync(join(promptDir, cwdName + '.txt'), prompt);

if (prompt.includes(${JSON.stringify(FAKE_MARKER)})) {
  const index = Number(/-(\\d+)$/.exec(cwdName)?.[1]);
  if (index === 0) writeFileSync(${JSON.stringify(TRACKED_FILE)}, ${JSON.stringify(TRACKED_EDIT)});
  if (index === 1) writeFileSync(${JSON.stringify(UNTRACKED_FILE)}, ${JSON.stringify(UNTRACKED_CONTENT)});
}

await import(${JSON.stringify(fakeEngineUrl)});
`;
}

async function fakeHarness() {
  const isolated = isolation();
  const wrapper = join(isolated.home, 'variant-fake-engine.mjs');
  writeFileSync(wrapper, fakeEngineWrapper(pathToFileURL(join(root, 'core/test/fake-engine.js')).href));
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{
    id: 'fake',
    command: process.execPath,
    args: [wrapper],
    prompt_arg: 'positional',
    state_source: 'hooks',
    roles: ['worker'],
    cost_rank: 1,
    usage_source: 'none',
    provider: 'local-cli',
    version_cmd: [process.execPath, '--version'],
  }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  const store = db(isolated.home);
  try {
    await until(() => store.prepare("SELECT 1 FROM engine_check WHERE engine_id = 'fake' AND installed = 1").get(), 5000);
  } finally {
    store.close();
  }
  return { ...isolated, env, core, async teardown() { await teardownCore(core, isolated); } };
}

async function openProject(h: Harness, name: string) {
  const project = join(h.home, name);
  mkdirSync(project, { recursive: true });
  const pipe = await client(h.prefix);
  try {
    const opened = await pipe.request('project.open', { path: project });
    assert.ok(opened.result?.project_id, JSON.stringify(opened));
    return { project, projectId: opened.result.project_id as string };
  } finally {
    pipe.close();
  }
}

function initGitProject(project: string) {
  writeFileSync(join(project, 'README.md'), 'variants fixture\n');
  writeFileSync(join(project, TRACKED_FILE), TRACKED_BASE);
  writeFileSync(join(project, 'server.mjs'), `
import http from 'node:http';
const port = Number(process.argv[2]);
const server = http.createServer((_request, response) => response.end('ok')).listen(port, '127.0.0.1');
setTimeout(() => server.close(), 1500);
`);
  execFileSync('git', ['init'], { cwd: project, stdio: 'ignore' });
  execFileSync('git', ['add', 'README.md', TRACKED_FILE, 'server.mjs'], { cwd: project, stdio: 'ignore' });
  execFileSync('git', ['-c', 'user.name=Metatrooper Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'variants fixture'], {
    cwd: project,
    stdio: 'ignore',
  });
}

function writePipeline(project: string, id: string, withBrowser: boolean) {
  const dir = join(project, '.troop', 'pipelines');
  mkdirSync(dir, { recursive: true });
  const build = {
    id: 'build',
    kind: 'agent',
    engine: 'fake',
    fanout: FANOUT,
    worktree: true,
    browser: withBrowser,
    ...(withBrowser ? { dev_command: 'node server.mjs {{port}}' } : {}),
    prompt: `${FAKE_MARKER}\nFAKE {"outputs":{"ok":"yes"}}`,
    outputs: ['ok'],
  };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify({
    schema: 1,
    id,
    title: 'Variants fixture',
    steps: [build, { id: 'hold', kind: 'gate', gate: 'handoff' }],
  }, null, 2) + '\n');
}

async function startRun(h: Harness, pipelineId: string, projectId: string) {
  const pipe = await client(h.prefix);
  try {
    const started = await pipe.request('run.start', { pipeline_id: pipelineId, project_id: projectId, inputs: {} }, { timeout: 5000 });
    assert.ok(started.result?.run_id, JSON.stringify(started));
    return started.result.run_id as string;
  } finally {
    pipe.close();
  }
}

async function fanoutFixture(h: Harness, name: string, withBrowser = false) {
  const { project, projectId } = await openProject(h, name);
  initGitProject(project);
  const pipelineId = `${name}-pipeline`;
  writePipeline(project, pipelineId, withBrowser);
  const runId = await startRun(h, pipelineId, projectId);
  const store = db(h.home);
  try {
    await until(() => store.prepare('SELECT paused_why FROM run WHERE id = ?').get(runId)?.paused_why === 'handoff', withBrowser ? 15000 : 8000);
    const variants = store.prepare('SELECT idx, worktree, branch, dev_port, pane_id, status FROM variant WHERE run_id = ? ORDER BY idx').all(runId) as VariantRow[];
    assert.equal(variants.length, FANOUT);
    assert.deepEqual(variants.map((variant) => variant.idx), [0, 1]);
    return { project, projectId, runId, variants };
  } finally {
    store.close();
  }
}

function assertRpcError(response: any, code: number, message: RegExp) {
  assert.equal(response.result, undefined, JSON.stringify(response));
  assert.equal(response.error?.code, code, JSON.stringify(response));
  assert.match(response.error?.message ?? '', message);
}

function promptCapture(home: string, worktree: string) {
  return join(home, 'captured-prompts', `${basename(worktree)}.txt`);
}

function git(project: string, args: string[]) {
  return execFileSync('git', args, { cwd: project, encoding: 'utf8' }).trim();
}

function normalizedText(file: string) {
  return readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

test('M2-03 pick marks a variant picked and rejects discarded or unknown variants', async () => {
  const h = await fakeHarness();
  try {
    const { runId } = await fanoutFixture(h, 'm2-pick');
    const pipe = await client(h.prefix);
    const store = db(h.home);
    try {
      const picked = await pipe.request('variant.pick', { run_id: runId, idx: 0 });
      assert.deepEqual(picked.result, {});
      assert.equal(store.prepare('SELECT status FROM variant WHERE run_id = ? AND idx = 0').get(runId)?.status, 'picked');

      const discarded = await pipe.request('variant.discard', { run_id: runId, idx: 1 }, { timeout: 8000 });
      assert.deepEqual(discarded.result, {});
      assertRpcError(await pipe.request('variant.pick', { run_id: runId, idx: 1 }), -32003, /discarded/i);
      assertRpcError(await pipe.request('variant.pick', { run_id: runId, idx: 99 }), -32002, /not found/i);
    } finally {
      store.close();
      pipe.close();
    }
  } finally {
    await h.teardown();
  }
});

test('M2-03 discard removes the worktree and branch, releases its port, closes its pane, and marks it discarded', async () => {
  const h = await fakeHarness();
  try {
    const { project, runId, variants } = await fanoutFixture(h, 'm2-discard', true);
    const target = variants[0];
    const sessions = db(h.home);
    try {
      await until(() => {
        const pids = sessions.prepare("SELECT s.pid FROM run_step r JOIN session s ON s.id = r.session_id WHERE r.run_id = ? AND r.step_id = 'build'").all(runId) as Array<{ pid: number | null }>;
        return pids.length === FANOUT && pids.every((row) => row.pid !== null && !alive(row.pid));
      }, 5000);
      await until(() => {
        const pids = sessions.prepare('SELECT pid FROM dev_server WHERE run_id = ?').all(runId) as Array<{ pid: number | null }>;
        return pids.length === FANOUT && pids.every((row) => row.pid !== null && !alive(row.pid));
      }, 5000);
    } finally {
      sessions.close();
    }
    assert.equal(target.status, 'ready');
    assert.ok(target.dev_port > 0);
    assert.ok(target.pane_id);
    assert.ok(existsSync(target.worktree));
    assert.equal(git(project, ['branch', '--list', target.branch]).replace(/^[*+]\s+/, ''), target.branch);

    const pipe = await client(h.prefix);
    try {
      const discarded = await pipe.request('variant.discard', { run_id: runId, idx: target.idx }, { timeout: 8000 });
      assert.deepEqual(discarded.result, {});
    } finally {
      pipe.close();
    }

    const store = db(h.home);
    try {
      assert.equal(existsSync(target.worktree), false);
      assert.equal(git(project, ['branch', '--list', target.branch]), '');
      assert.equal(store.prepare('SELECT 1 FROM port_lease WHERE run_id = ? AND idx = ?').get(runId, target.idx), undefined);
      assert.equal(store.prepare('SELECT open FROM browser_pane WHERE id = ?').get(target.pane_id)?.open, 0);
      assert.equal(store.prepare('SELECT status FROM variant WHERE run_id = ? AND idx = ?').get(runId, target.idx)?.status, 'discarded');
    } finally {
      store.close();
    }
    const cleanup = await client(h.prefix);
    try {
      assert.deepEqual((await cleanup.request('variant.discard', { run_id: runId, idx: variants[1].idx }, { timeout: 8000 })).result, {});
    } finally {
      cleanup.close();
    }
  } finally {
    await h.teardown();
  }
});

test('M2-03 combine records variant diffs and note, launches from HEAD with the raw note, and allocates successive ids', async () => {
  const h = await fakeHarness();
  try {
    const { project, runId, variants } = await fanoutFixture(h, 'm2-combine');
    assert.equal(normalizedText(join(variants[0].worktree, TRACKED_FILE)), TRACKED_EDIT);
    assert.equal(readFileSync(join(variants[1].worktree, UNTRACKED_FILE), 'utf8'), UNTRACKED_CONTENT);
    const note = 'Keep the tracked wording and include the new-file idea.';

    const pipe = await client(h.prefix);
    try {
      const first = await pipe.request('variant.combine', { run_id: runId, indices: [0, 1], note }, { timeout: 10000 });
      assert.deepEqual(first.result, { step_id: 'combine-1' });
      const store = db(h.home);
      try {
        const combined = await until(() => {
          const row = store.prepare('SELECT idx, worktree, branch, dev_port, pane_id, status FROM variant WHERE run_id = ? AND idx = ?').get(runId, FANOUT) as VariantRow | undefined;
          return row?.worktree && existsSync(row.worktree) ? row : null;
        }, 8000);
        assert.equal(combined.idx, FANOUT);
        assert.equal(git(combined.worktree, ['rev-parse', 'HEAD']), git(project, ['rev-parse', 'HEAD']));
        assert.equal(normalizedText(join(combined.worktree, TRACKED_FILE)), TRACKED_BASE);
        assert.equal(existsSync(join(combined.worktree, UNTRACKED_FILE)), false);

        const runDir = store.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId)?.run_dir as string;
        const combineDir = join(runDir, 'combine-1');
        assert.equal(readFileSync(join(combineDir, 'note.md'), 'utf8'), note);
        assert.match(readFileSync(join(combineDir, 'variant-0.diff'), 'utf8'), new RegExp(TRACKED_FILE.replace('.', '\\.')));
        assert.match(readFileSync(join(combineDir, 'variant-1.diff'), 'utf8'), new RegExp(UNTRACKED_FILE.replace('.', '\\.')));

        const promptFile = promptCapture(h.home, combined.worktree);
        await until(() => existsSync(promptFile), 5000);
        assert.match(readFileSync(promptFile, 'utf8'), new RegExp(note.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.ok(store.prepare("SELECT session_id FROM run_step WHERE run_id = ? AND step_id = 'combine-1' AND fanout_index = ?").get(runId, FANOUT)?.session_id);

        const log = readFileSync(join(runDir, 'log.jsonl'), 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
        assert.equal(log.filter((entry) => entry.event === 'combine crop skipped' && [0, 1].includes(entry.variant)).length, FANOUT);

        const second = await pipe.request('variant.combine', { run_id: runId, indices: [0, 1], note: 'Try a second synthesis.' }, { timeout: 10000 });
        assert.deepEqual(second.result, { step_id: 'combine-2' });
        await until(() => {
          const row = store.prepare('SELECT worktree FROM variant WHERE run_id = ? AND idx = ?').get(runId, FANOUT + 1) as { worktree: string } | undefined;
          return row?.worktree && existsSync(row.worktree);
        }, 8000);
        assert.equal(store.prepare("SELECT fanout_index FROM run_step WHERE run_id = ? AND step_id = 'combine-2'").get(runId)?.fanout_index, FANOUT + 1);
      } finally {
        store.close();
      }
    } finally {
      pipe.close();
    }
  } finally {
    await h.teardown();
  }
});

test('M2-03 combine refuses duplicate, missing, discarded, and invalid indices or a blank note without creating rows', async () => {
  const h = await fakeHarness();
  try {
    const { runId } = await fanoutFixture(h, 'm2-combine-refusals');
    const pipe = await client(h.prefix);
    const store = db(h.home);
    try {
      assert.deepEqual((await pipe.request('variant.discard', { run_id: runId, idx: 1 }, { timeout: 8000 })).result, {});
      assertRpcError(await pipe.request('variant.combine', { run_id: runId, indices: [0, 0], note: 'duplicate' }), -32003, /at least 2 different/i);
      assertRpcError(await pipe.request('variant.combine', { run_id: runId, indices: [0, 1], note: '   \t' }), -32003, /needs a note/i);
      assertRpcError(await pipe.request('variant.combine', { run_id: runId, indices: [0, 1], note: 'use both' }), -32003, /discarded/i);
      assertRpcError(await pipe.request('variant.combine', { run_id: 'missing-run', indices: [0, 1], note: 'use both' }), -32002, /run not found/i);
      assertRpcError(await pipe.request('variant.combine', { run_id: runId, indices: [0, 1.5], note: 'use both' }), -32602, /indices/i);

      assert.equal(store.prepare('SELECT COUNT(*) AS n FROM variant WHERE run_id = ?').get(runId)?.n, FANOUT);
      assert.equal(store.prepare("SELECT COUNT(*) AS n FROM run_step WHERE run_id = ? AND step_id LIKE 'combine-%'").get(runId)?.n, 0);
    } finally {
      store.close();
      pipe.close();
    }
  } finally {
    await h.teardown();
  }
});

test('M2-03 combine passes a note containing an unresolved template expression through raw', async () => {
  const h = await fakeHarness();
  try {
    const { runId } = await fanoutFixture(h, 'm2-combine-raw-note');
    const note = 'Preserve this literally: {{ steps.nope.out }}';
    const pipe = await client(h.prefix);
    try {
      const response = await pipe.request('variant.combine', { run_id: runId, indices: [0, 1], note }, { timeout: 10000 });
      assert.deepEqual(response.result, { step_id: 'combine-1' });
    } finally {
      pipe.close();
    }

    const store = db(h.home);
    try {
      const combined = await until(() => {
        const row = store.prepare('SELECT worktree FROM variant WHERE run_id = ? AND idx = ?').get(runId, FANOUT) as { worktree: string } | undefined;
        return row?.worktree && existsSync(promptCapture(h.home, row.worktree)) ? row : null;
      }, 8000);
      const step = store.prepare("SELECT status, session_id FROM run_step WHERE run_id = ? AND step_id = 'combine-1' AND fanout_index = ?").get(runId, FANOUT) as
        | { status: string; session_id: string | null }
        | undefined;
      assert.ok(step?.session_id, JSON.stringify(step));
      assert.notEqual(step?.status, 'failed');
      assert.ok(readFileSync(promptCapture(h.home, combined.worktree), 'utf8').includes(note));
    } finally {
      store.close();
    }
  } finally {
    await h.teardown();
  }
});
