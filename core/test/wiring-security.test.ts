import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { buildMethods } from '../src/methods.ts';
import { schemaFile } from '../src/paths.ts';
import { CommandRunner } from '../src/pipe/commands.ts';
import { automationTick, realDeps } from '../src/automations.ts';
import { E, RpcError } from '../src/pipe/errors.ts';

const ctx = { ui: true, origin: 'test' };
function fixture(t: any) {
  const home = mkdtempSync(join(tmpdir(), 'wiring-security-'));
  const before = process.env.METATROOPER_HOME; process.env.METATROOPER_HOME = home;
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(schemaFile, 'utf8'));
  const project = join(home, 'project'); mkdirSync(project);
  db.prepare('INSERT INTO project (id,path,name,opened_at,last_opened) VALUES (?,?,?,?,?)').run('p1', project, 'test', '2030-01-01', '2030-01-01');
  db.prepare('INSERT INTO engine (id,spec_json,cost_rank,provider) VALUES (?,?,?,?)').run('codex', '{}', 1, 'local-cli');
  const methods = buildMethods(db, { engines: () => [], stop() {}, uiKey: 'k' });
  t.after(() => { db.close(); if (before === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = before; rmSync(home, { recursive: true, force: true }); });
  return { home, project, db, methods };
}
const invalid = (e: any) => { assert.ok([-32602, -32003].includes(e.code), e.stack); return true; };

// Protects methods.ts:68, :103, :109 and commands.ts:77. No trusted UI key means no mutation.
for (const method of ['plugin.install', 'automation.set', 'worktree.create']) {
  test('wire-00 ' + method + ' is refused without a trusted UI connection', async t => {
    const f = fixture(t); const runner = new CommandRunner(f.db, f.methods);
    const params: Record<string, unknown> = {};
    if (method === 'worktree.create') {
      const git = (...a: string[]) => execFileSync('git', ['-C', f.project, ...a], { stdio: 'pipe', windowsHide: true });
      git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
      writeFileSync(join(f.project, 'a'), 'test'); git('add', 'a'); git('commit', '-m', 'fixture');
      Object.assign(params, { project_id: 'p1', branch: 'untrusted-create' });
    }
    await assert.rejects(runner.call({ id: 'untrusted', method, params, origin: 'renderer' }, { ui: false, origin: 'renderer' }), (e: any) => { assert.equal(e.code, -32012); return true; });
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM command').get()!.n, 0);
  });
}
// Protects methods.ts:580 and :595: branch-derived folders must remain contained; git rejects bad ref names.
test('wire-03 worktree branch traversal, dash and spaces are refused; slash branch stays contained', async t => {
  const f = fixture(t);
  const git = (...a: string[]) => execFileSync('git', ['-C', f.project, ...a], { stdio: 'pipe', windowsHide: true });
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.com');
  writeFileSync(join(f.project, 'a'), 'test'); git('add', 'a'); git('commit', '-m', 'fixture');
  const call = (branch: string) => f.methods.get('worktree.create')!.handler({ project_id: 'p1', branch }, ctx) as any;
  for (const branch of ['..', '../escape', 'a..b', '-x', 'with space']) assert.throws(() => call(branch), invalid, branch);
  const r = await call('feature/safe'); const rel = relative(join(f.home, 'worktrees', 'p1'), r.path);
  assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel), r.path);
  assert.equal(existsSync(join(r.path, '.git')), true);
});

// Execute the real session.launch handler with a launch recorder so even a removed guard cannot start an agent.
const methodSource = readFileSync(new URL('../src/methods.ts', import.meta.url), 'utf8');
function launchHarness() {
  const match = methodSource.match(/  m\.set\('session.launch', \{[^]*?\n  \}\);/); assert.ok(match);
  let handler: Function = () => {}; const launched: any[] = [];
  const engine = { id: 'codex', command: 'fake', provider: 'local-cli', model_arg: '-m', approval_profiles: { contained: [] } };
  const db = { prepare: (sql: string) => ({ get: () => sql.includes('FROM project') ? { id: 'p1', path: '/project', name: 'test' } : undefined }) };
  const c = vm.createContext({ m: { set: (_: string, v: any) => { handler = v.handler; } }, db, E, RpcError,
    getEngine: () => engine, path: { join: (...v: string[]) => v.join('/') }, homeDir: () => '/home', canonicalPath: (p: string) => p,
    settings: () => ({ sessions: { approval: 'ask' } }), fs: { readFileSync: () => { throw Error('no config'); } },
    launchSession: (_: unknown, opts: any) => { launched.push(opts); return { session_id: 'recorded' }; }, isPreset: () => true,
  });
  const strSource = methodSource.match(/^function str\([^]*?^}/m); assert.ok(strSource);
  vm.runInContext(stripTypeScriptTypes(strSource[0] + '\n' + match[0]), c);
  return { handler, launched, engine };
}
// Protects methods.ts:236, :250-262: malformed launch values cannot silently become defaults.
for (const [key, value] of [['approval', 'invalid-profile'], ['approval', 7], ['model', 7], ['model', ['injected']]] as const) {
  test('wire-03 rejects bad launch ' + key + '=' + JSON.stringify(value), async () => {
    const h = launchHarness();
    await assert.rejects(async () => h.handler({ project_id: 'p1', engine_id: 'codex', [key]: value }), invalid);
    assert.deepEqual(h.launched, []);
  });
}
// Protects methods.ts:262: a model on an engine without model_arg is rejected before launching.
test('wire-03 unsupported model never launches', async () => {
  const h = launchHarness(); delete (h.engine as any).model_arg;
  await assert.rejects(async () => h.handler({ project_id: 'p1', engine_id: 'codex', model: 'test-model' }), invalid);
  assert.deepEqual(h.launched, []);
});

