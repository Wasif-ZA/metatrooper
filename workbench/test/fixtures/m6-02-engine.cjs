// Engine fixture that spawns metatrooper-browser and drives it via step files
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const home = process.env.METATROOPER_HOME || os.tmpdir();
const logFile = path.join(home, 'm602-engine.log');
const log = (m) => {
  try { fs.appendFileSync(logFile, m + '\n'); } catch {}
  try { process.stderr.write(`[m602-engine] ${m}\n`); } catch {}
};

log(`start pid=${process.pid} home=${home} prefix=${process.env.METATROOPER_PIPE_PREFIX} sid=${process.env.TROOP_SESSION_ID}`);

const root = path.resolve(__dirname, '../../..');
const candidates = [
  path.join(root, 'core/metatrooper-browser.js'),
  path.join(root, 'core/dist/hook/browser-mcp.js'),
  path.join(root, 'core/dist/metatrooper-browser.js'),
];
const mcpScript = candidates.find((f) => fs.existsSync(f));

if (!mcpScript) {
  log(`fatal: cannot find MCP script in ${candidates.join(', ')}`);
  process.exit(1);
}

log(`mcp script: ${mcpScript}`);

const mcp = spawn(process.execPath, [mcpScript], {
  cwd: root,
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
});

mcp.stderr?.setEncoding('utf8');
mcp.stderr?.on('data', (d) => {
  log(`mcp stderr: ${d}`);
  try { fs.appendFileSync(path.join(home, 'mcp-stderr.log'), d); } catch {}
});

mcp.on('error', (err) => {
  log(`mcp error: ${err.message}`);
});

mcp.on('exit', (code, sig) => {
  log(`mcp exit code=${code} sig=${sig}`);
});

let buf = '';
const pending = new Map();

mcp.stdout.setEncoding('utf8');
mcp.stdout.on('data', (chunk) => {
  buf += chunk;
  for (let i; (i = buf.indexOf('\n')) >= 0;) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    log(`mcp stdout line: ${line.slice(0, 200)}`);
    try {
      const msg = JSON.parse(line);
      if (msg.id !== undefined && pending.has(msg.id)) {
        const waiter = pending.get(msg.id);
        pending.delete(msg.id);
        waiter(msg);
      }
    } catch (e) {
      log(`mcp parse error: ${e.message}`);
    }
  }
});

function callMcp(id, method, params = {}) {
  return new Promise((resolve) => {
    pending.set(id, resolve);
    const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    log(`mcp send: ${msg.trim()}`);
    mcp.stdin.write(msg);
  });
}

async function main() {
  log('calling initialize');
  const initRes = await callMcp('init', 'initialize', {});
  log(`initialize answered: ${JSON.stringify(initRes)}`);
  fs.writeFileSync(path.join(home, 'm602-ready.json'), JSON.stringify(initRes));

  let step = 1;
  while (true) {
    const stepFile = path.join(home, `m602-step-${step}.json`);
    const outFile = path.join(home, `m602-out-${step}.json`);

    // Poll for next step file from test runner
    while (!fs.existsSync(stepFile)) {
      await new Promise((r) => setTimeout(r, 20));
    }

    const content = JSON.parse(fs.readFileSync(stepFile, 'utf8'));
    if (content.done) {
      log('done received, exiting');
      try { mcp.kill(); } catch {}
      process.exit(0);
    }

    const method = content.method || 'tools/call';
    const params = content.params || { name: content.name, arguments: content.arguments };
    log(`running step ${step}: ${method}`);
    const reply = await callMcp(step, method, params);
    log(`step ${step} finished: ${JSON.stringify(reply).slice(0, 200)}`);
    fs.writeFileSync(outFile, JSON.stringify(reply));
    step++;
  }
}

main().catch((err) => {
  log(`engine main error: ${err.message}`);
  process.exit(1);
});
