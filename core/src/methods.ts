import fs from 'node:fs';
import { DEFAULTS, setSetting, settings } from './settings.ts';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { E, RpcError } from './pipe/errors.ts';
import { scrubSecretValues, setBrowserSecret } from './secrets.ts';
import type { MethodSpec } from './pipe/commands.ts';
import { canonicalPath, projectId, resolveProjectPath } from './project.ts';
import { nowIso, ulid } from './time.ts';
import { getEngine, type EngineSpec } from './engines/registry.ts';
import { checkAll, engineVersion } from './engines/health.ts';
import { launchSession, writePrompt } from './sessions/launch.ts';
import * as term from './terminal/index.ts';
import { availableShells } from './terminal/shells.ts';
import { liveText } from './terminal/events.ts';
import { appendEvent } from './events/append.ts';
import { processEvents } from './events/processor.ts';
import { installClaude, installCodex, installEngineSettings, lineDiff, uninstallClaude, uninstallCodex, uninstallEngineSettings } from './hooks/install.ts';
import { homeDir, repoDir } from './paths.ts';
import { installPlugin, previewPlugin, removePlugin, raiseMissingSecret, setPluginSecret } from './plugins/store.ts';
import { resolveMcpServer } from './plugins/mcp.ts';
import { reservedId } from './plugins/manifest.ts';
import { listSinks, removeSink, setSink, testSink } from './notify.ts';
import { browserCall } from './browser/client.ts';
import { writeClipboard } from './clipboard.ts';
import { trustFolder } from './trust.ts';
import { sandboxRefusal } from './sandbox/checks.ts';
import { owners, repoOf } from './sessions/owners.ts';
import { Approvals } from './approvals.ts';
import { SESSION_STATES, onStateChange, stateChanged } from './events/state.ts';

function str(p: Record<string, unknown>, key: string, required = true): string {
  const v = p[key];
  if (typeof v === 'string' && v.length > 0) return v;
  if (!required) return '';
  throw new RpcError(E.INVALID_PARAMS, `${key} is required`);
}

export const PROTOCOL = 1;

export const MOVED_METHODS = [
  'run.start', 'run.cancel', 'run.clear', 'run.resume', 'run.item-set', 'gate.resolve', 'schedule.set', 'pipeline.validate',
  'template.list', 'variant.pick', 'variant.discard', 'variant.combine', 'board.pin', 'board.remove',
];

export interface MethodDecl {
  name: string;
  params: string;
  result: string;
  errors?: number[];
  stable?: boolean;
  needsUi?: boolean;
}

