import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export interface EngineSpec {
  id: string;
  command: string;
  args?: string[];
  prompt_arg?: string;
  resume_args?: string[];
  version_cmd: string[];
  auth_cmd?: string[];
  auth_ok?: { exit_code?: number; stdout_regex?: string };
  state_source: 'hooks' | 'notify' | 'file-activity' | 'process';
  activity_glob?: string;
  activity_waiting?: { file?: string; last_line_regex: string };
  trust?: TrustSpec;
  approval_profiles?: Record<string, string[]>;
  ask_near_acu?: boolean;
  settings?: { file: string; set: Record<string, string | number | boolean> };
  mcp_attach?: { kind: string; path?: string };
  roles: string[];
  cost_rank: number;
  provider?: 'local-cli' | 'api-key' | 'gateway';
  usage_source?: 'claude-transcript' | 'codex-session' | 'none';
  print_args?: string[];
  sandbox?: SandboxSpec;
}

export interface SandboxSpec {
  install: string[];
  logins: Array<{ file: string; mode: 'ro' } | { volume: string; at: string }>;
  egress: string[];
}

export interface TrustSpec {
  kind: 'json-map' | 'json-list' | 'toml-table';
  file: string;
  at: string[];
  set?: Record<string, string | number | boolean>;
  path_style: 'posix' | 'windows' | 'windows-lower';
}

const HOME = os.homedir().split(String.fromCharCode(92)).join('/');

export const BUILT_IN: EngineSpec[] = [
  {
    id: 'claude', command: 'claude', prompt_arg: 'positional', resume_args: ['--resume', '{native_id}'], version_cmd: ['claude', '--version'],
    approval_profiles: { edits: ['--permission-mode', 'acceptEdits'], contained: ['--permission-mode', 'auto'], isolated: ['--dangerously-skip-permissions'] },
    sandbox: { install: ['npm install -g @anthropic-ai/claude-code'], logins: [{ file: '~/.claude/.credentials.json', mode: 'ro' }], egress: ['api.anthropic.com', 'statsig.anthropic.com'] },
    state_source: 'hooks', mcp_attach: { kind: 'claude-mcp-config-flag' },
    roles: ['research', 'plan', 'worker', 'review', 'verify', 'visual-check'], cost_rank: 3, usage_source: 'claude-transcript',
    trust: { kind: 'json-map', file: '~/.claude.json', at: ['projects'], set: { hasTrustDialogAccepted: true }, path_style: 'posix' },
  },
  {
    id: 'codex', command: 'codex', ask_near_acu: true, prompt_arg: 'positional', resume_args: ['resume', '{native_id}'], version_cmd: ['codex', '--version'],
    approval_profiles: { edits: ['--sandbox', 'workspace-write'], contained: ['--approve-for-me'], isolated: ['--dangerously-bypass-approvals-and-sandbox'] },
    sandbox: { install: ['npm install -g @openai/codex'], logins: [{ file: '~/.codex/auth.json', mode: 'ro' }], egress: ['chatgpt.com', 'api.openai.com', 'auth.openai.com'] },
    auth_cmd: ['codex', 'login', 'status'], auth_ok: { exit_code: 0 },
    state_source: 'notify', mcp_attach: { kind: 'codex-config', path: '~/.codex/config.toml' },
    roles: ['plan', 'worker', 'review', 'verify'], cost_rank: 2, usage_source: 'codex-session',
    trust: { kind: 'toml-table', file: '~/.codex/config.toml', at: ['projects'], set: { trust_level: 'trusted' }, path_style: 'windows-lower' },
  },
  {
    id: 'agy', command: 'agy', ask_near_acu: true, prompt_arg: '--prompt-interactive', version_cmd: ['agy', '--version'],
    approval_profiles: { edits: ['--mode', 'accept-edits'], contained: ['--mode', 'accept-edits', '--sandbox'] },
    state_source: 'file-activity', activity_glob: `${HOME}/.gemini/antigravity-cli/brain/*/.system_generated/logs/**`,
    activity_waiting: { file: 'transcript.jsonl', last_line_regex: '"type":"PLANNER_RESPONSE".*"tool_calls":\\[\\{' },
    mcp_attach: { kind: 'agy-config' },
    roles: ['research', 'worker', 'review', 'visual-check'], cost_rank: 1, usage_source: 'none',
    print_args: ['--print', '{prompt}', '--print-timeout', '0', '--output-format', 'text'],
    trust: { kind: 'json-list', file: '~/.gemini/antigravity-cli/settings.json', at: ['trustedWorkspaces'], path_style: 'windows' },
    settings: { file: '~/.gemini/antigravity-cli/settings.json', set: { toolPermission: 'proceed-in-sandbox' } },
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

const ACTIVE = `SELECT e.id, e.spec_json FROM engine e LEFT JOIN plugin p ON p.id = e.plugin_id
  WHERE (e.plugin_id IS NULL OR p.enabled = 1)`;

export function getEngine(db: DatabaseSync, id: string): EngineSpec | null {
  const row = db.prepare(`${ACTIVE} AND e.id = ?`).get(id) as { spec_json: string } | undefined;
  return row ? (JSON.parse(row.spec_json) as EngineSpec) : null;
}

/** Built-in engines plus the engines of enabled plugins. */
export function activeEngines(db: DatabaseSync): EngineSpec[] {
  return (db.prepare(ACTIVE).all() as Array<{ spec_json: string }>).map((r) => JSON.parse(r.spec_json) as EngineSpec);
}

/** The engine for a role: the pin when it is usable, else the lowest cost_rank that lists the role, is installed and is not red. */
export function bindRole(db: DatabaseSync, role: string, pinned?: string): EngineSpec | null {
  const usable = (e: EngineSpec) => {
    const c = db.prepare('SELECT installed, auth FROM engine_check WHERE engine_id = ? ORDER BY checked_at DESC LIMIT 1').get(e.id) as
      | { installed: number; auth: string }
      | undefined;
    return Boolean(c && c.installed && c.auth !== 'missing');
  };
  const engines = activeEngines(db);
  if (pinned) {
    const e = engines.find((x) => x.id === pinned);
    return e && usable(e) ? e : null;
  }
  return engines
    .filter((e) => e.roles.includes(role) && usable(e))
    .sort((a, b) => a.cost_rank - b.cost_rank || a.id.localeCompare(b.id))[0] ?? null;
}
