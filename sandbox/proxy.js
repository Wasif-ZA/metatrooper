import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import dns from 'node:dns/promises';

const ALLOW = new Set((process.env.ALLOW || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
const LOG = process.env.DENY_LOG || '/logs/egress-denied.log';
const PORT = Number(process.env.PORT || 3128);

const V4_BLOCKED = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]];
const V6_BLOCKED = [['::', 96], ['64:ff9b::', 96], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8]];
const blocked = new net.BlockList();
for (const [base, bits] of V4_BLOCKED) blocked.addSubnet(base, bits, 'ipv4');
for (const [base, bits] of V6_BLOCKED) blocked.addSubnet(base, bits, 'ipv6');

/** True for private, loopback, link-local, site-local, benchmark, multicast and unspecified addresses, and for IPv6 forms that embed an IPv4 address (mapped, NAT64, 6to4). */
export function isPrivate(ip) {
  const type = net.isIP(ip);
  return type === 0 || blocked.check(ip, type === 4 ? 'ipv4' : 'ipv6');
}

function deny(host, why) {
  try { fs.appendFileSync(LOG, `${new Date().toISOString()} ${host} ${why}\n`); } catch {}
}

/** The address to connect to for an allowed host name, or null with the reason logged. */
export async function resolveAllowed(host, lookup = (h) => dns.lookup(h, { all: true })) {
  const name = String(host).toLowerCase().replace(/\.$/, '');
  if (net.isIP(name.replace(/^\[|\]$/g, ''))) { deny(name, 'ip-literal'); return null; }
  if (!ALLOW.has(name)) { deny(name, 'not-allowed'); return null; }
  let addrs;
  try { addrs = await lookup(name); } catch { deny(name, 'no-dns'); return null; }
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) { deny(name, 'private-address'); return null; }
  return addrs[0].address;
}

function parseTarget(target) {
  const m = /^(\[[^\]]+\]|[^:]+):(\d+)$/.exec(target || '');
  return m ? { host: m[1], port: Number(m[2]) } : null;
}

const server = http.createServer((req, res) => {
  res.writeHead(403, { 'content-type': 'text/plain' });
  res.end('only CONNECT is proxied\n');
});

server.on('clientError', (_e, socket) => socket.destroy());

server.on('connect', async (req, client, head) => {
  let upstream = null;
  client.on('error', () => upstream?.destroy());
  const t = parseTarget(req.url);
  const addr = t && t.port === 443 ? await resolveAllowed(t.host) : null;
  if (!addr) {
    if (t && t.port !== 443) deny(t.host, 'port');
    client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  if (client.destroyed) return;
  upstream = net.connect(t.port, addr, () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on('error', () => client.destroy());
});

if (process.env.TROOP_PROXY === '1') server.listen(PORT, '0.0.0.0');
