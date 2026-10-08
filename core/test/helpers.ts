import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const root = resolve(import.meta.dirname, '../..');
export const bs = String.fromCharCode(92);

const FAKE_GH_CS = [
  'public static class P { public static void Main(string[] a) {',
  '  System.IO.File.AppendAllText(System.AppDomain.CurrentDomain.BaseDirectory + "gh.log", string.Join(" ", a) + "\\r\\n");',
  '  System.Console.WriteLine("https://github.com/fake/repo/pull/7"); } }',
].join('\n');

/** Puts a fake gh in `bin` that appends its arguments to `bin/gh.log` and prints a PR URL; returns the log path. Windows gets a real gh.exe, since plugins spawn gh with no shell. */
export function fakeGh(bin: string): string {
  if (process.platform !== 'win32') {
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\necho "$@" >> '${join(bin, 'gh.log')}'\necho https://github.com/fake/repo/pull/7\n`, { mode: 0o755 });
    return join(bin, 'gh.log');
  }
  copyFileSync(compileExe(FAKE_GH_CS), join(bin, 'gh.exe'));
  return join(bin, 'gh.log');
}

const NODE_SHIM_CS = [
  'public static class P { public static int Main(string[] a) {',
  '  var dir = System.AppDomain.CurrentDomain.BaseDirectory;',
  '  var name = System.IO.Path.GetFileNameWithoutExtension(System.Environment.GetCommandLineArgs()[0]);',
  '  var args = "\\"" + dir + name + ".mjs\\"";',
  '  foreach (var x in a) args += " \\"" + x.Replace("\\"", "\\\\\\"") + "\\"";',
  '  var p = System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("node", args) { UseShellExecute = false });',
  '  p.WaitForExit(); return p.ExitCode; } }',
].join('\n');

/** Puts a gh in `bin` that runs `script` (an ES module) with node on the same arguments; Windows gets a gh.exe shim, since plugins spawn gh with no shell. */
export function scriptedGh(bin: string, script: string): void {
  writeFileSync(join(bin, 'gh.mjs'), script);
  if (process.platform !== 'win32') {
    writeFileSync(join(bin, 'gh'), `#!/bin/sh\nexec node '${join(bin, 'gh.mjs')}' "$@"\n`, { mode: 0o755 });
    return;
  }
  copyFileSync(compileExe(NODE_SHIM_CS), join(bin, 'gh.exe'));
}

function compileExe(source: string): string {
  const cache = join(tmpdir(), `metatrooper-fake-gh-${createHash('sha256').update(source).digest('hex').slice(0, 12)}.exe`);
  if (!existsSync(cache)) {
    const src = `${cache}.cs`;
    writeFileSync(src, source);
    execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -OutputType ConsoleApplication -OutputAssembly '${cache}' -Path '${src}'`], { stdio: 'pipe' });
  }
  return cache;
}

export function isolation() {
  const home = mkdtempSync(join(tmpdir(), 'metatrooper-test-'));
  const prefix = `troop-test-${randomUUID().replaceAll('-', '')}`;
  const recorder = pathToFileURL(join(root, 'core/test/server-pid-recorder.mjs')).href;
  return { home, prefix, started: Date.now(), env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${recorder}`, METATROOPER_HOME: home, METATROOPER_PIPE_PREFIX: prefix, USERPROFILE: home, HOME: home } };
}

export function reservePortBand(db: DatabaseSync, firstAvailable: number, runId: string) {
  const now = new Date().toISOString();
  db.prepare("INSERT OR IGNORE INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)").run(`test-${runId}`, `/${runId}`, runId, now, now);
  db.prepare("INSERT OR IGNORE INTO pipeline (id, source, path, version, valid) VALUES (?, 'project', ?, 1, 1)").run(`test-${runId}`, `/${runId}.json`);
  db.prepare("INSERT OR IGNORE INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at) VALUES (?, ?, ?, '{}', ?, 'paused', 'manual', 0, 0, 1, ?)").run(runId, `test-${runId}`, `test-${runId}`, `/${runId}`, now);
  const insert = db.prepare('INSERT INTO port_lease (port, run_id, idx, leased_at) VALUES (?, ?, ?, ?)');
  for (let port = 3001; port < firstAvailable; port++) insert.run(port, runId, port - 3001, now);
}

