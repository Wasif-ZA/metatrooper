import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { buildGenerated, until } from './helpers.ts';
import { revisionHarness } from './ui-revision-helpers.ts';
import { validatePipeline } from '../src/pipelines/validate.ts';

before(buildGenerated);

const pipe = (id: string, captcha: string) => ({
  schema: 1, id, title: id,
  steps: [
    { id: 'fill', kind: 'agent', engine: 'fake', role: 'worker', approval: 'edits', outputs: ['captcha'], prompt: `FAKE ${JSON.stringify({ outputs: { captcha } })}\nFill.` },
    { id: 'captcha', kind: 'gate', gate: 'handoff', when: 'steps.fill.outputs.captcha == "shown"', gate_summary: 'Solve it.' },
    { id: 'after', kind: 'agent', engine: 'fake', role: 'worker', approval: 'edits', outputs: ['summary'], prompt: 'FAKE {"outputs":{"summary":"ok"}}\nAfter.' },
  ],
});

test('a gate with when pauses when it is true and is skipped and logged when it is false', async () => {
  const h = await revisionHarness();
  try {
    const none = await h.pipeline(pipe('when-none', 'none'));
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(none) as any).status === 'done', 30000);
    assert.equal((h.db.prepare("SELECT status FROM run_step WHERE run_id = ? AND step_id = 'captcha'").get(none) as any).status, 'skipped');
    assert.equal((h.db.prepare('SELECT COUNT(*) n FROM gate WHERE run_id = ?').get(none) as any).n, 0);
    const shown = await h.pipeline(pipe('when-shown', 'shown'));
    const gate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'captcha' AND status = 'waiting'").get(shown), 30000);
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'after' AND status = 'done'").get(shown) as any).n, 0);
    await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve' });
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(shown) as any).status === 'done', 30000);
  } finally { await h.close(); }
});

test('when is refused on a non-gate step, on a later or unknown step, and in a bad form', () => {
  const ctx = { dir: null, pipeline: () => null, action: () => null };
  const errs = (steps: object[]) => validatePipeline({ schema: 1, id: 'when-check', title: 'When check', steps }, ctx).filter((e) => /when/.test(e));
  const a = { id: 'a', kind: 'agent', role: 'worker', prompt: 'x', outputs: ['k'] };
  assert.deepEqual(errs([a, { id: 'g', kind: 'gate', gate: 'handoff', when: 'steps.a.outputs.k == "y"' }]), []);
  assert.equal(errs([{ ...a, when: 'steps.a.passed' }]).length, 1);
  assert.equal(errs([{ id: 'g', kind: 'gate', gate: 'handoff', when: 'steps.a.passed' }, a]).length, 1);
  assert.equal(errs([a, { id: 'g', kind: 'gate', gate: 'handoff', when: 'steps.zz.passed' }]).length, 1);
  assert.ok(errs([a, { id: 'g', kind: 'gate', gate: 'handoff', when: 'a is done' }]).length >= 1);
});
