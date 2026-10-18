import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { client, root, runNode, startCore, teardownCore, uiHello, until } from '../../core/test/helpers.ts';
import { alive, demoEnv, demoProblem, removeWhenGone, stopPid } from '../src/demo.ts';
import { spawn } from 'node:child_process';

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

test('M6-16b the demo guard refuses the real data folder or pipe prefix, and a demo gets a fresh temp home and metatrooper-demo-<pid>', () => {
  // protects=the --demo env guard as a pure function fails_when=a demo could open ~/.metatrooper or the metatrooper pipes no_claim=the Electron start itself (the opt-in E2E)
  const real = join(homedir(), '.metatrooper');
  assert.equal(demoProblem(real, 'metatrooper-demo-1'), 'demo would use the real data folder');
  assert.equal(demoProblem(real.toUpperCase(), 'metatrooper-demo-1'), 'demo would use the real data folder');
  assert.equal(demoProblem(join(tmpdir(), 'x'), 'metatrooper'), 'demo would use the real data folder');
  assert.equal(demoProblem(join(tmpdir(), 'x'), 'metatrooper-demo-1'), null);
  assert.deepEqual(demoEnv(42, 'T:'), { METATROOPER_HOME: join('T:', 'metatrooper-demo-42'), METATROOPER_PIPE_PREFIX: 'metatrooper-demo-42', METATROOPER_DEMO: '1' });
  assert.equal(demoProblem(join(real, 'metatrooper-demo-1'), 'metatrooper-demo-1'), 'demo would use the real data folder');
  assert.equal(demoProblem(join(real.toUpperCase(), 'a', 'b'), 'metatrooper-demo-1'), 'demo would use the real data folder');
  assert.equal(demoProblem(`${real}-other`, 'metatrooper-demo-1'), null);
});

