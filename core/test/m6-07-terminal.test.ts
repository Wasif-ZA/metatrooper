import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect, type Server, type Socket } from 'node:net';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGenerated, isolation, pipePath, sleep, until } from './helpers.ts';

type TerminalModule = typeof import('../src/terminal/index.ts');
type TermPipeModule = typeof import('../src/terminal/pipe.ts');
interface Msg { op: string; seq?: number; data?: string; code?: string | number }

const home = isolation();
const prior = { ...process.env };
let term: TerminalModule;
let termPipe: TermPipeModule;

before(async () => {
  await buildGenerated();
  Object.assign(process.env, home.env);
  mkdirSync(home.home, { recursive: true });
  writeFileSync(join(home.home, 'settings.json'), JSON.stringify({ terminal: { scrollback: 2000, chunk_bytes: 4096 } }));
  term = await import('../src/terminal/index.ts');
  termPipe = await import('../src/terminal/pipe.ts');
});

after(async () => {
  term?.killAll();
  await sleep(200);
  rmSync(home.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  for (const k of Object.keys(process.env)) if (!(k in prior)) delete process.env[k];
  Object.assign(process.env, prior);
});

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function rawClient(path: string) {
  const socket: Socket = connect(path);
  await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
  const messages: Msg[] = [];
  let buffer = '';
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      messages.push(JSON.parse(buffer.slice(0, nl)));
      buffer = buffer.slice(nl + 1);
    }
  });
  const send = (m: object) => socket.write(JSON.stringify(m) + '\n');
  return { socket, messages, send };
}

async function exited(id: string): Promise<void> {
  term.kill(id);
  await until(() => !term.has(id), 5000);
}

test('M6-07 credit: a viewer that never acks gets at most 64 KiB, then a fresh snapshot after it acks', async () => {
  const id = `credit-${randomUUID()}`;
  const path = pipePath(`credit-${randomUUID().replaceAll('-', '')}-term`);
  const flood = "setTimeout(()=>{for(let i=0;i<3000;i++)process.stdout.write(String(i).padStart(4,'0')+'-'+'x'.repeat(995)+'\\r\\n');setInterval(()=>{},1000)},800)";
  term.open(id, [process.execPath, '-e', flood], home.home, process.env, 1000, 24);
  const server = await termPipe.startTermServer(path, 'k');
  const c = await rawClient(path);
  try {
    c.send({ op: 'attach', session: id, cols: 1000, rows: 24, ui_key: 'k' });
    await until(() => c.messages.some((m) => m.op === 'snapshot'), 5000);
    await until(async () => ((await term.snapshot(id)) ?? '').includes('2999-'), 30_000);
    await sleep(300);
    const sent = c.messages.reduce((n, m) => n + (m.data?.length ?? 0), 0);
    assert.ok(sent < termPipe.CREDIT_BYTES + 4096, `sent ${sent} characters without an ack`);
    const before = c.messages.filter((m) => m.op === 'snapshot').length;
    c.send({ op: 'ack', bytes: sent });
    await until(() => c.messages.filter((m) => m.op === 'snapshot').length > before, 5000);
    const fresh = c.messages.filter((m) => m.op === 'snapshot').at(-1)!;
    assert.match(fresh.data ?? '', /2999-/);
  } finally {
    c.socket.destroy();
    await exited(id);
    await closeServer(server);
  }
});

test('M6-07 credit: an acking viewer receives every line in order with no gap', async () => {
  const id = `acked-${randomUUID()}`;
  const path = pipePath(`acked-${randomUUID().replaceAll('-', '')}-term`);
  const flood = "setTimeout(()=>{for(let i=0;i<2000;i++)process.stdout.write('L'+String(i).padStart(4,'0')+'.'+'y'.repeat(200)+'\\r\\n');setInterval(()=>{},1000)},800)";
  term.open(id, [process.execPath, '-e', flood], home.home, process.env, 300, 24);
  const server = await termPipe.startTermServer(path, 'k');
  const c = await rawClient(path);
  let acked = 0;
  const timer = setInterval(() => {
    const total = c.messages.reduce((n, m) => n + (m.data?.length ?? 0), 0);
    if (total > acked) { c.send({ op: 'ack', bytes: total - acked }); acked = total; }
  }, 5);
  try {
    c.send({ op: 'attach', session: id, cols: 300, rows: 24, ui_key: 'k' });
    await until(() => c.messages.map((m) => m.data ?? '').join('').includes('L1999.'), 30_000);
    const text = c.messages.map((m) => m.data ?? '').join('');
    const seen = [...text.matchAll(/L(\d{4})\./g)].map((m) => Number(m[1]));
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i] === seen[i - 1] + 1, `line ${seen[i - 1]} followed by ${seen[i]}`);
    assert.equal(c.messages.filter((m) => m.op === 'snapshot').length, 1);
  } finally {
    clearInterval(timer);
    c.socket.destroy();
    await exited(id);
    await closeServer(server);
  }
});

test('M6-07b with no workbench attached, a cursor-position query gets its answer', async () => {
  const id = `dsr-${randomUUID()}`;
  const probe = "process.stdin.setRawMode(true);process.stdin.once('data',(d)=>{process.stdout.write('GOT['+JSON.stringify(d.toString()).slice(1,-1)+']\\r\\n');setTimeout(()=>process.exit(0),300)});process.stdout.write('\\x1b[6n')";
  term.open(id, [process.execPath, '-e', probe], home.home, process.env, 80, 24);
  try {
    await until(async () => /GOT\[\\u001b\[\d+;\d+R\]/.test((await term.snapshot(id)) ?? ''), 10_000);
  } finally {
    if (term.has(id)) await exited(id);
  }
});

test('M6-07a printing 50 MB keeps the core under 64 MB of growth', { timeout: 240_000 }, async () => {
  const id = `big-${randomUUID()}`;
  const line = 'z'.repeat(1023);
  const flood = `const l='${line}\\r\\n';let n=0;const go=()=>{while(n<51200){n++;if(!process.stdout.write(l))return process.stdout.once('drain',go)}process.stdout.write('DONE-PRINT\\r\\n');setInterval(()=>{},1000)};setTimeout(go,500)`;
  global.gc?.();
  const base = process.memoryUsage().rss;
  let peak = base;
  let sawPause = false;
  const sample = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); if (term.paused(id)) sawPause = true; }, 25);
  term.open(id, [process.execPath, '-e', flood], home.home, process.env, 200, 24);
  try {
    await until(async () => ((await term.lastLine(id, 40)) ?? '').includes('DONE-PRINT'), 220_000);
    const grew = (peak - base) / (1024 * 1024);
    assert.ok(grew < 64, `rss grew ${grew.toFixed(1)} MB (pty paused at some point: ${sawPause})`);
  } finally {
    clearInterval(sample);
    await exited(id);
  }
});
