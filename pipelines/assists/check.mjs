// Detect helper for pipelines/assists/registry.json: exits 0 when the named MCP server or folder is set up.
// node check.mjs mcp <server name> | node check.mjs dir-env <ENV VAR>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [kind, name] = process.argv.slice(2);

function claudeServers() {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    return [s.mcpServers ?? {}, ...Object.values(s.projects ?? {}).map((p) => p.mcpServers ?? {})];
  } catch { return []; }
}

function codexHas(server) {
  try { return fs.readFileSync(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8').includes(`[mcp_servers.${server}]`); }
  catch { return false; }
}

if (kind === 'mcp' && name) {
  const found = claudeServers().some((m) => name in m) || codexHas(name);
  if (found) console.log(`MCP server ${name} configured`);
  process.exit(found ? 0 : 1);
}
if (kind === 'dir-env' && name) {
  const dir = process.env[name];
  const found = Boolean(dir && fs.existsSync(dir));
  if (found) console.log(dir);
  process.exit(found ? 0 : 1);
}
process.exit(2);
