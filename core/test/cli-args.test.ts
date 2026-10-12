import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
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

test('troop sessions prints no column the query never fills', () => {
  const iso = isolation();
  try {
    const db = new DatabaseSync(join(iso.home, 'troop.db'));
    try {
      db.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
      const at = new Date().toISOString();
      db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p', iso.home, 'proj', at, at);
      db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('codex', '{}', 1, 'local-cli');
      db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('s1234567890', 'p', 'codex', 'pty', 'idle', at, at);
    } finally { db.close(); }
    const r = spawnSync(process.execPath, [cli, 'sessions'], { cwd: root, env: iso.env, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.stdout.split('\n')[0].trim().split(/\s+/), ['id', 'engine', 'host', 'state', 'project', 'state_at']);
  } finally { rmSync(iso.home, { recursive: true, force: true }); }
});

test('a session prefix matches literally: % and _ are not wildcards', () => {
  const iso = isolation();
  try {
    const db = new DatabaseSync(join(iso.home, 'troop.db'));
    try {
      db.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
      const at = new Date().toISOString();
      db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p', iso.home, 'proj', at, at);
      db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('codex', '{}', 1, 'local-cli');
      db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('abc123', 'p', 'codex', 'pty', 'idle', at, at);
    } finally { db.close(); }
    for (const prefix of ['%', 'a_c']) {
      const r = spawnSync(process.execPath, [cli, 'focus', prefix], { cwd: root, env: iso.env, encoding: 'utf8', windowsHide: true });
      assert.equal(r.status, 1, `${prefix}: ${r.stderr}`);
      assert.match(r.stderr, /no session matches/);
    }
  } finally { rmSync(iso.home, { recursive: true, force: true }); }
});
