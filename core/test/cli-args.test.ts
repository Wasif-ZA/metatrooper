import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { projectId, resolveProjectPath } from '../src/project.ts';
import { harness, isolation, root } from './helpers.ts';

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

test('troop owners with the core offline says so instead of printing (none)', async () => {
  const iso = isolation();
  try {
    const r = spawnSync(process.execPath, [cli, 'owners'], { cwd: root, env: iso.env, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 3, r.stdout);
    assert.doesNotMatch(r.stdout, /\(none\)/);
  } finally { rmSync(iso.home, { recursive: true, force: true }); }
});

test('offline, launch --worktree and owners queue nothing that has a side effect or needs a reply', async () => {
  const iso = isolation();
  try {
    for (const args of [['launch', 'claude', '--worktree', 'b'], ['owners']]) {
      const r = spawnSync(process.execPath, [cli, ...args], { cwd: root, env: iso.env, encoding: 'utf8', windowsHide: true });
      assert.equal(r.status, 3, r.stderr);
    }
    const db = new DatabaseSync(join(iso.home, 'troop.db'), { readOnly: true });
    try {
      const methods = (db.prepare('SELECT method FROM command').all() as Array<{ method: string }>).map((x) => x.method);
      assert.deepEqual(methods.filter((m) => m !== 'project.open'), []);
    } finally { db.close(); }
  } finally { rmSync(iso.home, { recursive: true, force: true }); }
});
