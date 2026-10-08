import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl, typedUrl } from '../src/browser/policy.ts';

function ctx(ownedPorts: number[] = [], lookup?: (host: string) => Promise<string[]>) {
  return { ownedPorts: new Set(ownedPorts), allowHosts: new Set<string>(), lookup };
}

test('M1-24 blocks file URLs', async () => {
  const verdict = await checkUrl('file:///tmp/index.html', ctx());
  assert.equal(verdict.allow, false);
});

test('M1-24 blocks an unowned loopback port', async () => {
  const verdict = await checkUrl('http://127.0.0.1:5173/', ctx([3001]));
  assert.equal(verdict.allow, false);
});

test('M1-24 blocks private 192.168 addresses', async () => {
  const verdict = await checkUrl('http://192.168.1.10/', ctx());
  assert.equal(verdict.allow, false);
});

test('M1-24 blocks IPv6 loopback on an unowned port', async () => {
  const verdict = await checkUrl('http://[::1]:5173/', ctx([3001]));
  assert.equal(verdict.allow, false);
});

test('M1-24 blocks unique local IPv6 addresses', async () => {
  const verdict = await checkUrl('http://[fd00::1]/', ctx());
  assert.equal(verdict.allow, false);
});

test('M1-24 blocks a hostname that resolves to loopback', async () => {
  const verdict = await checkUrl('http://local-service.test:3001/', ctx([3001], async (host) => {
    assert.equal(host, 'local-service.test');
    return ['127.0.0.1'];
  }));
  assert.equal(verdict.allow, false);
});

test('M1-24 allows an owned loopback port over http', async () => {
  const verdict = await checkUrl('http://127.0.0.1:3001/', ctx([3001]));
  assert.deepEqual(verdict, { allow: true });
});

test('M1-24 a host that passed on a public address but connected to loopback or a private address is blocked (DNS rebinding)', async () => {
  const { connectedVerdict } = await import('../src/browser/policy.ts');
  const c = ctx([3001], async () => ['93.184.216.34']);
  assert.equal((await checkUrl('http://rebind.test:3001/', c)).allow, true);
  for (const ip of ['127.0.0.1', '::1', '[::1]', '10.0.0.5', '169.254.169.254', '::ffff:127.0.0.1']) {
    const v = await connectedVerdict('http://rebind.test:3001/', ip, c);
    assert.equal(v.allow, false, ip);
  }
  assert.equal((await connectedVerdict('http://rebind.test:3001/', '93.184.216.34', c)).allow, true);
  assert.equal((await connectedVerdict('http://127.0.0.1:3001/', '127.0.0.1', c)).allow, true);
});

test('typed URL inputs normalize hosts and turn queries into DuckDuckGo searches', () => {
  assert.equal(typedUrl('example.com'), 'https://example.com');
  assert.equal(typedUrl('localhost:3000/x'), 'http://localhost:3000/x');
  assert.equal(typedUrl('127.0.0.1:5173'), 'http://127.0.0.1:5173');
  assert.equal(typedUrl('how do vite hmr'), 'https://duckduckgo.com/?q=how%20do%20vite%20hmr');
  assert.equal(typedUrl('https://a.b'), 'https://a.b');
  assert.equal(typedUrl('about:blank'), 'about:blank');
});

test('WebSocket URL policy honors owned loopback ports and rejects private hosts', async () => {
  const c = ctx([3001], async () => ['93.184.216.34']);
  assert.deepEqual(await checkUrl('ws://localhost:3001/', c), { allow: true });
  assert.equal((await checkUrl('ws://localhost:3002/', c)).allow, false);
  assert.deepEqual(await checkUrl('wss://example.com/', c), { allow: true });
  assert.equal((await checkUrl('ws://192.168.1.2/', c)).allow, false);
});
