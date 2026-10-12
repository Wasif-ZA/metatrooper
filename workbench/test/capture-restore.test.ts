import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('a failed Before/After capture still restores the viewport and reports the capture error', () => {
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/capture-restore.ts', import.meta.url))], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop()!);
  assert.equal(out.plain.last, 'Emulation.clearDeviceMetricsOverride');
  assert.match(out.plain.error, /capture broke/);
  assert.equal(out.restoreAlsoFails.last, 'Emulation.clearDeviceMetricsOverride');
  assert.match(out.restoreAlsoFails.error, /capture broke/);
});
