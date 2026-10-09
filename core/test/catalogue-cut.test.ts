import test from 'node:test';
import assert from 'node:assert/strict';
import { client, harness } from './helpers.ts';
import { revisionHarness } from './ui-revision-helpers.ts';

test('M5-18a fresh core seeds only the four built-in pipelines', async () => {
  const h = await revisionHarness();
  try {
    const ids = (h.db.prepare('SELECT id FROM pipeline WHERE source = ?').all('builtin') as Array<{ id: string }>).map((pipeline) => pipeline.id).sort();
    assert.deepEqual(ids, [
      'e2e-browser-qa',
      'spec-build-review-handback',
      'spec-to-pr',
      'two-engine-review',
    ]);
  } finally { await h.close(); }
});

test('M5-18b template.list labels the ten preview templates and excludes unshipped templates', async () => {
  const h = await harness();
  const connection = await client(h.prefix);
  try {
    const response = await connection.request('template.list', {});
    const templates = response.result.templates as Array<{ id: string; preview: boolean }>;
    const previewIds = [
      'footage-to-edit',
      'website-build',
      'design-variants',
      'docs-and-release-notes',
      'security-review-and-upgrade',
      'clips-to-scheduled-posts',
      'seo-audit-fix',
      'deep-research-cited',
      'data-to-dashboard',
      'form-fill-batch',
    ];
    const byId = new Map(templates.map((template) => [template.id, template]));
    for (const id of previewIds) {
      assert.equal(byId.get(id)?.preview, true, `${id} should be listed as a preview template`);
    }
    for (const id of ['prospect-list-to-drafts', 'inbox-triage-drafts', 'study-notes-to-pdf']) {
      assert.equal(byId.has(id), false, `${id} should not be listed`);
    }
  } finally { connection.close(); await h.teardown(); }
});
