import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { killTree, killTreeAsync, startOf } from '../../tests/helpers/kill-tree.ts';

const T = { skip: process.platform !== 'win32' && 'pid reuse guard is Windows only', timeout: 60_000 };
const idle = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
const ended = (c: ChildProcess, ms: number) => c.exitCode !== null ? Promise.resolve(true) : Promise.race([once(c, 'exit').then(() => true), new Promise<boolean>(r => setTimeout(() => r(false), ms))]);

test('killTree leaves a process alone when its pid is named by a stale target', T, async () => {
  const live = idle();
  try {
    await once(live, 'spawn');
    const born = startOf(live.pid!)!;
    assert.ok(born > 0);
    killTree({ pid: live.pid!, born: born - 5000 });
    killTree({ pid: live.pid!, exitCode: 0, signalCode: null } as unknown as ChildProcess);
    await killTreeAsync({ pid: live.pid!, born: born + 5000 });
    assert.equal(await ended(live, 1500), false, 'a pid whose start time or exit no longer matches was killed');
    killTree({ pid: live.pid!, born });
    assert.equal(await ended(live, 10_000), true, 'a pid with the recorded start time is killed');
  } finally { live.kill(); }
});

test('killTree ends a ChildProcess it still owns, and its children', T, async () => {
  const parent = spawn(process.execPath, ['-e', "const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); console.log(c.pid); setInterval(() => {}, 1000)"], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  try {
    const [line] = await once(parent.stdout!, 'data');
    const kid = Number(String(line).trim());
    const kidBorn = startOf(kid);
    await killTreeAsync(parent);
    assert.equal(await ended(parent, 10_000), true);
    assert.equal(startOf(kid) === kidBorn, false, 'the child of the owned process survived');
  } finally { parent.kill(); }
});
