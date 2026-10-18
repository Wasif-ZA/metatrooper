import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { engineFix } from '../src/queries.ts';

test('h-sum-checkerror: an engine whose check threw gets a fix line', () => {
  assert.match(engineFix({ id: 'codex' }, 'check-error') ?? '', /codex/);
});

test('h-rv-ponytail: a pane that fails setup twice in a row is not rebuilt on the very next sync', () => {
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/pane-setup-backoff.ts', import.meta.url))], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), { retried: 4, waited: 4 });
});
