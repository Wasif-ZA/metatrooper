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
