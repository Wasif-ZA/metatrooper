import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export interface EngineSpec {
  id: string;
  command: string;
  args?: string[];
  prompt_arg?: string;
  version_cmd: string[];
  auth_cmd?: string[];
  auth_ok?: { exit_code?: number; stdout_regex?: string };
  state_source: 'hooks' | 'notify' | 'file-activity' | 'herdr' | 'process';
  activity_glob?: string;
  mcp_attach?: { kind: string; path?: string };
  roles: string[];
  cost_rank: number;
  provider?: 'local-cli' | 'api-key' | 'gateway';
  usage_source?: 'claude-transcript' | 'codex-session' | 'none';
}

const HOME = os.homedir().split(String.fromCharCode(92)).join('/');

export const BUILT_IN: EngineSpec[] = [
  {
    id: 'claude', command: 'claude', prompt_arg: 'positional', version_cmd: ['claude', '--version'],
    state_source: 'hooks', mcp_attach: { kind: 'claude-mcp-config-flag' },
    roles: ['research', 'plan', 'worker', 'review', 'verify', 'visual-check'], cost_rank: 3, usage_source: 'claude-transcript',
  },
  {
    id: 'codex', command: 'codex', prompt_arg: 'positional', version_cmd: ['codex', '--version'],
    auth_cmd: ['codex', 'login', 'status'], auth_ok: { exit_code: 0 },
    state_source: 'notify', mcp_attach: { kind: 'codex-config', path: '~/.codex/config.toml' },
    roles: ['plan', 'worker', 'review', 'verify'], cost_rank: 2, usage_source: 'codex-session',
  },
  {
    id: 'agy', command: 'agy', version_cmd: ['agy', '--version'],
    state_source: 'file-activity', activity_glob: `${HOME}/.gemini/antigravity-cli/brain/*/.system_generated/logs/**`,
    mcp_attach: { kind: 'agy-config' },
    roles: ['research', 'worker', 'review', 'visual-check'], cost_rank: 1, usage_source: 'none',
  },
];

export function loadEngines(): EngineSpec[] {
  const override = process.env.METATROOPER_ENGINES;
  if (override) return JSON.parse(fs.readFileSync(path.resolve(override), 'utf8')) as EngineSpec[];
  return BUILT_IN;
}

export function syncEngines(db: DatabaseSync, engines: EngineSpec[]): void {
  const up = db.prepare(
    `INSERT INTO engine (id, plugin_id, spec_json, cost_rank, provider) VALUES (?, NULL, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET spec_json = excluded.spec_json, cost_rank = excluded.cost_rank, provider = excluded.provider`,
  );
  for (const e of engines) up.run(e.id, JSON.stringify(e), e.cost_rank, e.provider ?? 'local-cli');
}

export function getEngine(db: DatabaseSync, id: string): EngineSpec | null {
  const row = db.prepare('SELECT spec_json FROM engine WHERE id = ?').get(id) as { spec_json: string } | undefined;
  return row ? (JSON.parse(row.spec_json) as EngineSpec) : null;
}
