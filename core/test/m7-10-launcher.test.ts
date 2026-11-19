import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { root, sleep, until } from './helpers.ts';

const exe = join(root, 'core', 'bin', 'metatrooper-launch.exe');
const win = process.platform === 'win32';
const native = win && existsSync(exe);
const b64 = (argv: unknown) => Buffer.from(JSON.stringify(argv)).toString('base64');

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function run(argv: unknown, env: NodeJS.ProcessEnv = process.env): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(exe, ['--session', 'S123', '--engine', 'fake', '--args-b64', b64(argv)], { encoding: 'utf8', env, windowsHide: true, timeout: 20_000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('M7-10 the launcher exe is built into core/bin', { skip: !win }, () => {
  assert.ok(existsSync(exe), `missing ${exe}; run pwsh launcher/build.ps1`);
});

test('M7-10c the child sees TROOP_SESSION_ID and its exit code 7 comes back as 7', { skip: !native }, () => {
  const r = run([process.execPath, '-e', 'process.stdout.write(String(process.env.TROOP_SESSION_ID)); process.exit(7)']);
  assert.equal(r.stdout, 'S123');
  assert.equal(r.status, 7);
});

test('M7-10c arguments with spaces, quotes and unicode reach the child unchanged', { skip: !native }, () => {
  const args = ['a b', 'say "hi"', 'tab\there', 'café ✳', 'back\\slash\\', ''];
  const r = run([process.execPath, '-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), args);
});

test('M7-10c an empty or broken argv exits 2 with today\'s text', { skip: !native }, () => {
  for (const argv of [[], 'not-an-array']) {
    const r = run(argv);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /troop launch: no command given/);
  }
  const r = spawnSync(exe, ['--session', 'S', '--engine', 'e', '--args-b64', '%%%'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 2);
});

test('M7-10c an unknown command exits 127 naming it', { skip: !native }, () => {
  const r = run(['definitely-not-a-command-7f3a', '--x']);
  assert.equal(r.status, 127);
  assert.match(r.stderr, /troop launch: could not find definitely-not-a-command-7f3a on PATH/);
});

test('M7-10c a .cmd engine starts', { skip: !native }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'm7-10-cmd-'));
  try {
    const cmd = join(dir, 'engine.cmd');
    writeFileSync(cmd, '@echo off\r\necho cmd-ran %TROOP_SESSION_ID%\r\nexit /b 3\r\n');
    const r = run([cmd]);
    assert.match(r.stdout, /cmd-ran S123/);
    assert.equal(r.status, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

const BROKER = `const { spawn } = require('node:child_process'); const fs = require('node:fs');
const b = spawn(process.execPath, ['-e', 'setInterval(()=>{},1e6)'], { detached: true, stdio: 'ignore', windowsHide: true });
fs.writeFileSync(process.argv[1], String(b.pid)); b.unref(); setInterval(() => {}, 1e6);`;

test('M7-10a a detached, unref\'d grandchild is gone within 2 s of the launcher ending', { skip: !native }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'm7-10-orphan-'));
  const pidFile = join(dir, 'broker.pid');
  const launcher = spawn(exe, ['--session', 'S', '--engine', 'fake', '--args-b64', b64([process.execPath, '-e', BROKER, pidFile])], { stdio: 'ignore', windowsHide: true });
  let broker = 0;
  try {
    broker = await until(() => existsSync(pidFile) && Number(readFileSync(pidFile, 'utf8')), 10_000);
    assert.ok(alive(broker), 'broker started');
    spawnSync('taskkill', ['/F', '/PID', String(launcher.pid)], { windowsHide: true });
    const t0 = Date.now();
    await until(() => !alive(broker), 2000);
    assert.ok(Date.now() - t0 <= 2000);
  } finally {
    if (broker && alive(broker)) try { process.kill(broker); } catch {}
    try { launcher.kill(); } catch {}
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M7-10b the launcher\'s working set is at most 5 MB with a session running', { skip: !native }, async () => {
  const launcher = spawn(exe, ['--session', 'S', '--engine', 'fake', '--args-b64', b64([process.execPath, '-e', 'setInterval(()=>{},1e6)'])], { stdio: 'ignore', windowsHide: true });
  try {
    await sleep(1500);
    const out = spawnSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${launcher.pid}).WorkingSet64`], { encoding: 'utf8', windowsHide: true }).stdout.trim();
    const mb = Number(out) / 1048576;
    assert.ok(mb > 0 && mb <= 5, `working set ${mb.toFixed(2)} MB`);
  } finally {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(launcher.pid)], { windowsHide: true });
  }
});

test('M7-10c Ctrl+C typed in the terminal reaches the engine and the launcher keeps running', { skip: !native }, async () => {
  const require = createRequire(import.meta.url);
  const pty = require('node-pty') as typeof import('node-pty');
  const child = 'process.on("SIGINT", () => process.stdout.write("got-int\\n")); process.stdout.write("ready\\n"); setInterval(() => {}, 1e6);';
  const term = pty.spawn(exe, ['--session', 'S', '--engine', 'fake', '--args-b64', b64([process.execPath, '-e', child])], { cols: 80, rows: 24, cwd: root, env: process.env as Record<string, string>, useConpty: true });
  let out = '';
  term.onData((d) => { out += d; });
  try {
    await until(() => out.includes('ready'), 10_000);
    term.write('\x03');
    await until(() => out.includes('got-int'), 5000);
    await sleep(500);
    assert.ok(alive(term.pid), 'launcher still running after Ctrl+C');
  } finally {
    spawnSync('taskkill', ['/T', '/F', '/PID', String(term.pid)], { windowsHide: true });
    try { term.kill(); } catch {}
  }
});
