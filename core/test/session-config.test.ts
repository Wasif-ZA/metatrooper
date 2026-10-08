import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const KEYS = ['HOME', 'USERPROFILE', 'METATROOPER_HOME', 'METATROOPER_CLAUDE_SETTINGS', 'METATROOPER_CODEX_CONFIG'] as const;

async function withHome(fn: (home: string) => Promise<void> | void): Promise<void> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-session-config-'));
  const prev = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  process.env.METATROOPER_CLAUDE_SETTINGS = path.join(home, '.claude', 'settings.json');
  process.env.METATROOPER_CODEX_CONFIG = path.join(home, '.codex', 'config.toml');
  try {
    await fn(home);
  } finally {
    for (const k of KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
    fs.rmSync(home, { recursive: true, force: true });
  }
}

const claude = { id: 'claude', command: 'claude', version_cmd: ['claude'], state_source: 'hooks' as const, roles: ['worker'], cost_rank: 3, mcp_attach: { kind: 'claude-mcp-config-flag' } };

test('Claude hooks travel in a per-session settings file and the global settings stay untouched', () => withHome(async (home) => {
  const { sessionHookArgs, installClaude, uninstallClaude } = await import('../src/hooks/install.ts');
  const args = sessionHookArgs(claude, 'S1');
  assert.equal(args.length, 1);
  assert.ok(args[0].startsWith('--settings='));
  const file = args[0].slice('--settings='.length);
  assert.equal(path.resolve(file), path.join(home, 'mt', 'mcp', 'S1.settings.json'));
  const hooks = JSON.parse(fs.readFileSync(file, 'utf8')).hooks;
  assert.deepEqual(Object.keys(hooks), ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd']);
  assert.equal(hooks.PreToolUse[0].matcher, '*');
  assert.match(hooks.Stop[0].hooks[0].command, /event\.js" claude\.Stop$/);
  assert.ok(!fs.existsSync(process.env.METATROOPER_CLAUDE_SETTINGS!));
  assert.deepEqual(sessionHookArgs({ ...claude, mcp_attach: undefined }, 'S2'), []);

  installClaude();
  assert.deepEqual(sessionHookArgs(claude, 'S3'), []);
  uninstallClaude();
}));

test('uninstallClaude with no install record removes only MetaTrooper hook entries', () => withHome(async () => {
  const { planClaudeInstall, uninstallClaude } = await import('../src/hooks/install.ts');
  const settings = process.env.METATROOPER_CLAUDE_SETTINGS!;
  fs.mkdirSync(path.dirname(settings), { recursive: true });
  fs.writeFileSync(settings, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] }, theme: 'dark' }));
  fs.writeFileSync(settings, planClaudeInstall().after);
  uninstallClaude();
  const after = JSON.parse(fs.readFileSync(settings, 'utf8'));
  assert.deepEqual(after.hooks.Stop, [{ hooks: [{ type: 'command', command: 'echo mine' }] }]);
  assert.equal(after.theme, 'dark');
  assert.ok(!JSON.stringify(after).includes('event.js'));
}));

test('untrustFolder removes only the folder trustFolder added from each store', () => withHome(async (home) => {
  const { trustFolder, untrustFolder } = await import('../src/trust.ts');
  const json = path.join(home, 'state.json');
  const list = path.join(home, 'settings.json');
  const toml = path.join(home, 'config.toml');
  const files = {
    [json]: JSON.stringify({ oauth: 'keep', projects: { 'c:/other': { hasTrustDialogAccepted: true } } }, null, 2),
    [list]: JSON.stringify({ trustedWorkspaces: ['c:\\other'] }, null, 2),
    [toml]: 'model = "x"\n\n[projects.\'c:\\other\']\ntrust_level = "trusted"\n',
  };
  for (const [f, t] of Object.entries(files)) fs.writeFileSync(f, t);
  const engines = [
    { id: 'a', trust: { kind: 'json-map', file: json, at: ['projects'], set: { hasTrustDialogAccepted: true }, path_style: 'posix' } },
    { id: 'b', trust: { kind: 'json-list', file: list, at: ['trustedWorkspaces'], path_style: 'windows' } },
    { id: 'c', trust: { kind: 'toml-table', file: toml, at: ['projects'], set: { trust_level: 'trusted' }, path_style: 'windows-lower' } },
  ] as any[];
  const wt = 'C:\\Work\\Tree';
  trustFolder(wt, engines);
  assert.ok(Object.keys(files).every((f) => fs.readFileSync(f, 'utf8') !== files[f]));
  assert.deepEqual(untrustFolder(wt, engines), ['a', 'b', 'c']);
  for (const [f, t] of Object.entries(files)) assert.equal(fs.readFileSync(f, 'utf8'), t, f);
}));

test('per-session files of exited and unknown sessions are swept; a live session keeps its files', () => withHome(async (home) => {
  const { sweepSessionFiles, removeSessionFiles } = await import('../src/plugins/mcp.ts');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const db = openCoreDb();
  try {
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
    const add = db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p', 'claude', 'pty', ?, 'x', 'x')");
    add.run('LIVE', 'working');
    add.run('GONE', 'exited');
    const dir = path.join(home, 'mt', 'mcp');
    fs.mkdirSync(dir, { recursive: true });
    for (const id of ['LIVE', 'GONE', 'ORPHAN']) for (const ext of ['.json', '.settings.json']) fs.writeFileSync(path.join(dir, id + ext), '{}');
    sweepSessionFiles(db);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['LIVE.json', 'LIVE.settings.json']);
    removeSessionFiles('LIVE');
    assert.deepEqual(fs.readdirSync(dir), []);
  } finally {
    db.close();
  }
}));

test('Codex gets MCP servers and the notify wrapper as -c overrides and config.toml is not written', () => withHome(async () => {
  const { sessionHookArgs } = await import('../src/hooks/install.ts');
  const { mcpAttachArgs } = await import('../src/plugins/mcp.ts');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { coreDir } = await import('../src/paths.ts');
  const script = path.join(coreDir, 'codex-notify.js').split(path.sep).join('/');
  const config = process.env.METATROOPER_CODEX_CONFIG!;
  fs.mkdirSync(path.dirname(config), { recursive: true });
  const inner = JSON.stringify(['orig.exe', 'turn-ended']);
  const text = `notify = ${JSON.stringify(['node', script, inner])}\n[mcp_servers.metatrooper-browser]\ncommand = "user"\n`;
  fs.writeFileSync(config, text);
  const codex = { ...claude, id: 'codex', state_source: 'notify' as const, mcp_attach: { kind: 'codex-config' } };
  assert.deepEqual(sessionHookArgs(codex, 'C1'), ['-c', `notify=[${['node', script, inner].map((v) => JSON.stringify(v)).join(', ')}]`]);
  const db = openCoreDb();
  try {
    assert.deepEqual(mcpAttachArgs(db, codex, 'C1'), []);
    fs.writeFileSync(config, '');
    const args = mcpAttachArgs(db, codex, 'C2');
    assert.equal(args.length, 4);
    assert.match(args[1], /^mcp_servers\.metatrooper-browser\.command=".+"$/);
    assert.match(args[3], /^mcp_servers\.metatrooper-browser\.args=\[".+metatrooper-browser\.js"\]$/);
  } finally {
    db.close();
  }
  assert.equal(fs.readFileSync(config, 'utf8'), '');
}));
