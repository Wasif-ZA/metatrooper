import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkUrl, isLoopback, loopbackStart, safeFetch } from '../../plugins/seo/bin/safe-fetch.js';
import { crawl } from '../../plugins/seo/bin/seo.js';

const resolvesTo = (...ips: string[]) => async () => ips.map((address) => ({ address }));

function serve(handler: http.RequestListener, host = '127.0.0.1'): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, host, () => {
    const { port } = server.address() as any;
    resolve({ url: `http://${host.includes(':') ? `[${host}]` : host}:${port}`, close: () => new Promise((r) => server.close(() => r())) });
  }));
}

test('isLoopback covers all of 127.0.0.0/8, ::1 and IPv4-mapped loopback, and nothing else', () => {
  for (const ip of ['127.0.0.1', '127.255.0.9', '::1', '::ffff:127.0.0.1']) assert.equal(isLoopback(ip), true, ip);
  for (const ip of ['10.0.0.1', '192.168.1.5', '169.254.1.1', '::', 'fc00::1', '::ffff:10.0.0.1', '128.0.0.1']) assert.equal(isLoopback(ip), false, ip);
});

test('loopbackStart is true only when every resolved address is loopback', async () => {
  assert.equal(await loopbackStart('http://127.0.0.2:8080/'), true);
  assert.equal(await loopbackStart('http://[::1]/'), true);
  assert.equal(await loopbackStart('http://localhost/', resolvesTo('127.0.0.1', '::1')), true);
  assert.equal(await loopbackStart('http://mixed.test/', resolvesTo('127.0.0.1', '93.184.216.34')), false);
  assert.equal(await loopbackStart('http://public.test/', resolvesTo('93.184.216.34')), false);
  assert.equal(await loopbackStart('http://empty.test/', resolvesTo()), false);
});

test('checkUrl refuses a loopback address unless loopback is allowed, and refuses other private ranges either way', async () => {
  await assert.rejects(checkUrl('http://127.0.0.1/'), /private address 127\.0\.0\.1/);
  await assert.rejects(checkUrl('http://sneaky.test/', resolvesTo('127.0.0.1')), /private address 127\.0\.0\.1/);
  await assert.rejects(checkUrl('http://[::1]/'), /private address ::1/);
  assert.equal((await checkUrl('http://127.0.0.1/', undefined, { loopback: true })).hostname, '127.0.0.1');
  assert.equal((await checkUrl('http://local.test/', resolvesTo('::1'), { loopback: true })).hostname, 'local.test');
  for (const ip of ['10.0.0.1', '192.168.1.5', '172.16.0.1', '169.254.169.254', '100.64.0.1']) {
    await assert.rejects(checkUrl(`http://${ip}/`, undefined, { loopback: true }), /private address/, ip);
  }
  await assert.rejects(checkUrl('http://half.test/', resolvesTo('127.0.0.1', '10.0.0.1'), { loopback: true }), /private address 10\.0\.0\.1/);
});

test('safeFetch refuses a public page that redirects to loopback', async () => {
  const real = globalThis.fetch;
  const hits: string[] = [];
  globalThis.fetch = (async (url: string) => {
    hits.push(url);
    return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:9/admin' } });
  }) as typeof fetch;
  try {
    await assert.rejects(safeFetch('http://public.test/', {}, resolvesTo('93.184.216.34')), /private address 127\.0\.0\.1/);
    assert.deepEqual(hits, ['http://public.test/']);
  } finally { globalThis.fetch = real; }
});

test('safeFetch from a loopback start still refuses a redirect to another private range', async () => {
  const site = await serve((req, res) => { res.writeHead(302, { location: 'http://10.0.0.1/' }); res.end(); });
  try {
    await assert.rejects(safeFetch(`${site.url}/`, {}, undefined, { loopback: true }), /private address 10\.0\.0\.1/);
  } finally { await site.close(); }
});

test('crawl of a loopback site follows its internal links, and a public start never reaches loopback', async () => {
  const pages: Record<string, string> = {
    '/': '<html><head><title>Home</title></head><body><a href="/menu">Menu</a></body></html>',
    '/menu': '<html><head><title>Menu</title></head><body><a href="/">Home</a></body></html>',
  };
  const site = await serve((req, res) => {
    const body = pages[req.url ?? ''];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' }); res.end(body ?? 'missing');
  });
  const dir = mkdtempSync(join(tmpdir(), 'seo-loopback-'));
  try {
    const r: any = await crawl({ url: `${site.url}/`, out: join(dir, 'crawl.json') }, dir);
    assert.deepEqual([r.pages, r.broken], [2, 0]);
    const data = JSON.parse(readFileSync(join(dir, 'crawl.json'), 'utf8'));
    assert.deepEqual(data.pages.map((p: any) => p.status), [200, 200]);
    await assert.rejects(safeFetch(`${site.url}/`, {}), /private address 127\.0\.0\.1/);
  } finally { await site.close(); rmSync(dir, { recursive: true, force: true }); }
});
