import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

const file = process.env.METATROOPER_NETWORK_LOG;
if (!file) throw new Error('METATROOPER_NETWORK_LOG is required');

function record(api, host, port, destination = host) {
  host = String(host).replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  const loopback = host === 'localhost' || host === '::1'
    || (net.isIPv4(host) && host.startsWith('127.'))
    || (host.startsWith('::ffff:') && net.isIPv4(host.slice(7)) && host.slice(7).startsWith('127.'));
  const stack = new Error().stack.split('\n').slice(1).filter(line => !line.includes(import.meta.url) && !line.includes('zero-outbound-preload.mjs')).join('\n');
  appendFileSync(file, JSON.stringify({ api, destination: String(destination) + (port ? `:${port}` : ''), loopback, stack }) + '\n');
}

function socketDestination(args) {
  if (Array.isArray(args[0])) return socketDestination(args[0]);
  const first = args[0];
  if (first && typeof first === 'object') {
    if (first.path !== undefined || first.socket) return null;
    return [first.host ?? first.hostname ?? 'localhost', first.port];
  }
  // String pipe and Unix socket arguments have no TCP port.
  if (typeof first === 'string' && !/^\d+$/.test(first)) return null;
  return [typeof args[1] === 'string' ? args[1] : 'localhost', first];
}

function wrap(target, name, destination) {
  const original = target[name];
  target[name] = function (...args) {
    const address = destination.call(this, args);
    if (address) record(name, ...address);
    return Reflect.apply(original, this, args);
  };
}

wrap(net.Socket.prototype, 'connect', socketDestination);
wrap(net, 'connect', socketDestination);
wrap(net, 'createConnection', socketDestination);
wrap(tls, 'connect', socketDestination);

wrap(dgram.Socket.prototype, 'connect', args => [args[1] ?? '127.0.0.1', args[0]]);
wrap(dgram.Socket.prototype, 'send', function (args) {
  try { const remote = this.remoteAddress(); return [remote.address, remote.port]; } catch {}
  const rest = args.slice(1).filter(value => typeof value !== 'function');
  const long = typeof rest[1] === 'number';
  return [rest[long ? 3 : 1] ?? '127.0.0.1', rest[long ? 2 : 0]];
});

for (const target of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
  for (const name of Object.getOwnPropertyNames(target)) {
    if (/^(lookup|lookupService|resolve.*|reverse)$/.test(name) && typeof target[name] === 'function') {
      wrap(target, name, args => [args[0]]);
    }
  }
}

function httpDestination(args) {
  const first = args[0];
  const url = typeof first === 'string' || first instanceof URL ? new URL(first) : null;
  const options = url ? (typeof args[1] === 'object' ? args[1] : {}) : first;
  if (options?.socketPath) return null;
  const host = options?.hostname ?? options?.host ?? url?.hostname ?? 'localhost';
  return [host, options?.port ?? url?.port, url?.href ?? host];
}

for (const target of [http, https]) {
  wrap(target, 'request', httpDestination);
  wrap(target, 'get', httpDestination);
}
wrap(globalThis, 'fetch', args => {
  const url = new URL(typeof args[0] === 'object' && !(args[0] instanceof URL) ? args[0].url : args[0]);
  return [url.hostname, undefined, url.href];
});

syncBuiltinESMExports();
appendFileSync(`${file}.ready`, `${process.pid}\n`);
