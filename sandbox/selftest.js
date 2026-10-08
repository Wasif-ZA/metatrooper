import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { execFileSync } from 'node:child_process';

const env = process.env;
const results = [];
const check = async (name, expect, fn) => {
  let happened = false;
  let detail = '';
  try { happened = await fn(); } catch (e) { detail = String(e?.code || e?.message || e).slice(0, 120); }
  results.push({ name, expect, ok: expect === 'blocked' ? !happened : happened, detail });
};
const write = (p) => { fs.writeFileSync(p, 'selftest\n'); return true; };
const connectVia = (host) => new Promise((resolve) => {
  const req = http.request({ host: 'troop-proxy', port: 3128, method: 'CONNECT', path: `${host}:443`, timeout: 8000 });
  req.on('connect', (res) => { res.socket.destroy(); resolve(res.statusCode === 200); });
  req.on('error', () => resolve(false));
  req.on('timeout', () => { req.destroy(); resolve(false); });
  req.end();
});
const direct = (host, port) => new Promise((resolve) => {
  const s = net.connect(port, host);
  s.setTimeout(4000);
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
  s.on('timeout', () => { s.destroy(); resolve(false); });
});

const wt = env.GIT_WORK_TREE;
const common = env.SELFTEST_COMMON;

await check('write a host path outside the mounts', 'blocked', () => write(`${env.SELFTEST_HOME}/troop-selftest.txt`));
await check('write the image filesystem', 'blocked', () => write('/opt/troop/selftest.txt'));
await check('write .git/hooks', 'blocked', () => write(`${common}/hooks/post-commit`));
await check('write .git/config', 'blocked', () => { fs.appendFileSync(`${common}/config`, '\n'); return true; });
await check('write the worktree .git pointer', 'blocked', () => write(`${wt}/.git`));
await check('read the host home folder', 'blocked', () => fs.existsSync(`${env.SELFTEST_HOME}/.troop-selftest-probe`));
await check('write a read-only login file', 'blocked', () => { fs.appendFileSync(`${env.HOME}/${env.SELFTEST_LOGIN}`, ''); return true; });
await check('HTTPS to a host not on the allow-list', 'blocked', () => connectVia('example.com'));
await check('a request that bypasses the proxy', 'blocked', () => direct('1.1.1.1', 443));
await check('reach the Docker socket', 'blocked', () => fs.existsSync('/var/run/docker.sock') || direct('host.docker.internal', 2375));
await check('gain root', 'blocked', () => {
  if (process.getuid() === 0) return true;
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  if (!/^NoNewPrivs:\s*1$/m.test(status) || !/^CapEff:\s*0+$/m.test(status)) return true;
  try { execFileSync('su', ['-c', 'id -u'], { stdio: 'pipe', timeout: 5000, input: '\n' }); return true; } catch { return false; }
});
await check('write in the worktree', 'allowed', () => write(`${wt}/troop-selftest.txt`));
await check('git commit on the worktree branch', 'allowed', () => {
  execFileSync('git', ['add', 'troop-selftest.txt'], { cwd: wt, stdio: 'pipe' });
  execFileSync('git', ['-c', 'user.email=selftest@troop', '-c', 'user.name=selftest', 'commit', '-qm', 'selftest'], { cwd: wt, stdio: 'pipe' });
  return true;
});
await check('HTTPS to an allow-listed host', 'allowed', () => connectVia(env.SELFTEST_ALLOWED));

console.log(JSON.stringify(results));
process.exit(results.every((r) => r.ok) ? 0 : 1);
