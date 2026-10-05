import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repoDir } from '../src/paths.ts';
import { validate } from '../src/jsonschema.ts';

const schema = JSON.parse(readFileSync(join(repoDir, 'contracts/pipeline.schema.json'), 'utf8'));
const pipelineDir = join(repoDir, 'pipelines');

test('every shipped pipeline validates and the layout enum rejects unknown values', () => {
  const files = readdirSync(pipelineDir).filter(file => file.endsWith('.json'));
  assert.ok(files.length > 0, 'expected shipped pipeline JSON files');
  for (const file of files) {
    const pipeline = JSON.parse(readFileSync(join(pipelineDir, file), 'utf8'));
    assert.deepEqual(validate(schema, pipeline), [], `${file} should validate against pipeline.schema.json`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'pipeline-schema-'));
  try {
    const copyPath = join(tempDir, files[0]);
    const bad = JSON.parse(readFileSync(join(pipelineDir, files[0]), 'utf8'));
    bad.layout = 'unknown-layout';
    writeFileSync(copyPath, JSON.stringify(bad));
    const errors = validate(schema, JSON.parse(readFileSync(copyPath, 'utf8')));
    assert.ok(errors.some(error => error.includes('/layout') && /one of/.test(error)), errors.join('\n'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
