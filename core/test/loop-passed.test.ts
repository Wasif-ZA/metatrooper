import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerated, until } from './helpers.ts';
import { revisionHarness } from './ui-revision-helpers.ts';

before(buildGenerated);

const loop = (id: string, outputs: object, declared = ['passed']) => ({
  schema: 1, id, title: id,
  steps: [{ id: 'check', kind: 'agent', engine: 'fake', role: 'verify', approval: 'edits', outputs: declared, prompt: `FAKE ${JSON.stringify({ outputs })}\nCheck.`, loop: { steps: ['check'], until: 'steps.check.passed', max: 2 } }],
});

test('a check loop treats a missing passed as not passed and pauses at loop-max; passed true ends it', async () => {
  const h = await revisionHarness();
  try {
    const end = (runId: string) => until(() => {
      const r = h.db.prepare('SELECT status, paused_why FROM run WHERE id = ?').get(runId) as any;
      return r.status === 'done' || r.status === 'failed' || r.paused_why === 'loop-max' ? r : null;
    }, 30000);
    const iterations = (runId: string) => (h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'check' AND status = 'done'").get(runId) as any).n;
    const missing = await h.pipeline(loop('loop-missing', { note: 'forgot passed' }, ['note']));
    assert.deepEqual({ ...(await end(missing)) }, { status: 'paused', paused_why: 'loop-max' });
    assert.equal(iterations(missing), 2);
    const passing = await h.pipeline(loop('loop-true', { passed: true }));
    assert.deepEqual({ ...(await end(passing)) }, { status: 'done', paused_why: null });
    assert.equal(iterations(passing), 1);
    const failing = await h.pipeline(loop('loop-false', { passed: false }));
    assert.equal((await end(failing)).paused_why, 'loop-max');
  } finally { await h.close(); }
});
