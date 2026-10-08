import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import dns from 'node:dns/promises';

const ALLOW = new Set((process.env.ALLOW || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean));
const LOG = process.env.DENY_LOG || '/logs/egress-denied.log';
const PORT = Number(process.env.PORT || 3128);

export function isPrivate(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
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

server.on('connect', async (req, client, head) => {
  const t = parseTarget(req.url);
  const addr = t && t.port === 443 ? await resolveAllowed(t.host) : null;
  if (!addr) {
    if (t && t.port !== 443) deny(t.host, 'port');
    client.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const upstream = net.connect(t.port, addr, () => {
    client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.on('error', () => client.destroy());
  client.on('error', () => upstream.destroy());
});

if (process.env.TROOP_PROXY === '1') server.listen(PORT, '0.0.0.0');