export function withEnv<T>(vars: Record<string, string>, fn: () => T): T {
  const previous = new Map(Object.keys(vars).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, vars);
    return fn();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export function pipePath(prefix) {
  if (process.platform !== 'win32') return join(tmpdir(), `${prefix}.sock`);
  return bs + bs + '.' + bs + 'pipe' + bs + prefix;
}

export function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function until(read, timeout = 3000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      const value = await read();
      if (value) return value;
    } catch (error) { last = error; }
    await sleep(25);
  }
  throw last ?? new Error(`condition not met in ${timeout} ms`);
}

export async function client(prefix) {
  const socket = connect(pipePath(prefix));
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  let buffer = '';
  const pending = new Map();
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    buffer += chunk;
    for (let index; (index = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const response = JSON.parse(line);
      const waiter = pending.get(response.id);
      if (waiter) { pending.delete(response.id); waiter.resolve(response); }
    }
  });
  socket.on('error', error => {
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });
  socket.on('close', () => {
    for (const waiter of pending.values()) waiter.reject(new Error('pipe closed'));
    pending.clear();
  });
  return {
    socket,
    request(method, params = {}, options = {}) {
      const id = options.id ?? randomUUID();
      const message = { jsonrpc: '2.0', id, method, params, meta: options.meta ?? { origin: 'cli', sent_at: new Date().toISOString() } };
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, options.timeout ?? 3000);
        pending.set(id, {
          resolve: value => { clearTimeout(timer); resolve(value); },
          reject: error => { clearTimeout(timer); reject(error); }
        });
        socket.write(JSON.stringify(message) + '\n');
      });
    },
    close() { socket.destroy(); }
  };
}

export async function uiHello(connection, home) {
  const ui_key = readFileSync(join(home, 'ui.key'), 'utf8').trim();
  const reply = await connection.request('ui.hello', { ui_key });
  assert.deepEqual(reply.result, { ok: true });
  return reply;
}

export async function startCore(isolated) {
  const child = spawn(process.execPath, ['core/src/main.ts'], { cwd: root, env: isolated.env, stdio: 'ignore', windowsHide: true });
  try {
    await until(async () => {
      if (child.exitCode !== null) throw new Error(`core exited ${child.exitCode}`);
      const connection = await client(isolated.prefix);
      try {
        const response = await connection.request('core.ping');
        return response.result?.ok === true && response.result?.schema_version === 2;
      } finally { connection.close(); }
    }, 5000);
  } catch (error) { child.kill(); throw error; }
  return child;
}

export async function stopCore(child, isolated) {
  if (!child || child.exitCode !== null) return;
  try {
    const connection = await client(isolated.prefix);
    try { await uiHello(connection, isolated.home); await connection.request('core.stop'); }
    finally { connection.close(); }
  } catch { child.kill('SIGINT'); }
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(1500)]);
  if (child.exitCode === null) child.kill();
}

