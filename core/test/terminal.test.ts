import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { connect, type Socket } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  buildGenerated,
  client,
  isolation,
  pipePath,
  root,
  runNode,
  sleep,
  startCore,
  teardownCore,
  until,
} from './helpers.ts';

type TerminalModule = typeof import('../src/terminal/index.ts');
type TermPipeModule = typeof import('../src/terminal/pipe.ts');
type TermEventsModule = typeof import('../src/terminal/events.ts');

interface TermMessage {
  op: string;
  seq?: number;
  data?: string;
  code?: string | number;
}

const moduleHome = isolation();
const priorEnv = {
  METATROOPER_HOME: process.env.METATROOPER_HOME,
  METATROOPER_PIPE_PREFIX: process.env.METATROOPER_PIPE_PREFIX,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
};
let settingsStamp = Date.now();
let term: TerminalModule;
let termPipe: TermPipeModule;
let termEvents: TermEventsModule;

function writeTerminalSettings(terminal: Record<string, unknown>): void {
  mkdirSync(moduleHome.home, { recursive: true });
  const file = join(moduleHome.home, 'settings.json');
  writeFileSync(file, JSON.stringify({ terminal }));
  settingsStamp += 2000;
  const stamp = new Date(settingsStamp);
  utimesSync(file, stamp, stamp);
}

before(async () => {
  await buildGenerated();
  Object.assign(process.env, moduleHome.env);
  writeTerminalSettings({ scrollback: 4, chunk_bytes: 16, slow_viewer_bytes: 4 * 1024 * 1024, bell_silent_ms: 80 });
  term = await import('../src/terminal/index.ts');
  termPipe = await import('../src/terminal/pipe.ts');
  termEvents = await import('../src/terminal/events.ts');
});

