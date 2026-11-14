import assert from 'node:assert/strict';
import { after } from 'node:test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { killTree, killTreeAsync, runningWith, startOf, stillRunning } from '../../tests/helpers/kill-tree.ts';

export const root = resolve(import.meta.dirname, '../..');
export const bs = String.fromCharCode(92);

/** Processes descended from `pid` with their start times, each started no earlier than its parent, from one Win32_Process query. */
export function descendants(pid: number): Array<{ pid: number; born: number }> {
  // ponytail: returns no pids off Windows; a ps query would cover other platforms
  if (process.platform !== 'win32') return [];
  const script = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $(if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 })" }';
  const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }).stdout ?? '';
  const rows = out.split(/\r?\n/).map(line => line.trim().split(' ').map(Number)).filter(row => row[0]);
  const born = new Map(rows.map(([p, , ms]) => [p, ms]));
  const found: Array<{ pid: number; born: number }> = [];
  for (const queue = [pid]; queue.length;) {
    const parent = queue.shift()!;
    for (const [p, pp, ms] of rows) if (pp === parent && p !== parent && !found.some(f => f.pid === p) && ms >= (born.get(parent) ?? 0)) { found.push({ pid: p, born: ms }); queue.push(p); }
  }
  return found;
}

/** Kills every process tree this test process started that is still running. */
function sweep() {
  if (process.getActiveResourcesInfo().includes('ProcessWrap')) for (const found of descendants(process.pid)) killTree(found);
}

// Sweeps 30 s after the file's last test, without keeping the process alive, and again on exit.
after(() => { setTimeout(sweep, 30_000).unref(); });
process.on('exit', sweep);

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
  mkdirSync(join(home, 'AppData', 'Local'), { recursive: true });
  const prefix = `troop-test-${randomUUID().replaceAll('-', '')}`;
  const recorder = pathToFileURL(join(root, 'core/test/server-pid-recorder.mjs')).href;
  return { home, prefix, started: Date.now(), env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${recorder}`, METATROOPER_HOME: home, METATROOPER_PIPE_PREFIX: prefix, USERPROFILE: home, HOME: home } };
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
  const child = spawn(process.execPath, ['core/src/main.ts', ...(isolated.args ?? [])], { cwd: root, env: isolated.env, stdio: 'ignore', windowsHide: true });
  try {
    await until(async () => {
      if (child.exitCode !== null) throw new Error(`core exited ${child.exitCode}`);
      const connection = await client(isolated.prefix);
      try {
        const response = await connection.request('core.ping');
        return response.result?.ok === true && response.result?.schema_version === 2;
      } finally { connection.close(); }
    }, 5000);
  } catch (error) { await killTreeAsync(child); throw error; }
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
  if (child.exitCode === null) await killTreeAsync(child);
}

export async function teardownCore(child, isolated) {
  const spawned = child?.exitCode === null ? descendants(child.pid) : [];
  await stopCore(child, isolated);
  const listenerDir = join(isolated.home, 'listener-pids');
  // Each file holds "<pid> <ms the process started>" from server-pid-recorder.mjs; its clock is the process's, so it gets slack.
  const listeners = (existsSync(listenerDir) ? readdirSync(listenerDir) : []).map(f => {
    const [pid, born] = readFileSync(join(listenerDir, f), 'utf8').split(' ').map(Number);
    return { pid, born, slack: 2000 };
  }).filter(l => Number.isInteger(l.pid) && Number.isFinite(l.born));
  await Promise.all(listeners.map(killTreeAsync));
  await until(() => listeners.every(l => {
    if (process.platform !== 'win32') { try { process.kill(l.pid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } }
    const now = startOf(l.pid);
    return now === undefined || Math.abs(now - l.born) > l.slack;
  }), 5000);
  const targets = [...spawned];
  const pids = new Set<number>();
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
  // A pid stored in the database may since have gone to another process, so one is killed only if it started after
  // this test began and its command line names this test's home or one of its sessions.
  if (pids.size && process.platform === 'win32') {
    try {
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `Get-CimInstance Win32_Process -Filter "${[...pids].map(p => `ProcessId=${Number(p)}`).join(' OR ')}" | ForEach-Object { "$($_.ProcessId) $(([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds()) $($_.CommandLine)" }`],
        { encoding: 'utf8', windowsHide: true });
      for (const line of out.split(/\r?\n/).filter(Boolean)) {
        const [pid, born, ...rest] = line.split(' ');
        const command = rest.join(' ');
        if (Number(born) >= (isolated.started ?? 0) - 1000 && [isolated.home, ...sessionIds].some(s => command.includes(s))) targets.push({ pid: Number(pid), born: Number(born) });
      }
    } catch {}
  } else if (pids.size) for (const pid of pids) targets.push({ pid, born: 0 });
  // A process whose command line names this test's own temp home is this test's, even one that left the core's tree.
  for (const found of runningWith(isolated.home, (isolated.started ?? 0) - 1000)) if (!targets.some(t => t.pid === found.pid)) targets.push(found);
  await Promise.all(targets.map(killTreeAsync));
  if (process.platform !== 'win32') for (const pid of pids) { try { process.kill(pid); } catch {} }
  // The home cannot be removed while a process still has it open, so wait for every process ended above to be gone.
  const owned = [...listeners, ...targets.filter(t => t.born > 0)];
  if (child && child.exitCode === null && child.signalCode === null) await Promise.race([new Promise(resolve => child.once('exit', resolve)), sleep(5000)]);
  await until(() => stillRunning(owned).length === 0, 10_000).catch(() => {});
  try {
    rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    throw new Error(`${error.message}; still running: ${JSON.stringify(stillRunning(owned))}`);
  }
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
    child.on('close', code => resolve({ code, stdout, stderr, ms: performance.now() - started }));
    child.stdin.end(input);
  });
}

let buildPromise;
export function buildGenerated() {
  buildPromise ??= (async () => {
    const key = createHash('sha1').update(root).digest('hex').slice(0, 12);
    const lock = join(tmpdir(), `metatrooper-build-${key}-${process.ppid}`);
    // a lock older than 15 min belongs to a dead run whose parent pid was reused
    try { if (Date.now() - statSync(lock).mtimeMs > 15 * 60_000) rmSync(lock, { recursive: true, force: true }); } catch {}
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

export function pipelineFile(id: string) {
  return ['', 'preview', 'unshipped'].map((sub) => join(root, 'pipelines', sub, `${id}.json`)).find(existsSync) ?? join(root, 'pipelines', `${id}.json`);
}

/** A committed git repo of a synthetic plugin, in a folder whose name does not end in .git. */
export function pluginRepo(home: string, id: string, extra: Record<string, unknown> = {}): string {
  const repo = join(home, `${id}-repo`);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'troop-plugin.json'), JSON.stringify({ schema: 1, id, version: '1.0.0', name: id, ...extra }));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  return repo;
}
