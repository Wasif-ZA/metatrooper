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
    for (const name of fs.readdirSync(pluginsDir)) {
      const dir = path.join(pluginsDir, name);
      if (!fs.existsSync(path.join(dir, 'troop-plugin.json'))) continue;
      assert.deepEqual(validateManifest(readManifest(dir).manifest, dir), [], `plugin ${name}`);
    }
  } finally {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
