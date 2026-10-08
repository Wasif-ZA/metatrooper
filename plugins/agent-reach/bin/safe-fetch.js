import dns from 'node:dns/promises';
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

// ponytail: checks DNS before each hop, so a host that re-resolves between check and connect slips through.
export async function safeFetch(url, opts = {}, lookup = dns.lookup, { loopback = false } = {}) {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    await checkUrl(current, lookup, { loopback });
    const res = await fetch(current, { ...opts, redirect: 'manual' });
    const next = res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!next) {
      Object.defineProperty(res, 'url', { value: current });
      return res;
    }
    current = new URL(next, current).href;
  }
  throw new Error(`too many redirects from ${url}`);
}
