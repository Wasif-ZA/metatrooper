import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedAddress, checkUrl } from '../src/browser/policy.ts';
import { titlePatterns, unsafePattern } from '../src/engines/registry.ts';

function ctx(ownedPorts: number[] = [], lookup?: (host: string) => Promise<string[]>) {
  return { ownedPorts: new Set(ownedPorts), allowHosts: new Set<string>(), lookup };
}

test('c-sec-d2 URL policy refuses wrapped-private IPv6, site-local, multicast and broadcast', async () => {
  for (const url of [
    'http://[::7f00:1]:3000/', 'http://[::127.0.0.1]:3000/', 'http://[::ffff:7f00:1]:3000/', 'http://[::a00:1]/',
    'http://[64:ff9b::7f00:1]/', 'http://[64:ff9b::192.168.1.1]/', 'http://[2002:c0a8:101::1]/', 'http://[2002:7f00:1::]/',
    'http://[fec0::1]/', 'http://[ff02::1]/', 'http://224.0.0.1/', 'http://239.255.255.250/', 'http://255.255.255.255/',
  ]) {
    assert.equal((await checkUrl(url, ctx([3000]))).allow, false, url);
  }
  for (const a of ['::7f00:1', '64:ff9b::a00:1', '2002:a00:1::', 'fec0::1', 'ff05::2', '224.0.0.251', '255.255.255.255']) {
    assert.equal(blockedAddress(a), true, a);
  }
  for (const a of ['64:ff9b::808:808', '2002:808:808::1', '2606:4700::1111', '8.8.8.8']) {
    assert.equal(blockedAddress(a), false, a);
  }
  assert.equal((await checkUrl('http://[::1]:3000/', ctx([3000]))).allow, true);
});

test('m6-23-d1 state_titles rejects nested quantifiers, backreferences and long patterns at load', () => {
  for (const src of ['^(a+)+$', '(?:x*)*', '((ab+))+', '(a{2,})+y', '(\\d+)*', '(a)\\1', '(?<n>a)\\k<n>', 'a'.repeat(201)]) {
    assert.ok(unsafePattern(src), src);
  }
  for (const src of ['^\\u2733 ', '(working|busy)', '^(a+)?b', '[(+)]+', '\\(a+\\)+', 'x{2}', 'Claude.*working']) {
    assert.equal(unsafePattern(src), null, src);
  }
  const spec = { id: 'fix-1018-fixture', command: 'x', version_cmd: ['x'], roles: [], cost_rank: 1, state_titles: { working: '^(a+)+$', idle: '^idle' } };
  const re = titlePatterns(spec as never);
  assert.equal(re.working, undefined);
  assert.ok(re.idle?.test('idle now'));
});
