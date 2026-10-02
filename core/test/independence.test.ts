import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

function alive(pid: number) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('M1-03 a live session survives a core kill and restart is rediscovered by pid within 10 s', { skip: 'superseded by UI-06: terminals are owned by the core and end with it' }, async () => {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{
    id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks',
    roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
    version_cmd: [process.execPath, '--version']
  }]));
  const sleeper = join(isolated.home, 'long-turn.js');
  writeFileSync(sleeper, 'setTimeout(() => {}, 60000);');
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  let core = await startCore({ ...isolated, env });
  let pid = 0;
  try {
    const project = join(isolated.home, 'indep-project');
    mkdirSync(project, { recursive: true });
    const pipe = await client(isolated.prefix);
    const opened = await pipe.request('project.open', { path: project });
    const launched = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: 'fake', prompt: sleeper });
    const sid = launched.result.session_id;
    pipe.close();
    const db = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
    await until(() => db.prepare('SELECT pid FROM session WHERE id = ?').get(sid).pid !== null, 4000);
    pid = db.prepare('SELECT pid FROM session WHERE id = ?').get(sid).pid;
    // kill the core hard; the session must keep running
    core.kill('SIGKILL');
    await new Promise((r) => core.once('exit', r));
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(alive(pid), 'engine process died with the core');
    // restart: session is rediscovered (still not exited, same pid) within 10 s
    core = await startCore({ ...isolated, env });
    await new Promise((r) => setTimeout(r, 6000)); // longer than one 5 s pid sweep
    const row = db.prepare('SELECT state, pid FROM session WHERE id = ?').get(sid);
    assert.notEqual(row.state, 'exited');
    assert.equal(row.pid, pid);
    // and a vanished pid is noticed by the sweep within 10 s of restart
    process.kill(pid, 'SIGKILL');
    await until(() => db.prepare('SELECT state FROM session WHERE id = ?').get(sid).state === 'exited', 7000);
    db.close();
  } finally {
    if (pid && alive(pid)) try { process.kill(pid, 'SIGKILL'); } catch {}
    await teardownCore(core, isolated);
  }
});
