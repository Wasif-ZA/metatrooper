import test from 'node:test';
import assert from 'node:assert/strict';
import { revisionHarness } from './ui-revision-helpers.ts';
import { BUILT_IN } from '../src/engines/registry.ts';

test('engines.models lists the manifest models, empty without a model argument, not found for an unknown engine', async () => {
  const h = await revisionHarness(undefined, undefined, [
    { id: 'picker', command: process.execPath, args: ['-e', ''], prompt_arg: 'positional', model_arg: '--model', models: ['big', 'small'], state_source: 'process', roles: ['worker'], cost_rank: 3, version_cmd: [process.execPath, '--version'] },
  ]);
  try {
    assert.deepEqual((await h.pipe.request('engines.models', { engine_id: 'picker' })).result, { models: ['big', 'small'] });
    assert.deepEqual((await h.pipe.request('engines.models', { engine_id: 'ticker' })).result, { models: [] });
    assert.equal((await h.pipe.request('engines.models', { engine_id: 'nope' })).error?.code, -32002);
  } finally {
    await h.close();
  }
  assert.deepEqual(BUILT_IN.find((e) => e.id === 'claude')?.models, ['opus', 'sonnet', 'haiku']);
});
