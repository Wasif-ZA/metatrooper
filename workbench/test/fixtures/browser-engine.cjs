// Fake engine that acts as a session-bound browser client: reads a job file, drives its pane, writes results.
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = process.env.METATROOPER_HOME;
const log = (m) => { try { fs.appendFileSync(path.join(home || os.tmpdir(), 'browser-engine.log'), m + '\n'); } catch {} };
log(`start home=${home} prefix=${process.env.METATROOPER_PIPE_PREFIX} sid=${process.env.TROOP_SESSION_ID}`);
const own = path.join(home, `browser-job-${process.env.TROOP_SESSION_ID}.json`);
let jobFile = path.join(home, 'browser-job.json');
const name = `${process.env.METATROOPER_PIPE_PREFIX}-browser`;
const sock = process.platform === 'win32' ? path.win32.join('//./pipe/', name) : path.join(os.tmpdir(), name + '.sock');
const deadline = Date.now() + 60_000;
const attach = () => {
  const c = net.connect(sock);
  c.on('error', (e) => {
    log('sock error ' + e.message);
    if (Date.now() < deadline) setTimeout(attach, 500);
  });
  c.on('connect', () => onConnect(c));
};
let s;
let buf = '';
const waiting = new Map();
const onData = (c) => {
  buf += c;
  for (let i; (i = buf.indexOf('\n')) >= 0;) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line) continue;
    const m = JSON.parse(line);
    waiting.get(m.id)?.(m);
  }
};
let latestSnapshot = '';
const resolveRefs = (method, params) => {
  const resolved = JSON.parse(JSON.stringify(params));
  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value !== 'string' || !value.startsWith('@')) continue;
    const label = value.slice(1);
    const line = latestSnapshot.split(/\r?\n/).find((entry) => entry.includes(`"${label}"`));
    const matchedRef = line?.match(/\[ref=(e\d+)\]/)?.[1];
    if (matchedRef) resolved[key] = matchedRef;
  }
  return resolved;
};
let n = 0;
const call = (method, params = {}) => new Promise((resolve) => {
  const id = `r${++n}`;
  waiting.set(id, resolve);
  s.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});

const onConnect = async (c) => {
  s = c;
  s.setEncoding('utf8');
  s.on('data', onData);
  while (!fs.existsSync(own) && !fs.existsSync(jobFile)) await new Promise((r) => setTimeout(r, 100));
  const perSession = fs.existsSync(own);
  if (perSession) jobFile = own;
  await new Promise((r) => setTimeout(r, 200));
  const job = JSON.parse(fs.readFileSync(jobFile, 'utf8'));
  log('job read');
  const out = { steps: {} };
  const hello = await call('browser.hello', { session_id: process.env.TROOP_SESSION_ID, pid: process.pid });
  out.hello = hello;
  for (const [name, method, params] of job.steps) {
    const values = resolveRefs(method, params);
    const response = await call(method, JSON.parse(JSON.stringify(values).replaceAll('"__PID__"', String(process.pid))));
    out.steps[name] = response;
    if (method === 'browser.snapshot' && response.result?.text) latestSnapshot = response.result.text;
  }
  fs.writeFileSync(path.join(home, perSession ? `browser-out-${process.env.TROOP_SESSION_ID}.json` : 'browser-out.json'), JSON.stringify(out));
  setTimeout(() => process.exit(0), 100);
};
attach();
