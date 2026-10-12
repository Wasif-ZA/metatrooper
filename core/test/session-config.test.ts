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
  const s1 = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(s1.statusLine);
  assert.ok(s1.statusLine.command.includes('--user-statusline'));
  assert.match(s1.statusLine.command, /statusline\.js/);
  const hooks = s1.hooks;
  assert.ok(hooks);
  assert.deepEqual(Object.keys(hooks), ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd']);
  assert.equal(hooks.PreToolUse[0].matcher, '*');
  assert.match(hooks.Stop[0].hooks[0].command, /event\.js" claude\.Stop$/);
  assert.ok(!fs.existsSync(process.env.METATROOPER_CLAUDE_SETTINGS!));
  assert.deepEqual(sessionHookArgs({ ...claude, mcp_attach: undefined }, 'S2'), []);

  installClaude();
  const args3 = sessionHookArgs(claude, 'S3');
  assert.equal(args3.length, 1);
  assert.ok(args3[0].startsWith('--settings='));
  const file3 = args3[0].slice('--settings='.length);
  assert.equal(path.resolve(file3), path.join(home, 'mt', 'mcp', 'S3.settings.json'));
  const s3 = JSON.parse(fs.readFileSync(file3, 'utf8'));
  assert.ok(s3.statusLine);
  assert.ok(s3.statusLine.command.includes('--user-statusline'));
  assert.match(s3.statusLine.command, /statusline\.js/);
  assert.equal('hooks' in s3, false);
  uninstallClaude();
}));

test('the StopFailure hook goes in for Claude Code 2.1.78 and later only, survives an install made before an upgrade, and uninstall removes it', () => withHome(async () => {
  const { sessionHookArgs, installClaude, uninstallClaude } = await import('../src/hooks/install.ts');
  const { sandboxHookArgs } = await import('../src/sandbox/launch.ts');
  const { spoolDir } = await import('../src/sandbox/spool.ts');
  const hooksOf = (args: string[]) => JSON.parse(fs.readFileSync(args[0].slice('--settings='.length), 'utf8')).hooks;
  const six = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd'];
  assert.deepEqual(Object.keys(hooksOf(sessionHookArgs(claude, 'A', null))), six);
  assert.deepEqual(Object.keys(hooksOf(sessionHookArgs(claude, 'B', '2.1.77 (Claude Code)'))), [...six, 'PermissionRequest']);
  const recent = hooksOf(sessionHookArgs(claude, 'C', '2.1.78 (Claude Code)'));
  assert.deepEqual(Object.keys(recent), [...six, 'StopFailure', 'PermissionRequest']);
  assert.match(recent.StopFailure[0].hooks[0].command, /event\.js" claude\.StopFailure$/);
  assert.equal(recent.StopFailure[0].matcher, undefined);

  const settings = process.env.METATROOPER_CLAUDE_SETTINGS!;
  installClaude('2.0.1 (Claude Code)');
  assert.equal('StopFailure' in JSON.parse(fs.readFileSync(settings, 'utf8')).hooks, false);
  assert.deepEqual(Object.keys(hooksOf(sessionHookArgs(claude, 'D', '2.1.296 (Claude Code)'))), ['StopFailure', 'PermissionRequest', 'PostToolUseFailure']);
  installClaude('2.1.296 (Claude Code)');
  assert.ok(JSON.parse(fs.readFileSync(settings, 'utf8')).hooks.StopFailure);
  assert.equal('hooks' in JSON.parse(fs.readFileSync(sessionHookArgs(claude, 'E', '2.1.296 (Claude Code)')[0].slice('--settings='.length), 'utf8')), false);
  uninstallClaude();
  assert.ok(!fs.existsSync(settings) || !fs.readFileSync(settings, 'utf8').includes('event.js'));

  const spool = spoolDir('X');
  fs.mkdirSync(spool, { recursive: true });
  sandboxHookArgs(claude, 'X');
  assert.ok(JSON.parse(fs.readFileSync(path.join(spool, 'settings.json'), 'utf8')).hooks.StopFailure);
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
    fs.mkdirSync(path.join(dir, 'GONE'));
    const gemini = path.join(home, 'mt', 'engines', 'gemini');
    fs.mkdirSync(path.join(gemini, 'notes'), { recursive: true });
    for (const name of ['LIVE.json', 'GONE.json', 'ORPHAN.json', 'README.md', '.keep', 'admin.settings.json']) fs.writeFileSync(path.join(gemini, name), '{}');
    for (const name of ['README.md', '.keep']) fs.writeFileSync(path.join(dir, name), '');
    sweepSessionFiles(db);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['.keep', 'LIVE.json', 'LIVE.settings.json', 'README.md']);
    assert.deepEqual(fs.readdirSync(gemini).sort(), ['.keep', 'LIVE.json', 'README.md', 'admin.settings.json', 'notes']);
    removeSessionFiles('LIVE');
    assert.deepEqual(fs.readdirSync(dir).sort(), ['.keep', 'README.md']);
    assert.deepEqual(fs.readdirSync(gemini).sort(), ['.keep', 'README.md', 'admin.settings.json', 'notes']);
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
  const hooked = sessionHookArgs({ ...codex, hooks: { kind: 'codex-config', events: ['Stop'] } }, 'C1');
  assert.deepEqual(hooked.filter((a) => a !== '-c').map((a) => a.split('=')[0]), ['hooks.Stop']);
  const db = openCoreDb();
  try {
    assert.deepEqual(mcpAttachArgs(db, codex, 'C1', true), []);
    fs.writeFileSync(config, '');
    assert.deepEqual(mcpAttachArgs(db, codex, 'C2'), []);
    assert.deepEqual(mcpAttachArgs(db, claude, 'K1'), []);
    const args = mcpAttachArgs(db, codex, 'C2', true);
    assert.equal(args.length, 4);
    assert.match(args[1], /^mcp_servers\.metatrooper-browser\.command=".+"$/);
    assert.match(args[3], /^mcp_servers\.metatrooper-browser\.args=\[".+metatrooper-browser\.js"\]$/);
  } finally {
    db.close();
  }
  assert.equal(fs.readFileSync(config, 'utf8'), '');
}));