after(async () => {
  term?.killAll();
  await sleep(100);
  rmSync(moduleHome.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function closeServer(server: import('node:net').Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

async function termClient(path: string) {
  const socket = connect(path);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const messages: TermMessage[] = [];
  let buffer = '';
  let closed = false;
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    for (let end; (end = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line) messages.push(JSON.parse(line));
    }
  });
  socket.on('close', () => { closed = true; });
  return {
    socket,
    messages,
    send(message: object) { socket.write(JSON.stringify(message) + '\n'); },
    waitFor(predicate: (message: TermMessage) => boolean, timeout = 3000) {
      return until(() => messages.find(predicate), timeout) as Promise<TermMessage>;
    },
    waitClosed(timeout = 3000) { return until(() => closed, timeout); },
    close() { socket.destroy(); },
  };
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test('1 node-pty loads, echoes PowerShell input, resizes, and reports the requested exit code', async () => {
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const script = String.raw`
    const pty = require('node-pty');
    let output = '', started = false;
    const child = pty.spawn('powershell.exe', ['-NoProfile'], { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.env.METATROOPER_HOME, env: process.env, useConpty: true });
    child.onData(data => {
      output += data;
      if (!started && output.includes('PS ')) {
        started = true;
        child.resize(97, 31);
        setTimeout(() => {
          child.write('$s=$Host.UI.RawUI.WindowSize; [Console]::WriteLine("SIZE=$($s.Width)x$($s.Height)")\r');
          child.write("$m='PTY_'+'ECHO_'+'OK'; [Console]::WriteLine($m)\r");
          child.write('exit 23\r');
        }, 100);
      }
    });
    child.onExit(event => {
      console.log(JSON.stringify({ loaded: typeof pty.spawn, output, exitCode: event.exitCode }));
      process.exit(0);
    });
    setTimeout(() => { console.error(output); process.exit(2); }, 5000);
  `;
  const probe = spawn(process.execPath, ['-e', script], { cwd: join(root, 'core'), env: cleanEnv, windowsHide: true });
  let stdout = '', stderr = '';
  probe.stdout.setEncoding('utf8');
  probe.stderr.setEncoding('utf8');
  probe.stdout.on('data', (chunk) => { stdout += chunk; });
  probe.stderr.on('data', (chunk) => { stderr += chunk; });
  const code = await new Promise<number | null>((resolve, reject) => {
    probe.once('error', reject);
    probe.once('exit', resolve);
  });
  assert.equal(code, 0, stderr || stdout);
  const result = JSON.parse(stdout.trim());
  assert.equal(result.loaded, 'function');
  assert.match(result.output, /SIZE=97x31/);
  assert.match(result.output, /PTY_ECHO_OK/);
  assert.equal(result.exitCode, 23);
});

test('2 terminal snapshots contain output and discard rows beyond the configured scrollback', async () => {
  writeTerminalSettings({ scrollback: 4, chunk_bytes: 16, slow_viewer_bytes: 4 * 1024 * 1024, bell_silent_ms: 80 });
  const id = `snapshot-${randomUUID()}`;
  const code = "for(let i=0;i<12;i++)process.stdout.write(`ROW-${String(i).padStart(3,'0')}\\r\\n`);setInterval(()=>{},1000)";
  term.open(id, [process.execPath, '-e', code], moduleHome.home, process.env, 80, 2);
  try {
    const snapshot = await until(async () => {
      const value = await term.snapshot(id);
      return value?.includes('ROW-011') ? value : null;
    });
    assert.match(snapshot, /ROW-011/);
    assert.doesNotMatch(snapshot, /ROW-000/);
    const retained = [...snapshot.matchAll(/ROW-(\d{3})/g)].map((match) => Number(match[1]));
    assert.ok(retained.length <= 6, `expected four scrollback rows plus two visible rows, got ${retained.join(', ')}`);
    assert.ok(retained.every((row) => row >= 6), `old rows were retained: ${retained.join(', ')}`);
  } finally {
    term.kill(id);
    await until(() => !term.has(id));
  }
});

test('3 attach snapshots a fast writer and streams only the missing suffix without a gap or repeat', async () => {
  writeTerminalSettings({ scrollback: 200, chunk_bytes: 16, slow_viewer_bytes: 4 * 1024 * 1024, bell_silent_ms: 80 });
  const id = `attach-${randomUUID()}`;
  const code = "let i=0;const t=setInterval(()=>{process.stdout.write(`STREAM-${String(i).padStart(3,'0')}\\r\\n`);if(++i===80){clearInterval(t);setInterval(()=>{},1000)}},3)";
  term.open(id, [process.execPath, '-e', code], moduleHome.home, process.env, 100, 10);
  await until(async () => (await term.snapshot(id))?.includes('STREAM-010'));

  let initial = '';
  const live: string[] = [];
  const viewer = {
    snapshot(data: string) { initial = data; },
    output(data: string) { live.push(data); },
    exit() {},
  };
  const attached = term.attach(id, viewer);
  assert.equal(attached, true);
  try {
    await until(() => (initial + live.join('')).includes('STREAM-079'), 5000);
    const seen = [...(initial + live.join('')).matchAll(/STREAM-(\d{3})/g)].map((match) => Number(match[1]));
    assert.deepEqual(seen, Array.from({ length: 80 }, (_, index) => index));
  } finally {
    term.detach(id, viewer);
    term.kill(id);
    await until(() => !term.has(id));
  }
});

test('4 terminal pipe enforces attach errors, fans out output, reattaches from a fresh snapshot, and increments seq', async () => {
  writeTerminalSettings({ scrollback: 200, chunk_bytes: 8, slow_viewer_bytes: 4 * 1024 * 1024, bell_silent_ms: 80 });
  const prefix = `term-${randomUUID().replaceAll('-', '')}`;
  const path = pipePath(`${prefix}-term`);
  const key = 'correct-ui-key';
  const id = `pipe-${randomUUID()}`;
  const echo = "process.stdin.setEncoding('utf8');process.stdin.on('data',d=>process.stdout.write(d));setInterval(()=>{},1000)";
  term.open(id, [process.execPath, '-e', echo], moduleHome.home, process.env, 100, 10);
  const server = await termPipe.startTermServer(path, key);
  const connections: Array<Awaited<ReturnType<typeof termClient>>> = [];
  try {
    const wrong = await termClient(path); connections.push(wrong);
    wrong.send({ op: 'attach', session: id, cols: 100, rows: 10, ui_key: 'wrong' });
    assert.equal((await wrong.waitFor((m) => m.code === 'needs-ui')).op, 'error');
    await wrong.waitClosed();

    const first = await termClient(path); connections.push(first);
    first.send({ op: 'input', data: 'too early' });
    assert.equal((await first.waitFor((m) => m.code === 'bad-op')).op, 'error');
    first.send({ op: 'attach', session: id, cols: 100, rows: 10, ui_key: key });
    await first.waitFor((m) => m.op === 'snapshot');

    const missing = await termClient(path); connections.push(missing);
    missing.send({ op: 'attach', session: 'missing-session', cols: 80, rows: 24, ui_key: key });
    assert.equal((await missing.waitFor((m) => m.code === 'no-session')).op, 'error');
    await missing.waitClosed();

    const second = await termClient(path); connections.push(second);
    second.send({ op: 'attach', session: id, cols: 100, rows: 10, ui_key: key });
    await second.waitFor((m) => m.op === 'snapshot');
    first.send({ op: 'input', data: 'FANOUT-MARKER-123456789\r' });
    for (const viewer of [first, second]) {
      await until(() => viewer.messages.filter((m) => m.op === 'output').map((m) => m.data).join('').includes('FANOUT-MARKER-123456789'));
      const sequenced = viewer.messages.filter((m) => m.seq !== undefined);
      assert.deepEqual(sequenced.map((m) => m.seq), sequenced.map((_, index) => index));
    }

    first.send({ op: 'detach' });
    await first.waitClosed();
    term.write(id, 'AFTER-DETACH\r');
    await until(() => second.messages.filter((m) => m.op === 'output').map((m) => m.data).join('').includes('AFTER-DETACH'));

    const reattached = await termClient(path); connections.push(reattached);
    reattached.send({ op: 'attach', session: id, cols: 100, rows: 10, ui_key: key });
    const fresh = await reattached.waitFor((m) => m.op === 'snapshot');
    assert.match(fresh.data ?? '', /AFTER-DETACH/);
  } finally {
    for (const connection of connections) connection.close();
    term.kill(id);
    await until(() => !term.has(id), 5000);
    await closeServer(server);
    if (process.platform !== 'win32') rmSync(path, { force: true });
  }
});

test('5 splitChunks respects its maximum without splitting a surrogate pair', () => {
  const input = `ab😀cd🧪ef${'z'.repeat(25)}`;
  const chunks = termPipe.splitChunks(input, 3);
  assert.equal(chunks.join(''), input);
  assert.ok(chunks.every((chunk) => chunk.length <= 3), JSON.stringify(chunks));
  for (const chunk of chunks) {
    const first = chunk.charCodeAt(0);
    const last = chunk.charCodeAt(chunk.length - 1);
    assert.ok(!(first >= 0xdc00 && first <= 0xdfff), `chunk begins with low surrogate: ${JSON.stringify(chunk)}`);
    assert.ok(!(last >= 0xd800 && last <= 0xdbff), `chunk ends with high surrogate: ${JSON.stringify(chunk)}`);
  }
});

test('6 a terminal viewer that does not read is dropped with slow-viewer at the configured limit', async () => {
  writeTerminalSettings({ scrollback: 8_000, chunk_bytes: 4096, slow_viewer_bytes: 1024, bell_silent_ms: 80 });
  const { settings } = await import('../src/settings.ts');
  assert.equal(settings().terminal.slow_viewer_bytes, 1024);
  const prefix = `slow-${randomUUID().replaceAll('-', '')}`;
  const path = pipePath(`${prefix}-term`);
  const key = 'slow-key';
  const id = `slow-${randomUUID()}`;
  const flood = "for(let i=0;i<7000;i++)process.stdout.write(`${String(i).padStart(4,'0')}-${'x'.repeat(980)}\\r\\n`);setInterval(()=>{},1000)";
  term.open(id, [process.execPath, '-e', flood], moduleHome.home, process.env, 1000, 24);
  const server = await termPipe.startTermServer(path, key);
  let socket: Socket | undefined;
  try {
    await until(async () => ((await term.snapshot(id))?.length ?? 0) > 5_000_000, 10_000);
    socket = connect(path);
    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', resolve);
      socket!.once('error', reject);
    });
    let closed = false;
    let received = '';
    socket.on('close', () => { closed = true; });
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      received += chunk;
      socket!.pause();
      setTimeout(() => socket?.resume(), 25);
    });
    socket.write(JSON.stringify({ op: 'attach', session: id, cols: 1000, rows: 24, ui_key: key }) + '\n');
    try {
      await until(() => received.includes('"code":"slow-viewer"'), 8000);
    } catch (cause) {
      throw new Error(`slow-viewer was not sent after the client received ${received.length} characters (closed=${closed})`, { cause });
    }
    assert.match(received, /"op":"error","code":"slow-viewer"/);
    await until(() => closed, 3000);
  } finally {
    socket?.destroy();
    term.kill(id);
    await until(() => !term.has(id), 5000);
    await closeServer(server);
    if (process.platform !== 'win32') rmSync(path, { force: true });
    writeTerminalSettings({ scrollback: 200, chunk_bytes: 16, slow_viewer_bytes: 4 * 1024 * 1024, bell_silent_ms: 80 });
  }
});

