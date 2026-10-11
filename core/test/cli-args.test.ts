import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { projectId, resolveProjectPath } from '../src/project.ts';
import { harness, root } from './helpers.ts';

const cli = join(root, 'core', 'cli.ts');

test('troop open . registers the folder the CLI runs in, not the core cwd', async () => {
  const h = await harness();
  try {
    const project = join(h.home, 'rel-open');
    mkdirSync(project);
    const r = spawnSync(process.execPath, [cli, 'open', '.', '--json'], { cwd: project, env: h.env, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).project_id, projectId(resolveProjectPath(project)));
  } finally { await h.teardown(); }
});
