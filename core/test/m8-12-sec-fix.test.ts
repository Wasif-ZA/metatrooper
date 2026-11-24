import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os, { homedir, tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildMethods } from '../src/methods.ts';
import { runAction } from '../src/plugins/actions.ts';
import { unsafeGrant } from '../src/plugins/box.ts';
import { installScreen } from '../src/plugins/manifest.ts';
import { installPlugin } from '../src/plugins/store.ts';
import { shimToken } from '../src/plugins/mcp.ts';
import { issueSecret } from '../src/sessions/secret.ts';
import { schemaFile } from '../src/paths.ts';
import { withEnv } from './helpers.ts';

const csc = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const skip = process.platform !== 'win32' || !existsSync(csc) ? 'needs Windows and the .NET Framework compiler (csc.exe)' : false;
const NEEDS_UI = -32012;
const NOT_FOUND = -32002;

const dirs: string[] = [];
const temp = (label: string) => { const d = mkdtempSync(join(tmpdir(), `m8-12-sec-${label}-`)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

function plugin(dir: string, actions: unknown[], permissions: string[] = []) {
  return {
    id: 'sec-act', version: '1.0.0', path: dir, source: 'native' as const, enabled: true, permissions,
    manifest: { schema: 1 as const, id: 'sec-act', version: '1.0.0', name: 'Sec', permissions, actions: actions as never },
  };
}

test('a shipped .js action with no project permission cannot write the project or the run log, and can write its out folder', { skip, timeout: 60000 }, async () => {
  const dir = temp('plugin');
  const project = temp('project');
  const run = join(temp('run'), 'run');
  mkdirSync(join(dir, 'bin'), { recursive: true });
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, 'log.jsonl'), 'start');
  writeFileSync(join(dir, 'bin', 'probe.js'), `
    const fs = require('node:fs'); const path = require('node:path');
    const tries = {
      project: () => fs.writeFileSync(path.join(process.env.TROOP_PROJECT_DIR, 'owned.txt'), 'x'),
      out: () => fs.writeFileSync(path.join(process.env.TROOP_RUN_DIR, 'ok.txt'), 'x'),
      log: () => fs.appendFileSync(path.join(path.dirname(process.env.TROOP_RUN_DIR), 'log.jsonl'), 'FORGED\\n'),
    };
    const outputs = {};
    for (const [k, f] of Object.entries(tries)) { try { f(); outputs[k] = true; } catch { outputs[k] = false; } }
    process.stdout.write(JSON.stringify({ ok: true, outputs }));`);
  const r = await runAction({
    plugin: plugin(dir, [{ id: 'probe', run: ['bin/probe.js'], timeout_seconds: 20 }]),
    actionId: 'probe', input: {}, projectDir: project, run: { id: 'r', dir: run }, secret: () => null,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual((r as { outputs: unknown }).outputs, { project: false, out: true, log: false });
  assert.equal(existsSync(join(project, 'owned.txt')), false);
  assert.equal(existsSync(join(run, 'out', 'ok.txt')), true);
  assert.ok(!readFileSync(join(run, 'log.jsonl'), 'utf8').includes('FORGED'));
});

test('a boxed shipped .js action that hangs still times out', { skip, timeout: 30000 }, async () => {
  const dir = temp('plugin');
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'bin', 'hang.js'), 'setInterval(() => {}, 1000);');
  const r = await runAction({
    plugin: plugin(dir, [{ id: 'hang', run: ['bin/hang.js'], timeout_seconds: 2 }]),
    actionId: 'hang', input: {}, projectDir: temp('project'), run: { id: 'r', dir: join(temp('run'), 'run') }, secret: () => null,
  });
  assert.deepEqual(r, { ok: false, error: { message: 'action timed out after 2 s', retryable: true } });
});

test('a shipped .cmd action is refused with cmd.exe and runs nothing', { skip }, async () => {
  const dir = temp('plugin');
  const project = temp('project');
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'bin', 'go.cmd'), `@echo ran> "${join(project, 'ran.txt')}"\r\n`);
  const r = await runAction({
    plugin: plugin(dir, [{ id: 'go', run: ['bin/go.cmd'], timeout_seconds: 5 }], ['project:write']),
    actionId: 'go', input: {}, projectDir: project, run: { id: 'r', dir: join(temp('run'), 'run') }, secret: () => null,
  });
  assert.equal(r.ok, false);
  assert.match((r as { error: { message: string } }).error.message, /cmd\.exe/);
  assert.equal(existsSync(join(project, 'ran.txt')), false);
});

function sessionDb(): { db: DatabaseSync; home: string; project: string } {
  const home = temp('home');
  const project = temp('proj');
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(schemaFile, 'utf8'));
  db.exec('PRAGMA foreign_keys = OFF');
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(project);
  return { db, home, project };
}
const addSession = (db: DatabaseSync, id: string, state = 'idle') => db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p', 'fake', 'pty', ?, 'x', 'x')").run(id, state);
const code = (c: number) => (e: { code?: number }) => e.code === c;

