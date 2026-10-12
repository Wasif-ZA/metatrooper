import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('every shipped plugin manifest is valid', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-shipped-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { repoDir } = await import('../src/paths.ts');
  const { readManifest, validateManifest } = await import('../src/plugins/manifest.ts');
  try {
    const pluginsDir = path.join(repoDir, 'plugins');
    for (const dir of [...fs.readdirSync(pluginsDir).map((n) => path.join(pluginsDir, n)), path.join(repoDir, 'router')]) {
      const name = path.basename(dir);
      if (!fs.existsSync(path.join(dir, 'troop-plugin.json'))) continue;
      assert.deepEqual(validateManifest(readManifest(dir).manifest, dir), [], `plugin ${name}`);
    }
  } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('every test file tests/release.ps1 names exists', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const ps1 = fs.readFileSync(path.join(root, 'tests', 'release.ps1'), 'utf8');
  for (const [, dir, cmd] of ps1.matchAll(/dir = '(\w+)'; cmd = '([^']*)'/g)) {
    for (const file of cmd.match(/test\/[\w.-]+\.test\.ts/g) ?? []) assert.ok(fs.existsSync(path.join(root, dir, file)), `${dir}/${file}`);
  }
});
