import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');

test('M1-32 AGPL dirs carry AGPL-3.0 and MIT dirs carry MIT', () => {
  for (const d of ['core', 'workbench', 'tray']) {
    if (!existsSync(new URL(`${d}/`, root))) continue; // tray/ not built yet
    assert.match(read(`${d}/LICENSE`), /GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3/, `${d} LICENSE`);
    if (existsSync(new URL(`${d}/package.json`, root))) {
      assert.equal(JSON.parse(read(`${d}/package.json`)).license, 'AGPL-3.0-only', `${d} package license`);
    }
  }
  for (const d of ['sdk', 'pipelines']) {
    assert.match(read(`${d}/LICENSE`), /^MIT License/, `${d} LICENSE`);
  }
  assert.match(read('contracts/LICENSE-MIT'), /MIT License/);
});
