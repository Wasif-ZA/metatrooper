import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

const V4_BLOCKED = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3]];
const V6_BLOCKED = [['::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]];

const blocked = new net.BlockList();
for (const [base, bits] of V4_BLOCKED) blocked.addSubnet(base, bits, 'ipv4');
for (const [base, bits] of V6_BLOCKED) blocked.addSubnet(base, bits, 'ipv6');
const loop = new net.BlockList();
loop.addSubnet('127.0.0.0', 8, 'ipv4');
loop.addAddress('::1', 'ipv6');

/** True for private, loopback, link-local, multicast and unspecified addresses, IPv4-mapped IPv6 in any spelling included. */
export function isPrivate(ip) {
  const type = net.isIP(ip);
  return type === 0 || blocked.check(ip, type === 4 ? 'ipv4' : 'ipv6');
}

export function isLoopback(ip) {
  const type = net.isIP(ip);
  return type !== 0 && loop.check(ip, type === 4 ? 'ipv4' : 'ipv6');
}

async function addresses(u, lookup) {
  const host = u.hostname.replace(/^\[|\]$/g, '');
  return net.isIP(host) ? [{ address: host }] : lookup(host, { all: true });
}

/** True when every address the URL's host resolves to is loopback. */
export async function loopbackStart(raw, lookup = dns.lookup) {
  const addrs = await addresses(new URL(raw), lookup);
  return addrs.length > 0 && addrs.every((a) => isLoopback(a.address));
}

export async function checkUrl(raw, lookup = dns.lookup, { loopback = false } = {}) {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`refused ${u.protocol} URL`);
  const addrs = await addresses(u, lookup);
  const bad = addrs.find((a) => isPrivate(a.address) && !(loopback && isLoopback(a.address)));
  if (bad) throw new Error(`refused ${u.hostname}: resolves to private address ${bad.address}`);
  return u;
}

export const MAX_BYTES = 20 * 1024 * 1024;
export const DEADLINE_MS = 60_000;

/** A socket lookup that refuses private addresses at connect time, so a host cannot re-resolve after checkUrl. */
function guardedLookup(lookup, loopback) {
  return (host, options, cb) => {
    Promise.resolve(lookup(host, { all: true })).then((addrs) => {
      const bad = addrs.find((a) => isPrivate(a.address) && !(loopback && isLoopback(a.address)));
      if (bad) return cb(new Error(`refused ${host}: resolves to private address ${bad.address}`));
      const list = addrs.map((a) => ({ address: a.address, family: a.family ?? net.isIP(a.address) }));
      return options.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
    }, cb);
  };
}

/** One request with no redirect following; the body is read whole, capped at MAX_BYTES, inside the caller's deadline. */
function fetchOnce(u, opts, lookup, loopback, signal) {
  return new Promise((resolve, reject) => {
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: opts.method ?? 'GET', headers: opts.headers, lookup: guardedLookup(lookup, loopback), signal }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) return res.destroy(new Error(`response from ${u.hostname} is over ${MAX_BYTES} bytes`));
        chunks.push(c);
      });
      res.on('error', reject);
      res.on('aborted', () => reject(new Error(`response from ${u.hostname} was cut off`)));
      res.on('end', () => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const one of [v].flat()) if (one !== undefined) headers.append(k, one);
        const empty = [204, 205, 304].includes(res.statusCode);
        const out = new Response(empty ? null : Buffer.concat(chunks), { status: res.statusCode, statusText: res.statusMessage, headers });
        Object.defineProperty(out, 'url', { value: u.href });
        resolve(out);
      });
    });
    req.on('error', reject);
    req.end(opts.body);
  });
}

export async function safeFetch(url, opts = {}, lookup = dns.lookup, { loopback = false } = {}) {
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  const signal = opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline;
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    const u = await checkUrl(current, lookup, { loopback });
    const res = await fetchOnce(u, opts, lookup, loopback, signal);
    const next = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!next) return res;
    current = new URL(next, current).href;
  }
  throw new Error(`too many redirects from ${url}`);
}
