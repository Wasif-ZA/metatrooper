import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePipeline } from '../src/pipelines/validate.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugins/repo/troop-plugin.json'), 'utf8'));
const pipelinesDir = path.join(root, 'pipelines');
const load = (id) => JSON.parse(fs.readFileSync(path.join(pipelinesDir, id + '.json'), 'utf8'));

test('loop pipelines validate with the repo plugin manifest', () => {
  for (const id of ['spec-build-review-handback', 'two-engine-review']) {
    const errors = validatePipeline(load(id), { action: (plugin, action) => manifest.actions.find((item) => plugin === manifest.id && action === item.id) ?? null, pipeline: (childId) => load(childId), dir: pipelinesDir });
    assert.deepEqual(errors, [], id + ': ' + errors.join('; '));
  }
});
