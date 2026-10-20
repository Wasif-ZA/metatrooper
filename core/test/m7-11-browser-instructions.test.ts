import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BROWSER_BLOCK, METAROUTER_BLOCK } from '../src/sessions/launch.ts';
import { BUILT_IN } from '../src/engines/registry.ts';
import { client, isolation, startCore, teardownCore, until } from './helpers.ts';

async function fixture(metarouter: boolean) {
  const iso = isolation();
  writeFileSync(join(iso.home, 'settings.json'), JSON.stringify({ sessions: { metarouter } }));
  const script = join(iso.home, 'record-argv.mjs');
  writeFileSync(script, `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(join(process.env.METATROOPER_HOME, process.env.TROOP_SESSION_ID + '.argv.json'), JSON.stringify({ argv: process.argv.slice(2), token: process.env.TROOP_BROWSER_TOKEN ?? null }));
setTimeout(() => process.exit(0), 1200);
`);
  const registry = join(iso.home, 'engines.json');
  const engines = ['claude', 'codex'].map((id) => {
    const builtIn = BUILT_IN.find((engine) => engine.id === id)!;
    return {
      id, command: process.execPath, args: [script], prompt_arg: 'positional',
      state_source: 'process', roles: ['worker'], cost_rank: 1, usage_source: 'none',
      provider: 'local-cli', version_cmd: [process.execPath, '--version'],
      instructions_arg: builtIn.instructions_arg,
      mcp_attach: { kind: 'claude-mcp-config-flag' },
    };
  });
  writeFileSync(registry, JSON.stringify(engines));
  iso.env.METATROOPER_ENGINES = registry;
  const project = join(iso.home, 'project');
  mkdirSync(project);
  const core = await startCore(iso);
  const pipe = await client(iso.prefix);
  try {
    const opened = await pipe.request('project.open', { path: project });
    assert.ok(opened.result?.project_id, JSON.stringify(opened));
    const launch = async (engine_id: string, browser: boolean) => {
      const reply = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id, browser });
      assert.ok(reply.result?.session_id, JSON.stringify(reply));
      const file = join(iso.home, `${reply.result.session_id}.argv.json`);
      await until(() => existsSync(file), 8000);
      return JSON.parse(readFileSync(file, 'utf8')) as { argv: string[]; token: string | null };
    };
    const claudeBrowser = await launch('claude', true);
    const claudeNoBrowser = metarouter ? await launch('claude', false) : null;
    const codexBrowser = metarouter ? await launch('codex', true) : null;
    return { claudeBrowser, claudeNoBrowser, codexBrowser };
  } finally {
    pipe.close();
    await teardownCore(core, iso);
  }
}

function prompts(argv: string[]): string[] {
  return argv.flatMap((arg, i) => arg === '--append-system-prompt' ? [argv[i + 1]] : []);
}

test('M7-11 Claude browser launch combines router and browser instructions in one argv prompt', async () => {
  const result = await fixture(true);
  assert.match(result.claudeBrowser.token ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual(prompts(result.claudeBrowser.argv), [`${METAROUTER_BLOCK}\n\n${BROWSER_BLOCK}`]);
  assert.equal(result.claudeNoBrowser?.token, null);
  assert.deepEqual(prompts(result.claudeNoBrowser!.argv), [METAROUTER_BLOCK]);
  assert.match(result.codexBrowser?.token ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual(prompts(result.codexBrowser!.argv), []);
  assert.equal(result.codexBrowser!.argv.some((arg) => arg.includes(METAROUTER_BLOCK) || arg.includes(BROWSER_BLOCK)), false);
});

test('M7-11 Claude browser launch carries only browser instructions when metarouter is off', async () => {
  const result = await fixture(false);
  assert.match(result.claudeBrowser.token ?? '', /^[a-f0-9]{64}$/);
  assert.deepEqual(prompts(result.claudeBrowser.argv), [BROWSER_BLOCK]);
});

test('M7-11 Claude launch without browser carries only router instructions', async () => {
  const result = await fixture(true);
  const argv = result.claudeNoBrowser!.argv;
  assert.deepEqual(prompts(argv), [METAROUTER_BLOCK]);
  assert.equal(prompts(argv)[0].includes('## Browser'), false);
});

test('M7-11 Codex browser launch passes token without browser instructions in argv', async () => {
  const result = await fixture(true);
  const { argv, token } = result.codexBrowser!;
  assert.deepEqual(prompts(argv), []);
  assert.equal(argv.some((arg) => arg.includes(BROWSER_BLOCK)), false);
  assert.match(token ?? '', /^[a-f0-9]{64}$/);
});
