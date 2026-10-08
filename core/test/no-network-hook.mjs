// Loaded with --import: appends every TCP connect and DNS lookup to a non-loopback host to TROOP_NO_NET_LOG.
import dns from 'node:dns';
import fs from 'node:fs';
import net from 'node:net';

const log = process.env.TROOP_NO_NET_LOG;
if (log) {
  const loopback = (host) => !host || host === 'localhost' || /^127\./.test(host) || ['::1', '[::1]', '::ffff:127.0.0.1'].includes(host);
  const note = (what, host) => { if (!loopback(String(host))) fs.appendFileSync(log, `${process.pid} ${what} ${host}\n`); };

  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    const first = Array.isArray(args[0]) ? args[0][0] : args[0];
    if (first && typeof first === 'object') { if (!first.path) note('tcp', first.host ?? 'localhost'); }
    else if (typeof first === 'number' || /^\d+$/.test(String(first))) note('tcp', typeof args[1] === 'string' ? args[1] : 'localhost');
    return connect.apply(this, args);
  };

  const lookup = dns.lookup;
  dns.lookup = function (host, ...rest) { note('dns', host); return lookup.call(this, host, ...rest); };
  const plookup = dns.promises.lookup;
  dns.promises.lookup = function (host, ...rest) { note('dns', host); return plookup.call(this, host, ...rest); };
}