test('7 bells count only after non-terminal silence, then output returns waiting_for_you to working', async () => {
  writeTerminalSettings({ scrollback: 20, chunk_bytes: 16, slow_viewer_bytes: 4 * 1024 * 1024, bell_silent_ms: 500 });
  const { openCoreDb } = await import('../src/store/db.ts');
  const { processEvents } = await import('../src/events/processor.ts');
  const db = openCoreDb();
  const id = `bell-${randomUUID()}`;
  const at = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('bell-project', moduleHome.home, 'bell', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, 1, ?)').run('bell-engine', '{}', 'local-cli');
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'bell-project', 'bell-engine', 'pty', 'working', ?, ?)").run(id, at, at);
  termEvents.wireTermEvents(db);
  const code = "process.stdout.write('BELL-READY\\r\\n');setTimeout(()=>process.stdout.write('\\x07'),300);setTimeout(()=>process.stdout.write('\\x07'),900);setTimeout(()=>process.stdout.write('after-bell\\r\\n'),1400);setInterval(()=>{},1000)";
  term.open(id, [process.execPath, '-e', code], moduleHome.home, process.env);
  try {
    await until(async () => (await term.snapshot(id))?.includes('BELL-READY'));
    db.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.status-cleared', '{}', 1)").run(new Date().toISOString(), id);
    await until(() => db.prepare("SELECT count(*) AS n FROM event WHERE session_id = ? AND kind = 'term.bell'").get(id)?.n === 1, 2000);
    assert.equal(db.prepare("SELECT count(*) AS n FROM event WHERE session_id = ? AND kind = 'term.bell'").get(id).n, 1);
    processEvents(db);
    assert.equal(db.prepare('SELECT state FROM session WHERE id = ?').get(id).state, 'waiting_for_you');
    await until(() => db.prepare("SELECT count(*) AS n FROM event WHERE session_id = ? AND kind = 'term.output' AND processed = 0").get(id)?.n === 1, 2000);
    processEvents(db);
    const state = db.prepare('SELECT state FROM session WHERE id = ?').get(id).state;
    const rows = db.prepare("SELECT seq, kind, processed FROM event WHERE session_id = ? ORDER BY seq").all(id);
    assert.equal(state, 'working', JSON.stringify(rows));
  } finally {
    term.kill(id);
    await until(() => !term.has(id));
    db.close();
  }
});