test('worktree.create keeps a branch with backslashes inside the worktrees folder', () => withHome(async (home) => {
  const { openCoreDb } = await import('../src/store/db.ts');
  const { buildMethods } = await import('../src/methods.ts');
  const list = path.join(home, 'trusted.json');
  fs.writeFileSync(list, JSON.stringify({ trusted: [] }));
  const engines = [{ id: 'a', trust: { kind: 'json-list', file: list, at: ['trusted'], path_style: 'posix' } }] as any[];
  const proj = path.join(home, 'proj');
  fs.mkdirSync(proj);
  fs.mkdirSync(path.join(home, 'mt', 'outside', '.git'), { recursive: true });
  const db = openCoreDb();
  try {
    const m = buildMethods(db, { engines: () => engines, stop: () => {}, uiKey: 'k' });
    const { project_id } = m.get('project.open')!.handler({ path: proj }, { ui: false, origin: 'test' }) as { project_id: string };
    const branch = ['..', '..', 'outside'].join(String.fromCharCode(92));
    try { m.get('worktree.create')!.handler({ project_id, branch }, { ui: false, origin: 'test' }); } catch {}
    assert.deepEqual(JSON.parse(fs.readFileSync(list, 'utf8')).trusted, []);
    fs.mkdirSync(path.join(home, 'mt', 'worktrees', project_id, '.git'), { recursive: true });
    fs.mkdirSync(path.join(home, 'mt', 'worktrees', '.git'), { recursive: true });
    for (const name of ['..', '.']) {
      assert.throws(() => m.get('worktree.create')!.handler({ project_id, branch: name }, { ui: false, origin: 'test' }), { message: /branch/ }, name);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(list, 'utf8')).trusted, []);
  } finally {
    db.close();
  }
}));

test('event lookups by session use an index on an existing database', () => withHome(async () => {
  const { openCoreDb } = await import('../src/store/db.ts');
  const db = openCoreDb();
  try {
    const plan = (db.prepare("EXPLAIN QUERY PLAN SELECT at FROM event WHERE session_id = ? AND kind NOT LIKE 'term.%' ORDER BY julianday(at) DESC LIMIT 1").all('s') as Array<{ detail: string }>).map((r) => r.detail).join(' ');
    assert.match(plan, /USING INDEX event_session_idx/);
  } finally {
    db.close();
  }
}));

test('hook writers commit without a full fsync per event', () => withHome(async () => {
  const { openCoreDb } = await import('../src/store/db.ts');
  const { openWriterDb } = await import('../src/events/append.ts');
  openCoreDb().close();
  const db = openWriterDb()!;
  try {
    assert.equal((db.prepare('PRAGMA synchronous').get() as { synchronous: number }).synchronous, 1);
  } finally {
    db.close();
  }
}));

test('a settings file that is JSON but not an object falls back to defaults and is reported', () => withHome(async (home) => {
  const { settings, settingsError, setSetting } = await import('../src/settings.ts');
  const file = path.join(home, 'mt', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let stamp = Date.now() / 1000;
  for (const body of ['null', '7', '[]']) {
    fs.writeFileSync(file, body);
    stamp += 5;
    fs.utimesSync(file, stamp, stamp);
    assert.equal(settings().sessions.approval, 'ask', body);
    assert.equal(settingsError(), 'settings.json is not a JSON object', body);
    assert.throws(() => setSetting('ui', 'theme', 'charcoal'), /not a JSON object/, body);
    assert.equal(fs.readFileSync(file, 'utf8'), body);
  }
}));

test('uninstalling engine settings restores a key whose original value was null and removes one that was absent', () => withHome(async (home) => {
  const { installEngineSettings, uninstallEngineSettings } = await import('../src/hooks/install.ts');
  const file = path.join(home, 'engine-settings.json');
  fs.writeFileSync(file, JSON.stringify({ a: null, b: 1 }));
  const engines = [{ id: 'e', settings: { file, set: { a: 5, c: 7 } } }] as any[];
  installEngineSettings(engines);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: 5, b: 1, c: 7 });
  uninstallEngineSettings();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { a: null, b: 1 });
}));
