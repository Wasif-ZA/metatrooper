import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, sleep, startCore, teardownCore, uiHello, until } from '../../core/test/helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';
import { Helper } from '../../core/src/desktop/driver.ts';

// Opt-in: drives a real --demo workbench with the real UI Automation helper, so it needs the desktop to itself.
// Run with METATROOPER_DESKTOP_E2E=1 on Windows: cd workbench && node --test test/m6-16-self-test.e2e.test.ts
const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', 'electron.exe');
const runnable = process.env.METATROOPER_DESKTOP_E2E === '1' && process.platform === 'win32' && existsSync(electron);

const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const lines = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

function sentinelHome(marker: string): string {
  const home = mkdtempSync(join(tmpdir(), 'metatrooper-sentinel-'));
  const db = new DatabaseSync(join(home, 'troop.db'));
  db.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
  db.exec('PRAGMA foreign_keys = OFF');
  const now = new Date().toISOString();
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, hidden, started_at, title) VALUES ('s1', 'p1', 'claude', 'pty', 'idle', ?, 0, ?, ?)").run(now, now, marker);
  db.close();
  return home;
}

test('M6-16a-f a scripted agent drives a --demo workbench through metatrooper-desktop beside a running workbench, and the demo leaves nothing behind', { skip: !runnable && 'needs METATROOPER_DESKTOP_E2E=1, Windows and the Electron binary', timeout: 600_000 }, async () => {
  // protects=agents testing MetaTrooper through the desktop tools, scoped to a harmless demo copy (M6-16a-f) fails_when=the agent misses a tile, the chip or the card, the approval is not approved for real, the demo sees or changes real data, a grant reaches a workbench it should not, the demo home survives quit, or the other workbench stalls no_claim=a real engine driving it (Change 6, by hand) or screenshot content (five-shot, /agy-visual)
  await buildGenerated();
  const marker = `sentinel-${randomUUID()}`;
  const sentinel = sentinelHome(marker);
  const before = sha(join(sentinel, 'troop.db'));
  const scratch = mkdtempSync(join(tmpdir(), 'metatrooper-m6-16-'));
  const agentLog = join(scratch, 'agent.jsonl');
  const helper = new Helper();

  // another workbench of this install with its own core: stands in for the real one, which this test never touches
  const other = isolation();
  const otherCore = await startCore(other);
  const otherWb = spawn(electron, [workbench], { env: other.env, stdio: 'ignore' });
  const beats: number[] = [];
  const beat = setInterval(() => {
    try {
      const d = new DatabaseSync(join(other.home, 'troop.db'), { readOnly: true });
      try { beats.push(Date.parse((d.prepare("SELECT value FROM meta WHERE key = 'core_heartbeat'").get() as any).value)); } finally { d.close(); }
    } catch {}
  }, 1000);

  const demo: ChildProcess = spawn(electron, [workbench, '--demo'], {
    env: { ...process.env, METATROOPER_HOME: sentinel, METATROOPER_PIPE_PREFIX: `troop-test-${randomUUID().replaceAll('-', '')}`, DEMO_AGENT_LOG: agentLog },
    stdio: 'ignore',
  });
  const prefix = `metatrooper-demo-${demo.pid}`;
  const home = join(tmpdir(), prefix);
  const iso: any = { home, prefix, started: Date.now() };
  let ui: any, pipe: any;
  try {
    assert.match(prefix, /^metatrooper-demo-\d+$/);
    await until(async () => { const c = await client(prefix); c.close(); return existsSync(join(home, 'ui.key')); }, 60_000);
    pipe = await client(prefix);
    ui = await client(prefix);
    await uiHello(ui, home);
    const db = new DatabaseSync(join(home, 'troop.db'), { readOnly: true });
    try {
      const live = () => db.prepare("SELECT id, title, pid FROM session WHERE ended_at IS NULL AND engine_id = 'demo-fixture'").all() as any[];
      await until(() => live().length === 2 && live().every((s) => s.pid), 60_000);
      const project = (db.prepare('SELECT id FROM project').get() as any).id;
      const sessions = (await pipe.request('session.list', { project_id: project }, { timeout: 10_000 })).result.sessions.map((s: any) => s.id);
      assert.equal(sessions.length, 2);
      // only the preview role serves a page, so its session is the one that gets a ready dev server row
      const preview = (await until(() => db.prepare("SELECT session_id FROM session_dev_server WHERE status = 'ready'").get() as any, 60_000)).session_id;
      const asker = sessions.find((id: string) => id !== preview);

      // the demo window and the other workbench's window, as the helper sees them
      const windows = async () => (await helper.request<{ windows: any[] }>('list')).windows;
      const demoWin = await until(async () => (await windows()).find((w) => w.pid === demo.pid && w.title === 'MetaTrooper (demo)'), 60_000);
      const otherWin = await until(async () => (await windows()).find((w) => w.pid === otherWb.pid && w.title), 60_000);

      // M6-16c on the other (non-demo) core: neither workbench window is listed or grantable
      const oui = await client(other.prefix);
      try {
        await uiHello(oui, other.home);
        await until(async () => !(await oui.request('grant.candidates', {}, { timeout: 15_000 })).error, 30_000);
        const listed = (await oui.request('grant.candidates', {}, { timeout: 15_000 })).result.windows.map((w: any) => w.hwnd);
        assert.ok(!listed.includes(demoWin.hwnd) && !listed.includes(otherWin.hwnd), 'the non-demo core lists no workbench window');
        const odb = new DatabaseSync(join(other.home, 'troop.db'));
        const now = new Date().toISOString();
        odb.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF');
        odb.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
        odb.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, hidden, started_at) VALUES ('s1', 'p1', 'claude', 'pty', 'idle', ?, 0, ?)").run(now, now);
        odb.close();
        for (const w of [demoWin, otherWin]) assert.equal((await oui.request('grant.window', { session_id: 's1', hwnd: w.hwnd, pid: w.pid, process_start: w.process_start }, { timeout: 15_000 })).error?.code, -32003);
      } finally { oui.close(); }

      // the user's part: a live approval waits on asker (D45), driver starts, and the demo window is given to it
      const check = { session_id: asker, surface: 'browser', target: 'https://shop.example.invalid/', action: 'click', args: {}, control: { name: 'Send', role: 'button', automation_id: '' } };
      const decided = pipe.request('approval.check', check, { timeout: 200_000 }) as Promise<any>;
      const driver = (await pipe.request('session.launch', { project_id: project, engine_id: 'demo-fixture', prompt: 'driver' }, { timeout: 15_000 })).result.session_id;
      await until(() => (db.prepare('SELECT pid FROM session WHERE id = ?').get(driver) as any)?.pid, 20_000);
      await until(async () => !(await ui.request('grant.candidates', {}, { timeout: 15_000 })).error, 30_000);
      const candidates = (await ui.request('grant.candidates', {}, { timeout: 15_000 })).result.windows;
      assert.ok(candidates.some((w: any) => w.hwnd === demoWin.hwnd), 'the demo core lists its own window');
      assert.ok(!candidates.some((w: any) => w.hwnd === otherWin.hwnd), 'the demo core does not list another workbench');
      assert.equal((await ui.request('grant.window', { session_id: driver, hwnd: otherWin.hwnd, pid: otherWin.pid, process_start: otherWin.process_start }, { timeout: 15_000 })).error?.code, -32003);
      const grant = await ui.request('grant.window', { session_id: driver, hwnd: demoWin.hwnd, pid: demoWin.pid, process_start: demoWin.process_start }, { timeout: 15_000 });
      assert.match(grant.result?.grant_id ?? '', /^gr_/, JSON.stringify(grant));

      const out = await until(() => lines(agentLog).find((l) => 'exit' in l), 300_000);
      const steps = lines(agentLog).filter((l) => 'step' in l);
      assert.equal(out.exit, 0, JSON.stringify(steps.map(({ text: _t, ...s }) => s)));
      assert.equal(steps.length, 4);

      // M6-16a: the approval was approved for real, and the clicked tile is the one with the ready dev server
      assert.equal((await decided).result?.decision, 'approved');
      assert.equal((db.prepare('SELECT status FROM approval WHERE session_id = ?').get(asker) as any).status, 'approved');
      assert.match(steps[1].clicked.name, /^(preview, |Open preview)/);
      assert.ok(db.prepare("SELECT 1 FROM session_dev_server WHERE session_id = ? AND status = 'ready'").get(preview));

      // M6-16d: the agent saw only its grant, and its screenshot named the demo window
      assert.deepEqual(steps[0].windows.map((w: any) => w.window), [demoWin.hwnd]);
      assert.equal(steps[1].screenshot.window, demoWin.hwnd);
      assert.ok(steps[1].screenshot.bytes > 0);

      // M6-16e: a full tree with the names the agent finds by
      assert.ok(steps[1].nodes >= 20, `${steps[1].nodes} nodes`);
      const texts = steps.map((s) => s.text ?? '').join('\n');
      assert.match(texts, /"Open preview/);
      assert.match(texts, /button "Approve once"/);
      for (const role of ['preview', 'asker']) assert.match(texts, new RegExp(`group "${role}, `), role);

      // M6-16b: nothing of the sentinel reached the run
      assert.ok(!readFileSync(agentLog, 'utf8').includes(marker), 'no snapshot or windows result shows the sentinel marker');
    } finally {
      db.close();
    }

    // M6-16f: a polite close (WM_CLOSE) quits the demo, which removes its home; the other workbench keeps going
    pipe.close(); ui.close(); pipe = ui = null;
    execFileSync('taskkill', ['/PID', String(demo.pid)], { stdio: 'pipe' });
    await until(() => !existsSync(home), 60_000);
    assert.ok(alive(otherWb.pid!), 'the other workbench is still running');
    const gaps = beats.slice(1).map((t, i) => t - beats[i]);
    assert.ok(beats.length > 10 && Math.max(...gaps) <= 6000, `heartbeat gaps ${gaps.join(',')}`);
  } finally {
    clearInterval(beat);
    pipe?.close(); ui?.close();
    helper.stop();
    if (demo.pid && alive(demo.pid)) killTree(demo.pid);
    if (otherWb.pid) killTree(otherWb.pid);
    await sleep(500);
    if (existsSync(home)) await teardownCore(null, iso);
    await teardownCore(otherCore, other);
    assert.equal(sha(join(sentinel, 'troop.db')), before, 'the sentinel troop.db is unchanged');
    rmSync(sentinel, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
});
