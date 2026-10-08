import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeCodexMcp } from '../src/plugins/mcp.ts';
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

const block = (name: string) => `${BEGIN}\n[mcp_servers.${name}]\ncommand = "node"\nargs = ["server.js"]\n\n${END}\n`;

test('removeCodexMcp leaves exactly the user content', () => withConfig((file) => {
  const user = 'model = "fixture"\n\n[mcp_servers.user-server]\ncommand = "user"\nargs = []\n';
  writeFileSync(file, `${user}\n${block('metatrooper-browser')}`);
  removeCodexMcp();
  assert.equal(readFileSync(file, 'utf8'), user);
}));

test('uninstallCodex removes the MetaTrooper MCP block', () => withConfig((file) => {
  const user = 'model = "fixture"\n';
  writeFileSync(file, `${user}\n${block('metatrooper-browser')}`);
  uninstallCodex();
  const config = readFileSync(file, 'utf8');
  assert.equal(config, user);
  assert.ok(!config.includes(BEGIN));
  assert.ok(!config.includes(END));
}));
