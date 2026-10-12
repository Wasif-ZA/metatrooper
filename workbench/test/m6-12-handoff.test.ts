import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isolation } from '../../core/test/helpers.ts';

test('M6-12a handoff blocks every other browser tool until Give back; M6-12b a secret fills only a password field on its saved origin and reaches no event row, log, tool result, approval row or file', () => {
  const iso = isolation();
  // lower case only, so only the known-secret-value redaction can catch it, not the credential pattern
  const marker = `secretmarker${randomUUID().replaceAll('-', '')}`;
  try {
    const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/m6-12-handoff.ts', import.meta.url))], {
      encoding: 'utf8', timeout: 90_000, env: { ...iso.env, M612_MARKER: marker },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(marker) && !r.stderr.includes(marker), 'the value is not in the fixture output');
    const handed = 'the user has the pane (Sign in with your security key); wait until they give it back';
    assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), {
      hello: 'ok',
      passwordFieldOnSavedOrigin: 'ok',
      filledWithStoredValue: true,
      consoleScrubbed: true,
      evaluateAfterFill: 'evaluate is off on a page a secret was typed into; navigate first',
      otherOrigin: 'secret BANK_PW is saved for another origin; nothing was typed',
      plainField: 'secret BANK_PW goes only into a password field; nothing was typed',
      unknownSecret: 'there is no browser secret named NOPE; nothing was typed',
      insertedOnlyOnce: true,
      childFrameSameOrigin: 'ok',
      childFrameOtherOrigin: 'secret BANK_PW is saved for another origin; nothing was typed',
      childFrameOpaque: 'not sent: the control is in a frame whose origin cannot be established',
      childFrameDetached: 'not sent: the control is in a frame whose origin cannot be established',
      childFrameInserted: 2,
      describeScrubbed: { automation_id: 'pw-[secret]', name: 'Password [secret]', role: 'textbox' },
      approval: 'approved: password field',
      handoffMidAction: 'ok',
      inputAfterHandoff: handed,
      nothingSentAfterHandoff: true,
      realCmdWhileHanded: { input: handed, other: 'sent', dispatched: ['DOM.focus'] },
      handoff: 'ok',
      handoffEvent: true,
      stateCarriesReason: true,
      whileHanded: { snapshot: handed, click: handed, type: handed, navigate: handed, console: handed, screenshot: handed, describe: handed, handoff: handed },
      afterGiveBack: 'ok',
      outcome: 'ok',
      outcomeBadStatus: 'outcome takes a checked tool (click, type, select or key) and an error status',
      outcomeBadTool: 'outcome takes a checked tool (click, type, select or key) and an error status',
      audit: [
        's1 type bp_agent_1 https://bank.test ok',
        's1 console bp_agent_1 https://bank.test ok',
        's1 evaluate bp_agent_1 https://bank.test error -32037',
        's1 type bp_agent_1 https://evil.test error -32037',
        's1 type bp_agent_1 https://bank.test error -32037',
        's1 type bp_agent_1 https://bank.test error -32037',
        's1 type bp_agent_1 https://bank.test ok',
        's1 type bp_agent_1 https://bank.test error -32037',
        's1 type bp_agent_1 https://bank.test error -32030',
        's1 type bp_agent_1 https://bank.test error -32030',
        's1 handoff bp_agent_1 https://bank.test ok',
        's1 type bp_agent_1 https://bank.test error -32036',
        's1 handoff bp_agent_1 https://bank.test ok',
        's1 snapshot bp_agent_1 https://bank.test error -32036',
        's1 click bp_agent_1 https://bank.test error -32036',
        's1 type bp_agent_1 https://bank.test error -32036',
        's1 navigate bp_agent_1 https://bank.test error -32036',
        's1 console bp_agent_1 https://bank.test error -32036',
        's1 screenshot bp_agent_1 https://bank.test error -32036',
        's1 handoff bp_agent_1 https://bank.test error -32036',
        's1 console bp_agent_1 https://bank.test ok',
        's1 type bp_agent_1 https://bank.test error -32030',
      ],
      auditKeys: ['origin', 'pane', 'status', 'tool'],
      describeIsTheCheckOne: true,
      markerFound: [],
    });
  } finally {
    rmSync(iso.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
