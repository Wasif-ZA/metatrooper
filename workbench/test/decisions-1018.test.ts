import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isolation } from '../../core/test/helpers.ts';

test('D3 the browser pipe never speaks first; D4 tool output scrubs a saved secret this process never decrypted; D6 wait_for cannot confirm a secret; D8 a busy database delays the audit row, and one busy past every try is logged', () => {
  const iso = isolation();
  // lower case only, so only the saved-secret redaction can catch it, not a credential pattern
  const marker = `secretmarker${randomUUID().replaceAll('-', '')}`;
  try {
    const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/decisions-1018.ts', import.meta.url))], {
      encoding: 'utf8', timeout: 90_000, env: { ...iso.env, M612_MARKER: marker },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(marker), 'the value is not in any result');
    assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), {
      waitGuess: { found: false },
      waitPlain: { found: true },
      evaluate: { value: 'Welcome [secret] home' },
      unaskedBytes: 0,
      hello: 'session',
      console: [{ at: JSON.parse(r.stdout.trim().split('\n').pop()!).console[0].at, level: 'log', text: 'typed [secret]' }],
      auditAfterBusy: 1,
      auditAfterLongBusy: 0,
    });
    assert.match(r.stderr, /browser audit row dropped after 3 tries \(console ok\)/);
  } finally {
    rmSync(iso.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