test('engine.run refuses an exited session and an isolated one, and lets a live ask session through the proof', async () => {
  const { db, home } = sessionDb();
  addSession(db, 'live'); addSession(db, 'gone', 'exited'); addSession(db, 'iso');
  const secrets = { live: issueSecret('live', 'ask'), gone: issueSecret('gone', 'ask'), iso: issueSecret('iso', 'isolated') };
  const h = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k' }).get('engine.run')!.handler as (p: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>;
  const call = async (id: keyof typeof secrets) => await withEnv({ METATROOPER_HOME: home }, () => h({ engine: 'x', action: 'y', session_id: id, session_secret: secrets[id] }, { ui: false, origin: 'cli' }));
  await assert.rejects(call('gone'), code(NEEDS_UI));
  await assert.rejects(call('iso'), code(NEEDS_UI));
  await assert.rejects(call('live'), code(NOT_FOUND));
});

test('unsafeGrant refuses a junction to the user folder and allows one to a plain folder', { skip }, () => {
  const holder = temp('junc');
  const plain = temp('plain');
  const toHome = join(holder, 'to-home');
  const toPlain = join(holder, 'to-plain');
  symlinkSync(homedir(), toHome, 'junction');
  symlinkSync(plain, toPlain, 'junction');
  const home = temp('cchome');
  assert.ok(withEnv({ METATROOPER_HOME: home }, () => unsafeGrant(toHome)));
  assert.equal(withEnv({ METATROOPER_HOME: home }, () => unsafeGrant(toPlain)), null);
});

test('mcp.resolve returns the project of a proven live session as project_dir, and null without one', async () => {
  const { db, home, project } = sessionDb();
  addSession(db, 's1');
  const secret = issueSecret('s1', 'ask');
  const src = temp('src');
  writeFileSync(join(src, 'troop-plugin.json'), JSON.stringify({ schema: 1, id: 'proj-dir', version: '1.0.0', name: 'proj-dir', platforms: ['windows', 'linux', 'macos'], mcp: [{ id: 'x', command: 'node', args: ['-v'], engines: ['codex'] }] }));
  const resolve = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k' }).get('mcp.resolve')!.handler as (p: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<{ project_dir: string | null }>;
  const old = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = home;
  try {
    installPlugin(db, { source: src, approved_permissions: [] });
    const base = { plugin_id: 'proj-dir', server_id: 'x', token: shimToken('proj-dir') };
    assert.equal((await resolve({ ...base, session_secret: secret }, { ui: false })).project_dir, project);
    assert.equal((await resolve(base, { ui: false })).project_dir, null);
    assert.equal((await resolve({ ...base, session_secret: 'nope' }, { ui: false })).project_dir, null);
  } finally { if (old === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = old; }
});

const win = process.platform === 'win32' ? false : 'needs Windows';

test('install screen names an action started through node or powershell under Not sandboxed, not a shipped .js', { skip: win }, () => {
  const m = { schema: 1, id: 'a', version: '1.0.0', name: 'A', actions: [
    { id: 'viaNode', run: ['node', 'x.js'] }, { id: 'viaPs', run: ['powershell', '-File', 'x.ps1'] }, { id: 'shipped', run: ['bin/x.js'] },
  ] } as never;
  const line = installScreen(m, null).warnings.find((w) => w.startsWith('Not sandboxed:')) ?? '';
  assert.match(line, /action viaNode/);
  assert.match(line, /action viaPs/);
  assert.doesNotMatch(line, /action shipped/);
});

test('unsafeGrant refuses UNC and device-prefix forms as a network or device path and allows a temp folder', () => {
  for (const d of [String.raw`\\localhost\c$\Users\x`, String.raw`\\?\UNC\localhost\c$\x`, String.raw`\\?\C:\x`]) assert.match(unsafeGrant(d) ?? '', /network or device path/, d);
  assert.equal(unsafeGrant(temp('ok')), null);
});

test('a shipped .js action is refused with "inside your user folder" when node is under the user folder', { skip: win }, async () => {
  const dir = temp('plugin');
  mkdirSync(join(dir, 'bin'), { recursive: true });
  writeFileSync(join(dir, 'bin', 'x.js'), '');
  const real = os.homedir;
  os.homedir = () => dirname(process.execPath);
  try {
    const r = await runAction({
      plugin: plugin(dir, [{ id: 'x', run: ['bin/x.js'], timeout_seconds: 5 }]),
      actionId: 'x', input: {}, projectDir: temp('project'), run: { id: 'r', dir: join(temp('run'), 'run') }, secret: () => null,
    });
    assert.equal(r.ok, false);
    assert.match((r as { error: { message: string } }).error.message, /inside your user folder/);
  } finally { os.homedir = real; }
});
