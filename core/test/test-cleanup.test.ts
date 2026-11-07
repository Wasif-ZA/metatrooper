import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root } from './helpers.ts';

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === 'EPERM'; } };

test('a test file held open by its child ends after the test timeout, and the child and its detached grandchild are killed', { skip: process.platform !== 'win32' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'metatrooper-cleanup-'));
  try {
    const pids = join(dir, 'pids.txt');
    writeFileSync(join(dir, 'hung.test.ts'), `
      import test from 'node:test';
      import { spawn } from 'node:child_process';
      import { writeFileSync } from 'node:fs';
      import ${JSON.stringify(pathToFileURL(join(root, 'core/test/helpers.ts')).href)};
      const parent = spawn(process.execPath, ['-e', "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' }); console.log(c.pid); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'] });
      parent.stdout.once('data', (d) => writeFileSync(${JSON.stringify(pids)}, parent.pid + ' ' + String(d).trim()));
      test('never ends', () => new Promise(() => {}));
    `);
    const started = Date.now();
    const run = spawnSync(process.execPath, ['--test', '--test-timeout=3000', join(dir, 'hung.test.ts')], { encoding: 'utf8', timeout: 90_000, windowsHide: true, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
    assert.notEqual(run.error?.code, 'ETIMEDOUT', 'the hung file did not end');
    assert.ok(Date.now() - started < 90_000);
    assert.ok(existsSync(pids), run.stdout + run.stderr);
    const [child, grandchild] = readFileSync(pids, 'utf8').split(' ').map(Number);
    assert.ok(child && grandchild, 'both pids recorded');
    assert.equal(alive(child), false, 'child still running');
    assert.equal(alive(grandchild), false, 'grandchild still running');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
