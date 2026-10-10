#!/usr/bin/env node
// M5-9: every package.json and troop-plugin.json carries the root package.json version.
// Usage: node tests/version-check.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const want = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const skip = new Set(['node_modules', '.git', 'fixtures', 'release-logs']);

function* manifests(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !skip.has(e.name)) yield* manifests(join(dir, e.name));
    else if (e.isFile() && (e.name === 'package.json' || e.name === 'troop-plugin.json')) yield join(dir, e.name);
  }
}

let bad = 0;
for (const file of manifests(root)) {
  const got = JSON.parse(readFileSync(file, 'utf8')).version;
  if (got !== want) { bad++; console.log(`${relative(root, file)}: ${got} (want ${want})`); }
}
console.log(bad ? `version check FAIL: ${bad} file(s) differ from ${want}` : `version check PASS: ${want}`);
process.exit(bad ? 1 : 0);
