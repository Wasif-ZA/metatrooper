#!/usr/bin/env node
// Replays the context the codex-review step is offered for one fixture diff and prints its size.
// Usage: node tests/replay/token-replay.mjs --diff <small|medium|large> --mode <before|after>
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const fixture = join(root, 'tests', 'fixtures', 'token-replay');

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function git(cwd, ...args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}

export function renderPrompt(hint = '') {
  const pipe = JSON.parse(readFileSync(join(root, 'pipelines', 'two-engine-review.json'), 'utf8'));
  const step = pipe.steps.find((s) => s.id === 'codex-review');
  return step.prompt
    .replaceAll('{{steps.diff.outputs.diff_file}}', 'RUN/review.diff')
    .replaceAll('{{inputs.range}}', 'HEAD')
    .replaceAll('{{steps.map.outputs.hint}}', hint);
}

export function touchedFiles(diff) {
  return [...diff.matchAll(/^diff --git a\/(\S+) b\/(\S+)$/gm)].map((m) => m[2]);
}

/** Newline-delimited JSON-RPC client on a child's stdio. */
function mcp(child) {
  let buf = '';
  let seq = 0;
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const p = pending.get(msg.id);
      if (!p) continue;
      pending.delete(msg.id);
      msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
    }
  });
  const send = (method, params) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  return { send, notify };
}

async function reviewContext(repo, files) {
  execFileSync('code-review-graph', ['build'], { cwd: repo, stdio: 'ignore', windowsHide: true });
  const child = spawn('code-review-graph', ['serve', '--repo', repo], { cwd: repo, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
  try {
    const rpc = mcp(child);
    await rpc.send('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'token-replay', version: '1' } });
    rpc.notify('notifications/initialized', {});
    const { tools } = await rpc.send('tools/list', {});
    const tool = tools.find((t) => t.name === 'get_review_context_tool');
    if (!tool) throw new Error('code-review-graph has no get_review_context_tool');
    const extra = (tool.inputSchema?.required ?? []).filter((k) => k !== 'files');
    if (extra.length) throw new Error(`get_review_context_tool also requires ${extra.join(', ')}`);
    const result = await rpc.send('tools/call', { name: tool.name, arguments: { files } });
    return (result.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  } finally {
    child.kill();
  }
}

export async function replay(diffName, mode) {
  const tmp = mkdtempSync(join(tmpdir(), 'token-replay-'));
  try {
    const repo = join(tmp, 'repo');
    cpSync(join(fixture, 'repo'), repo, { recursive: true });
    git(repo, 'init', '-q');
    git(repo, 'config', 'core.autocrlf', 'false');
    git(repo, 'add', '-A');
    git(repo, '-c', 'user.email=replay@metatrooper', '-c', 'user.name=replay', 'commit', '-qm', 'fixture');
    git(repo, 'apply', '--whitespace=nowarn', join(fixture, `${diffName}.patch`));
    const diff = git(repo, 'diff', 'HEAD');
    writeFileSync(join(tmp, 'review.diff'), diff);
    const files = touchedFiles(diff);
    let context;
    if (mode === 'before') {
      context = files.map((f) => readFileSync(join(repo, f), 'utf8')).join('\n');
    } else {
      context = await reviewContext(repo, files);
    }
    const offered = [renderPrompt(), diff, context].join('\n');
    const bytes = Buffer.byteLength(offered, 'utf8');
    return { diff: diffName, mode, bytes, tokens: Math.ceil(bytes / 4) };
  } finally {
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const diffName = arg('diff');
  const mode = arg('mode');
  if (!['small', 'medium', 'large'].includes(diffName) || !['before', 'after'].includes(mode)) {
    console.error('usage: node tests/replay/token-replay.mjs --diff <small|medium|large> --mode <before|after>');
    process.exit(2);
  }
  console.log(JSON.stringify(await replay(diffName, mode)));
}
