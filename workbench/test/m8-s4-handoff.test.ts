import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function runFixture(path: string) {
  // Remove the inherited nested runner marker.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', '--test', '--test-reporter=tap', path], { encoding: 'utf8', timeout: 20000, env });
}

test('M8-S4 human-check handoff and partition UA with fake Electron', () => {
  const result = runFixture(fileURLToPath(new URL('./fixtures/m8-s4-handoff.ts', import.meta.url)));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /^# pass 33$/m);
  assert.match(result.stdout, /^# fail 0$/m);
});

test('fixture runner propagates assertion failures from node:test', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm8-s4-handoff-'));
  try {
    const path = join(dir, 'failure.mjs');
    writeFileSync(path, "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('intentional fixture failure', () => assert.fail('fixture failure sentinel'));\n");
    const result = runFixture(path);
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /^# pass 0$/m);
    assert.match(result.stdout, /^# fail 1$/m);
    assert.match(result.stdout + result.stderr, /fixture failure sentinel/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