test('M6-16b the demo guard follows a junction into the real data folder', (t) => {
  // protects=canonical comparison fails_when=a demo home reached through a link inside ~/.metatrooper is taken as isolated no_claim=symlinks on other hosts
  const dir = mkdtempSync(join(tmpdir(), 'metatrooper-junction-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const fakeReal = join(dir, 'real');
  mkdirSync(fakeReal);
  symlinkSync(fakeReal, join(dir, 'link'), 'junction');
  assert.equal(demoProblem(join(dir, 'link', 'demo-1'), 'metatrooper-demo-1', fakeReal), 'demo would use the real data folder');
  assert.equal(demoProblem(join(dir, 'link'), 'metatrooper-demo-1', fakeReal), 'demo would use the real data folder');
  assert.equal(demoProblem(join(dir, 'elsewhere'), 'metatrooper-demo-1', fakeReal), null);
});

test('M6-16b a --demo start whose generated home lands inside the real data folder exits 2 and creates nothing', async (t) => {
  // protects=the exit-2 branch of the import-time guard fails_when=the guard is skipped and the demo home is made inside ~/.metatrooper no_claim=the Electron start itself
  const fake = mkdtempSync(join(tmpdir(), 'metatrooper-fakeuser-'));
  t.after(() => rmSync(fake, { recursive: true, force: true }));
  const real = join(fake, '.metatrooper');
  mkdirSync(real);
  const r = await runNode(['--input-type=module', '-e', "await import('./workbench/src/demo.ts'); console.log('started')", '--', '--demo'],
    { ...process.env, USERPROFILE: fake, HOME: fake, TEMP: real, TMP: real, TMPDIR: real }) as { code: number; stdout: string; stderr: string };
  assert.equal(r.code, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /demo would use the real data folder/);
  assert.doesNotMatch(r.stdout, /started/);
  assert.deepEqual(readdirSync(real), []);
});

test('M6-16b stopping the demo core kills its process tree when it does not exit in time', { timeout: 30_000 }, async (t) => {
  // protects=demo quit confirms its own core stopped fails_when=a core that ignores the stop, or a process it started, outlives the quit no_claim=the Electron will-quit wiring (the opt-in E2E)
  const script = "process.on('SIGTERM',()=>{});const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{},1e3)'],{stdio:'ignore',detached:true});console.log(c.pid);setInterval(()=>{},1e3)";
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const grandchild = Number(await new Promise<string>((r) => child.stdout.once('data', (d) => r(String(d)))));
  t.after(() => { for (const p of [child.pid!, grandchild]) try { process.kill(p); } catch {} });
  assert.ok(alive(child.pid!) && alive(grandchild));
  assert.equal(await stopPid(child.pid!, 300), true);
  assert.equal(alive(child.pid!), false);
  await until(() => !alive(grandchild), 5000);
});

test('M6-16b the demo home is removed only after every named process has exited', { timeout: 30_000 }, async (t) => {
  // protects=deletion waits for the demo core as well as the window fails_when=the home is deleted while the core still runs no_claim=Chromium's own file locks
  const dir = mkdtempSync(join(tmpdir(), 'metatrooper-demo-rm-'));
  writeFileSync(join(dir, 'troop.db'), 'x');
  const core = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e3)'], { stdio: 'ignore', windowsHide: true });
  t.after(() => { try { process.kill(core.pid!); } catch {} rmSync(dir, { recursive: true, force: true }); });
  removeWhenGone(dir, [core.pid!]);
  await new Promise((r) => setTimeout(r, 1000));
  assert.ok(existsSync(dir), 'the home stays while the core runs');
  core.kill();
  await until(() => !existsSync(dir), 10_000);
});

test('M6-16b isolation: a --demo start overrides an inherited home and prefix, seeds only its own folder, and a --demo core with live fixture sessions leaves the sentinel troop.db byte for byte', { timeout: 120_000 }, async () => {
  // protects=isolation of the demo from the real data folder (Change 1, 2) and the live approval lifecycle (D45) fails_when=the inherited METATROOPER_HOME or prefix is reused, the sentinel troop.db changes, its marker reaches the demo, or the seeded sessions, dev server or approval do not come up for real no_claim=the window, its title or UI Automation (the opt-in E2E)
  const marker = `sentinel-${randomUUID()}`;
  const sentinel = mkdtempSync(join(tmpdir(), 'metatrooper-sentinel-'));
  const sdb = new DatabaseSync(join(sentinel, 'troop.db'));
  sdb.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
  sdb.exec("PRAGMA foreign_keys = OFF");
  const now = new Date().toISOString();
  sdb.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
  sdb.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, hidden, started_at, title) VALUES ('s1', 'p1', 'claude', 'pty', 'idle', ?, 0, ?, ?)").run(now, now, marker);
  sdb.close();
  const before = sha(join(sentinel, 'troop.db'));

  // the real import side effect of workbench/src/demo.ts, with --demo on the command line
  const probe = await runNode(['--input-type=module', '-e', "await import('./workbench/src/demo.ts'); console.log(JSON.stringify({ home: process.env.METATROOPER_HOME, prefix: process.env.METATROOPER_PIPE_PREFIX, demo: process.env.METATROOPER_DEMO }))", '--', '--demo'],
    { ...process.env, METATROOPER_HOME: sentinel, METATROOPER_PIPE_PREFIX: 'metatrooper' }) as { code: number; stdout: string; stderr: string };
  assert.equal(probe.code, 0, probe.stderr);
  const got = JSON.parse(probe.stdout);
  assert.match(got.prefix, /^metatrooper-demo-\d+$/);
  assert.equal(got.home, join(tmpdir(), got.prefix));
  assert.equal(got.demo, '1');
  assert.ok(existsSync(got.home));

  const seed = await import('../../tests/demo/seed.mjs');
  // an inherited override pointing at a real registry must not reach the demo
  const inherited = join(sentinel, 'engines.json');
  writeFileSync(inherited, JSON.stringify([{ id: marker, command: 'node', args: [] }]));
  const savedEngines = process.env.METATROOPER_ENGINES;
  process.env.METATROOPER_ENGINES = inherited;
  let seeded;
  try { seeded = seed.seedDemo(got.home); } finally { if (savedEngines === undefined) delete process.env.METATROOPER_ENGINES; else process.env.METATROOPER_ENGINES = savedEngines; }
  const { project, engines } = seeded;
  const registry = JSON.parse(readFileSync(engines, 'utf8')).map((e: { id: string }) => e.id);
  assert.ok(registry.includes('demo-fixture') && registry.includes('claude'), `engines.json keeps the shipped engines: ${registry}`);
  assert.ok(!registry.includes(marker), 'the inherited METATROOPER_ENGINES registry is never read');
  const iso: any = { home: got.home, prefix: got.prefix, started: Date.now(), args: ['--demo'], env: { ...process.env, METATROOPER_HOME: got.home, METATROOPER_PIPE_PREFIX: got.prefix, METATROOPER_DEMO: '1', METATROOPER_ENGINES: engines } };
  const core = await startCore(iso);
  const pipe = await client(got.prefix);
  const ui = await client(got.prefix);
  try {
    await uiHello(ui, got.home);
    const request = async (method: string, params: object) => {
      const r: any = await pipe.request(method, params, { timeout: 15_000 });
      if (r.error) throw new Error(`${method}: ${r.error.message}`);
      return r.result;
    };
    const { sessions } = await seed.launchDemo(request, project);
    const db = new DatabaseSync(join(got.home, 'troop.db'), { readOnly: true });
    try {
      const rows = () => db.prepare("SELECT id, engine_id, pid FROM session WHERE ended_at IS NULL").all() as Array<{ id: string; engine_id: string; pid: number | null }>;
      await until(() => rows().length === 2 && rows().every((r) => r.pid), 20_000);
      assert.deepEqual(rows().map((r) => r.engine_id), ['demo-fixture', 'demo-fixture']);
      const ready = () => db.prepare("SELECT status FROM session_dev_server WHERE session_id = ? AND status = 'ready'").get(sessions.preview);
      await until(ready, 30_000);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM session_dev_server WHERE session_id = ?').get(sessions.asker)!.n, 0);
      // each role names its terminal, which is the tile name an agent finds it by
      await until(async () => {
        const titles: any = (await ui.request('session.live-text', {})).result ?? {};
        return titles[sessions.preview]?.title === 'preview' && titles[sessions.asker]?.title === 'asker';
      }, 10_000);

      const check = { session_id: sessions.asker, surface: 'browser', target: 'https://shop.example.invalid/', action: 'click', args: {}, control: { name: 'Send', role: 'button', automation_id: '' } };
      const decided = pipe.request('approval.check', check, { timeout: 130_000 }) as Promise<any>;
      const row = await until(() => db.prepare("SELECT id, status, summary FROM approval WHERE session_id = ? AND status = 'waiting'").get(sessions.asker) as any, 10_000);
      assert.equal(row.summary, 'click Send in shop.example.invalid');
      assert.equal((await ui.request('approval.resolve', { approval_id: row.id, decision: 'approve' })).result?.status, 'approved');
      assert.equal((await decided).result.decision, 'approved');
      assert.equal((db.prepare('SELECT status FROM approval WHERE id = ?').get(row.id) as any).status, 'approved');

      const text = JSON.stringify(db.prepare('SELECT * FROM session').all()) + readFileSync(engines, 'utf8');
      assert.ok(!text.includes(marker), 'the sentinel marker never reaches the demo');
    } finally {
      db.close();
    }
  } finally {
    pipe.close(); ui.close();
    await teardownCore(core, iso);
    assert.equal(sha(join(sentinel, 'troop.db')), before, 'the sentinel troop.db is unchanged');
    rmSync(sentinel, { recursive: true, force: true });
  }
});
