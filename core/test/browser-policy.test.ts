import test from 'node:test';
import assert from 'node:assert/strict';
import { checkUrl } from '../src/browser/policy.ts';

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
