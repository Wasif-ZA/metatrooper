import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { DEFAULTS, settings } from '../src/settings.ts';
import { buildGenerated, client, isolation, pipePath, root, runNode, sleep, stopCore, teardownCore, until, withEnv } from './helpers.ts';

const preload = pathToFileURL(join(import.meta.dirname, 'fixtures/zero-outbound-preload.mjs')).href;
type Attempt = { api: string; destination: string; loopback: boolean; stack: string };
const attempts = (file: string): Attempt[] => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));

before(buildGenerated);

test('network trap records a deliberate fetch before DNS can fail', { timeout: 15_000 }, async () => {
  const isolated = isolation();
  const file = join(isolated.home, 'outbound.jsonl');
  writeFileSync(file, '');
  try {
    const result = await runNode(['--import', preload, '--input-type=module', '--eval',
      `import net from 'node:net';
      const probe = address => new Promise(resolve => {
        const socket = net.connect(address);
        socket.once('connect', () => { socket.destroy(); resolve(); });
        socket.once('error', () => resolve());
      });
      await probe(${JSON.stringify(pipePath(isolated.prefix))});
      await probe({ host: '127.0.0.1', port: 1 });
      await fetch('http://example.invalid/', { signal: AbortSignal.timeout(1000) }).catch(() => {});`],
    { ...isolated.env, METATROOPER_NETWORK_LOG: file });
    assert.equal(result.code, 0, result.stderr);
    const found = attempts(file).find(row => row.api === 'fetch' && row.destination === 'http://example.invalid/');
    assert.ok(found, JSON.stringify(attempts(file)));
    assert.equal(found.loopback, false);
    assert.match(found.stack, /eval/);
    assert.ok(attempts(file).some(row => row.loopback && row.destination === '127.0.0.1:1'));
    assert.ok(attempts(file).every(row => !row.destination.includes(isolated.prefix)), 'local pipes are not recorded');
  } finally { rmSync(isolated.home, { recursive: true, force: true }); }
});

test('signed-out core with default settings makes zero outbound connections', {
  skip: process.platform !== 'win32' ? 'The real engine lifecycle uses Windows PTYs.' : false,
  timeout: 90_000,
}, async (t) => {
  const isolated = isolation();
  const file = join(isolated.home, 'outbound.jsonl');
  const registry = join(isolated.home, 'engines.json');
  const engine = join(isolated.home, 'fake-engine.mjs');
  const project = join(isolated.home, 'project');
  writeFileSync(file, '');
  writeFileSync(engine, "process.stdout.write('fake engine finished\\n');\n");
  writeFileSync(registry, JSON.stringify([{
    id: 'fake', command: process.execPath, args: [engine], state_source: 'process',
    roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
    version_cmd: [process.execPath, '--version'],
  }]));
  mkdirSync(project);
  const env = {
    ...isolated.env, METATROOPER_ENGINES: registry, METATROOPER_FAKE_DPAPI: '1',
    METATROOPER_CLAUDE_SETTINGS: join(isolated.home, 'claude-settings.json'),
    METATROOPER_CODEX_CONFIG: join(isolated.home, 'codex-config.toml'),
    METATROOPER_NETWORK_LOG: file,
  };
  const core = spawn(process.execPath, ['--import', preload, 'core/src/main.ts'], {
    cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true,
  });
  let stderr = '';
  core.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  let spawnError: Error | undefined;
  core.on('error', error => { spawnError = error; });
  try {
    await until(async () => {
      if (spawnError) throw spawnError;
      assert.equal(core.exitCode, null, stderr);
      const pipe = await client(isolated.prefix);
      try { return (await pipe.request('core.ping')).result?.ok; }
      finally { pipe.close(); }
    }, 10_000);
    assert.ok(readFileSync(`${file}.ready`, 'utf8').split('\n').includes(String(core.pid)), 'core loaded the trap');
    const pipe = await client(isolated.prefix);
    try {
      const request = async (method: string, params = {}) => {
        const reply = await pipe.request(method, params);
        assert.equal(reply.error, undefined, JSON.stringify(reply));
        return reply.result;
      };
      assert.equal((await request('core.ping')).protocol, 1);
      assert.deepEqual(await request('account.state'), { state: 'signed_out' });
      const opened = await request('project.open', { path: project });
      assert.ok(opened.project_id);
      assert.deepEqual((await request('session.list')).sessions, []);
      assert.equal(existsSync(join(isolated.home, 'settings.json')), false);
      assert.deepEqual(withEnv({ METATROOPER_HOME: isolated.home }, () => settings()), DEFAULTS);
      // Checks only the fake engine with node --version.
      await request('engines.check');
      const db = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
      try {
        await until(() => db.prepare("SELECT installed FROM engine_check WHERE engine_id = 'fake'").get()?.installed === 1, 5000);
        const launched = await request('session.launch', { project_id: opened.project_id, engine_id: 'fake' });
        assert.ok(launched.session_id);
        await until(() => db.prepare('SELECT state FROM session WHERE id = ?').get(launched.session_id)?.state === 'exited', 15_000);
      } finally { db.close(); }
      await sleep(15_000);
      assert.equal(core.exitCode, null, stderr);
    } finally { pipe.close(); }
    await stopCore(core, isolated);
    assert.equal(core.exitCode, 0, stderr);
    const recorded = attempts(file);
    const external = recorded.filter(row => !row.loopback);
    t.diagnostic(`Loopback attempts: ${JSON.stringify(recorded.filter(row => row.loopback))}`);
    assert.equal(external.length, 0, external.map(row => `${row.api} ${row.destination}\n${row.stack}`).join('\n'));
  } finally {
    try {
      await stopCore(core, isolated);
      for (const row of attempts(file).filter(row => !row.loopback)) {
        t.diagnostic(`${row.api} ${row.destination}\n${row.stack}`);
      }
    } finally { await teardownCore(core, isolated); }
  }
});
