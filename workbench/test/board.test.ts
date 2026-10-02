import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, sleep, startCore, teardownCore, until, uiHello } from '../../core/test/helpers.ts';

const workbench = resolve(import.meta.dirname, '..');
const plugin = resolve(workbench, '..', 'plugins', 'agent-reach');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const runnable = process.env.METATROOPER_BROWSER_E2E === '1' && process.env.METATROOPER_NETWORK_E2E === '1' && existsSync(electron) && process.platform === 'win32';

test('M2-02 the inspiration board returns at least 8 references with captures for the fixture brief', { skip: !runnable && 'set METATROOPER_BROWSER_E2E=1 and METATROOPER_NETWORK_E2E=1 on Windows (real Exa and GitHub search)', timeout: 300_000 }, async () => {
  await buildGenerated();
  const base = isolation();
  const iso = { ...base, env: { ...base.env, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME } };
  const core = await startCore(iso);
  let wb: ChildProcess | null = null;
  try {
    wb = spawn(electron, [workbench], { env: iso.env, stdio: ['ignore', 'ignore', openSync(join(iso.home, 'workbench.err'), 'w')] });
    const pipe = await client(iso.prefix);
    await uiHello(pipe, iso.home);
    const preview = await pipe.request('plugin.preview', { source: plugin });
    assert.equal(preview.result?.valid, true, JSON.stringify(preview));
    const installed = await pipe.request('plugin.install', { source: plugin, approved_permissions: ['network', 'run:write'], manifest_hash: preview.result.manifest_hash });
    assert.equal(installed.result?.plugin_id, 'agent-reach', JSON.stringify(installed));
    const project = join(iso.home, 'project');
    mkdirSync(project);
    const projectId = (await pipe.request('project.open', { path: project })).result.project_id as string;
    await sleep(3000);
    const started = await pipe.request('run.start', { pipeline_id: 'inspiration-board', project_id: projectId, inputs: { brief: 'a calm landing page for a local bakery with online ordering' } }, { timeout: 5000 });
    assert.ok(started.result?.run_id, JSON.stringify(started));
    pipe.close();

    const db = new DatabaseSync(join(iso.home, 'troop.db'), { readOnly: true });
    try {
      const status = await until(() => {
        const r = db.prepare('SELECT status FROM run WHERE id = ?').get(started.result.run_id) as { status: string };
        return ['done', 'failed', 'cancelled'].includes(r.status) ? r.status : null;
      }, 240_000);
      const runDir = (db.prepare('SELECT run_dir FROM run WHERE id = ?').get(started.result.run_id) as { run_dir: string }).run_dir;
      const log = existsSync(join(runDir, 'log.jsonl')) ? readFileSync(join(runDir, 'log.jsonl'), 'utf8').slice(-2000) : 'no log';
      assert.equal(status, 'done', log);
      const items = db.prepare('SELECT source_url, capture_path FROM board_item WHERE run_id = ?').all(started.result.run_id) as Array<{ source_url: string; capture_path: string | null }>;
      const captured = items.filter((i) => i.capture_path && existsSync(i.capture_path) && statSync(i.capture_path).size > 1000);
      assert.ok(items.length >= 8, `${items.length} references`);
      assert.ok(captured.length >= 8, `${captured.length} of ${items.length} captured`);
    } finally { db.close(); }
  } finally {
    if (wb?.pid) try { spawnSync('taskkill', ['/T', '/F', '/PID', String(wb.pid)]); } catch {}
    await sleep(300);
    await teardownCore(core, iso);
  }
});
