// The scripted agent (M6-16): drives the demo workbench through metatrooper-desktop the way a real agent would and
// prints one JSON line per step; it exits 0 only if every step held. DEMO_AGENT_LOG, when set, gets the same lines.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GRANT_WAIT_MS = Number(process.env.DEMO_AGENT_GRANT_WAIT_MS || 120_000);

const mcp = spawn(process.execPath, [path.join(repo, 'core', 'metatrooper-desktop.js')], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
const waiting = new Map();
let n = 0;
readline.createInterface({ input: mcp.stdout }).on('line', (l) => { try { const m = JSON.parse(l); waiting.get(m.id)?.(m); waiting.delete(m.id); } catch {} });
/** One tool call; resolves to its text (or `image` for a screenshot) and throws its error text. */
function tool(name, args = {}) {
  return new Promise((resolve, reject) => {
    const id = ++n;
    waiting.set(id, (m) => {
      const r = m.result ?? {};
      const c = (r.content ?? [])[0] ?? {};
      if (m.error || r.isError) reject(new Error(m.error?.message ?? c.text ?? 'tool failed'));
      else resolve(c.type === 'image' ? { image: c.data } : c.text ?? '');
    });
    mcp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }) + '\n');
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = (line) => {
  const text = JSON.stringify(line);
  console.log(text);
  if (process.env.DEMO_AGENT_LOG) fs.appendFileSync(process.env.DEMO_AGENT_LOG, text + '\n');
};

/** Snapshot lines as {depth, role, name, ref}. */
function parse(text) {
  return text.split('\n').filter(Boolean).map((l) => {
    const m = /^( *)(\S+)(?: "((?:[^"]|"(?! \[| #| value=| password))*)")?.*\[ref=(e\d+)\]$/.exec(l);
    return m ? { depth: m[1].length / 2, role: m[2], name: m[3] ?? '', ref: m[4] } : null;
  }).filter(Boolean);
}

/** The nodes below nodes[i], in order. */
function below(nodes, i) {
  const out = [];
  for (let k = i + 1; k < nodes.length && nodes[k].depth > nodes[i].depth; k++) out.push(nodes[k]);
  return out;
}

let ok = true;
async function step(n, name, fn) {
  try {
    const detail = await fn();
    report({ step: n, name, ok: true, ...detail });
  } catch (e) {
    ok = false;
    report({ step: n, name, ok: false, error: e.message });
  }
}

let win = null;
await step(1, 'windows', async () => {
  const end = Date.now() + GRANT_WAIT_MS;
  let list = [];
  for (;;) {
    try { list = JSON.parse(await tool('windows')).windows; } catch (e) { if (Date.now() >= end) throw e; }
    if (list.length || Date.now() >= end) break;
    await sleep(500);
  }
  if (list.length !== 1) throw new Error(`expected exactly one window, got ${list.length}`);
  win = list[0].window;
  return { windows: list };
});

await step(2, 'click preview tile', async () => {
  const text = await tool('snapshot', { window: win });
  const nodes = parse(text);
  const i = nodes.findIndex((x) => x.name.startsWith('preview, '));
  if (i < 0) throw new Error('no tile named "preview, ..." in the snapshot');
  let clicked = nodes[i];
  try {
    await tool('click', { window: win, ref: clicked.ref });
  } catch (e) {
    // a group with no click action: click a button inside the tile instead
    if (!/no click action/.test(e.message)) throw e;
    clicked = below(nodes, i).find((x) => x.role === 'button' && x.name.startsWith('Open preview'));
    if (!clicked) throw e;
    await tool('click', { window: win, ref: clicked.ref });
  }
  const shot = await tool('screenshot', { window: win });
  return { clicked: { role: clicked.role, name: clicked.name }, nodes: nodes.length, groups: nodes.filter((x) => x.role === 'group').map((x) => x.name), screenshot: { window: win, bytes: (shot.image ?? '').length }, text };
});

await step(3, 'find Open preview', async () => {
  const found = JSON.parse(await tool('wait_for', { window: win, text: 'Open preview', timeout_ms: 30_000 })).found;
  if (!found) throw new Error('"Open preview" did not appear');
  return { found };
});

await step(4, 'approve the asker card', async () => {
  let last = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    last = await tool('snapshot', { window: win });
    const nodes = parse(last);
    for (let i = 0; i < nodes.length; i++) {
      if (!nodes[i].name.startsWith('Approval: ')) continue;
      const inside = below(nodes, i);
      if (!inside.some((x) => x.name.includes('asker'))) continue;
      const button = inside.find((x) => x.role === 'button' && x.name === 'Approve once');
      if (!button) continue;
      const result = await tool('click', { window: win, ref: button.ref });
      return { card: nodes[i].name, clicked: button.name, result, text: last };
    }
    // the card sits in the folded approval sheet: open it from its tab, then look again
    const tab = nodes.find((x) => /agent actions? waits? for you/.test(x.name));
    if (tab) await tool('click', { window: win, ref: tab.ref }).catch(() => {});
    await sleep(1000);
  }
  throw new Error('no "Approve once" on an approval card for asker');
});

const code = ok ? 0 : 1;
report({ exit: code });
mcp.kill();
process.exit(code);
