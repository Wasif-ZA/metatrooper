import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test('every spawn in the main process handles its error event, so a missing binary never raises the crash dialog', () => {
  const src = join(import.meta.dirname, '../src');
  const bad: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const f = join(dir, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|cjs)$/.test(e.name)) readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (/\bspawn\(/.test(line) && !line.includes(".on('error'")) bad.push(`${e.name}:${i + 1}`); });
    }
  };
  walk(src);
  assert.deepEqual(bad, []);
});
