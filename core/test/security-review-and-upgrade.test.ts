import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { client, isolation, root, startCore, teardownCore, uiHello, until } from './helpers.ts';

const fake = (d: object) => `FAKE ${JSON.stringify(d)}\n`;
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' });

test('M2-01 security-review-and-upgrade runs on a fixture, stops at approve-upgrade before external work, and completes after approval', async () => {
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, args: [join(root, 'core/test/fake-engine.js')], prompt_arg: 'positional', state_source: 'hooks', roles: ['plan', 'worker', 'review', 'verify', 'visual-check', 'research'], cost_rank: 1, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'] }]));
  const bin = join(iso.home, 'bin'); mkdirSync(bin);
  const project = join(iso.home, 'project'); cpSync(join(root, 'tests/fixtures/docs-and-release-notes-project'), project, { recursive: true });
  git(project, 'init', '-q', '-b', 'main'); git(project, 'config', 'user.email', 'fixture@example.com'); git(project, 'config', 'user.name', 'fixture'); git(project, 'add', '-A'); git(project, 'commit', '-qm', 'fixture');
  const origin = join(iso.home, 'origin.git'); execFileSync('git', ['init', '-q', '--bare', origin]); git(project, 'remote', 'add', 'origin', origin); git(project, 'push', '-q', 'origin', 'main');
  const fakeNpm = join(bin, process.platform === 'win32' ? 'npm.cmd' : 'npm');
  writeFileSync(fakeNpm, process.platform === 'win32' ? '@echo off\r\necho {}\r\n' : '#!/bin/sh\necho {}\n');
  if (process.platform !== 'win32') execFileSync('chmod', ['+x', fakeNpm]);
  const core = await startCore({ ...iso, env: { ...iso.env, METATROOPER_ENGINES: registry, PATH: `${bin}${delimiter}${process.env.PATH}` } });
  const db = new DatabaseSync(join(iso.home, 'troop.db')); db.exec('PRAGMA busy_timeout = 5000');
  try {
    const def = JSON.parse(readFileSync(join(root, 'pipelines/preview/security-review-and-upgrade.json'), 'utf8'));
    for (const step of def.steps) if (step.kind === 'agent') { step.engine = 'fake'; step.prompt = fake(step.id === 'plan' ? { outputs: { package: 'sample', high_reachable: false } } : { outputs: { summary: 'fixture notes' } }) + step.prompt; }
    mkdirSync(join(project, '.troop/pipelines'), { recursive: true }); writeFileSync(join(project, '.troop/pipelines/security-review-and-upgrade.json'), JSON.stringify(def));
    const pipe = await client(iso.prefix);
    try {
      await uiHello(pipe, iso.home);
      const projectId = (await pipe.request('project.open', { path: project })).result.project_id;
      const started = await pipe.request('run.start', { pipeline_id: 'security-review-and-upgrade', project_id: projectId }, { timeout: 5000 });
      const runId = started.result.run_id as string;
      const gate = await until(() => {
        const status = db.prepare('SELECT status FROM run WHERE id = ?').get(runId)?.status;
        if (status === 'failed' || status === 'done') throw new Error(`run ${status} before approve-upgrade`);
        return db.prepare("SELECT id, guards_step, action_hash FROM gate WHERE run_id = ? AND step_id = 'approve-upgrade' AND status = 'waiting'").get(runId) as { id: string; guards_step: string | null; action_hash: string | null } | undefined;
      }, 60_000);
      assert.equal(gate.guards_step, null);
      for (const id of ['inventory', 'notes', 'plan', 'bump', 'check', 'fix', 'licences']) {
        const row = db.prepare('SELECT status FROM run_step WHERE run_id = ? AND step_id = ?').get(runId, id) as { status: string } | undefined;
        assert.equal(row?.status, 'done', `${id} did not finish before gate`);
      }
      assert.equal((db.prepare('SELECT paused_why FROM run WHERE id = ?').get(runId) as { paused_why: string }).paused_why, 'gate');
      assert.deepEqual((await pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash }, { timeout: 5000 })).result, {});
      const status = await until(() => {
        const row = db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as { status: string };
        return ['done', 'failed'].includes(row.status) ? row.status : null;
      }, 60_000);
      assert.equal(status, 'done');
    } finally { pipe.close(); }
  } finally { db.close(); await teardownCore(core, iso); }
});
