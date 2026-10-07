import dns from 'node:dns/promises';
import net from 'node:net';

const V4_BLOCKED = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.168.0.0', 16], ['224.0.0.0', 3]];

const v4int = (ip) => ip.split('.').reduce((n, part) => n * 256 + Number(part), 0);

export function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const n = v4int(ip);
    return V4_BLOCKED.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(v4int(base) / 2 ** (32 - bits)));
  }
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivate(mapped[1]);
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6);
}

export async function checkUrl(raw, lookup = dns.lookup) {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`refused ${u.protocol} URL`);
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  const bad = addrs.find((a) => isPrivate(a.address));
  if (bad) throw new Error(`refused ${u.hostname}: resolves to private address ${bad.address}`);
  return u;
}

// ponytail: checks DNS before each hop, so a host that re-resolves between check and connect slips through.
export async function safeFetch(url, opts = {}, lookup = dns.lookup) {
  let current = url;
  for (let hop = 0; hop <= 5; hop++) {
    await checkUrl(current, lookup);
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
