import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('every shipped plugin manifest is valid and every shipped pipeline validates or names its missing plugin', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-shipped-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { repoDir } = await import('../src/paths.ts');
  const { readManifest, validateManifest } = await import('../src/plugins/manifest.ts');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncPipelines } = await import('../src/pipelines/store.ts');
  const db = openCoreDb();
  try {
    const pluginsDir = path.join(repoDir, 'plugins');
    for (const dir of [...fs.readdirSync(pluginsDir).map((n) => path.join(pluginsDir, n)), path.join(repoDir, 'router')]) {
      const name = path.basename(dir);
      if (!fs.existsSync(path.join(dir, 'troop-plugin.json'))) continue;
      assert.deepEqual(validateManifest(readManifest(dir).manifest, dir), [], `plugin ${name}`);
    }
    syncPipelines(db);
    const rows = db.prepare("SELECT id, valid, errors FROM pipeline WHERE source = 'builtin'").all() as Array<{ id: string; valid: number; errors: string | null }>;
    assert.ok(rows.length > 0);
    for (const r of rows) {
      if (r.valid) continue;
      const errors = JSON.parse(r.errors ?? '[]') as string[];
      assert.ok(errors.length && errors.every((e) => /is not installed or has no action/.test(e)), `${r.id}: ${errors.join('; ')}`);
    }
  } finally {
    db.close();
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
