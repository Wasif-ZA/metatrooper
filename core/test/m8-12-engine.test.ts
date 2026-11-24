import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openCoreDb } from '../src/store/db.ts';
import { isolation, withEnv } from './helpers.ts';
import { installPlugin } from '../src/plugins/store.ts';
import { BLOCK_FILE } from '../src/plugins/blocklist.ts';
import { runEngine } from '../src/plugins/engine-run.ts';
import { getSurface, showSurface } from '../src/surfaces.ts';

const SCRIPT = `
const fs = require('fs');
const path = require('path');
const req = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.writeFileSync(path.join(req.project, 'ran.marker'), 'ran');
console.log(JSON.stringify({ ok: true, outputs: { captions: [{ t: 0, text: 'hello' }] } }));
`;

function harness(t: any, action: Record<string, unknown> = {}) {
  const isolated = isolation();
  const env = { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix };
  const db = withEnv(env, openCoreDb);
  t.after(() => { db.close(); rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const source = join(isolated.home, 'src-captions');
  mkdirSync(join(source, 'bin'), { recursive: true });
  writeFileSync(join(source, 'bin', 'captions.js'), SCRIPT);
  const manifest = {
    schema: 1, id: 'fake-captions', version: '1.0.0', name: 'fake-captions', permissions: ['run:write', 'project:write'], platforms: ['windows', 'linux', 'macos'],
    actions: [{ id: 'transcribe', run: ['bin/captions.js'], binds: { from: '/captions', to: '/captions' }, ...action }],
  };
  writeFileSync(join(source, 'troop-plugin.json'), JSON.stringify(manifest));
  withEnv(env, () => installPlugin(db, { source, approved_permissions: ['run:write', 'project:write'] }));
  const project = join(isolated.home, 'project');
  mkdirSync(project, { recursive: true });
  const at = '2026-11-24T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project', project, 'Synthetic', at, at);
  db.prepare('INSERT OR IGNORE INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('fake', '{}', 1, 'local-cli');
  for (const id of ['session-a', 'session-b']) db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, 'project', 'fake', 'pty', 'idle', at, at);
  const spec = { type: 'page', children: [{ type: 'log', lines: { bind: '/captions' } }] };
  const show = (session_id = 'session-a') => showSurface(db, { session_id, surface: 'screening', zone: 'tab', spec });
  const run = (session_id = 'session-a', surface: string | undefined = 'screening') => withEnv(env, () => runEngine(db, { session_id, engine: 'fake-captions', action: 'transcribe', surface }));
  const dir = () => (db.prepare('SELECT path FROM plugin WHERE id = ?').get('fake-captions') as { path: string }).path;
  return { db, env, spec, show, run, dir, project };
}

test('a fake caption engine fills a bound surface and the surface seq of its parts is unchanged', async (t) => {
  const h = harness(t);
  h.show();
  const before: any = getSurface(h.db, 'screening');
  const res = await h.run();
  assert.equal(res.status, 'ok');
  assert.equal(res.bound, '/captions');
  assert.deepEqual(res.outputs, { captions: [{ t: 0, text: 'hello' }] });
  const after: any = getSurface(h.db, 'screening');
  assert.deepEqual(after.spec, h.spec);
  assert.deepEqual(after.data.captions, [{ t: 0, text: 'hello' }]);
  assert.equal(after.seq, before.seq + 1);
});

test('an external engine action is refused and runs nothing', async (t) => {
  const h = harness(t, { external: true, destination_field: 'channel' });
  h.show();
  await assert.rejects(h.run(), (e: any) => e.code === -32003);
  assert.equal(existsSync(join(h.project, 'ran.marker')), false);
});

test('a blocked, disabled or changed plugin does not run', async (t) => {
  const h = harness(t);
  h.show();
  const backup = join(h.dir(), '..', 'blocked.json.bak');
  copyFileSync(BLOCK_FILE, backup);
  try {
    writeFileSync(BLOCK_FILE, JSON.stringify([{ id: 'fake-captions', reason: 'leaks tokens' }]));
    await assert.rejects(h.run(), (e: any) => e.code === -32003 && /leaks tokens/.test(e.message));
  } finally {
    copyFileSync(backup, BLOCK_FILE);
  }
  assert.equal(existsSync(join(h.project, 'ran.marker')), false);

  writeFileSync(join(h.dir(), 'bin', 'captions.js'), SCRIPT + '\n// tampered\n');
  await assert.rejects(h.run(), (e: any) => e.code === -32003 && /captions\.js/.test(e.message));
  assert.equal(existsSync(join(h.project, 'ran.marker')), false);

  h.db.prepare("UPDATE plugin SET enabled = 0 WHERE id = 'fake-captions'").run();
  await assert.rejects(h.run(), (e: any) => e.code === -32002);
  assert.equal(existsSync(join(h.project, 'ran.marker')), false);
});

test('a surface of another session is not filled', async (t) => {
  const h = harness(t);
  h.show('session-b');
  const before: any = getSurface(h.db, 'screening');
  await assert.rejects(h.run('session-a'), (e: any) => e.code === -32003);
  const after: any = getSurface(h.db, 'screening');
  assert.equal(after.seq, before.seq);
  assert.deepEqual(after.data, before.data);
});

test('a missing engine marks the surface it named', async (t) => {
  const h = harness(t);
  h.show();
  const call = (session_id: string, surface?: string) => withEnv(h.env, () => runEngine(h.db, { session_id, engine: 'not-installed', action: 'captions', surface }));
  const get = (): any => withEnv(h.env, () => getSurface(h.db, 'screening'));
  const before: any = get();
  await assert.rejects(call('session-a'), (e: any) => e.code === -32002);
  assert.deepEqual(get().data.missing_engine, undefined);
  await assert.rejects(call('session-b', 'screening'), (e: any) => e.code === -32002);
  assert.deepEqual(get().data.missing_engine, undefined);
  assert.equal(get().seq, before.seq);
  await assert.rejects(call('session-a', 'screening'), (e: any) => e.code === -32002);
  const after = get();
  assert.deepEqual(after.data.missing_engine, { engine: 'not-installed', action: 'captions' });
  assert.ok(after.seq > before.seq);
});

test('a successful run clears an install card left by an earlier call', async (t) => {
  const h = harness(t);
  const saved = Object.fromEntries(Object.keys(h.env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, h.env); // the clear runs after an await, outside withEnv
  t.after(() => { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } });
  h.show();
  const get = (): any => withEnv(h.env, () => getSurface(h.db, 'screening'));
  await assert.rejects(withEnv(h.env, () => runEngine(h.db, { session_id: 'session-a', engine: 'not-installed', action: 'captions', surface: 'screening' })), (e: any) => e.code === -32002);
  assert.deepEqual(get().data.missing_engine, { engine: 'not-installed', action: 'captions' });
  assert.equal((await h.run()).status, 'ok');
  assert.equal(get().data.missing_engine, null);
});
