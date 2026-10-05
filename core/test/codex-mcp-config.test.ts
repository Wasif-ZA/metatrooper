import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncCodexMcp, removeCodexMcp } from '../src/plugins/mcp.ts';
import { uninstallCodex } from '../src/hooks/install.ts';

const BEGIN = '# metatrooper mcp: begin (written by MetaTrooper; troop hooks uninstall removes it)';
const END = '# metatrooper mcp: end';

function withConfig(fn: (file: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'metatrooper-codex-mcp-'));
  const file = join(dir, 'config.toml');
  const previous = process.env.METATROOPER_CODEX_CONFIG;
  const previousHome = process.env.HOME;
  const previousProfile = process.env.USERPROFILE;
  process.env.METATROOPER_CODEX_CONFIG = file;
  process.env.HOME = dir;
  process.env.USERPROFILE = dir;
  try { fn(file); }
  finally {
    if (previous === undefined) delete process.env.METATROOPER_CODEX_CONFIG;
    else process.env.METATROOPER_CODEX_CONFIG = previous;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = previousProfile;
    rmSync(dir, { recursive: true, force: true });
  }
}

const server = (name: string, args: string[] = ['server.js']) => ({ name, args });

test('Codex MCP sync preserves existing user content and is byte stable on repeated sync', () => withConfig((file) => {
  const user = 'model = "fixture"\n\n[mcp_servers.user-server]\ncommand = "user"\nargs = []\n';
  writeFileSync(file, user);
  syncCodexMcp('node', [server('metatrooper-browser'), server('plugin-server')]);
  const first = readFileSync(file);
  assert.ok(first.subarray(0, Buffer.byteLength(user)).equals(Buffer.from(user)));
  const mtime = statSync(file).mtimeMs;
  syncCodexMcp('node', [server('metatrooper-browser'), server('plugin-server')]);
  assert.deepEqual(readFileSync(file), first);
  assert.equal(statSync(file).mtimeMs, mtime);
}));

test('Codex MCP sync does not duplicate a server defined by the user outside the block', () => withConfig((file) => {
  const user = '[mcp_servers.metatrooper-browser]\ncommand = "user-browser"\nargs = []\n';
  writeFileSync(file, user);
  syncCodexMcp('node', [server('metatrooper-browser'), server('plugin-server')]);
  const config = readFileSync(file, 'utf8');
  assert.equal((config.match(/\[mcp_servers\.metatrooper-browser\]/g) ?? []).length, 1);
  assert.match(config, /command = "user-browser"/);
  assert.match(config, /\[mcp_servers\.plugin-server\]/);
}));

test('Codex MCP sync drops a removed plugin server on the next sync', () => withConfig((file) => {
  syncCodexMcp('node', [server('metatrooper-browser'), server('plugin-server')]);
  syncCodexMcp('node', [server('metatrooper-browser')]);
  const config = readFileSync(file, 'utf8');
  assert.doesNotMatch(config, /\[mcp_servers\.plugin-server\]/);
  assert.match(config, /\[mcp_servers\.metatrooper-browser\]/);
}));

test('removeCodexMcp leaves exactly the user content', () => withConfig((file) => {
  const user = 'model = "fixture"\n\n[mcp_servers.user-server]\ncommand = "user"\nargs = []\n';
  writeFileSync(file, user);
  syncCodexMcp('node', [server('metatrooper-browser')]);
  removeCodexMcp();
  assert.equal(readFileSync(file, 'utf8'), user);
}));

test('uninstallCodex removes the MetaTrooper MCP block', () => withConfig((file) => {
  const user = 'model = "fixture"\n';
  writeFileSync(file, user);
  syncCodexMcp('node', [server('metatrooper-browser')]);
  uninstallCodex();
  const config = readFileSync(file, 'utf8');
  assert.equal(config, user);
  assert.ok(!config.includes(BEGIN));
  assert.ok(!config.includes(END));
}));
