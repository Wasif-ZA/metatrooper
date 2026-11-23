import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { openCoreDb } from '../src/store/db.ts';
import { isolation, withEnv } from './helpers.ts';
import { installPlugin } from '../src/plugins/store.ts';
import { resolveMcpServer } from '../src/plugins/mcp.ts';
import { boxArgv, launcher, unsafeGrant } from '../src/plugins/box.ts';

const csc = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const skip = process.platform !== 'win32' || !existsSync(csc) ? 'needs Windows and the .NET Framework compiler (csc.exe)' : false;

const ARGS_PROBE = `
using System; using System.IO;
class P {
  static void Main(string[] a) {
    File.WriteAllText(a[0], "ran");
    Console.WriteLine("ARGS:" + a.Length + " ENV:" + Environment.GetEnvironmentVariables().Count);
  }
}`;
const ENV_PROBE = `
using System;
class P { static void Main() { Console.WriteLine("SECRET:" + Environment.GetEnvironmentVariable("SECRET_TOKEN")); } }`;

const dirs: string[] = [];
const temp = (label: string) => { const d = mkdtempSync(join(tmpdir(), `m8-14-fix-${label}-`)); dirs.push(d); return d; };
function compile(dir: string, name: string, source: string): string {
  const cs = join(dir, `${name}.cs`);
  const exe = join(dir, `${name}.exe`);
  writeFileSync(cs, source);
  execFileSync(csc, ['-nologo', `-out:${exe}`, cs], { stdio: 'pipe', windowsHide: true });
  return exe;
}

test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test('the box refuses a drive root, the user folder, the cc home and folders above them', { skip }, () => {
  const home = temp('home');
  const project = temp('project');
  const unsafe = (d: string) => withEnv({ METATROOPER_HOME: home }, () => unsafeGrant(d));
  assert.ok(unsafe('C:\\'));
  assert.ok(unsafe(homedir()));
  assert.ok(unsafe(dirname(homedir())));
  assert.ok(unsafe(home));
  assert.ok(unsafe(dirname(home)));
  assert.equal(unsafe(project), null);
  assert.ok(unsafe(`${project}\nextra`));

  const tmp = join(temp('scratch'), 'run');
  const grantFile = `${tmp}.grants`;
  for (const bad of ['C:\\', homedir(), home, `${project}\nr C:\\`]) {
    assert.throws(() => withEnv({ METATROOPER_HOME: home }, () => boxArgv({ name: 'x', net: false, grants: [`r ${bad}`] }, 'p.exe', [], tmp, 'boxrun.exe')), /will not grant/);
    assert.equal(existsSync(grantFile), false, `no grants file for ${bad}`);
  }
});

test('a boxed program cannot be a .cmd or .bat', { skip }, () => {
  const tmp = join(temp('scratch'), 'run');
  for (const file of ['x.cmd', 'y.BAT', 'C:\\Windows\\System32\\cmd.exe']) {
    assert.throws(() => boxArgv({ name: 'x', net: false, grants: [] }, file, [], tmp, 'boxrun.exe'), /\.cmd or \.bat/, file);
  }
  assert.equal(existsSync(`${tmp}.grants`), false);
});

test('a boxed probe inherits no extra handle and starts nothing on a bad grant line', { skip }, () => {
  const home = temp('home');
  const plugin = temp('plugin');
  const work = temp('work');
  const exe = compile(plugin, 'probe', ARGS_PROBE);
  const boxrun = withEnv({ METATROOPER_HOME: home }, launcher);
  assert.ok(boxrun, 'boxrun builds');
  const marker = join(work, 'marker.txt');
  const cmdline = `"${exe}" "${marker}"`;

  const bad = join(temp('grants'), 'bad.grants');
  writeFileSync(bad, `x C:\\bad\nr ${plugin}\nw ${work}\n`);
  const r = spawnSync(boxrun!, ['bad-grant-test', '0', bad, exe, cmdline], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
  assert.equal(r.status, 121, r.stdout + r.stderr);
  assert.equal(existsSync(marker), false, 'the probe never ran');

  const good = join(temp('grants'), 'good.grants');
  writeFileSync(good, `r ${plugin}\nw ${work}\n`);
  const ok = spawnSync(boxrun!, [`ok-grant-test-${Date.now()}`, '0', good, exe, cmdline], { encoding: 'utf8', timeout: 60_000, windowsHide: true });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /ARGS:1 ENV:\d+/);
  assert.equal(readFileSync(marker, 'utf8'), 'ran');
});

test('a boxed server sees only the allowlisted environment', { skip }, () => {
  const shim = readFileSync(join(import.meta.dirname, '..', 'src', 'hook', 'mcp-shim.ts'), 'utf8');
  const block = shim.slice(shim.indexOf('if (r.box)'));
  assert.ok(block.includes("new Set(['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'LOCALAPPDATA', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', ...Object.keys(r.env), ...Object.keys(r.refs)]"), 'allowlist line is inside the box branch');
  assert.match(block, /for \(const k of Object\.keys\(env\)\) if \(!keep\.has\(k\.toUpperCase\(\)\)\) delete env\[k\];/);

  const plugin = temp('plugin');
  const exe = compile(plugin, 'envdump', ENV_PROBE);
  const home = temp('home');
  const run = (env: NodeJS.ProcessEnv, key: string) => {
    const argv = withEnv({ METATROOPER_HOME: home }, () => boxArgv({ name: `env-test-${key}-${Date.now()}`, net: false, grants: [`r ${plugin}`] }, exe, [], join(temp('scratch'), 'run')));
    return spawnSync(argv.file, argv.args, { encoding: 'utf8', timeout: 60_000, windowsHide: true, env });
  };
  const parent = { ...process.env, SECRET_TOKEN: 's3cret' };
  assert.match(run(parent, 'all').stdout, /SECRET:s3cret/, 'unfiltered, the child inherits the parent variable');

  // mirrors the filter in mcp-shim.ts; LOCALAPPDATA is needed, without it boxrun's CreateProcess fails with 203
  const keep = new Set(['SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'LOCALAPPDATA', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']);
  const env: NodeJS.ProcessEnv = { ...parent };
  for (const k of Object.keys(env)) if (!keep.has(k.toUpperCase())) delete env[k];
  env.TEMP = env.TMP = temp('shimtmp');
  const r = run(env, 'kept');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SECRET:\s*$/);
});

test('internet is granted only with the network permission', { skip }, (t) => {
  const isolated = isolation();
  const env = { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix };
  const db = withEnv(env, openCoreDb);
  t.after(() => { db.close(); rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const netOf = (id: string, permissions: string[]) => {
    const source = join(isolated.home, `src-${id}`);
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'probe.exe'), 'MZ');
    writeFileSync(join(source, 'troop-plugin.json'), JSON.stringify({ schema: 1, id, version: '1.0.0', name: id, platforms: ['windows'], permissions, mcp: [{ id: 'x', command: '{{plugin_dir}}/probe.exe', writes: 'external', engines: ['codex'] }] }));
    withEnv(env, () => installPlugin(db, { source, approved_permissions: permissions }));
    return withEnv(env, () => resolveMcpServer(db, id, 'x')).box;
  };
  assert.equal(netOf('net-off', [])?.net, false);
  assert.equal(netOf('net-on', ['network'])?.net, true);
});
