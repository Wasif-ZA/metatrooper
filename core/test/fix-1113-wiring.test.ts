import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { client, isolation, startCore, teardownCore, uiHello } from './helpers.ts';

async function core(args: string[] = []) {
  const iso = isolation();
  const project = join(iso.home, 'project');
  mkdirSync(project);
  const idle = join(iso.home, 'idle.cjs');
  writeFileSync(idle, 'setInterval(()=>{},1000);');
  const fake = (id: string) => ({ id, command: process.execPath, args: [idle], prompt_arg: 'positional', state_source: 'process', roles: [], cost_rank: 9, version_cmd: [process.execPath, '--version'], approval_profiles: { edits: [] } });
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([fake('claude'), fake('demo-fixture')]));
  const env = { ...iso.env, METATROOPER_ENGINES: registry };
  const child = await startCore({ ...iso, env, args });
  const pipe = await client(iso.prefix); await uiHello(pipe, iso.home);
  const projectId = (await pipe.request('project.open', { path: project })).result.project_id;
  return { iso, pipe, project, projectId, async close() { pipe.close(); await teardownCore(child, iso); } };
}

test('fix 1: a --demo core refuses a real engine and still launches demo-fixture', { timeout: 60_000 }, async () => {
  const c = await core(['--demo']);
  try {
    const real = await c.pipe.request('session.launch', { project_id: c.projectId, engine_id: 'claude', prompt: 'x' });
    assert.equal(real.error?.code, -32020, JSON.stringify(real));
    assert.match(real.error.message, /demo runs only demo-fixture/);
    const ok = await c.pipe.request('session.launch', { project_id: c.projectId, engine_id: 'demo-fixture', prompt: 'x' });
    assert.ok(ok.result?.session_id, JSON.stringify(ok));
  } finally { await c.close(); }
});

test('fix 5: launch and shell.open into a deleted project folder say the folder is gone', { timeout: 60_000 }, async () => {
  const c = await core();
  try {
    rmSync(c.project, { recursive: true, force: true });
    const launch = await c.pipe.request('session.launch', { project_id: c.projectId, engine_id: 'claude', prompt: 'x' });
    assert.equal(launch.error?.code, -32002, JSON.stringify(launch));
    assert.match(launch.error.message, /project folder is gone/);
    const shell = await c.pipe.request('shell.open', { project_id: c.projectId, kind: 'powershell' });
    assert.equal(shell.error?.code, -32002, JSON.stringify(shell));
    assert.match(shell.error.message, /project folder is gone/);
  } finally { await c.close(); }
});

test('fix 3: automation.set refuses an approval level the engine has no profile for', { timeout: 60_000 }, async () => {
  const c = await core();
  try {
    const base = { project_id: c.projectId, name: 'n', engine_id: 'claude', prompt: 'p', cron: '0 9 * * *' };
    const bad = await c.pipe.request('automation.set', { ...base, approval: 'contained' });
    assert.equal(bad.error?.code, -32003, JSON.stringify(bad));
    assert.match(bad.error.message, /no approval profile contained/);
    const ok = await c.pipe.request('automation.set', { ...base, approval: 'edits' });
    assert.ok(ok.result?.id, JSON.stringify(ok));
  } finally { await c.close(); }
});

test('fix 18: automation.list carries created_at so Newest can sort', { timeout: 60_000 }, async () => {
  const c = await core();
  try {
    await c.pipe.request('automation.set', { project_id: c.projectId, name: 'n', engine_id: 'claude', prompt: 'p', cron: '0 9 * * *' });
    const list = await c.pipe.request('automation.list', {});
    assert.match(String(list.result.automations[0].created_at), /^\d{4}-\d\d-\d\dT/);
  } finally { await c.close(); }
});

test('fix 26: a read-only settings.json gives a plain message and leaves no temp file', async () => {
  const { mkdtempSync, writeFileSync: write, chmodSync, readdirSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const home = mkdtempSync(join(tmpdir(), 'fix26-'));
  const before = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = home;
  try {
    const { setSetting } = await import('../src/settings.ts');
    write(join(home, 'settings.json'), JSON.stringify({ sessions: { approval: 'ask' } }));
    chmodSync(join(home, 'settings.json'), 0o444);
    assert.throws(() => setSetting('ui', 'toast_ms', 4000), /^Error: settings\.json is read-only or open in another program/);
    assert.deepEqual(readdirSync(home), ['settings.json']);
  } finally {
    process.env.METATROOPER_HOME = before;
    try { chmodSync(join(home, 'settings.json'), 0o666); } catch {}
    rmSync(home, { recursive: true, force: true });
  }
});

test('Tier B a: session.stop ends one agent as cancelled with no failed item, and refuses outside sessions', { timeout: 60_000 }, async () => {
  const c = await core();
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const { until } = await import('./helpers.ts');
    const a = (await c.pipe.request('session.launch', { project_id: c.projectId, engine_id: 'claude', prompt: 'x' })).result.session_id;
    const b = (await c.pipe.request('session.launch', { project_id: c.projectId, engine_id: 'claude', prompt: 'y' })).result.session_id;
    const db = new DatabaseSync(join(c.iso.home, 'troop.db'), { readOnly: true });
    const row = (id: string) => db.prepare('SELECT state, outcome FROM session WHERE id = ?').get(id) as { state: string; outcome: string | null };
    await until(() => row(a).state !== 'starting', 10_000).catch(() => {});
    assert.deepEqual((await c.pipe.request('session.stop', { session_id: a })).result, { stopped: true });
    await until(() => row(a).state === 'exited', 15_000);
    assert.equal(row(a).outcome, 'cancelled');
    assert.notEqual(row(b).state, 'exited', 'the other agent keeps running');
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM needs_you WHERE ref = ? AND kind = 'failed'").get(a) as { n: number }).n, 0);
    assert.deepEqual((await c.pipe.request('session.stop', { session_id: a })).result, { stopped: false });
    db.close();
  } finally { await c.close(); }
});

test('Tier B d: plugin.enable persists, and a disabled plugin is not loaded', { timeout: 60_000 }, async () => {
  const c = await core();
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(join(c.iso.home, 'troop.db'));
    const id = (db.prepare("SELECT id FROM plugin WHERE source = 'builtin' ORDER BY id LIMIT 1").get() as { id: string }).id;
    db.close();
    assert.deepEqual((await c.pipe.request('plugin.enable', { plugin_id: id, on: false })).result, { enabled: false });
    const { loadPlugin } = await import('../src/plugins/store.ts');
    const ro = new DatabaseSync(join(c.iso.home, 'troop.db'), { readOnly: true });
    assert.equal((ro.prepare('SELECT enabled FROM plugin WHERE id = ?').get(id) as { enabled: number }).enabled, 0);
    assert.equal(loadPlugin(ro, id), null);
    ro.close();
    assert.equal((await c.pipe.request('plugin.enable', { plugin_id: 'nope', on: true })).error?.code, -32002);
    assert.equal((await c.pipe.request('plugin.enable', { plugin_id: id, on: 'yes' })).error?.code, -32602);
    assert.deepEqual((await c.pipe.request('plugin.enable', { plugin_id: id, on: true })).result, { enabled: true });
  } finally { await c.close(); }
});
