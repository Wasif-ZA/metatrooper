import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { search } from '../../plugins/agent-reach/bin/search.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'research-plugins-'));
}

test('agent-reach search fails when every search fails and nothing was found', async () => {
  const dir = tempDir();
  try {
    const plan = join(dir, 'plan.md');
    writeFileSync(plan, 'search: one\nsearch: two\n');
    await assert.rejects(search({ plan, out: join(dir, 'out') }, async () => { throw new Error('mcporter not found'); }, async () => {}), /no sources found: one: mcporter not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