export const METHODS: MethodDecl[] = [
  { name: 'core.ping', stable: true, params: '{}', result: '{ok: true, pid, version, protocol, schema_version, started_at}; `version` is the root `package.json` version, `protocol` is 1 (D63); never queued' },
  { name: 'settings.set', needsUi: true, errors: [E.INVALID_PARAMS, E.VALIDATION], params: '{key, value}', result: '{}. `key` is `<section>.<name>` of a known setting and `value` has its type (-32602 otherwise). The core is the only writer of `settings.json`: it writes `settings.json.tmp-<pid>`, flushes it and renames it over the file, and refuses with -32003 "settings.json does not parse, line N" when the file is not JSON. A leftover `.tmp-*` file is deleted on start (M6-4)' },
  { name: 'core.stop', needsUi: true, params: '{}', result: '{}; the core exits a moment after replying' },
  { name: 'account.state', params: '{}', result: '{state: "signed_out"}: the only state until the cloud milestone; nothing prompts for sign-in' },
  { name: 'project.open', stable: true, errors: [E.NOT_FOUND], params: '{path}', result: '{project_id}; any folder opens (sessions in a `sessions.ask_paths` folder start in `ask`). `project_id` = sha1 hex of the canonical path: `fs.realpathSync.native`, then the git toplevel if inside a repo (also through `realpathSync.native`), backslashes turned into forward slashes, the drive letter lower-cased, no trailing slash. Example: `C:\\Users\\wasif\\proj\\` becomes `c:/Users/wasif/proj`' },
  { name: 'project.clear', params: '{project_id}', result: "{}; hides the project's sessions that are not working or waiting, and its runs that are not running or paused" },
  { name: 'session.launch', stable: true, errors: [E.NOT_FOUND, E.VALIDATION, E.ENGINE_UNAVAILABLE, E.CLOUD_UNAVAILABLE], params: '{project_id, engine_id, prompt?, host?: "pty", browser?: boolean, parent_id?}', result: '{session_id, prompt_delivered}: `browser: true` (a launch from the browser pane) attaches the `metatrooper-browser` MCP server; other sessions do not get it. `parent_id` (set by `troop launch` from its own `TROOP_SESSION_ID`) is stored as `session.parent_id`; when the child exits, the parent gets one `notice` naming the child, its claimed files and whether each is committed, its last line and transcript path' },
  { name: 'session.list', stable: true, params: '{project_id?, all?: bool}', result: '{sessions: [{id, project_id, engine_id, host, state, state_at, parent_id}]}, newest first; hidden sessions only with `all: true`' },
  { name: 'session.wait', stable: true, errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{session_id, states: [state, ...], timeout_ms}', result: '{state, timed_out}: returns as soon as the session is in one of `states` (at once if already there), or with `timed_out: true` when `timeout_ms` passes. `states` must be non-empty and from `starting`, `working`, `waiting_for_you`, `done`, `idle`, `unknown`, `exited`; `timeout_ms` is 1 to 600000; -32602 otherwise. Not queued. A client passes a reply wait longer than `timeout_ms`' },
  { name: 'session.resume', stable: true, errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{session_id}', result: "{session_id, prompt_delivered, approval, resumed} for an `exited` session: same engine and folder, with the engine's `resume_args` when it has them and a `native_id`; the new session gets a `core.resumed` event naming the old id" },
  { name: 'session.focus', stable: true, errors: [E.NOT_FOUND], params: '{session_id}', result: '{focused: bool}' },
  { name: 'session.live-text', stable: true, params: '{}', result: "{<session_id>: {line?, title?}}: each terminal session's last non-empty screen row (first `terminal.last_line_chars` characters, read at most every `terminal.last_line_every_ms`) and last title. Held in core memory only and never written to the database, because typed text shows on screen (M1-05); empty after a core restart. Polled by the workbench once a second" },
  { name: 'session.search', needsUi: true, params: '{query, session_ids?}', result: "{hits: [{session_id, line, text}]}: lines of every live terminal's (or only the listed sessions') headless scrollback that contain `query` as plain text, ignoring case, wrapped rows joined; the most recently active terminal first and its newest line first, at most 50. `line` is the buffer row the line starts on; `text` is 300 characters of it around the match. Never queued and never written to the database (M6-19)" },
  { name: 'session.seen', errors: [E.NOT_FOUND], params: '{session_id}', result: '{}; moves `done` to `idle`. Sent by the workbench when a card is opened and by `session.focus`' },
  { name: 'session.hide', errors: [E.NOT_FOUND], params: '{session_id}', result: '{}' },
  { name: 'session.limit-resume', errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{session_id, on: bool}', result: '{}; sets the tile\'s "go on at a usage limit reset" toggle (`session.limit_resume`, M6-24). -32602 when `on` is not a boolean' },
  { name: 'session.clear-status', errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{session_id}', result: '{}: sets `idle`, appends `core.status-cleared`, marks its inbox rows read' },
  { name: 'session.owners', errors: [E.NOT_FOUND], params: '{project_id}', result: "{repo, paths: [{path, owners: [{id, title, state}], shared, unclaimed}]}: each uncommitted path of the project's repository with the session that owns it, from the latest `core.claim` naming it; a path committed after that claim is `unclaimed`" },
  { name: 'session.paste-prompt', errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{session_id}', result: '{written, reason?}: types the held prompt once; refused for an `external` session' },
  { name: 'needs_you.mark-read', errors: [E.NOT_FOUND], params: '{id}', result: '{}' },
  { name: 'needs_you.mark-unread', errors: [E.NOT_FOUND], params: '{id}', result: '{}' },
  { name: 'needs.dismiss', needsUi: true, errors: [E.NOT_FOUND], params: '{id}', result: '{}; marks one needs-you item resolved (added by child #16 for items nothing else resolves, such as a missed schedule)' },
  { name: 'shell.list', params: '{}', result: '{shells: [{kind, label, argv}]}' },
  { name: 'shell.open', errors: [E.ENGINE_UNAVAILABLE, E.NOT_FOUND], params: '{kind, project_id}', result: "{shell_id, label, cwd}: a shell tab in the project's folder" },
  { name: 'shell.close', errors: [E.INVALID_PARAMS], params: '{shell_id}', result: '{}' },
  { name: 'worktree.create', stable: true, errors: [E.NOT_FOUND, E.VALIDATION], params: '{project_id, branch?, base?: "HEAD"}', result: '{path, branch, trusted, existing?}' },
  { name: 'ui.hello', params: '{ui_key}', result: '{ok}; marks this connection as a trusted UI connection (see Access)' },
  { name: 'engines.check', params: '{}', result: '{} (results land in `engine_check`)' },
  { name: 'hooks.install', needsUi: true, params: '{codex?: bool}', result: '{diff}' },
  { name: 'hooks.uninstall', needsUi: true, params: '{codex?: bool}', result: '{diff}' },
  { name: 'plugin.preview', params: '{source}', result: '{valid, errors, manifest_hash, source, screen}; nothing is installed or run. `screen` is what the install screen shows (`plugins.md`, Install)' },
  { name: 'plugin.install', needsUi: true, errors: [E.VALIDATION], params: '{source, approved_permissions, manifest_hash?, secrets?: {NAME: value}}', result: '{plugin_id, missing_secrets}. -32003 when `approved_permissions` differs from what the manifest asks for, or `manifest_hash` differs from the manifest now on disk' },
  { name: 'plugin.remove', needsUi: true, params: '{plugin_id}', result: '{}' },
  { name: 'plugin.secret.set', needsUi: true, params: '{plugin_id, name, value}', result: '{}; `name` must be an approved `secrets:<NAME>`' },
  { name: 'browser.secret.set', needsUi: true, errors: [E.INVALID_PARAMS], params: '{name, origin, value}', result: '{}; saves a secret the browser 	ype tool fills from {{secret:NAME}}, only into a password field on origin (scheme, host and port); the value goes to the DPAPI store under plugin id core-browser, never to the command table; a value under 4 characters is refused, since output scrubbing skips such short values' },
  { name: 'mcp.resolve', params: '{plugin_id, server_id}', result: '{command, args, env, refs, missing} for the MCP shim: `env` holds stored secret values, `refs` maps keys to `${VAR}` names the shim reads from its own environment' },
  { name: 'mcp.missing', errors: [E.NOT_FOUND], params: '{plugin_id, names}', result: '{}; raises a `missing-secret` needs-you item per name' },
  { name: 'notify.sink.set', stable: true, needsUi: true, params: '{kind, dest, name?, id?, kinds?, enabled?}', result: '{id}; `kind` is `ntfy`, `slack-webhook`, `discord-webhook`, `teams-workflow`, `webhook` or `command`; `dest` is the URL (or a JSON argv array for `command`) and is stored only in the secret store under plugin id `core-notify`; never written to the `command` table' },
  { name: 'notify.sink.list', stable: true, params: '{}', result: '{sinks: [{id, kind, name, kinds, enabled, dest_hash, approved_at}]}; no destination' },
  { name: 'notify.sink.test', stable: true, needsUi: true, params: '{id}', result: '{ok, error?}' },
  { name: 'notify.sink.remove', stable: true, needsUi: true, params: '{id}', result: '{}' },
  { name: 'comment.deliver', errors: [E.NOT_FOUND], params: '{comment_id}', result: "{clipboard_at, typed}: always copied; typed into the agent's terminal without Enter unless its engine takes comments through hooks (Claude), where the UserPromptSubmit hook delivers it" },
  { name: 'pane.open', stable: true, needsUi: true, errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{project_id, url?, session_id?, agent?: bool}', result: "{pane_id}; a browser pane the user opened, or with `agent: true` (needs `session_id`) one the workbench opened for an agent's first `navigate`, id `bp_agent_<ulid>`. Stable in the agent form" },
  { name: 'pane.close', needsUi: true, errors: [E.NOT_FOUND], params: '{pane_id}', result: '{}' },
  { name: 'pane.url', needsUi: true, params: '{pane_id, url}', result: '{}; the workbench reports each navigation' },
  { name: 'pane.assign', needsUi: true, errors: [E.NOT_FOUND], params: '{pane_id, session_id?}', result: '{}; sets or clears the one session allowed to drive the pane' },
  { name: 'pane.capture', needsUi: true, errors: [E.INVALID_PARAMS], params: '{pane_id, label}', result: '{snapshot_id}; the core calls `browser.capture` on the browser pipe and writes the `snapshot` row' },
  { name: 'approval.check', params: '{session_id, surface, target, action, args, control, password?, hidden?, file_dialog?, action_hash?}', result: '{decision, reason?, approval_id?}; never queued; waits until a person decides or 120 s pass (`contracts/approvals.md`)' },
  { name: 'approval.resolve', needsUi: true, errors: [E.GATE_STALE], params: '{approval_id, decision, scope?}', result: '{status, scope}; -32010 when the row is not `waiting`' },
];

const cell = (s: string) => s.split('|').join('\\|');

export function methodTable(): string {
  const rows = METHODS.map((d) => `| \`${d.name}\` | \`${cell(d.params)}\` | ${cell(d.result)} | ${d.errors?.join(', ') ?? ''} | ${d.stable ? 'yes' : ''} | ${d.needsUi ? 'yes' : ''} |`);
  const moved = `| ${MOVED_METHODS.map((n) => `\`${n}\``).join(', ')} | any | -32601 "moved to the pipeline products" (M6-1) | -32601 | | |`;
  return ['| Method | Params | Result | Errors | Stable | Needs `ui.hello` |', '|---|---|---|---|---|---|', ...rows, moved].join('\n');
}

export function methodHelp(): string {
  const width = Math.max(...METHODS.map((d) => d.name.length)) + 2;
  return METHODS.map((d) => `  ${d.name.padEnd(width)}${d.params}${d.stable ? '  (stable)' : ''}`).join('\n');
}

export interface CoreControl {
  engines: () => EngineSpec[];
  stop: () => void;
  uiKey: string;
  approvalTimeoutMs?: number;
}

function int(p: Record<string, unknown>, key: string): number {
  const v = p[key];
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  throw new RpcError(E.INVALID_PARAMS, `${key} must be a whole number`);
}

export function buildMethods(db: DatabaseSync, ctl: CoreControl): Map<string, MethodSpec> {
  const m = new Map<string, MethodSpec>();

  m.set('account.state', { handler: () => ({ state: 'signed_out' }) });

  const startedAt = nowIso();
  const version = String((JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8')) as { version?: unknown }).version ?? '');
  m.set('core.ping', {
    handler: () => {
      const v = db.prepare('PRAGMA user_version').get() as { user_version: number };
      return { ok: true, pid: process.pid, version, protocol: PROTOCOL, schema_version: v.user_version, started_at: startedAt };
    },
  });

  m.set('settings.set', {
    handler: (p) => {
      const [section, key, ...rest] = str(p, 'key').split('.');
      const base = (DEFAULTS as Record<string, unknown>)[section] as Record<string, unknown> | undefined;
      if (!key || rest.length || !base || typeof base !== 'object' || !(key in base)) throw new RpcError(E.INVALID_PARAMS, 'key must be a known <section>.<name> setting');
      if (typeof p.value !== typeof base[key] || p.value === null || Array.isArray(p.value) !== Array.isArray(base[key])) throw new RpcError(E.INVALID_PARAMS, `${section}.${key} must be a ${typeof base[key]}`);
      try {
        setSetting(section, key, p.value);
      } catch (e) {
        throw new RpcError(E.VALIDATION, (e as Error).message);
      }
      return {};
    },
  });

  m.set('core.stop', { needsUi: true, handler: () => { setTimeout(() => ctl.stop(), 10); return {}; } });

  m.set('project.open', {
    handler: (p) => {
      const input = str(p, 'path');
      let canonical: string;
      try {
        canonical = resolveProjectPath(input);
      } catch {
        throw new RpcError(E.NOT_FOUND, `folder not found: ${input}`);
      }
      const id = projectId(canonical);
      const now = nowIso();
      db.prepare(
        `INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_opened = excluded.last_opened, hidden = 0, older = 0`,
      ).run(id, canonical, path.posix.basename(canonical), now, now);
      return { project_id: id };
    },
  });

  m.set('session.launch', {
    handler: (p) => {
      const project = db.prepare('SELECT id, path, name FROM project WHERE id = ?').get(str(p, 'project_id')) as
        | { id: string; path: string; name: string }
        | undefined;
      if (!project) throw new RpcError(E.NOT_FOUND, 'project not found');
      const requested = str(p, 'approval', false);
      const host = str(p, 'host', false) || (requested === 'isolated' ? 'sandbox' : 'pty');
      if (host !== 'pty' && host !== 'sandbox') throw new RpcError(E.ENGINE_UNAVAILABLE, `host ${host} is not installed`);
      if ((requested === 'isolated') !== (host === 'sandbox')) throw new RpcError(E.VALIDATION, 'isolated runs only on the sandbox host, and the sandbox host only runs isolated');
      const engine = getEngine(db, str(p, 'engine_id'));
      if (!engine) throw new RpcError(E.NOT_FOUND, 'engine not found');
      if (engine.provider === 'gateway') throw new RpcError(E.CLOUD_UNAVAILABLE, `gateway engine ${engine.id} is not available yet`);
      const check = db
        .prepare('SELECT installed FROM engine_check WHERE engine_id = ? ORDER BY julianday(checked_at) DESC LIMIT 1')
        .get(engine.id) as { installed: number } | undefined;
      if (check && !check.installed) throw new RpcError(E.ENGINE_UNAVAILABLE, `${engine.id} is not installed`);
      const worktreesRoot = canonicalPath(path.join(homeDir(), 'worktrees')).toLowerCase() + '/';
      const fallback = project.path.toLowerCase().startsWith(worktreesRoot) ? 'contained' : settings().sessions.approval;
      const approval = requested || (fallback !== 'isolated' && (fallback === 'ask' || engine.approval_profiles?.[fallback]) ? fallback : 'ask');
      if (approval !== 'ask' && !engine.approval_profiles?.[approval]) {
        throw new RpcError(E.INVALID_PARAMS, `${engine.id} has no approval profile ${approval}`);
      }
      const parent = str(p, 'parent_id', false) || undefined;
      if (parent && !db.prepare('SELECT 1 FROM session WHERE id = ?').get(parent)) throw new RpcError(E.NOT_FOUND, 'parent session not found');
      if (host === 'sandbox') {
        const refusal = sandboxRefusal(engine, project.path);
        if (refusal) throw new RpcError(E.VALIDATION, refusal);
      }
      return launchSession(db, {
        host,
        approval,
        projectId: project.id,
        projectPath: project.path,
        projectName: project.name,
        engine,
        prompt: str(p, 'prompt', false) || undefined,
        browser: p.browser === true,
        parentId: parent,
      });
    },
  });

  m.set('session.list', {
    handler: (p) => {
      const project = str(p, 'project_id', false);
      const sessions = db.prepare(
        `SELECT id, project_id, engine_id, host, state, state_at, parent_id FROM session
         WHERE (? = '' OR project_id = ?) AND (? = 1 OR hidden = 0) ORDER BY julianday(started_at) DESC`,
      ).all(project, project, p.all === true ? 1 : 0);
      return { sessions };
    },
  });

  m.set('session.wait', {
    handler: async (p) => {
      const id = str(p, 'session_id');
      const states = p.states;
      if (!Array.isArray(states) || states.length === 0 || states.some((s) => !(SESSION_STATES as readonly unknown[]).includes(s))) {
        throw new RpcError(E.INVALID_PARAMS, `states must be a non-empty list of ${SESSION_STATES.join(', ')}`);
      }
      const timeout = p.timeout_ms;
      if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1 || timeout > 600_000) {
        throw new RpcError(E.INVALID_PARAMS, 'timeout_ms must be a whole number from 1 to 600000');
      }
      const read = () => (db.prepare('SELECT state FROM session WHERE id = ?').get(id) as { state: string } | undefined)?.state;
      const end = Date.now() + timeout;
      let state = read();
      if (state === undefined) throw new RpcError(E.NOT_FOUND, 'session not found');
      // A state the core writes wakes the wait at once, so done -> idle between polls is not missed; the 200 ms poll catches other writers.
      let hit: string | undefined;
      let wake = () => {};
      const off = onStateChange((sid, s) => { if (sid === id && !hit && states.includes(s)) { hit = s; wake(); } });
      try {
        while (!hit && !states.includes(state)) {
          const left = end - Date.now();
          if (left <= 0) return { state, timed_out: true };
          await new Promise<void>((r) => { wake = r; setTimeout(r, Math.min(200, left)); });
          state = read() ?? state;
        }
        return { state: hit ?? state, timed_out: false };
      } finally {
        off();
      }
    },
  });

  m.set('session.hide', {
    handler: (p) => {
      const r = db.prepare('UPDATE session SET hidden = 1 WHERE id = ?').run(str(p, 'session_id'));
      if (Number(r.changes) === 0) throw new RpcError(E.NOT_FOUND, 'session not found');
      return {};
    },
  });

  m.set('session.limit-resume', {
    handler: (p) => {
      if (typeof p.on !== 'boolean') throw new RpcError(E.INVALID_PARAMS, 'on must be true or false');
      const r = db.prepare('UPDATE session SET limit_resume = ? WHERE id = ?').run(p.on ? 1 : 0, str(p, 'session_id'));
      if (Number(r.changes) === 0) throw new RpcError(E.NOT_FOUND, 'session not found');
      return {};
    },
  });

  m.set('project.clear', {
    handler: (p) => {
      const id = str(p, 'project_id');
      db.prepare("UPDATE session SET hidden = 1 WHERE project_id = ? AND state NOT IN ('starting', 'working', 'waiting_for_you')").run(id);
      db.prepare("UPDATE run SET hidden = 1 WHERE project_id = ? AND status NOT IN ('running', 'paused')").run(id);
      return {};
    },
  });

  const markSeen = (id: string) => {
    const s = db.prepare('SELECT state FROM session WHERE id = ?').get(id) as { state: string } | undefined;
    if (!s) throw new RpcError(E.NOT_FOUND, 'session not found');
    if (s.state === 'done') {
      appendEvent('core.seen', id, {}, db);
      processEvents(db);
    }
  };

  m.set('session.seen', { handler: (p) => { markSeen(str(p, 'session_id')); return {}; } });
  m.set('session.live-text', { handler: () => liveText() });
  m.set('session.search', { needsUi: true, handler: async (p) => ({ hits: await term.search(str(p, 'query'), 50, Array.isArray(p.session_ids) ? new Set(p.session_ids.filter((x): x is string => typeof x === 'string')) : undefined) }) });

  m.set('session.focus', {
    handler: (p) => {
      const id = str(p, 'session_id');
      markSeen(id);
      db.prepare("UPDATE needs_you SET read_at = ? WHERE ref = ? AND kind IN ('done', 'failed') AND read_at IS NULL").run(nowIso(), id);
      db.prepare("INSERT INTO ui_selection (window_id, session_id, at) VALUES ('main', ?, ?) ON CONFLICT (window_id) DO UPDATE SET session_id = excluded.session_id, at = excluded.at").run(id, nowIso());
      return { focused: true };
    },
  });

  m.set('session.clear-status', {
    handler: (p) => {
      const id = str(p, 'session_id');
      const s = db.prepare('SELECT state FROM session WHERE id = ?').get(id) as { state: string } | undefined;
      if (!s) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (s.state === 'exited') throw new RpcError(E.INVALID_PARAMS, 'the session has exited');
      appendEvent('core.status-cleared', id, {}, db);
      db.prepare("UPDATE session SET state = 'idle', state_at = ? WHERE id = ?").run(nowIso(), id);
      stateChanged(id, 'idle');
      db.prepare('UPDATE needs_you SET read_at = ? WHERE ref = ? AND read_at IS NULL AND resolved_at IS NULL').run(nowIso(), id);
      return {};
    },
  });

  for (const [name, value] of [['needs_you.mark-read', 'now'], ['needs_you.mark-unread', null]] as const) {
    m.set(name, {
      handler: (p) => {
        const r = db.prepare('UPDATE needs_you SET read_at = ? WHERE id = ?').run(value ? nowIso() : null, str(p, 'id'));
        if (Number(r.changes) === 0) throw new RpcError(E.NOT_FOUND, 'item not found');
        return {};
      },
    });
  }

  const resumedAs = new Map<string, string>();
  m.set('session.resume', {
    handler: (p) => {
      const oldId = str(p, 'session_id');
      const prior = resumedAs.get(oldId);
      const live = prior && db.prepare("SELECT 1 FROM session WHERE id = ? AND state != 'exited'").get(prior);
      if (live) return { session_id: prior, resumed: false, existing: true, notice: 'Already started again; showing that session.' };
      const old = db.prepare('SELECT s.engine_id, s.native_id, s.cwd, s.state, p.id AS project_id, p.path, p.name FROM session s JOIN project p ON p.id = s.project_id WHERE s.id = ?')
        .get(oldId) as { engine_id: string; native_id: string | null; cwd: string | null; state: string; project_id: string; path: string; name: string } | undefined;
      if (!old) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (old.state !== 'exited') throw new RpcError(E.INVALID_PARAMS, 'the session is still running');
      const engine = getEngine(db, old.engine_id);
      if (!engine) throw new RpcError(E.NOT_FOUND, 'engine not found');
      const resumed = Boolean(engine.resume_args && old.native_id);
      const extraArgs = resumed ? engine.resume_args!.map((a) => a.split('{native_id}').join(old.native_id!)) : [];
      const r = launchSession(db, { projectId: old.project_id, projectPath: old.path, projectName: old.name, engine, cwd: old.cwd ?? old.path, extraArgs });
      if (resumed && engine.id === 'codex') db.prepare('UPDATE session SET native_id = ? WHERE id = ? AND native_id IS NULL').run(old.native_id, r.session_id);
      appendEvent('core.resumed', r.session_id, { from: oldId }, db);
      resumedAs.set(oldId, r.session_id);
      return { ...r, resumed, ...(resumed ? {} : { notice: 'No saved conversation, starting fresh.' }) };
    },
  });

  m.set('shell.list', { handler: () => ({ shells: availableShells() }) });

  m.set('shell.open', {
    handler: (p) => {
      const kind = str(p, 'kind');
      const shell = availableShells().find((x) => x.kind === kind);
      if (!shell) throw new RpcError(E.ENGINE_UNAVAILABLE, `${kind} is not available on this machine`);
      const project = db.prepare('SELECT path FROM project WHERE id = ?').get(str(p, 'project_id')) as { path: string } | undefined;
      if (!project) throw new RpcError(E.NOT_FOUND, 'project not found');
      const id = `sh_${ulid()}`;
      term.open(id, shell.argv, project.path, process.env);
      return { shell_id: id, label: shell.label, cwd: project.path };
    },
  });

  m.set('shell.close', {
    handler: (p) => {
      const id = str(p, 'shell_id');
      if (!id.startsWith('sh_')) throw new RpcError(E.INVALID_PARAMS, 'not a shell tab');
      term.kill(id);
      return {};
    },
  });

  m.set('session.owners', {
    handler: (p) => {
      const project = db.prepare('SELECT path FROM project WHERE id = ?').get(str(p, 'project_id')) as { path: string } | undefined;
      if (!project) throw new RpcError(E.NOT_FOUND, 'project not found');
      const repo = repoOf(project.path);
      if (!repo) return { repo: null, paths: [] };
      const titles = Object.fromEntries(Object.entries(liveText()).map(([id, t]) => [id, t.title]));
      return { repo, paths: owners(db, repo, titles) };
    },
  });

  m.set('session.paste-prompt', {
    handler: (p) => {
      const id = str(p, 'session_id');
      const row = db.prepare('SELECT host FROM session WHERE id = ?').get(id) as { host: string } | undefined;
      if (!row) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (row.host === 'external') throw new RpcError(E.INVALID_PARAMS, 'the session was opened outside MetaTrooper; type into its own terminal');
      return writePrompt(db, id);
    },
  });

  m.set('engines.check', { handler: () => { void checkAll(db, ctl.engines()); return {}; } });

  m.set('worktree.create', {
    handler: (p) => {
      const project = db.prepare('SELECT id, path FROM project WHERE id = ?').get(str(p, 'project_id')) as
        | { id: string; path: string }
        | undefined;
      if (!project) throw new RpcError(E.NOT_FOUND, 'project not found');
      const branch = str(p, 'branch', false) || `troop/${ulid().toLowerCase()}`;
      const base = str(p, 'base', false) || 'HEAD';
      const root = path.join(homeDir(), 'worktrees', project.id);
      const dir = path.join(root, branch.replace(/[\\/]/g, '-'));
      if (path.dirname(dir) !== root || dir === root) throw new RpcError(E.INVALID_PARAMS, `branch ${branch} does not name a folder under the worktrees folder`);
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      if (fs.existsSync(path.join(dir, '.git'))) {
        const trusted = trustFolder(fs.realpathSync.native(dir), ctl.engines());
        return { path: dir.split(String.fromCharCode(92)).join('/'), branch, trusted, existing: true };
      }
      try {
        execFileSync('git', ['-C', project.path, 'worktree', 'add', dir, '-b', branch, base], { stdio: 'pipe', timeout: 60_000 });
      } catch (e) {
        throw new RpcError(E.VALIDATION, `git worktree add failed: ${String((e as { stderr?: Buffer }).stderr ?? e).trim()}`);
      }
      const trusted = trustFolder(fs.realpathSync.native(dir), ctl.engines());
      return { path: dir.split(String.fromCharCode(92)).join('/'), branch, trusted };
    },
  });

  m.set('hooks.install', {
    handler: (p) => {
      const claude = installClaude(engineVersion(db, 'claude'));
      const codex = p.codex ? installCodex() : null;
      const settings = installEngineSettings(ctl.engines());
      return {
        diff: [lineDiff(claude.before, claude.after), codex ? lineDiff(codex.before, codex.after) : '', ...settings.map((s) => lineDiff(s.before, s.after))]
          .filter(Boolean)
          .join('\n'),
      };
    },
  });

  m.set('hooks.uninstall', {
    handler: (p) => {
      const claude = uninstallClaude();
      const codex = p.codex ? uninstallCodex() : null;
      uninstallEngineSettings();
      return { diff: [claude ? lineDiff(claude.before, claude.after) : '', codex ? lineDiff(codex.before, codex.after) : ''].filter(Boolean).join('\n') };
    },
  });

  m.set('plugin.preview', { handler: (p) => previewPlugin(db, str(p, 'source')) });

  m.set('plugin.install', {
    handler: (p) => {
      const approved = p.approved_permissions;
      if (!Array.isArray(approved) || approved.some((x) => typeof x !== 'string')) throw new RpcError(E.INVALID_PARAMS, 'approved_permissions must be an array of strings');
      const secrets = p.secrets ?? {};
      if (typeof secrets !== 'object' || Array.isArray(secrets) || Object.values(secrets).some((v) => typeof v !== 'string')) {
        throw new RpcError(E.INVALID_PARAMS, 'secrets must map names to strings');
      }
      const r = installPlugin(db, {
        source: str(p, 'source'),
        approved_permissions: approved as string[],
        manifest_hash: str(p, 'manifest_hash', false) || undefined,
        secrets: secrets as Record<string, string>,
      });
      void checkAll(db, ctl.engines()).catch(() => {});
      return r;
    },
  });

  m.set('plugin.remove', { handler: (p) => { removePlugin(db, str(p, 'plugin_id')); return {}; } });

  m.set('plugin.secret.set', {
    handler: (p) => {
      if (typeof p.value !== 'string') throw new RpcError(E.INVALID_PARAMS, 'value is required');
      setPluginSecret(db, str(p, 'plugin_id'), str(p, 'name'), p.value);
      return {};
    },
  });

  m.set('browser.secret.set', {
    handler: (p) => {
      if (typeof p.value !== 'string') throw new RpcError(E.INVALID_PARAMS, 'value is required');
      try { setBrowserSecret(db, str(p, 'name'), str(p, 'origin'), p.value); } catch (e) { throw new RpcError(E.INVALID_PARAMS, (e as Error).message); }
      return {};
    },
  });

  m.set('notify.sink.set', { handler: (p) => setSink(db, p) });
  m.set('notify.sink.list', { handler: () => listSinks(db) });
  m.set('notify.sink.test', { handler: (p) => testSink(db, str(p, 'id')) });
  m.set('notify.sink.remove', { handler: (p) => removeSink(db, str(p, 'id')) });

  m.set('mcp.resolve', { handler: (p) => resolveMcpServer(db, str(p, 'plugin_id'), str(p, 'server_id')) });

  m.set('mcp.missing', {
    handler: (p) => {
      const pluginId = str(p, 'plugin_id');
      const names = Array.isArray(p.names) ? p.names.filter((n): n is string => typeof n === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(n)) : [];
      if (reservedId(pluginId) || !db.prepare('SELECT 1 FROM plugin WHERE id = ?').get(pluginId)) throw new RpcError(E.NOT_FOUND, 'plugin not found');
      for (const n of names) raiseMissingSecret(db, pluginId, n);
      return {};
    },
  });

  m.set('needs.dismiss', {
    handler: (p) => {
      const r = db.prepare('UPDATE needs_you SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL').run(nowIso(), str(p, 'id'));
      if (Number(r.changes) === 0 && !db.prepare('SELECT 1 FROM needs_you WHERE id = ?').get(str(p, 'id'))) throw new RpcError(E.NOT_FOUND, 'item not found');
      return {};
    },
  });

  m.set('pane.open', {
    handler: (p) => {
      const projectId = str(p, 'project_id');
      if (!db.prepare('SELECT 1 FROM project WHERE id = ?').get(projectId)) throw new RpcError(E.NOT_FOUND, 'project not found');
      const sessionId = str(p, 'session_id', false) || null;
      if (sessionId && !db.prepare('SELECT 1 FROM session WHERE id = ? AND project_id = ?').get(sessionId, projectId)) throw new RpcError(E.NOT_FOUND, 'session not found in this project');
      if (p.agent === true && !sessionId) throw new RpcError(E.INVALID_PARAMS, 'agent panes need a session_id');
      const id = p.agent === true ? `bp_agent_${ulid()}` : `bp_${ulid()}`;
      db.prepare('INSERT INTO browser_pane (id, project_id, session_id, url, open) VALUES (?, ?, ?, ?, 1)').run(id, projectId, sessionId, str(p, 'url', false) || null);
      return { pane_id: id };
    },
  });

  m.set('pane.close', {
    handler: (p) => {
      const r = db.prepare('UPDATE browser_pane SET open = 0 WHERE id = ?').run(str(p, 'pane_id'));
      if (Number(r.changes) === 0) throw new RpcError(E.NOT_FOUND, 'pane not found');
      return {};
    },
  });

  m.set('pane.url', {
    handler: (p) => {
      db.prepare('UPDATE browser_pane SET url = ? WHERE id = ?').run(str(p, 'url'), str(p, 'pane_id'));
      return {};
    },
  });

  m.set('pane.assign', {
    handler: (p) => {
      const pane = db.prepare('SELECT project_id FROM browser_pane WHERE id = ?').get(str(p, 'pane_id')) as { project_id: string } | undefined;
      if (!pane) throw new RpcError(E.NOT_FOUND, 'pane not found');
      const sessionId = str(p, 'session_id', false) || null;
      if (sessionId && !db.prepare('SELECT 1 FROM session WHERE id = ? AND project_id = ?').get(sessionId, pane.project_id)) throw new RpcError(E.NOT_FOUND, 'session not found in this project');
      db.prepare('UPDATE browser_pane SET session_id = ? WHERE id = ?').run(sessionId, str(p, 'pane_id'));
      return {};
    },
  });

  m.set('pane.capture', {
    handler: async (p) => {
      const label = str(p, 'label');
      if (!['before', 'after', 'reference', 'comment'].includes(label)) throw new RpcError(E.INVALID_PARAMS, 'label must be before, after, reference or comment');
      const paneId = str(p, 'pane_id');
      const shot = (await browserCall(ctl.uiKey, 'browser.capture', { pane_id: paneId, label })) as { url: string; w390_path: string; w1280_path: string };
      const id = ulid();
      db.prepare('INSERT INTO snapshot (id, pane_id, label, url, taken_at, w390_path, w1280_path) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(id, paneId, label, shot.url, nowIso(), shot.w390_path, shot.w1280_path);
      return { snapshot_id: id };
    },
  });

  m.set('comment.deliver', {
    handler: (p) => {
      const c = db.prepare('SELECT c.id, c.body, c.session_id, s.engine_id FROM comment c JOIN session s ON s.id = c.session_id WHERE c.id = ?').get(str(p, 'comment_id')) as
        | { id: string; body: string; session_id: string; engine_id: string }
        | undefined;
      if (!c) throw new RpcError(E.NOT_FOUND, 'comment not found');
      const at = writeClipboard(c.body) ? nowIso() : null;
      if (at) db.prepare('UPDATE comment SET clipboard_at = ? WHERE id = ?').run(at, c.id);
      // engines with hooks get the comment from the UserPromptSubmit hook instead
      const typed = getEngine(db, c.engine_id)?.state_source !== 'hooks' && term.paste(c.session_id, c.body);
      return { clipboard_at: at, typed: Boolean(typed) };
    },
  });

  const approvals = new Approvals(db, ctl.approvalTimeoutMs, scrubSecretValues);
  m.set('approval.check', { handler: (p) => approvals.check(p) });
  m.set('approval.resolve', { needsUi: true, handler: (p) => approvals.resolve(p) });

  for (const name of MOVED_METHODS) m.set(name, { handler: () => { throw new RpcError(E.METHOD_NOT_FOUND, 'moved to the pipeline products'); } });
  for (const d of METHODS) if (d.needsUi && m.has(d.name)) m.get(d.name)!.needsUi = true;

  return m;
}
