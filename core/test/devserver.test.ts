import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { reservePortBand } from './helpers.ts';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('starting a dev server again on the same run and index stops the previous one', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-devserver-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { startDevServer, stopDevServer } = await import('../src/pipelines/devserver.ts');
  const db = openCoreDb();
  try {
    reservePortBand(db, 3002, 'r1');
    const command = `"${process.execPath}" -e "setInterval(() => {}, 1000)"`;
    startDevServer(db, 'r1', 0, 3001, command, home);
    const first = (db.prepare("SELECT pid FROM dev_server WHERE run_id = 'r1'").get() as { pid: number }).pid;
    await sleep(300);
    assert.ok(alive(first));
    startDevServer(db, 'r1', 0, 3001, command, home);
    const second = (db.prepare("SELECT pid FROM dev_server WHERE run_id = 'r1'").get() as { pid: number }).pid;
    assert.notEqual(second, first);
    assert.equal(alive(first), false);
    stopDevServer(db, 'r1', 0);
    assert.equal(alive(second), false);
  } finally {
    db.close();
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
