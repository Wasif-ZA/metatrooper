import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, startCore, teardownCore, uiHello } from './helpers.ts';

before(buildGenerated);

const manifestFile = join(root, 'plugins', 'optional', 'code-map', 'troop-plugin.json');
const { validateManifest } = await import(pathToFileURL(join(root, 'core', 'src', 'plugins', 'manifest.ts')).href);
const { FALLBACK, run: runMap } = await import(pathToFileURL(join(root, 'pipelines', 'code-map', 'index.mjs')).href);

test('M4-03 manifest accepts code-map and rejects env/env_keys overlap', () => {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  assert.deepEqual(validateManifest(manifest, join(root, 'plugins', 'optional', 'code-map')), []);
  manifest.mcp[0].env_keys = ['PYTHONUTF8'];
  assert.ok(validateManifest(manifest, join(root, 'plugins', 'optional', 'code-map')).some((e: string) => e.includes('PYTHONUTF8')));
});

test('M4-03 map fallback is returned when code-map is not installed', async () => {
  assert.deepEqual(await runMap({ plugins: [], inputs: {}, projectPath: root }), { available: false, hint: FALLBACK });
});

test('M4-06 two-engine-review passes the unavailable map hint into the codex prompt (fake engines)', async () => {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const wrapper = join(isolated.home, 'capture-engine.mjs');
  writeFileSync(wrapper, [
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "const dir = join(process.env.METATROOPER_HOME, 'captured-prompts');",
    'mkdirSync(dir, { recursive: true });',
    "writeFileSync(join(dir, process.env.TROOP_SESSION_ID + '.txt'), process.argv[2] ?? '');",
    `await import(${JSON.stringify(pathToFileURL(join(root, 'core', 'test', 'fake-engine.js')).href)});`,
  ].join('\n'));
  writeFileSync(registry, JSON.stringify(['fake-a', 'fake-b'].map((id) => ({
    id, command: process.execPath, args: [wrapper], prompt_arg: 'positional',
    state_source: 'hooks', roles: ['worker', 'review', 'verify'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
    version_cmd: [process.execPath, '--version'],
  }))));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  try {
    const project = join(isolated.home, 'code-map-prompt');
    mkdirSync(project, { recursive: true });
    await promisify(execFile)('git', ['init', '-q', project]);
    await promisify(execFile)('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'base']);
    const pipelines = join(project, '.troop', 'pipelines');
    mkdirSync(pipelines, { recursive: true });
    cpSync(join(root, 'pipelines', 'two-engine-review'), join(pipelines, 'two-engine-review'), { recursive: true });
    cpSync(join(root, 'pipelines', 'code-map'), join(pipelines, 'code-map'), { recursive: true });
    const def = JSON.parse(readFileSync(join(root, 'pipelines', 'two-engine-review.json'), 'utf8'));
    def.requires = [];
    def.steps.find((s: { id: string }) => s.id === 'codex-review').engine = 'fake-b';
    def.steps.find((s: { id: string }) => s.id === 'gemini-review').engine = 'fake-a';
    writeFileSync(join(pipelines, 'two-engine-review.json'), JSON.stringify(def));
    const pipe = await client(isolated.prefix);
    try {
      const opened = await pipe.request('project.open', { path: project });
      const started = await pipe.request('run.start', { pipeline_id: 'two-engine-review', project_id: opened.result.project_id, inputs: {} }, { timeout: 5000 });
      assert.equal(started.error, undefined, JSON.stringify(started));
      const runId = started.result.run_id;
      const store = new DatabaseSync(join(isolated.home, 'troop.db'));
      let status: any;
      let runDir: string | undefined;
      const until = Date.now() + 30000;
      do {
        status = store.prepare('SELECT status, run_dir FROM run WHERE id = ?').get(runId);
        runDir = status?.run_dir;
        if (['done', 'failed'].includes(status?.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      } while (Date.now() < until);
      assert.equal(status.status, 'done', JSON.stringify(status));
      const mapStep = store.prepare('SELECT outputs FROM run_step WHERE run_id = ? AND step_id = ?').get(runId, 'map') as { outputs: string } | undefined;
      assert.ok(mapStep, 'map step should have a persisted record');
      assert.deepEqual(JSON.parse(mapStep.outputs), { available: false, hint: FALLBACK });
      const review = store.prepare("SELECT session_id FROM run_step WHERE run_id = ? AND step_id = 'codex-review'").get(runId) as { session_id: string };
      store.close();
      const promptPath = join(isolated.home, 'captured-prompts', `${review.session_id}.txt`);
      assert.ok(existsSync(promptPath), `expected the codex-review prompt at ${promptPath}`);
      assert.ok(readFileSync(promptPath, 'utf8').includes(FALLBACK));
    } finally { pipe.close(); }
  } finally { await teardownCore(core, isolated); }
});

test('M4-05 code-map leaves only its graph cache and one git exclude line', async (t) => {
  const version = spawnSync('code-review-graph', ['--version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (version.error || version.status !== 0) {
    t.skip(`code-review-graph unavailable: ${version.error?.message ?? `exit ${version.status}`}`);
    return;
  }

  const isolated = isolation();
  const home = isolated.home;
  const project = join(home, 'map-project');
  const graphPath = join(project, '.code-review-graph');
  const excludePath = join(project, '.git', 'info', 'exclude');
  const { HINT } = await import(pathToFileURL(join(root, 'pipelines', 'code-map', 'index.mjs')).href);
  const snapshot = (dir: string): Map<string, string> => {
    const files = new Map<string, string>();
    const walk = (at: string) => {
      for (const name of readdirSync(at, { withFileTypes: true })) {
        const file = join(at, name.name);
        if (name.isDirectory()) walk(file);
        else files.set(relative(dir, file).replaceAll('\\', '/'), createHash('sha256').update(readFileSync(file)).digest('hex'));
      }
    };
    if (existsSync(dir)) walk(dir);
    return files;
  };

  let core: Awaited<ReturnType<typeof startCore>> | null = null;
  try {
    mkdirSync(project, { recursive: true });
    await promisify(execFile)('git', ['init', '-q', project]);
    await promisify(execFile)('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'base']);
    const agentFiles = ['.claude/settings.json', '.claude.json', '.claude/CLAUDE.md', '.codex/config.toml', '.codex/AGENTS.md', '.gemini/antigravity-cli/mcp_config.json'].map((f) => join(home, f));
    const agentBefore = agentFiles.map((f) => (existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null));
    const before = snapshot(project);
    core = await startCore(isolated);
    const pluginClient = await client(isolated.prefix);
    try {
      await uiHello(pluginClient, home);
      const source = join(root, 'plugins', 'optional', 'code-map');
      const preview = await pluginClient.request('plugin.preview', { source });
      const installed = await pluginClient.request('plugin.install', { source, approved_permissions: [], manifest_hash: preview.result.manifest_hash });
      assert.equal(installed.error, undefined, JSON.stringify(installed));
    } finally { pluginClient.close(); }
    const agentAfter = agentFiles.map((f) => (existsSync(f) ? createHash('sha256').update(readFileSync(f)).digest('hex') : null));
    assert.deepEqual(agentAfter, agentBefore, 'agent settings files must be unchanged or still absent');
    const map = await runMap({ plugins: ['code-map'], inputs: { path: project }, projectPath: project });
    assert.deepEqual(map, { available: true, hint: HINT });

    const env = { ...process.env, ...isolated.env, USERPROFILE: home, HOME: home, PATH: `${join(root, 'core')}${delimiter}${process.env.PATH}` };
    const child = spawn(process.execPath, [join(root, 'core', 'mcp-shim.js'), 'code-map', 'graph'], { cwd: project, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    try {
      const reply = await new Promise<string>((resolve, reject) => {
        let output = '';
        const timer = setTimeout(() => reject(new Error('code-map shim did not answer initialize')), 10000);
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk) => {
          output += chunk;
          if (output.includes('\n')) { clearTimeout(timer); resolve(output); }
        });
        child.once('error', reject);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'code-map-test', version: '1' } } })}\n`);
      });
      assert.ok(reply.includes('"id":1'), reply);
    } finally {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => child.once('exit', () => resolve()));
    }

    const after = snapshot(project);
    for (const [file, hash] of before) {
      if (file === '.git/info/exclude') continue;
      assert.equal(after.get(file), hash, `${file} changed`);
    }
    assert.ok(existsSync(graphPath), 'expected .code-review-graph/ cache directory');
    const excludes = readFileSync(excludePath, 'utf8').split(/\r?\n/).filter((line) => line === '.code-review-graph/');
    assert.equal(excludes.length, 1, 'expected exactly one .code-review-graph/ info/exclude line');
    for (const file of after.keys()) {
      assert.ok(before.has(file) || file === '.git/info/exclude' || file.startsWith('.code-review-graph/'), `unexpected new file ${file}`);
    }
  } finally {
    if (core) await teardownCore(core, isolated);
    else rmSync(home, { recursive: true, force: true });
  }
});

test('M4-03 mcp shim replaces the exact {{cwd}} argument with its working directory', async () => {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([]));
  const project = join(isolated.home, 'shim-cwd');
  mkdirSync(project, { recursive: true });
  const pluginDir = join(isolated.home, 'plugins', 'cwd-check');
  mkdirSync(pluginDir, { recursive: true });
  const fixture = join(isolated.home, 'shim-argv-fixture.js');
  writeFileSync(join(pluginDir, 'troop-plugin.json'), JSON.stringify({ schema: 1, id: 'cwd-check', version: '1.0.0', name: 'cwd-check', mcp: [{ id: 'cwd', command: process.execPath, args: [fixture, '{{cwd}}'], engines: ['codex'] }] }));
  writeFileSync(fixture, "process.stdin.once('data',()=>{process.stdout.write(JSON.stringify({cwd:process.argv[2]})+'\\n')})\n");
  const core = await startCore({ ...isolated, env: { ...isolated.env, METATROOPER_ENGINES: registry } });
  try {
    const pipe = await client(isolated.prefix);
    try {
      await uiHello(pipe, isolated.home);
      const preview = await pipe.request('plugin.preview', { source: pluginDir });
      const installed = await pipe.request('plugin.install', { source: pluginDir, approved_permissions: [], manifest_hash: preview.result.manifest_hash });
      assert.equal(installed.error, undefined, JSON.stringify(installed));
    } finally { pipe.close(); }
    const child = spawn(process.execPath, [join(root, 'core', 'mcp-shim.js'), 'cwd-check', 'cwd'], { cwd: project, env: { ...process.env, ...isolated.env, METATROOPER_ENGINES: registry }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const output = await new Promise<string>((resolve, reject) => {
      let data = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('shim did not spawn cwd fixture')); }, 8000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { data += chunk; if (data.includes('\n')) { clearTimeout(timer); resolve(data); child.kill(); } });
      child.once('error', reject);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} })}\n`);
    });
    assert.deepEqual(JSON.parse(output), { cwd: project });
  } finally { await teardownCore(core, isolated); }
});