// Protects methods.ts:831, :839-841: renderer argv and script are validated before persistence.
test('wire-07 rejects outside script paths and malformed runners without saving an automation', async t => {
  const f = fixture(t); writeFileSync(join(f.home, 'outside.mjs'), 'process.exit(0)');
  const base = { project_id: 'p1', name: 'check', every_min: 1, runner: ['node'], script: 'check.mjs', engine_id: 'codex', prompt: 'fix' };
  writeFileSync(join(f.project, 'check.mjs'), 'process.exit(0)');
  for (const script of ['../outside.mjs', join(f.home, 'outside.mjs')]) {
    await assert.rejects(async () => f.methods.get('automation.set')!.handler({ ...base, script }, ctx), invalid);
  }
  for (const runner of ['node -e injected', [], [''], [7]]) await assert.rejects(async () => f.methods.get('automation.set')!.handler({ ...base, runner }, ctx), invalid);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM automation').get()!.n, 0);
});
// Protects automations.ts:60-67: a renderer cannot approve replacement bytes by reusing a saved command.
test('wire-07 changed check script never reaches the runner', async t => {
  const f = fixture(t); const script = join(f.project, 'check.mjs'); writeFileSync(script, 'original');
  await f.methods.get('automation.set')!.handler({ project_id: 'p1', name: 'check', every_min: 1, runner: ['node'], script: 'check.mjs', engine_id: 'codex', prompt: 'fix' }, ctx);
  const now = Date.now(); f.db.prepare('UPDATE automation SET next_due = ?').run(new Date(now).toISOString());
  writeFileSync(script, 'replacement'); let runs = 0;
  await automationTick(f.db, { now: () => now, readFile: readFileSync, runCheck: async () => { runs++; return { code: 0 }; }, launch: async () => { throw Error('must not launch'); } });
  assert.equal(runs, 0); assert.equal(f.db.prepare('SELECT outcome FROM automation_run').get()!.outcome, 'failed');
});
// Protects automations.ts:92: metacharacters stay literal arguments, never a shell program.
test('wire-07 real check runner passes shell metacharacters literally', async t => {
  const f = fixture(t); const output = join(f.project, 'argv.json'); const marker = join(f.project, 'injected');
  const script = join(f.project, 'args.cjs'); writeFileSync(script, 'require("fs").writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))');
  const arg = '& echo INJECTED > "' + marker + '"';
  const result = await realDeps(async () => ({ session_id: 'unused' })).runCheck([process.execPath, script, output, arg], f.project, 5000);
  assert.equal(result.code, 0); assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), [arg]); assert.equal(existsSync(marker), false);
});

// Protects plugins/store.ts:161-169 via methods.ts:637-642: rejected installs persist nothing.
test('wire-08 changed manifest or mismatched permissions installs nothing', async t => {
  const f = fixture(t); const source = join(f.home, 'plugin-source'); mkdirSync(source);
  const manifest = { schema: 1, id: 'wire-test', version: '1.0.0', name: 'Wire test', platforms: ['windows', 'linux', 'macos'], permissions: ['network'] };
  writeFileSync(join(source, 'troop-plugin.json'), JSON.stringify(manifest));
  const preview = await f.methods.get('plugin.preview')!.handler({ source }, ctx) as any;
  assert.equal(preview.valid, true, JSON.stringify(preview.errors));
  await assert.rejects(async () => f.methods.get('plugin.install')!.handler({ source, approved_permissions: [], manifest_hash: preview.manifest_hash }, ctx), invalid);
  writeFileSync(join(source, 'troop-plugin.json'), JSON.stringify({ ...manifest, description: 'changed after preview' }));
  await assert.rejects(async () => f.methods.get('plugin.install')!.handler({ source, approved_permissions: ['network'], manifest_hash: preview.manifest_hash }, ctx), invalid);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM plugin').get()!.n, 0);
});
