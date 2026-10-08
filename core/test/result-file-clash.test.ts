import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePipeline } from '../src/pipelines/validate.ts';

const ctx = { dir: null, pipeline: () => null, action: () => ({ id: 'go', run: ['x'] }) as any };
const pipe = (out: string, extra: any[] = []) => ({
  schema: 1, id: 'clash', title: 'Clash', requires: ['p'],
  steps: [{ id: 'crawl', kind: 'action', uses: 'plugin:p/go', with: { out } }, ...extra],
});
const clashes = (p: unknown) => validatePipeline(p, ctx).filter((e) => /result file/.test(e));

test('an action writing to any action step result file is refused, other names pass', () => {
  assert.deepEqual(clashes(pipe('{{run.dir}}/crawl.json')), ["/steps/0 (crawl)/with: {{run.dir}}/crawl.json is step crawl's result file and the runner overwrites it; use another name"]);
  assert.equal(clashes(pipe('{{ run.dir }}/crawl-2.json')).length, 1);
  assert.equal(clashes(pipe('{{run.dir}}/later.json', [{ id: 'later', kind: 'action', uses: 'plugin:p/go', with: {} }])).length, 1);
  assert.deepEqual(clashes(pipe('{{run.dir}}/site-crawl.json')), []);
  assert.deepEqual(clashes(pipe('{{run.dir}}/crawl/out.json')), []);
  assert.deepEqual(clashes(pipe('{{run.dir}}/notes.json', [{ id: 'notes', kind: 'agent', prompt: 'x' }])), []);
});
