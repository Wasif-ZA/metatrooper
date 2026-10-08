import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { root } from './helpers.ts';

const { lintSpec } = await import(pathToFileURL(`${root}/pipelines/spec-to-pr/spec-lint.mjs`).href);

test('empty acceptance checks gets a flag', () => {
  const flags = lintSpec('# Goal\nBuild a useful tool.\n\n## Acceptance checks\n\n## Scope\nOnly this feature.');
  assert.ok(flags.some((flag: string) => /acceptance checks.*missing or empty/i.test(flag)));
});

test('an uncovered behaviour bullet gets a flag', () => {
  const flags = lintSpec('# Goal\nBuild a useful tool.\n\n## Acceptance checks\n- The output is useful.\n\n## User-visible behaviour\n- On failure, the tool retries twice.');
  assert.ok(flags.some((flag: string) => /No acceptance check covers/i.test(flag)));
});

test('also in the goal gets a flag', () => {
  const flags = lintSpec('# Goal\nBuild a useful tool and also add a dashboard.\n\n## Acceptance checks\n- The tool builds.');
  assert.ok(flags.some((flag: string) => /scope|also/i.test(flag)));
});

test('a clean spec gets no flags', () => {
  const flags = lintSpec('# Goal\nBuild a useful tool.\n\n## Acceptance checks\n- The tool returns a useful result.\n\n## Scope\n- The tool runs locally.');
  assert.deepEqual(flags, []);
});
