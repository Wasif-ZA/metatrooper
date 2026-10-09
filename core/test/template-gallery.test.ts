import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGenerated, root } from './helpers.ts';
import { revisionHarness } from './ui-revision-helpers.ts';

before(buildGenerated);

test('M3-04 template.list lists all 17 templates, each ready only when every required plugin is installed and enabled', async () => {
  const h = await revisionHarness();
  try {
    const files = readdirSync(join(root, 'pipelines/templates')).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 17);
    const list = async () => (await h.pipe.request('template.list', {})).result.templates as Array<{ id: string; requires: string[]; missing: string[]; ready: boolean; preview: boolean }>;
    const plugins = new Set((h.db.prepare('SELECT id FROM plugin WHERE enabled = 1').all() as Array<{ id: string }>).map((r) => r.id));
    const first = (await list()).filter((t) => !t.preview);
    assert.deepEqual(first.map((t) => t.id).sort(), files.map((f) => JSON.parse(readFileSync(join(root, 'pipelines/templates', f), 'utf8')).id).sort());
    for (const t of first) {
      assert.deepEqual(t.missing, t.requires.filter((r) => !plugins.has(r)), t.id);
      assert.equal(t.ready, t.missing.length === 0, t.id);
    }
    assert.ok(first.some((t) => t.ready) && first.some((t) => !t.ready));
    const victim = first.find((t) => t.ready && t.requires.length)!;
    h.db.prepare('UPDATE plugin SET enabled = 0 WHERE id = ?').run(victim.requires[0]);
    const after = (await list()).find((t) => t.id === victim.id)!;
    assert.deepEqual([after.ready, after.missing], [false, [victim.requires[0]]]);
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM pipeline WHERE id IN (" + files.map(() => '?').join(',') + ')').get(...first.map((t) => t.id)) as any).n, 0);
  } finally { await h.close(); }
});
