import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { openCoreDb } from '../src/store/db.ts';
import { isolation, withEnv } from './helpers.ts';
import { installPlugin } from '../src/plugins/store.ts';
import { previewPlugin } from '../src/plugins/store.ts';
import { resolveMcpServer } from '../src/plugins/mcp.ts';
import { boxArgv, containerName } from '../src/plugins/box.ts';

const csc = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const skip = process.platform !== 'win32' || !existsSync(csc) ? 'needs Windows and the .NET Framework compiler (csc.exe)' : false;

const FILE_PROBE = `
using System; using System.IO;
class P {
  static string Try(string f) { try { File.ReadAllText(f); return "ok"; } catch (UnauthorizedAccessException) { return "denied"; } catch (Exception e) { return "error:" + e.GetType().Name; } }
  static void Main(string[] a) { Console.WriteLine("IN:" + Try(a[0])); Console.WriteLine("OUT:" + Try(a[1])); }
}`;
const NET_PROBE = `
using System; using System.Net.Sockets;
class P {
  static void Main() {
    string r = "denied";
    try { using (var c = new TcpClient()) { if (c.ConnectAsync("example.com", 443).Wait(5000) && c.Connected) r = "ok"; } } catch (Exception) { }
    Console.WriteLine("NET:" + r);
  }
}`;

const dirs: string[] = [];
const temp = (label: string) => { const d = mkdtempSync(join(tmpdir(), `m8-14-${label}-`)); dirs.push(d); return d; };
function compile(dir: string, name: string, source: string): string {
  const cs = join(dir, `${name}.cs`);
  const exe = join(dir, `${name}.exe`);
  writeFileSync(cs, source);
  execFileSync(csc, ['-nologo', `-out:${exe}`, cs], { stdio: 'pipe', windowsHide: true });
  return exe;
}

test.after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

const boxed = (home: string, tmp: string, exe: string, args: string[], net: boolean, grants: string[], key: string) => {
  const argv = withEnv({ METATROOPER_HOME: home }, () => boxArgv({ name: containerName('probe-test', key), net, grants }, exe, args, tmp));
  return spawnSync(argv.file, argv.args, { encoding: 'utf8', timeout: 60_000, windowsHide: true });
};

test('a cli plugin reading an undeclared file is refused by the sandbox', { skip }, () => {
  const home = temp('home');
  const plugin = temp('plugin');
  const project = temp('project');
  const outside = temp('outside');
  const inFile = join(project, 'in.txt');
  const outFile = join(outside, 'out.txt');
  writeFileSync(inFile, 'in');
  writeFileSync(outFile, 'out');
  const exe = compile(plugin, 'probe', FILE_PROBE);

  const plain = spawnSync(exe, [inFile, outFile], { encoding: 'utf8', windowsHide: true });
  assert.match(plain.stdout, /OUT:ok/, 'unboxed, the fixture can read the outside file');

  const r = boxed(home, join(temp('scratch'), 'run'), exe, [inFile, outFile], false, [`r ${plugin}`, `r ${project}`], `file-${Date.now()}`);
  assert.match(r.stdout, /IN:ok/, r.stdout + r.stderr);
  assert.match(r.stdout, /OUT:denied/, r.stdout + r.stderr);
});

test('the network capability is granted only with net', { skip }, (t) => {
  const home = temp('home');
  const plugin = temp('plugin');
  const exe = compile(plugin, 'net', NET_PROBE);
  const plain = spawnSync(exe, [], { encoding: 'utf8', windowsHide: true });
  if (!/NET:ok/.test(plain.stdout)) return t.skip('offline: example.com:443 is unreachable without the box');
  const key = `net-${Date.now()}`;
  const off = boxed(home, join(temp('scratch'), 'off'), exe, [], false, [`r ${plugin}`], key);
  assert.match(off.stdout, /NET:denied/, off.stdout + off.stderr);
  const on = boxed(home, join(temp('scratch'), 'on'), exe, [], true, [`r ${plugin}`], `${key}-on`);
  assert.match(on.stdout, /NET:ok/, on.stdout + on.stderr);
});

test('resolveMcpServer boxes a shipped binary and not an npx server', { skip }, (t) => {
  const isolated = isolation();
  const env = { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix };
  const db = withEnv(env, openCoreDb);
  t.after(() => { db.close(); rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const source = join(isolated.home, 'src-box');
  mkdirSync(source, { recursive: true });
  compile(source, 'probe', FILE_PROBE);
  const manifest = {
    schema: 1, id: 'box-check', version: '1.0.0', name: 'box-check', platforms: ['windows'],
    mcp: [
      { id: 'shipped', command: '{{plugin_dir}}/probe.exe', engines: ['codex'] },
      { id: 'loose', command: 'npx', args: ['some-server'], engines: ['codex'] },
    ],
  };
  writeFileSync(join(source, 'troop-plugin.json'), JSON.stringify(manifest));

  const preview = withEnv(env, () => previewPlugin(db, source));
  assert.ok(preview.valid, preview.errors.join('; '));
  const servers = preview.screen!.mcp_servers;
  assert.equal(servers.find((s) => s.id === 'shipped')?.sandboxed, true);
  assert.equal(servers.find((s) => s.id === 'loose')?.sandboxed, false);
  const warning = preview.screen!.warnings.find((w) => w.startsWith('Not sandboxed:'));
  assert.ok(warning && /loose/.test(warning) && !/shipped/.test(warning), warning);

  withEnv(env, () => installPlugin(db, { source, approved_permissions: [] }));
  const { path } = db.prepare('SELECT path FROM plugin WHERE id = ?').get('box-check') as { path: string };
  const shipped = withEnv(env, () => resolveMcpServer(db, 'box-check', 'shipped'));
  assert.ok(shipped.box, 'a shipped binary is boxed');
  assert.ok(shipped.box!.grants.includes(`r ${path}`), shipped.box!.grants.join('|'));
  assert.equal(shipped.box!.project, 'r');
  assert.equal(withEnv(env, () => resolveMcpServer(db, 'box-check', 'loose')).box, null, 'an npx server is not boxed');
});
