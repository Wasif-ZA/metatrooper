import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const script = join(root, 'tests', 'version-check.mjs');

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'metatrooper-version-check-'));
  mkdirSync(join(dir, 'tests'), { recursive: true });
  cpSync(script, join(dir, 'tests', 'version-check.mjs'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '7.8.9' }));
  mkdirSync(join(dir, 'core'));
  writeFileSync(join(dir, 'core', 'package.json'), JSON.stringify({ version: '7.8.9' }));
  mkdirSync(join(dir, 'plugins', 'sample'), { recursive: true });
  writeFileSync(join(dir, 'plugins', 'sample', 'troop-plugin.json'), JSON.stringify({ version: '7.8.9' }));
  return dir;
}

function run(dir: string) {
  return spawnSync(process.execPath, [join(dir, 'tests', 'version-check.mjs')], {
    cwd: dir,
    encoding: 'utf8',
  });
}

test('M5-09 version check passes when all package and plugin manifests match', () => {
  const dir = fixture();
  try {
    const result = run(dir);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /version check PASS: 7\.8\.9/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M5-09 version check fails and names a mismatched manifest', () => {
  const dir = fixture();
  try {
    writeFileSync(join(dir, 'plugins', 'sample', 'troop-plugin.json'), JSON.stringify({ version: '7.8.8' }));
    const result = run(dir);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /plugins[\\/]sample[\\/]troop-plugin\.json/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
