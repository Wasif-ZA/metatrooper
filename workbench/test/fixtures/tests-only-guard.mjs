// Opt-in preload for tests-only runs: no Electron or generated/source writes.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import cp from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
const children = new Set();
const workspace = path.resolve(fileURLToPath(new URL('../../../', import.meta.url))).toLowerCase();
const norm = p => path.resolve(p instanceof URL ? fileURLToPath(p) : String(p)).toLowerCase();
const allowed = p => {
  if (typeof p === 'number') return;
  const n = norm(p);
  if ((n === workspace || n.startsWith(workspace + path.sep)) && !['workbench', 'core'].some(d => n.startsWith(path.join(workspace, d, 'test') + path.sep))) {
    throw new Error('TESTS_ONLY: refusing write outside test directories: ' + p);
  }
};
const exists = fs.existsSync;
fs.existsSync = p => /[\\/]electron[\\/]dist[\\/](electron|electron\.exe)$/i.test(String(p)) ? false : exists(p);
for (const name of ['writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'unlink', 'truncate', 'chmod', 'chown', 'utimes']) {
  for (const [object, key] of [[fs, name + 'Sync'], [fs, name], [fsp, name]]) {
    const fn = object[key]; if (fn) object[key] = function(p, ...args) { allowed(p); return fn.call(this, p, ...args); };
  }
}
for (const object of [fs, fsp]) for (const suffix of object === fs ? ['', 'Sync'] : ['']) {
  for (const name of ['rename', 'copyFile', 'link', 'symlink']) {
    const key = name + suffix; const fn = object[key]; if (fn) object[key] = function(a, b, ...args) { if (name === 'rename') allowed(a); allowed(b); return fn.call(this, a, b, ...args); };
  }
  const key = 'open' + suffix; const fn = object[key]; if (fn) object[key] = function(p, flags, ...args) { if (typeof flags === 'number' ? (flags & 3) !== 0 : /[wa+]/.test(flags)) allowed(p); return fn.call(this, p, flags, ...args); };
}
const stream = fs.createWriteStream; fs.createWriteStream = function(p, ...args) { allowed(p); return stream.call(this, p, ...args); };
for (const key of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync']) {
  const fn = cp[key]; cp[key] = function(command, args, ...rest) {
    const all = [String(command), ...(Array.isArray(args) ? args.map(String) : [])];
    if (all.some(v => /(?:^|[\\/])electron(?:\.exe)?$/i.test(v)) || all.some(v => /(?:^|[\\/])build\.ts$/.test(v)) || /^(npm|npx)(\.cmd)?$/i.test(path.basename(String(command)))) {
      throw new Error('TESTS_ONLY: refusing Electron or build command: ' + all.join(' '));
    }
    const child = fn.call(this, command, args, ...rest);
    if (child && typeof child.kill === 'function') { children.add(child); child.once('exit', () => children.delete(child)); }
    return child;
  };
  if (fn[promisify.custom]) cp[key][promisify.custom] = (...args) => {
    let child;
    const promise = new Promise((resolve, reject) => {
      child = cp[key](...args, (error, stdout, stderr) => { if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); } else resolve({ stdout, stderr }); });
    });
    promise.child = child;
    return promise;
  };
}
if (/\.test\.ts$/.test(process.argv[1] || '')) {
  const { after } = await import('node:test');
  after(() => {
  for (const child of children) { try { child.kill(); } catch {} }
  // Bound leaked fixture handles after all assertions and per-test teardown have finished.
  setTimeout(() => { console.error('TESTS_ONLY: worker still has open fixture handles after teardown'); process.exit(1); }, 15000).unref();
  });
}
syncBuiltinESMExports();
