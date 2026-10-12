import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('browser network logs and screenshots always fit the 1 MiB pipe line', () => {
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/line-cap.ts', import.meta.url))], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop()!);
  assert.equal(out.networkFits, true);
  assert.match(out.dataUrl, /^data:image\/png;base64… \(\d+ chars\)$/);
  assert.ok(out.longUrlLength < 2100, `long URL kept ${out.longUrlLength} chars`);
  assert.equal(out.shotFits, true);
  assert.equal(out.shotMime, 'image/jpeg');
});
