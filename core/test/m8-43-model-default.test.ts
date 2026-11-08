import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { EngineSpec } from '../src/engines/registry.ts';

const require = createRequire(import.meta.url);
const pty = require('node-pty') as typeof import('node-pty');

async function launch(t: TestContext, params: Record<string, unknown>, config?: string) {
  const home = mkdtempSync(join(tmpdir(), 'troop-m8-43-'));
  const env = {
    HOME: home, USERPROFILE: home, METATROOPER_HOME: join(home, 'mt'),
    METATROOPER_CLAUDE_SETTINGS: join(home, '.claude', 'settings.json'),
    METATROOPER_CODEX_CONFIG: join(home, '.codex', 'config.toml'),
  };
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  let db: import('node:sqlite').DatabaseSync | undefined;
  const calls: string[][] = [];
  // Record the terminal launcher arguments and stop before spawning a process.
  const spawn = t.mock.method(pty, 'spawn', (_file: string, args: string[]) => {
    calls.push([...args]);
    throw new Error('synthetic terminal boundary');
  });
  try {
    const { openCoreDb } = await import('../src/store/db.ts');
    const { syncEngines } = await import('../src/engines/registry.ts');
    const { buildMethods } = await import('../src/methods.ts');
    const project = join(home, 'project');
    mkdirSync(project);
    if (config !== undefined) {
      mkdirSync(join(project, '.troop'));
      writeFileSync(join(project, '.troop', 'config.json'), config);
    }
    // Register synthetic engines with the public engine ids and model flags.
    const engines: EngineSpec[] = [
      ['claude', '--model'], ['codex', '-m'], ['agy', '--model'],
    ].map(([id, model_arg]) => ({
      id, model_arg, command: process.execPath, version_cmd: [process.execPath, '--version'],
      state_source: 'process', roles: ['worker'], cost_rank: 1,
      provider: 'local-cli', usage_source: 'none',
    }));
    db = openCoreDb();
    syncEngines(db, engines);
    const methods = buildMethods(db, { engines: () => engines, stop: () => {}, uiKey: 'test-key' });
    const context = { ui: false, origin: 'test' };
    const opened = await methods.get('project.open')!.handler({ path: project }, context) as { project_id: string };
    const result = await methods.get('session.launch')!.handler({
      project_id: opened.project_id, engine_id: 'claude', ...params,
    }, context) as { session_id: string; model?: string };
    assert.ok(result.session_id);
    assert.equal(calls.length, 1, 'launch reaches the terminal exactly once');
    const flag = calls[0].indexOf('--args-b64');
    assert.ok(flag >= 0, JSON.stringify(calls[0]));
    const argv = JSON.parse(Buffer.from(calls[0][flag + 1], 'base64').toString('utf8')) as string[];
    assert.equal(argv[0], process.execPath);
    const row = db.prepare('SELECT browser_grant FROM session WHERE id = ?').get(result.session_id);
    assert.ok(row);
    return { result, argv, grant: row.browser_grant };
  } finally {
    spawn.mock.restore();
    db?.close();
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(home, { recursive: true, force: true });
  }
}

function hasModel(observed: Awaited<ReturnType<typeof launch>>, expected: string) {
  const { argv, result } = observed;
  const index = argv.indexOf('--model');
  assert.ok(index > 0, JSON.stringify(argv));
  assert.deepEqual(argv.slice(index, index + 2), ['--model', expected]);
  assert.equal(argv.filter(arg => arg === '--model').length, 1);
  assert.equal(argv.includes('-m'), false, JSON.stringify(argv));
  assert.equal(Object.hasOwn(result, 'model'), true);
  assert.equal(result.model, expected);
}

function hasNoModel({ argv, result }: Awaited<ReturnType<typeof launch>>) {
  assert.equal(argv.includes('--model'), false, JSON.stringify(argv));
  assert.equal(argv.includes('-m'), false, JSON.stringify(argv));
  assert.equal(Object.hasOwn(result, 'model'), false, JSON.stringify(result));
}

test('M8-43a browser Claude without project config uses Sonnet in argv and result', async t => {
  hasModel(await launch(t, { browser: true }), 'claude-sonnet-5-5');
});

test('M8-43a project models.browser selects Opus in argv and result', async t => {
  hasModel(await launch(t, { browser: true }, '{"models":{"browser":"claude-opus-5-5"}}'), 'claude-opus-5-5');
});

test('M8-43a explicit Haiku overrides project Opus in argv and result', async t => {
  hasModel(await launch(t, { browser: true, model: 'claude-haiku-5-5' }, '{"models":{"browser":"claude-opus-5-5"}}'), 'claude-haiku-5-5');
});

for (const params of [{}, { browser: false }]) {
  for (const config of [undefined, '{"models":{"browser":"claude-opus-5-5"}}']) {
    test('M8-43a non-browser Claude has no model: ' + JSON.stringify({ params, config }), async t => {
      hasNoModel(await launch(t, params, config));
    });
  }
}

for (const engine_id of ['codex', 'agy']) {
  for (const config of [undefined, '{"models":{"browser":"claude-opus-5-5"}}']) {
    test('M8-43a browser ' + engine_id + ' has no default model: ' + String(config), async t => {
      hasNoModel(await launch(t, { engine_id, browser: true }, config));
    });
  }
}

for (const config of [
  '{"models":{"browser":""}}', '{}', '{"models":{}}', '{"models":{"browser":5}}',
  '{"models":{"browser":null}}', '{"models":{"browser":false}}',
  '{"models":{"browser":[]}}', '{"models":{"browser":{}}}',
]) {
  test('M8-43a invalid or missing models.browser falls back to Sonnet: ' + config, async t => {
    hasModel(await launch(t, { browser: true }, config), 'claude-sonnet-5-5');
  });
}

test('M8-43a JSON null project config launches with Sonnet without throwing', async t => {
  hasModel(await launch(t, { browser: true }, 'null'), 'claude-sonnet-5-5');
});

test('M8-43a malformed project config launches with Sonnet', async t => {
  hasModel(await launch(t, { browser: true }, 'not JSON'), 'claude-sonnet-5-5');
});

for (const [config, expected] of [
  ['{"browser":{"grant":"look"}}', 'claude-sonnet-5-5'],
  ['{"browser":{"grant":"look"},"models":{"browser":"claude-opus-5-5"}}', 'claude-opus-5-5'],
]) {
  test('M8-43a project look grant is stored alongside model ' + expected, async t => {
    const observed = await launch(t, { browser: true }, config);
    hasModel(observed, expected);
    assert.equal(observed.grant, 'look');
  });
}
