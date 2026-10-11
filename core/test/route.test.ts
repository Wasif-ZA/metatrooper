import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const shim = path.join(root, 'router', 'bin', 'metarouter.js');
const { findPython } = await import(pathToFileURL(shim).href);
const hasPython = findPython() !== null;

function env(extra: Record<string, string> = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-route-'));
  return { ...process.env, HOME: home, USERPROFILE: home, METATROOPER_HOME: path.join(home, 'mt'), ...extra };
}

test('troop route runs the bundled metarouter', { skip: !hasPython && 'no Python 3.11+' }, () => {
  const r = spawnSync(process.execPath, ['core/cli.ts', 'route', 'list', '--json'], { cwd: root, env: env(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});

test('troop route with no Python and no metarouter exits 127 and says what is missing', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-route-path-'));
  const e = env({ TROOP_PYTHON: path.join(empty, 'no-python') });
  for (const k of Object.keys(e)) if (k.toLowerCase() === 'path') delete e[k];
  e.PATH = empty;
  const r = spawnSync(process.execPath, ['core/cli.ts', 'route', 'list'], { cwd: root, env: e, encoding: 'utf8' });
  assert.equal(r.status, 127);
  assert.match(r.stderr, /Python 3\.11/);
});

test('the metarouter plugin action answers in the plugin contract shape', { skip: !hasPython && 'no Python 3.11+' }, () => {
  const action = path.join(root, 'router', 'bin', 'troop-action.js');
  const r = spawnSync(process.execPath, [action], { env: env(), input: JSON.stringify({ schema: 1, action: 'ingest', input: {} }), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(typeof out.outputs.shell_read_tokens, 'number');
  assert.equal(typeof out.outputs.saved_tokens, 'number');
});

test('troop gate reads A-05 from the bundled metarouter', { skip: !hasPython && 'no Python 3.11+' }, () => {
  const r = spawnSync(process.execPath, ['core/cli.ts', 'gate', '--json'], { cwd: root, env: env(), encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.notEqual(JSON.parse(r.stdout).A05.reason, 'toolrouter not found');
});

test('sessions get the bundled metarouter first on PATH, and claude gets the metarouter block', async () => {
  const { metarouterLaunch, METAROUTER_BLOCK } = await import('../src/sessions/launch.ts');
  const { BUILT_IN } = await import('../src/engines/registry.ts');
  const claude = BUILT_IN.find((e) => e.id === 'claude')!;
  const codex = BUILT_IN.find((e) => e.id === 'codex')!;
  const bin = path.join(root, 'router', 'bin');
  const on = metarouterLaunch(claude, true, { Path: 'X' });
  assert.deepEqual(on.args, ['--append-system-prompt', METAROUTER_BLOCK]);
  assert.deepEqual(on.env, { Path: `${bin}${path.delimiter}X` });
  assert.deepEqual(metarouterLaunch(codex, true, { PATH: 'X' }).args, []);
  assert.deepEqual(metarouterLaunch(claude, false), { args: [], env: {} });
});

test('metarouter on a session PATH runs the bundled copy', { skip: !hasPython && 'no Python 3.11+' }, async () => {
  const { metarouterLaunch } = await import('../src/sessions/launch.ts');
  const e = env();
  const r = spawnSync('metarouter', ['list', '--json'], { env: { ...e, ...metarouterLaunch({ id: 'x' } as never, true, e).env }, encoding: 'utf8', shell: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).ok, true);
});