test('H11 spinner frames in the terminal title (Claude glyphs, Codex braille) write one term.title per real title', async () => {
  const { openCoreDb } = await import('../src/store/db.ts');
  const db = openCoreDb();
  const id = `title-${randomUUID()}`;
  termEvents.wireTermEvents(db);
  const titles = ['✳ claude task', '✶ claude task', '✻ claude task', '⠋ codex', '⠙ codex', '⠹ codex', 'done'];
  const code = `const t=${JSON.stringify(titles)};t.forEach((x,i)=>setTimeout(()=>process.stdout.write('\\x1b]0;'+x+'\\x1b\\\\'),100*i));setTimeout(()=>process.stdout.write('TITLES-SENT\\r\\n'),100*t.length);setInterval(()=>{},1000)`;
  term.open(id, [process.execPath, '-e', code], moduleHome.home, process.env);
  try {
    await until(async () => (await term.snapshot(id))?.includes('TITLES-SENT'));
    await sleep(100);
    const rows = db.prepare("SELECT json_extract(payload, '$.title') AS t FROM event WHERE session_id = ? AND kind = 'term.title' ORDER BY seq").all(id).map((r: any) => r.t);
    assert.deepEqual(rows, ['✳ claude task', '⠋ codex', 'done']);
  } finally {
    term.kill(id);
    await until(() => !term.has(id));
    db.close();
  }
});

