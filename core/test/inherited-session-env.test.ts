import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isolation, runNode, startCore, teardownCore } from './helpers.ts';

const INHERITED = { TROOP_SESSION_ID: 'ses_from_outer_cc', TROOP_ANYTHING: '1', CLAUDE_CODE_SESSION_ID: 'outer', CLAUDECODE: '1' };
const leaked = `console.log(JSON.stringify(Object.keys(process.env).filter((k) => /^TROOP_|^CLAUDE(CODE$|_CODE_SESSION_ID$)/.test(k))))`;

test('importing the test helpers drops session variables inherited from an outer cc or Claude Code session', () => {
  const helpers = pathToFileURL(join(import.meta.dirname, 'helpers.ts')).href;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const h = await import(${JSON.stringify(helpers)}); ${leaked}; console.log(JSON.stringify(Object.keys(h.isolation().env).filter((k) => k.startsWith('TROOP_'))))`], { env: { ...process.env, ...INHERITED }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.split(/\r?\n/).slice(0, 2), ['[]', '[]']);
});

test('the core and workbench suite runners preload the same cleanup for every test process', () => {
  const r = spawnSync(process.execPath, ['--import=./test/clean-env.mjs', '-e', leaked], { cwd: join(import.meta.dirname, '..'), env: { ...process.env, ...INHERITED }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '[]');
  assert.match(readFileSync(join(import.meta.dirname, 'run-suites.mjs'), 'utf8'), /--import=\.\/test\/clean-env\.mjs/);
  assert.match(JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'workbench', 'package.json'), 'utf8')).scripts.test, /--import=\.\.\/core\/test\/clean-env\.mjs/);
});

test('troop launch with a stale TROOP_SESSION_ID says so plainly and launches without a parent', async () => {
  const h = isolation();
  const registry = join(h.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], state_source: 'process', roles: ['worker'], cost_rank: 1, usage_source: 'none', version_cmd: [process.execPath, '--version'] }]));
  const env = { ...h.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...h, env });
  try {
    const project = join(h.home, 'proj');
    mkdirSync(project);
    const r = await runNode(['core/cli.ts', 'launch', 'fake', '--project', project], { ...env, TROOP_SESSION_ID: 'ses_stale_parent' }) as { code: number; stdout: string; stderr: string };
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /launched fake/);
    assert.match(r.stderr, /TROOP_SESSION_ID ses_stale_parent names no session in this core/);
  } finally {
    await teardownCore(core, h);
  }
});
