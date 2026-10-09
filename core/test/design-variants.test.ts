import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { captured, capturingEngine } from './pipeline-fixup-helpers.ts';
import { buildGenerated, until } from './helpers.ts';
import { revisionHarness } from './ui-revision-helpers.ts';
import { parseRef, resolveString } from '../src/pipelines/template.ts';
import { validatePipeline } from '../src/pipelines/validate.ts';

before(buildGenerated);

const load = () => JSON.parse(readFileSync(join(import.meta.dirname, '../../pipelines/preview/design-variants.json'), 'utf8'));
const context = {
  pipeline: () => null,
  action: (plugin: string, action: string) => plugin === 'agent-reach' && action === 'inspiration-board'
    ? { id: action, run: ['fake.js'], output_schema: { type: 'object', required: ['references'] } } as any : null,
  dir: join(import.meta.dirname, '../../pipelines'),
};

test('index and picked variant template references parse and resolve', () => {
  assert.deepEqual(parseRef('index'), { raw: 'index', root: 'index' });
  assert.deepEqual(parseRef('variants.picked.worktree'), { raw: 'variants.picked.worktree', root: 'variants', key: 'worktree' });
  assert.deepEqual(parseRef('variants.picked.branch'), { raw: 'variants.picked.branch', root: 'variants', key: 'branch' });
  const scope: any = { inputs: {}, steps: () => null, run: { id: 'r', dir: 'run' }, project: { path: 'project' }, index: 2, picked: () => ({ worktree: 'wt', branch: 'troop/v2' }) };
  assert.equal(resolveString('{{index}} {{variants.picked.worktree}} {{variants.picked.branch}}', scope), '2 wt troop/v2');
  assert.throws(() => resolveString('{{index}}', { ...scope, index: undefined }), /only available in a fan-out step/);
  assert.throws(() => resolveString('{{variants.picked.worktree}}', { ...scope, picked: () => null }), /no variant is picked/);
});

test('the shipped design-variants pipeline validates and rejects unsafe template placement', () => {
  const shipped = load();
  assert.deepEqual(validatePipeline(shipped, context), []);
  const noPick = structuredClone(shipped); noPick.steps = noPick.steps.filter((s: any) => s.id !== 'pick');
  assert.ok(validatePipeline(noPick, context).some((e) => /handoff gate/i.test(e)), validatePipeline(noPick, context).join('\n'));
  const badIndex = structuredClone(shipped); badIndex.steps[1].prompt += ' {{index}}';
  assert.ok(validatePipeline(badIndex, context).some((e) => /index.*fan-out/i.test(e)), validatePipeline(badIndex, context).join('\n'));
  const both = structuredClone(shipped); both.steps[3].cwd = '{{project.path}}';
  assert.ok(validatePipeline(both, context).some((e) => /cwd.*worktree/i.test(e)), validatePipeline(both, context).join('\n'));
});

async function installAgentReach(h: Awaited<ReturnType<typeof revisionHarness>>) {
  const dir = join(h.iso.home, 'agent-reach'); mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'troop-plugin.json'), JSON.stringify({ schema: 1, id: 'agent-reach', version: '1.0.0', name: 'Fake reach', actions: [{ id: 'inspiration-board', run: ['bin/board.mjs'], output_schema: { type: 'object', required: ['references'] } }] }));
  writeFileSync(join(dir, 'bin/board.mjs'), "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({ok:true,outputs:{references:['Swiss','Bauhaus','Editorial']}})));\n");
  const preview = await h.pipe.request('plugin.preview', { source: dir });
  const installed = await h.pipe.request('plugin.install', { source: dir, approved_permissions: [], manifest_hash: preview.result.manifest_hash });
  assert.equal(installed.result.plugin_id, 'agent-reach');
}

