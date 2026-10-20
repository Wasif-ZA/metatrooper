import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { client, isolation, runNode, startCore, teardownCore, uiHello, until } from './helpers.ts';

test('M7-11f troop stop with no core reports it was not running and exits 0', async () => {
  const isolated = isolation();
  try {
    const result = await runNode(['core/cli.ts', 'stop'], isolated.env);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /core was not running/);
  } finally { rmSync(isolated.home, { recursive: true, force: true }); }
});

test('M7-11f non-TTY troop stop is refused with -32012 and leaves the core running', async () => {
  const isolated = isolation();
  const core = await startCore(isolated);
  try {
    const result = await runNode(['core/cli.ts', 'stop'], isolated.env);
    assert.equal(result.code, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /error -32012:/);
    const pipe = await client(isolated.prefix);
    try { assert.equal((await pipe.request('core.ping')).result?.ok, true); }
    finally { pipe.close(); }
  } finally { await teardownCore(core, isolated); }
});

test('M7-11f trusted core.stop ends the core and an isolated restart has a new pid', { timeout: 20_000 }, async () => {
  const isolated = isolation();
  let core = await startCore(isolated);
  try {
    const pipe = await client(isolated.prefix);
    let oldPid: number;
    try {
      oldPid = (await pipe.request('core.ping')).result?.pid;
      assert.equal(oldPid, core.pid);
      await uiHello(pipe, isolated.home);
      const stopped = await pipe.request('core.stop');
      assert.equal(stopped.error, undefined, JSON.stringify(stopped));
    } finally { pipe.close(); }

    const stoppingAt = Date.now();
    await until(async () => {
      try {
        const probe = await client(isolated.prefix);
        try { return (await probe.request('core.ping')).result?.ok !== true; }
        finally { probe.close(); }
      } catch { return true; }
    }, 10_000);
    assert.ok(Date.now() - stoppingAt < 10_000, 'core.ping still answered after 10 s');
    await until(() => core.exitCode !== null || core.signalCode !== null, 10_000);

    core = await startCore(isolated);
    const restarted = await client(isolated.prefix);
    try {
      const ping = await restarted.request('core.ping');
      assert.equal(ping.result?.ok, true);
      assert.equal(ping.result?.pid, core.pid);
      assert.notEqual(ping.result?.pid, oldPid);
    } finally { restarted.close(); }
  } finally { await teardownCore(core, isolated); }
});
