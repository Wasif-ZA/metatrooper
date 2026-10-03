import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { revisionHarness, runDone } from './ui-revision-helpers.ts';
import { capturingEngine } from './pipeline-fixup-helpers.ts';
import { until } from './helpers.ts';
import { validatePipeline } from '../src/pipelines/validate.ts';

function pipeline(serve?: string) {
  return { schema: 1, id: 'serve-order', title: 'Server ordering', steps: [{
    id: 'probe', kind: 'agent', engine: 'fake', browser: true,
    dev_command: 'node serve.js --port {{port}}', ...(serve ? { serve } : {}),
    prompt: 'FAKE {"probe_http":true,"outputs":{}}', outputs: ['probe'],
  }] };
}

test('serve rejects during and accepts before, after, and the default', () => {
  const context = { pipeline: () => null, action: () => null, dir: import.meta.dirname };
  for (const mode of [undefined, 'before', 'after']) assert.deepEqual(validatePipeline(pipeline(mode), context), []);
  assert.ok(validatePipeline(pipeline('during'), context).some(e => /serve/.test(e)));
});

for (const mode of ['before', undefined]) {
  test(`agent fetch gets ${mode ? '200 with serve before' : 'ECONNREFUSED with default serve after'}`, async () => {
    const h = await revisionHarness('website-build', capturingEngine);
    try {
      const runId = await h.pipeline(pipeline(mode));
      await runDone(h, runId);
      const row = h.db.prepare('SELECT outputs FROM run_step WHERE run_id=? AND step_id=?').get(runId, 'probe');
      assert.equal(JSON.parse(row.outputs as string).probe, mode ? 200 : 'ECONNREFUSED');
      assert.ok(readdirSync(join(h.iso.home, 'listener-pids')).length > 0);
    } finally { await h.close(); }
  });
}

test('serve before fails a non-answering server without starting its agent', { timeout: 120000 }, async () => {
  const h = await revisionHarness('website-build', capturingEngine);
  try {
    writeFileSync(join(h.project, 'serve.js'), 'import {createServer} from "node:http"; console.log("intentionally never answers"); createServer(() => {}).listen(Number(process.argv[process.argv.indexOf("--port") + 1]), "127.0.0.1");');
    const runId = await h.pipeline(pipeline('before'));
    const row = await until(() => h.db.prepare("SELECT * FROM run_step WHERE run_id=? AND step_id='probe' AND status='failed'").get(runId), 105000)
      .catch(error => { throw new Error(`${error}; rows=${JSON.stringify(h.db.prepare('SELECT * FROM run_step WHERE run_id=?').all(runId))}`); });
    assert.equal(row.session_id, null);
    assert.equal(h.db.prepare('SELECT COUNT(*) n FROM session').get().n, 0);
    const runDir = h.db.prepare('SELECT run_dir FROM run WHERE id=?').get(runId).run_dir as string;
    const log = readFileSync(join(runDir, 'log.jsonl'), 'utf8');
    assert.match(log, /gave no response/);
    assert.match(log, /intentionally never answers/);
    assert.ok(readdirSync(join(h.iso.home, 'listener-pids')).length > 0);
  } finally { await h.close(); }
});