test('8 an engine without prompt_arg receives one typed prompt and never creates a handoff gate', async () => {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const reader = join(isolated.home, 'stdin-engine.mjs');
  const received = join(isolated.home, 'received.txt');
  writeFileSync(reader, "import{appendFileSync}from'node:fs';process.stdin.setEncoding('utf8');process.stdin.on('data',d=>appendFileSync(process.argv[2],d));setInterval(()=>{},1000);");
  writeFileSync(registry, JSON.stringify([{
    id: 'np', command: process.execPath, args: [reader, received], state_source: 'hooks', roles: ['worker'], cost_rank: 1,
    usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
  }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  try {
    const project = join(isolated.home, 'prompt-project');
    mkdirSync(project);
    const pipe = await client(isolated.prefix);
    try {
      const projectId = (await pipe.request('project.open', { path: project })).result.project_id;
      const marker = `PROMPT-${randomUUID()}`;
      const launched = await pipe.request('session.launch', { project_id: projectId, engine_id: 'np', prompt: marker });
      assert.equal(launched.result.prompt_delivered, false);
      const sessionId = launched.result.session_id;
      const event = await runNode(
        ['core/event.js', 'claude.Notification'],
        { ...env, TROOP_SESSION_ID: sessionId },
        JSON.stringify({ session_id: 'native-np', cwd: project, message: 'waiting for input' }),
      );
      assert.equal(event.code, 0, event.stderr);
      await until(() => existsSync(received) && readFileSync(received, 'utf8').includes(marker), 4000);
      const pasted = await pipe.request('session.paste-prompt', { session_id: sessionId });
      assert.deepEqual(pasted.result, { written: false, reason: 'already written' });
      const db = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
      try {
        assert.equal((readFileSync(received, 'utf8').match(new RegExp(marker, 'g')) ?? []).length, 1);
        assert.equal(db.prepare("SELECT count(*) AS n FROM event WHERE session_id = ? AND kind = 'core.prompt-written'").get(sessionId).n, 1);
        assert.equal(db.prepare("SELECT count(*) AS n FROM gate WHERE kind = 'handoff'").get().n, 0);
      } finally { db.close(); }
    } finally { pipe.close(); }
  } finally { await teardownCore(core, isolated); }
});

test('9 a hard-killed core ends its PTY tree and restart marks every live session exited', async () => {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const sleeper = join(isolated.home, 'sleep-engine.mjs');
  const enginePidFile = join(isolated.home, 'engine.pid');
  writeFileSync(sleeper, "import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],String(process.pid));setInterval(()=>{},1000);");
  writeFileSync(registry, JSON.stringify([{
    id: 'sleep', command: process.execPath, args: [sleeper, enginePidFile], prompt_arg: 'positional', state_source: 'hooks',
    roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
  }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  let core = await startCore({ ...isolated, env });
  let launcherPid = 0;
  let enginePid = 0;
  try {
    const project = join(isolated.home, 'kill-project');
    mkdirSync(project);
    const pipe = await client(isolated.prefix);
    const projectId = (await pipe.request('project.open', { path: project })).result.project_id;
    const launched = await pipe.request('session.launch', { project_id: projectId, engine_id: 'sleep' });
    pipe.close();
    const sessionId = launched.result.session_id;
    const db = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
    try {
      await until(() => db.prepare('SELECT pid FROM session WHERE id = ?').get(sessionId)?.pid, 4000);
      await until(() => existsSync(enginePidFile), 4000);
      launcherPid = db.prepare('SELECT pid FROM session WHERE id = ?').get(sessionId).pid;
      enginePid = Number(readFileSync(enginePidFile, 'utf8'));
    } finally { db.close(); }

    core.kill('SIGKILL');
    await new Promise((resolve) => core.once('exit', resolve));
    await until(() => !alive(launcherPid) && !alive(enginePid), 5000);

    core = await startCore({ ...isolated, env });
    const restarted = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
    try {
      await until(() => restarted.prepare("SELECT count(*) AS n FROM session WHERE state <> 'exited'").get().n === 0, 3000);
      assert.equal(restarted.prepare("SELECT count(*) AS n FROM session WHERE state <> 'exited'").get().n, 0);
    } finally { restarted.close(); }
  } finally {
    if (enginePid && alive(enginePid)) try { process.kill(enginePid, 'SIGKILL'); } catch {}
    await teardownCore(core, isolated);
  }
});

test('12 settings returns defaults for no file, preserves defaults for wrong types, and ignores broken JSON', async () => {
  const evaluate = async (home: string) => {
    const script = "import('./core/src/settings.ts').then(({settings,DEFAULTS})=>console.log(JSON.stringify({value:settings(),defaults:DEFAULTS})))";
    const result = await runNode(['-e', script], { ...process.env, METATROOPER_HOME: home, HOME: home, USERPROFILE: home });
    assert.equal(result.code, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  };

  const noFile = isolation();
  const wrongType = isolation();
  const broken = isolation();
  try {
    const absent = await evaluate(noFile.home);
    assert.deepEqual(absent.value, absent.defaults);

    writeFileSync(join(wrongType.home, 'settings.json'), JSON.stringify({ terminal: { scrollback: 'many', rows: 7 } }));
    const wrong = await evaluate(wrongType.home);
    assert.equal(wrong.value.terminal.scrollback, wrong.defaults.terminal.scrollback);
    assert.equal(wrong.value.terminal.rows, 7);

    writeFileSync(join(broken.home, 'settings.json'), '{not json');
    const invalid = await evaluate(broken.home);
    assert.deepEqual(invalid.value, invalid.defaults);
  } finally {
    for (const isolated of [noFile, wrongType, broken]) rmSync(isolated.home, { recursive: true, force: true });
  }
});
