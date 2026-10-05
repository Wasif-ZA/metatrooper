import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const core = fileURLToPath(new URL('..', import.meta.url));

function fixture(notify) {
  const home = mkdtempSync(join(tmpdir(), 'metatrooper-codex-unwrap-'));
  const config = join(home, 'config.toml');
  writeFileSync(config, `notify = ${JSON.stringify(notify)}\nmodel = "fixture"\n`);
  return { home, config };
}

function invoke(home, config, action) {
  const script = `
    import { installCodex, uninstallCodex } from ${JSON.stringify(new URL('../src/hooks/install.ts', import.meta.url).href)};
    ${action}
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: core,
    encoding: 'utf8',
    env: { ...process.env, METATROOPER_HOME: home, METATROOPER_CODEX_CONFIG: config },
  });
  assert.equal(result.status, 0, result.stderr);
}

function wrapper(inner) {
  return ['node', join(core, 'codex-notify.js').replaceAll('\\', '/'), JSON.stringify(inner)];
}

test('installCodex unwraps nested MetaTrooper notify wrappers without prior state', () => {
  const { home, config } = fixture(wrapper(wrapper(['orig.exe', 'turn-ended'])));
  try {
    invoke(home, config, 'installCodex();');
    const script = join(core, 'codex-notify.js').replaceAll('\\', '/');
    const notifyLine = readFileSync(config, 'utf8').split('\n')[0];
    assert.deepEqual(JSON.parse(notifyLine.slice('notify = '.length)), ['node', script, JSON.stringify(['orig.exe', 'turn-ended'])]);
    const state = JSON.parse(readFileSync(join(home, 'hooks-install.json'), 'utf8'));
    assert.deepEqual(state.codex.previous, ['orig.exe', 'turn-ended']);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('installCodex stores null and an empty array argument for a wrapper around an empty array', () => {
  const { home, config } = fixture(wrapper([]));
  try {
    invoke(home, config, 'installCodex();');
    const script = join(core, 'codex-notify.js').replaceAll('\\', '/');
    assert.equal(readFileSync(config, 'utf8').split('\n')[0], `notify = ${JSON.stringify(['node', script, '[]']).replaceAll(',', ', ')}`);
    const state = JSON.parse(readFileSync(join(home, 'hooks-install.json'), 'utf8'));
    assert.equal(state.codex.previous, null);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('uninstallCodex restores the original notify after nested wrappers were unwrapped', () => {
  const original = ['orig.exe', 'turn-ended'];
  const { home, config } = fixture(wrapper(wrapper(original)));
  try {
    invoke(home, config, `installCodex(); const fs = await import('node:fs'); const stateFile = ${JSON.stringify(join(home, 'hooks-install.json'))}; const state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); state.codex.installed = fs.readFileSync(${JSON.stringify(config)}, 'utf8'); fs.writeFileSync(stateFile, JSON.stringify(state)); const configFile = ${JSON.stringify(config)}; fs.writeFileSync(configFile, fs.readFileSync(configFile, 'utf8').replace(', ', ',')); uninstallCodex();`);
    assert.deepEqual(JSON.parse(readFileSync(config, 'utf8').split('\n')[0].slice('notify = '.length)), original);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
