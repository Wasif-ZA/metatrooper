// Fake session engine for the M7-1 Electron tests. It is a session-bound browser client: it connects to the
// workbench's browser pipe and runs numbered job files in order. Job k is <home>/m701-job-<session>-<k>.json,
// {steps: [[name, method, params]]}; its results go to <home>/m701-out-<session>-<k>.json, {hello?, steps: {name: {reply, ms, at}}}.
// method "browser.*" is a pipe call. method "mcp.call" sends {name, arguments} to the session's browser MCP shim
// (core/src/hook/browser-mcp.ts) over stdio, so batch runs the way an agent's call runs it.
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const home = process.env.METATROOPER_HOME;
const sid = process.env.TROOP_SESSION_ID;
// The test writes this file into the isolation home and replaces the shim placeholder on the next line with the
// repo's browser-mcp.ts path, since __dirname is the copy's folder, not this fixture's.
const shim = __SHIM_PATH__;
const jobFile = (k) => path.join(home, `m701-job-${sid}-${k}.json`);
const outFile = (k) => path.join(home, `m701-out-${sid}-${k}.json`);
const name = `${process.env.METATROOPER_PIPE_PREFIX}-browser`;
const sock = process.platform === 'win32' ? path.win32.join('//./pipe/', name) : path.join(os.tmpdir(), name + '.sock');
const deadline = Date.now() + 150_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (e) => {
  try { fs.writeFileSync(path.join(home, `m701-error-${sid}.txt`), String(e && e.stack ? e.stack : e)); } catch {}
  process.exit(1);
};

// Pipe client: newline-delimited JSON-RPC, replies matched by id.
let pipe = null;
let buf = '';
let seq = 0;
const waiting = new Map();
const connect = () => new Promise((resolve, reject) => {
  const c = net.connect(sock);
  c.setEncoding('utf8');
  c.once('error', reject);
  c.on('data', (chunk) => {
    buf += chunk;
    let i = buf.indexOf('\n');
    while (i >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line) {
        const m = JSON.parse(line);
        const done = waiting.get(m.id);
        if (done) done(m);
      }
      i = buf.indexOf('\n');
    }
  });
  c.once('connect', () => resolve(c));
});
const call = (method, params = {}) => new Promise((resolve) => {
  const id = `r${++seq}`;
  waiting.set(id, (m) => { waiting.delete(id); resolve(m); });
  pipe.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
});

// MCP shim: one fresh shim per mcp.call, a child of this engine. Its stdin stays open until the reply for
// this call's id has arrived, and only then is it ended (mcp-stdio exits on stdin end). Its stderr goes to
// <home>/m701-mcp-stderr-<session>-<call>.log so a silent shim can be diagnosed.
let mcpSeq = 0;
const mcpCall = (toolName, args) => new Promise((resolve, reject) => {
  const n = ++mcpSeq;
  const errLog = fs.openSync(path.join(home, `m701-mcp-stderr-${sid}-${n}.log`), 'w');
  const mcp = spawn(process.execPath, [shim], { env: process.env, stdio: ['pipe', 'pipe', errLog] });
  const id = 1;
  let buf = '';
  mcp.stdout.setEncoding('utf8');
  mcp.stdout.on('data', (chunk) => {
    buf += chunk;
    let i = buf.indexOf('\n');
    while (i >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line) {
        const m = JSON.parse(line);
        if (m.id === id) {
          mcp.stdin.end();
          resolve(m);
          return;
        }
      }
      i = buf.indexOf('\n');
    }
  });
  mcp.on('exit', (code) => reject(new Error(`mcp shim exited ${code} before replying to ${toolName}`)));
  mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: toolName, arguments: args } }) + '\n');
});

const run = async () => {
  for (;;) {
    try { pipe = await connect(); break; } catch (e) {
      if (Date.now() > deadline) throw e;
      await sleep(300);
    }
  }
  const hello = await call('browser.hello', { session_id: sid, pid: process.pid });
  for (let k = 1; ; k++) {
    while (!fs.existsSync(jobFile(k))) {
      if (Date.now() > deadline) process.exit(0);
      await sleep(50);
    }
    const job = JSON.parse(fs.readFileSync(jobFile(k), 'utf8'));
    const out = { hello: k === 1 ? hello : undefined, steps: {} };
    for (const [step, method, params] of job.steps) {
      const started = Date.now();
      const reply = method === 'mcp.call'
        ? await mcpCall(params.name, params.arguments || {})
        : await call(method, params);
      out.steps[step] = { reply, ms: Date.now() - started, at: Date.now() };
    }
    const tmp = outFile(k) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, outFile(k));
  }
};

run().catch(fail);
