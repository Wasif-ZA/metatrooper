import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { isPrivate as safeFetchIsPrivate } from '../../plugins/agent-reach/bin/safe-fetch.js';

const temp = mkdtempSync(join(tmpdir(), 'fix-r6-'));
const savedEnv = { PORT: process.env.PORT, DENY_LOG: process.env.DENY_LOG, TROOP_PROXY: process.env.TROOP_PROXY };
let listenCalls = 0;
const listen = mock.method(net.Server.prototype, 'listen', function () {
  listenCalls++;
  return this;
});
let proxyIsPrivate: (ip: string) => boolean;
try {
  process.env.PORT = '0';
  process.env.DENY_LOG = join(temp, 'denied.log');
  delete process.env.TROOP_PROXY;
  ({ isPrivate: proxyIsPrivate } = await import('../../sandbox/proxy.js'));
} finally {
  listen.mock.restore();
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(temp, { recursive: true, force: true });
}

test('proxy import does not start a server without TROOP_PROXY', () => {
  // protects=FIX-R6 importing the classifier does not open a listening socket
  assert.equal(listenCalls, 0, 'sandbox/proxy.js attempted to start a server on import');
});

const privateAddresses = [
  '::ffff:7f00:1', '::ffff:127.0.0.1', '64:ff9b::7f00:1', '2002:7f00:1::',
  'fec0::1', '198.18.0.1', '198.19.255.255', '192.0.0.8',
  '10.0.0.1', '127.0.0.1', '::1', 'fe80::1', 'fd00::1',
];
const publicAddresses = [
  '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '198.20.0.1',
];

for (const [name, isPrivate] of [
  ['sandbox/proxy.js', proxyIsPrivate],
  ['safe-fetch.js', safeFetchIsPrivate],
] as const) {
  test(`${name} blocks embedded IPv4 and private ranges`, () => {
    // protects=FIX-R6 mapped, NAT64, 6to4, site-local, benchmark and private addresses are blocked
    for (const ip of privateAddresses) assert.equal(isPrivate(ip), true, `${name}: ${ip}`);
  });

  test(`${name} allows public addresses outside blocked ranges`, () => {
    // protects=FIX-R6 public IPv4 and IPv6 including the benchmark upper boundary remain allowed
    for (const ip of publicAddresses) assert.equal(isPrivate(ip), false, `${name}: ${ip}`);
  });

  test(`${name} treats a non-IP string as private`, () => {
    // protects=FIX-R6 invalid addresses fail closed
    assert.equal(isPrivate('not-an-ip'), true);
  });
}
