import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, sleep, startCore, teardownCore, withEnv } from './helpers.ts';
import { buildMethods } from '../src/methods.ts';
import { openCoreDb } from '../src/store/db.ts';

// Build generated fixtures before running tests.
before(buildGenerated);

test('engines.check background checkAll rejection does not crash core and core answers ping', async () => {
  // Start isolated core instance.
  const isolated = isolation();
  const core = await startCore(isolated);
  try {
    // Open a second connection to the database and hold an exclusive transaction lock.
    const locker = new DatabaseSync(join(isolated.home, 'troop.db'));
    locker.exec('BEGIN EXCLUSIVE;');
    try {
      // Connect to the pipe and call engines.check while database is locked.
      const pipe = await client(isolated.prefix);
      let checkReply;
      try {
        checkReply = await pipe.request('engines.check');
      } finally {
        pipe.close();
      }
      // Verify engines.check returns an empty object result immediately.
      assert.deepEqual(checkReply.result, {});
    } finally {
      // Release the exclusive database lock.
      locker.exec('ROLLBACK;');
      locker.close();
    }
    // Allow background checkAll to handle its rejection.
    await sleep(200);
    // Connect to the pipe and verify core is still running and responsive.
    const pingPipe = await client(isolated.prefix);
    try {
      const pingReply = await pingPipe.request('core.ping');
      assert.equal(pingReply.result?.ok, true);
    } finally {
      pingPipe.close();
    }
    // Verify core process did not exit.
    assert.equal(core.exitCode, null);
  } finally {
    await teardownCore(core, isolated);
  }
});

test('engines.check background rejection with closed database does not emit unhandledRejection', async () => {
  // Open and initialize a real core database schema.
  const isolated = isolation();
  const env = { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix };
  const db = withEnv(env, openCoreDb);

  // Build methods map while database is open.
  const methods = buildMethods(db, {
    engines: () => [{
      id: 'test-engine',
      command: process.execPath,
      args: [],
      prompt_arg: 'positional',
      state_source: 'process',
      roles: ['worker'],
      cost_rank: 1,
      usage_source: 'none',
      provider: 'local-cli',
      version_cmd: [process.execPath, '--version'],
    }],
    stop: () => {},
    uiKey: 'test-key',
  });

  // Close database to force checkAll to reject when executed.
  db.close();

  // Listen for unhandled rejection events on process.
  let unhandledError: unknown = null;
  const onUnhandled = (err: unknown) => { unhandledError = err; };
  process.on('unhandledRejection', onUnhandled);
  try {
    // Invoke engines.check handler with closed database.
    const method = methods.get('engines.check');
    assert.ok(method);
    const result = method.handler({}, { ui: false, origin: 'cli' });
    assert.deepEqual(result, {});

    // Allow microtasks to run and verify rejection is caught.
    await sleep(100);
    assert.equal(unhandledError, null);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
