import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { killTree, killTreeAsync } from '../../tests/helpers/kill-tree.ts';

for (const kill of [killTree, killTreeAsync]) {
  test(`${kill.name} ends its owned child when taskkill is unavailable`, { skip: process.platform !== 'win32' }, async () => {
    const empty = mkdtempSync(join(tmpdir(), 'kill-tree-fallback-'));
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', windowsHide: true });
    try {
      await once(child, 'spawn');
      const path = process.env.PATH;
      try {
        process.env.PATH = empty;
        const probe = spawnSync('taskkill', ['/?'], { windowsHide: true });
        assert.ok(probe.error, 'taskkill must fail to spawn');
        assert.equal((probe.error as NodeJS.ErrnoException).code, 'ENOENT');
        await kill(child);
      } finally {
        if (path === undefined) delete process.env.PATH;
        else process.env.PATH = path;
      }
      if (child.exitCode === null && child.signalCode === null) {
        await assert.doesNotReject(once(child, 'exit', { signal: AbortSignal.timeout(5000) }), 'child must exit within 5 s');
      }
    } finally {
      child.kill();
      rmSync(empty, { recursive: true, force: true });
    }
  });
}
