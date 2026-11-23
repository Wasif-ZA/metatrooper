import test from 'node:test';
import assert from 'node:assert/strict';
import type { EngineSpec } from '../src/engines/registry.ts';
import { followUpApproval } from '../src/sessions/launch.ts';

const engine = (profiles: string[]): EngineSpec => ({
  id: 'fake-followup-engine', command: process.execPath, version_cmd: [process.execPath, '--version'], state_source: 'process',
  roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
  approval_profiles: Object.fromEntries(profiles.map((p) => [p, [`--${p}`]])),
} as EngineSpec);

for (const [parent, profiles, expected] of [
  ['ask', ['edits', 'contained'], 'ask'],
  ['edits', ['edits', 'contained'], 'edits'],
  ['contained', ['edits', 'contained'], 'contained'],
  ['isolated', ['edits', 'contained'], 'contained'],
  [null, ['edits', 'contained'], 'ask'],
  ['edits', ['contained'], 'ask'],
] as const) {
  test(`a monitor follow-up of a ${parent ?? 'missing'} parent runs at ${expected}, never looser than its parent`, () => {
    assert.equal(followUpApproval(engine([...profiles]), 'contained', parent), expected);
  });
}