export async function teardownCore(child, isolated) {
  await stopCore(child, isolated);
  const listenerDir = join(isolated.home, 'listener-pids');
  const listeners = existsSync(listenerDir) ? readdirSync(listenerDir).map(Number) : [];
  for (const pid of listeners) {
    try { process.kill(pid); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  await until(() => listeners.every(pid => {
    try { process.kill(pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; }
  }), 5000);
  const pids = new Set();
  let sessionIds = [];
  let db;
  try {
    db = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
    const sessions = db.prepare('SELECT id, pid FROM session').all();
    sessionIds = sessions.map(row => row.id);
    for (const session of sessions) if (session.pid !== null) pids.add(session.pid);
    if (sessions.some(session => session.pid === null)) {
      try {
        await until(() => {
          const launchIds = new Set(db.prepare("SELECT session_id FROM event WHERE kind = 'launch'").all().map(row => row.session_id));
          return sessions.every(session => session.pid !== null || launchIds.has(session.id));
        }, 2500);
      } catch {}
    }
    for (const row of db.prepare("SELECT session_id, payload FROM event WHERE kind = 'launch'").all()) {
      if (!sessionIds.includes(row.session_id)) continue;
      try {
        const pid = JSON.parse(row.payload).pid;
        if (Number.isInteger(pid)) pids.add(pid);
      } catch {}
    }
  } catch {} finally { try { db?.close(); } catch {} }
  if (sessionIds.length) await new Promise(resolve => {
    const script = '$ids = $env:METATROOPER_CLEANUP_SESSION_IDS -split ","; $testPid = [int]$env:METATROOPER_CLEANUP_TEST_PID; foreach ($p in (Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)) { if ($p.ProcessId -eq $PID -or $p.ProcessId -eq $testPid -or -not $p.CommandLine -or -not $p.CommandLine.Contains("launch.js")) { continue }; foreach ($id in $ids) { if ($p.CommandLine.Contains($id)) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; break } } }';
    const sweep = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, METATROOPER_CLEANUP_SESSION_IDS: sessionIds.join(','), METATROOPER_CLEANUP_TEST_PID: String(process.pid) },
      stdio: 'ignore', windowsHide: true
    });
    sweep.once('error', resolve);
    sweep.once('exit', resolve);
  });
  // Windows reuses pids, so only kill ones that started after this test's core.
  if (pids.size) {
    try {
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-Process -Id ${[...pids].join(',')} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $([DateTimeOffset]::new($_.StartTime).ToUnixTimeMilliseconds())" }`],
        { encoding: 'utf8', windowsHide: true });
      const fresh = new Set(out.split(/\r?\n/).filter(Boolean).map(line => line.split(' ').map(Number)).filter(([, ms]) => ms >= (isolated.started ?? 0) - 1000).map(([pid]) => pid));
      for (const pid of [...pids]) if (!fresh.has(pid)) pids.delete(pid);
    } catch { pids.clear(); }
  }
  await Promise.all([...pids].map(pid => new Promise(resolve => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.once('error', resolve);
    killer.once('exit', resolve);
  })));
  for (const pid of pids) { try { process.kill(pid); } catch {} }
  await sleep(1200);
  rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

export async function harness() {
  const isolated = isolation();
  let core;
  try { core = await startCore(isolated); }
  catch (error) { rmSync(isolated.home, { recursive: true, force: true }); throw error; }
  return { ...isolated, core, async teardown() { await teardownCore(core, isolated); } };
}

export function runNode(args, env, input = '') {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(process.execPath, args, { cwd: root, env, windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => resolve({ code, stdout, stderr, ms: performance.now() - started }));
    child.stdin.end(input);
  });
}

let buildPromise;
export function buildGenerated() {
  buildPromise ??= (async () => {
    const key = createHash('sha1').update(root).digest('hex').slice(0, 12);
    const lock = join(tmpdir(), `metatrooper-build-${key}-${process.ppid}`);
    let owner = false;
    try { mkdirSync(lock); owner = true; }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const marker = join(lock, 'result');
    if (owner) {
      const result = await runNode(['core/build.ts'], process.env);
      writeFileSync(marker, JSON.stringify({ code: result.code, output: result.stderr || result.stdout }));
    } else {
      await until(() => existsSync(marker), 30000);
    }
    const result = JSON.parse(readFileSync(marker, 'utf8'));
    assert.equal(result.code, 0, result.output);
  })();
  return buildPromise;
}
