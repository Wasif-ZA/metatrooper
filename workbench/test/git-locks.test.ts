import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitIn, handback, sessionChanges } from '../src/handback.ts';
import { gitView, runIn } from '../src/gitpane.ts';
import { refreshRowGit } from '../src/rowgit.ts';

test("the workbench's read-only git never makes a concurrent git add fail on index.lock", { timeout: 120_000 }, async () => {
  const d = mkdtempSync(join(tmpdir(), 'git-locks-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: d, encoding: 'utf8' });
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  for (let i = 0; i < 200; i++) writeFileSync(join(d, `f${i}.txt`), `${i}\n`);
  g('add', '.');
  g('commit', '-qm', 'init');
  let stop = false;
  const reads = (async () => {
    while (!stop) {
      await Promise.all([handback(gitIn(d)), sessionChanges(gitIn(d), 'HEAD'), gitView(runIn(d)), refreshRowGit([{ id: 's', cwd: d }])]).catch(() => {});
    }
  })();
  let failed = 0;
  for (let i = 0; i < 60; i++) {
    appendFileSync(join(d, `f${i % 200}.txt`), `${i}\n`);
    const code = await new Promise<number>((r) => spawn('git', ['add', '-A'], { cwd: d, stdio: 'ignore' }).on('close', (c) => r(c ?? 1)));
    if (code !== 0) failed++;
  }
  stop = true;
  await reads;
  assert.equal(failed, 0);
});
