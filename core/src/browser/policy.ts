import dns from 'node:dns';
import net from 'node:net';

const blocked4 = new net.BlockList();
for (const [addr, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['127.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16], ['100.64.0.0', 10]] as const) {
  blocked4.addSubnet(addr, bits, 'ipv4');
}
const blocked6 = new net.BlockList();
blocked6.addAddress('::', 'ipv6');
blocked6.addAddress('::1', 'ipv6');
blocked6.addSubnet('fc00::', 7, 'ipv6');
blocked6.addSubnet('fe80::', 10, 'ipv6');

export interface PolicyContext {
  /** Ports this pane's project owns (`browser_pane.dev_port`, `variant.dev_port`). */
  ownedPorts: Set<number>;
  /** Hosts the project's `.troop/config.json` allows in spite of the address rules. */
  allowHosts: Set<string>;
  /** Resolves a host to every address; defaults to `dns.lookup(host, {all: true})`. */
  lookup?: (host: string) => Promise<string[]>;
}

export type Verdict = { allow: true } | { allow: false; reason: string };

const PASS_SCHEMES = new Set(['data:', 'blob:', 'about:']);

function mappedV4(addr: string): string | null {
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  if (dotted) return dotted[1];
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(addr);
  if (!hex) return null;
  const hi = parseInt(hex[1], 16);
  const lo = parseInt(hex[2], 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

function isLoopback(addr: string): boolean {
  const v4 = net.isIPv4(addr) ? addr : mappedV4(addr);
  if (v4) return v4.startsWith('127.');
  return addr === '::1';
}

/** True when the address is in one of the blocked ranges of browser-tools.md, safety rule 2. */
export function blockedAddress(addr: string): boolean {
  const v4 = net.isIPv4(addr) ? addr : mappedV4(addr);
  if (v4) return blocked4.check(v4, 'ipv4');
  if (net.isIPv6(addr)) return blocked6.check(addr, 'ipv6');
  return true;
}

async function defaultLookup(host: string): Promise<string[]> {
  const found = await dns.promises.lookup(host, { all: true, verbatim: true });
  return found.map((a) => a.address);
}

/** Re-decides a response by the address the browser actually connected to, so a host that re-resolves (DNS rebinding) is caught. */
export async function connectedVerdict(url: string, ip: string, ctx: PolicyContext): Promise<Verdict> {
  const v = await checkUrl(url, { ...ctx, lookup: async () => [ip.replace(/^\[|\]$/g, '')] });
  return v.allow ? v : { allow: false, reason: `connected to ${ip} after the check (DNS rebinding): ${v.reason}` };
}

/** Decides one request or navigation by browser-tools.md, safety rule 2, resolving the host first. */
export async function checkUrl(raw: string, ctx: PolicyContext): Promise<Verdict> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { allow: false, reason: 'not a valid URL' };
  }
  if (PASS_SCHEMES.has(url.protocol)) return url.protocol === 'about:' && url.href !== 'about:blank' ? { allow: false, reason: `${url.href} is blocked` } : { allow: true };
  const scheme = url.protocol === 'ws:' ? 'http:' : url.protocol === 'wss:' ? 'https:' : url.protocol;
  if (scheme !== 'http:' && scheme !== 'https:') return { allow: false, reason: `${url.protocol} URLs are blocked` };
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (ctx.allowHosts.has(host)) return { allow: true };
  const port = Number(url.port || (scheme === 'https:' ? 443 : 80));
  const literalLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
  let addrs: string[];
  if (net.isIP(host)) addrs = [host];
  else if (host === 'localhost') addrs = ['127.0.0.1', '::1'];
  else {
    try {
      addrs = await (ctx.lookup ?? defaultLookup)(host);
    } catch {
      return { allow: false, reason: `${host} did not resolve` };
    }
    if (!addrs.length) return { allow: false, reason: `${host} did not resolve` };
  }
  for (const a of addrs) {
    if (isLoopback(a)) {
      if (literalLoopback && scheme === 'http:' && ctx.ownedPorts.has(port)) continue;
      return { allow: false, reason: `${host}:${port} is a loopback address this project does not own` };
    }
    if (blockedAddress(a)) return { allow: false, reason: `${host} resolves to a private address (${a})` };
  }
  return { allow: true };
}

/** What the user typed in the URL box as a URL: kept when it has a scheme, http for loopback and IPs, https for a dotted host, otherwise a search. */
export function typedUrl(input: string): string {
  const t = input.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^(about|data):/i.test(t)) return t;
  if (t && !/\s/.test(t)) {
    const host = t.split(/[/?#]/)[0];
    if (/^(localhost|\[::1\]|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/i.test(host)) return `http://${t}`;
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?$/i.test(host)) return `https://${t}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(t)}`;
}
