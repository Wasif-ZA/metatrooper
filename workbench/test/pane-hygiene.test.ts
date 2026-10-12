import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('M6-13 pane hygiene: error pages, popups with opener, no pane without a click, element stack walk', () => {
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/pane-hygiene.ts', import.meta.url))], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), {
    noClickDenied: true,
    clickOpensOnePane: true,
    secondOpenNeedsAnotherClick: true,
    agentClickCounts: true,
    popupKeepsOpener: true,
    popupGuarded: true,
    popupClosesWithPane: true,
    loadErrorPage: true,
    errorPageKeepsUrl: true,
    certificatePage: true,
    blockedPage: true,
    abortAndSubframeIgnored: true,
    crashPage: true,
    reloadRetriesFailedUrl: true,
    errorPageEscapes: true,
    walkUp: true,
    walkStopsBelowHtml: true,
    walkDown: true,
    walkDownAtClickedIsNoop: true,
    navigateToDeadHostFails: true,
  });
});
