import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../../pipelines/spec-build-review-handback/handback.mjs';

async function fixture(t, { reverifyPassed = true, includeReviews = true } = {}) {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'loop-handback-'));
  t.after(() => fs.rm(runDir, { recursive: true, force: true }));
  if (includeReviews) {
    for (const [step, data] of [
      ['review', { disagree: [{ codex: { title: 'disputed finding', file: 'src/a.ts', line_start: 7 } }], codex_only: [{ title: 'codex item' }], gemini_only: [{ title: 'gemini item' }] }],
      ['rereview', { both: [{ title: 'unresolved both' }], disagree: [{ title: 'unresolved disagreement' }] }],
    ]) {
      const dir = path.join(runDir, step, 'child-run');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'review-buckets.json'), JSON.stringify(data));
    }
  }
  const ctx = {
    runDir,
    inputs: {},
    steps: {
      build: { worktree: 'C:/work/tree', branch: 'feature/loop' },
      reverify: { passed: reverifyPassed, exit_code: 4 },
    },
    async writeFile(name, contents) { await fs.writeFile(path.join(runDir, name), contents); },
  };
  return { runDir, ctx };
}

test('hand-back numbers disputed, unresolved, human-only and commit items', async (t) => {
  const { runDir, ctx } = await fixture(t, { reverifyPassed: false });
  const result = await run(ctx);
  assert.deepEqual(result.items.map((item) => item.n), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(result.items.map((item) => item.kind), ['disputed', 'disputed', 'disputed', 'unresolved', 'unresolved', 'human', 'human']);
  assert.match(result.items[0].text, /disputed finding \(src\/a\.ts:7\).*engines disagree/);
  assert.match(result.items[1].text, /codex item.*only codex found it/);
  assert.match(result.items[2].text, /gemini item.*only gemini found it/);
  assert.match(result.items[3].text, /unresolved both: still found after the fix/);
  assert.match(result.items[4].text, /unresolved disagreement: still found after the fix/);
  assert.match(result.items[5].text, /Tests fail after the fix \(exit 4\)/);
  assert.match(result.items[6].text, /Review and commit the work in C:\/work\/tree on feature\/loop/);
  assert.equal(result.document, 'handback.md');
  assert.equal(result.count, 7);
  assert.match(await fs.readFile(path.join(runDir, 'handback.md'), 'utf8'), /^# Hand-back\n\n1\. \[disputed\]/);
});

test('passing reverify omits only the failing-tests human item', async (t) => {
  const { ctx } = await fixture(t, { reverifyPassed: true });
  const result = await run(ctx);
  assert.equal(result.items.length, 6);
  assert.equal(result.items.some((item) => item.text.startsWith('Tests fail')), false);
  assert.equal(result.items.at(-1).text.startsWith('Review and commit the work'), true);
});

test('missing review folders produce the commit hand-back item without crashing', async (t) => {
  const { runDir, ctx } = await fixture(t, { includeReviews: false });
  const result = await run(ctx);
  assert.equal(result.count, 1);
  assert.equal(result.items[0].n, 1);
  assert.equal(result.items[0].kind, 'human');
  assert.match(await fs.readFile(path.join(runDir, 'handback.md'), 'utf8'), /1\. \[human\] Review and commit/);
});
