// tests by Codex
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { replay, touchedFiles } from './token-replay.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const baseline = JSON.parse(readFileSync(join(root, 'tests/fixtures/token-replay/baseline.json'), 'utf8'));
const graphAvailable = (() => {
  try {
    execFileSync('code-review-graph', ['--version'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
})();

test('M4-01 before replay matches the token baseline for each diff', async () => {
  for (const diff of ['small', 'medium', 'large']) {
    const result = await replay(diff, 'before');
    assert.deepEqual({ bytes: result.bytes, tokens: result.tokens }, baseline[diff].before, diff);
  }
});

test('M4-01 large patch touches the expected 16 files', () => {
  const patch = readFileSync(join(root, 'tests/fixtures/token-replay/large.patch'), 'utf8');
  assert.deepEqual(touchedFiles(patch), [
    'lib/core/Axios.js',
    'lib/core/buildFullPath.js',
    'lib/helpers/bind.js',
    'lib/helpers/buildURL.js',
    'lib/helpers/combineURLs.js',
    'lib/helpers/cookies.js',
    'lib/helpers/formDataToJSON.js',
    'lib/helpers/fromDataURI.js',
    'lib/helpers/isAbsoluteURL.js',
    'lib/helpers/isURLSameOrigin.js',
    'lib/helpers/parseHeaders.js',
    'lib/helpers/parseProtocol.js',
    'lib/helpers/speedometer.js',
    'lib/helpers/spread.js',
    'lib/helpers/throttle.js',
    'lib/helpers/toURLEncodedForm.js',
  ]);
});

test('M4-03 after replay keeps the median token ratio at or below 0.70', { skip: !graphAvailable && 'Skipping: code-review-graph is not on PATH.' }, async () => {
  const ratios = [];
  for (const diff of ['small', 'medium', 'large']) {
    const before = await replay(diff, 'before');
    const after = await replay(diff, 'after');
    ratios.push(after.tokens / before.tokens);
  }
  ratios.sort((a, b) => a - b);
  assert.ok(ratios[1] <= 0.70, `median token ratio ${ratios[1].toFixed(3)} exceeds 0.70`);
});