test('M2-01 design variants pause, require a pick, switch picks, and polish in the picked worktree', async () => {
  const h = await revisionHarness('design-variants', capturingEngine);
  try {
    await installAgentReach(h);
    const def = load();
    for (const step of def.steps) if (step.kind === 'agent') {
      step.engine = 'fake';
      step.prompt = `FAKE ${JSON.stringify({ outputs: step.id === 'directions' ? { summary: 'three directions' } : { summary: step.id } })}\n${step.prompt}`;
    }
    const runId = await h.pipeline(def, { brief: readFileSync(join(h.project, 'brief.md'), 'utf8') });
    const directionsGate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id=? AND step_id='approve-directions' AND status='waiting'").get(runId), 30000);
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: directionsGate.id, decision: 'approve', action_hash: directionsGate.action_hash ?? undefined })).result, {});
    const pickGate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id=? AND step_id='pick' AND status='waiting'").get(runId), 60000);
    const attention = h.db.prepare("SELECT * FROM needs_you WHERE kind='handoff' AND ref=?").get(pickGate.id);
    assert.ok(attention); assert.equal(attention.resolved_at, null);
    const variants: any[] = h.db.prepare('SELECT * FROM variant WHERE run_id=? ORDER BY idx').all(runId) as any[];
    assert.equal(variants.length, 3);
    assert.equal(new Set(variants.map(v => v.worktree)).size, 3);
    assert.equal(new Set(variants.map(v => v.branch)).size, 3);
    for (const [index, variant] of variants.entries()) {
      assert.ok(existsSync(variant.worktree)); assert.match(variant.branch, /^troop\//); assert.ok(variant.dev_port > 0);
      const response = await fetch(`http://127.0.0.1:${variant.dev_port}/`); assert.equal(response.status, 200);
      const row = h.db.prepare("SELECT session_id FROM run_step WHERE run_id=? AND step_id='variants' AND fanout_index=?").get(runId, index);
      assert.match(captured(h, row.session_id as string).prompt, new RegExp(`direction-${index}\\.md`));
    }
    const refused = await h.pipe.request('gate.resolve', { gate_id: pickGate.id, decision: 'approve' });
    assert.equal(refused.error.code, -32003); assert.match(refused.error.message, /pick a tile first/);
    assert.equal((h.db.prepare('SELECT status FROM gate WHERE id=?').get(pickGate.id) as any).status, 'waiting');
    assert.equal(h.db.prepare('SELECT status FROM run WHERE id=?').get(runId).status, 'paused');
    assert.equal(h.db.prepare('SELECT resolved_at FROM needs_you WHERE id=?').get(attention.id).resolved_at, null);
    assert.deepEqual((await h.pipe.request('variant.pick', { run_id: runId, idx: 1 })).result, {});
    assert.deepEqual((await h.pipe.request('variant.pick', { run_id: runId, idx: 2 })).result, {});
    assert.deepEqual(h.db.prepare('SELECT idx,status FROM variant WHERE run_id=? AND idx IN (1,2) ORDER BY idx').all(runId).map((row: any) => ({ ...row })), [{ idx: 1, status: 'ready' }, { idx: 2, status: 'picked' }]);
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: pickGate.id, decision: 'approve' })).result, {});
    assert.ok(h.db.prepare('SELECT resolved_at FROM needs_you WHERE id=?').get(attention.id).resolved_at);
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id=?').get(runId) as any).status === 'done', 30000);
    const polish: any = h.db.prepare("SELECT session_id FROM run_step WHERE run_id=? AND step_id='polish'").get(runId);
    const session: any = h.db.prepare('SELECT cwd FROM session WHERE id=?').get(polish.session_id);
    assert.equal(session.cwd.replaceAll('\\', '/'), variants[2].worktree.replaceAll('\\', '/'));
    const received = captured(h, polish.session_id);
    assert.equal(received.cwd.replaceAll('\\', '/').toLowerCase(), variants[2].worktree.replaceAll('\\', '/').toLowerCase());
    assert.ok(received.prompt.includes(variants[2].branch), received.prompt);
    assert.equal(h.db.prepare("SELECT COUNT(*) n FROM gate WHERE run_id=? AND step_id!='approve-directions' AND step_id!='pick'").get(runId).n, 0);
  } finally { try { await h.close(); } catch (error: any) { if (error?.code !== 'EPERM') throw error; } }
});
