import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { buildGenerated, client, isolation, scriptedGh, startCore, teardownCore, uiHello, until } from './helpers.ts';

// Build generated fixtures before running tests.
before(buildGenerated);

const gitScript = `
import { appendFileSync } from 'node:fs';
const log = process.env.FAKE_GIT_LOG;
if (log) {
  appendFileSync(log, JSON.stringify(process.argv.slice(2)) + '\\n');
}
setTimeout(() => process.exit(0), 30000);
`;

let isolated: ReturnType<typeof isolation>;
let core: any;
let logPath: string;
let uiPipe: any;
let previewPromise: Promise<any>;

before(async () => {
  // Set up isolated home and fake git directory on PATH.
  isolated = isolation();
  logPath = join(isolated.home, 'fake-git.log');
  const fakeBin = join(isolated.home, 'fake-bin');
  mkdirSync(fakeBin, { recursive: true });
  writeFileSync(join(fakeBin, 'git.mjs'), gitScript);
  writeFileSync(join(fakeBin, 'git.cmd'), '@echo off\r\nnode "%~dp0git.mjs" %*\r\n');
  writeFileSync(join(fakeBin, 'git.bat'), '@echo off\r\nnode "%~dp0git.mjs" %*\r\n');
  writeFileSync(join(fakeBin, 'git'), '#!/bin/sh\nexec node "$(dirname "$0")/git.mjs" "$@"\n', { mode: 0o755 });
  scriptedGh(fakeBin, gitScript);
  if (existsSync(join(fakeBin, 'gh.exe'))) {
    copyFileSync(join(fakeBin, 'gh.exe'), join(fakeBin, 'git.exe'));
  }
  const env = {
    ...isolated.env,
    PATH: `${fakeBin}${delimiter}${isolated.env.PATH ?? process.env.PATH ?? ''}`,
    FAKE_GIT_LOG: logPath,
  };
  core = await startCore({ ...isolated, env });
});

after(async () => {
  // Clean up open connections and core process.
  if (uiPipe) {
    uiPipe.close();
  }
  if (core) {
    await teardownCore(core, isolated);
  }
});

test('C4d: plugin.preview of remote git URL without ui.hello returns -32012 while local folder works', async () => {
  // Connect a non-UI pipe client.
  const nonUiPipe = await client(isolated.prefix);
  try {
    // Attempt remote git preview without ui.hello.
    const remoteRes = await nonUiPipe.request('plugin.preview', { source: 'https://example.com/fake/repo.git' });
    const expectedNeedsUiCode = -32012;
    assert.equal(remoteRes.error?.code, expectedNeedsUiCode);

    // Create a local plugin folder fixture.
    const localPlugin = join(isolated.home, 'local-plugin-fixture');
    mkdirSync(localPlugin, { recursive: true });
    writeFileSync(join(localPlugin, 'troop-plugin.json'), JSON.stringify({ schema: 1, id: 'local-fixture', version: '1.0.0', name: 'Local Fixture' }));

    // Preview local folder without ui.hello.
    const localRes = await nonUiPipe.request('plugin.preview', { source: localPlugin });
    assert.equal(localRes.result?.valid, true);
  } finally {
    nonUiPipe.close();
  }
});

test('C4a: core.ping answers in under 500 ms while remote git clone is in flight', async () => {
  // Connect a UI client and authenticate with ui.hello.
  uiPipe = await client(isolated.prefix);
  await uiHello(uiPipe, isolated.home);

  // Start remote git preview in the background.
  previewPromise = uiPipe.request('plugin.preview', { source: 'https://example.com/fake/repo.git' }, { timeout: 35000 });
  previewPromise.catch(() => {});

  // Wait until fake git logs that clone started.
  await until(() => {
    try {
      const raw = readFileSync(logPath, 'utf8').trim();
      return raw.length > 0;
    } catch {
      return false;
    }
  }, 5000);

  // Connect a second client to verify core responsiveness.
  const pingPipe = await client(isolated.prefix);
  try {
    const started = performance.now();
    const ping = await pingPipe.request('core.ping');
    const elapsed = performance.now() - started;
    assert.equal(ping.result?.ok, true);
    const maxAllowedPingMs = 500;
    assert.ok(elapsed < maxAllowedPingMs, `ping took ${elapsed} ms, exceeding bound of ${maxAllowedPingMs} ms`);
  } finally {
    pingPipe.close();
  }
});

test('C4c: git clone is started with https-only protocol flags', () => {
  // Read logged fake git arguments from disk.
  const raw = readFileSync(logPath, 'utf8').trim().split('\n')[0];
  const loggedArgv = JSON.parse(raw) as string[];

  // Assert protocol restrictions prevent insecure transports.
  assert.ok(loggedArgv.includes('protocol.allow=never'));
  assert.ok(loggedArgv.includes('protocol.https.allow=always'));
});
