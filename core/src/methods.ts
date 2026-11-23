import fs from 'node:fs';
import * as auth from './auth.ts';
import { DEFAULTS, setSetting, settings } from './settings.ts';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { E, RpcError } from './pipe/errors.ts';
import { knownSecretValues, scrubSecretValues, scrubSecretValuesAsync, setBrowserSecret } from './secrets.ts';
import { scrub } from './redact.ts';
import type { MethodSpec } from './pipe/commands.ts';
import { isPreset } from './browser/grants.ts';
import { canonicalPath, projectId, resolveProjectPath, resolveProjectPathAsync } from './project.ts';
import { repeatReads, saverReport, sessionUsage, usageSummary } from './usage.ts';
import { checkStats, sessionStats } from './stats.ts';
import { cronNext, cronWords, nowIso, ulid } from './time.ts';
import { ensureLabels, labelList } from './labels.ts';
import { getEngine, type EngineSpec } from './engines/registry.ts';
import { checkAll, engineVersion } from './engines/health.ts';
import { heldPrompts, launchSession, writePrompt } from './sessions/launch.ts';
import { proveSecret } from './sessions/secret.ts';
import { parseChat, parseEngineChat } from './sessions/chat.ts';
import { engineFile } from './meter.ts';
import { buildHandoff, gatherHandoff, handoffTranscript } from './sessions/handoff.ts';
import { preserveFiles, validatePreserve } from './sessions/preserve.ts';
import { gitAsync } from './sessions/owners.ts';
import { beingRemoved } from './worktree.ts';
import { tx } from './store/db.ts';
import * as term from './terminal/index.ts';
import { chooseLoop } from './reliability.ts';
import { availableShells } from './terminal/shells.ts';
import { forgetLive, liveText } from './terminal/events.ts';
import { appendEvent } from './events/append.ts';
import { processEvents } from './events/processor.ts';
import { installClaude, installCodex, installEngineSettings, lineDiff, uninstallClaude, uninstallCodex, uninstallEngineSettings } from './hooks/install.ts';
import { handoffDir, homeDir, repoDir } from './paths.ts';
import { installPluginAsync, isLocalSource, previewPluginAsync, removePlugin, raiseMissingSecret, setPluginSecret } from './plugins/store.ts';
import { checkShimToken, resolveMcpServerAsync } from './plugins/mcp.ts';
import { reservedId } from './plugins/manifest.ts';
import { listSinks, removeSink, setSink, testSink } from './notify.ts';
import { browserCall } from './browser/client.ts';
import { writeClipboard } from './clipboard.ts';
import { trustFolder } from './trust.ts';
import { sandboxRefusal } from './sandbox/checks.ts';
import { ownersAsync, repoOfAsync } from './sessions/owners.ts';
import { Approvals } from './approvals.ts';
import { auditRows } from './audit.ts';
import { nextDue, realDeps, runAutomationNow, sha256File, type AutomationDeps } from './automations.ts';
import { Desktop } from './desktop/driver.ts';
import { doneResult, runCheck } from './done-proof.ts';
import { SESSION_STATES, onStateChange, stateChanged } from './events/state.ts';
import { decide, setReviewers } from './reviews.ts';
import { getSurface, showSurface, surfaceEvent } from './surfaces.ts';

function str(p: Record<string, unknown>, key: string, required = true): string {
  const v = p[key];
  if (typeof v === 'string' && v.length > 0) return v;
  if (!required) return '';
  throw new RpcError(E.INVALID_PARAMS, `${key} is required`);
}

export const PROTOCOL = 1;

function refuseGateway(engine: EngineSpec): void {
  if (engine.provider === 'gateway') throw new RpcError(E.CLOUD_UNAVAILABLE, `gateway engine ${engine.id} is not available yet`);
}

const PRIORITIES = ['none', 'low', 'medium', 'high', 'urgent'];

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
  { name: 'auth.signIn', needsUi: true, errors: [E.INVALID_PARAMS, E.VALIDATION, E.INTERRUPTED], params: '{timeout_ms?}', result: '{signed_in, sub?, name?, email?, picture?, signed_in_at?}; opens the system browser and waits up to timeout_ms (1000..600000, default 300000); never queued' },
  { name: 'auth.status', needsUi: true, params: '{}', result: '{signed_in, sub?, name?, email?, picture?, signed_in_at?}; local public profile only; never queued' },
  { name: 'auth.signOut', needsUi: true, params: '{}', result: '{signed_in: false, revoked}; cancels a pending sign-in, revokes the refresh token when supported and clears local state; never queued' },
  { name: 'core.ping', stable: true, params: '{}', result: '{ok: true, pid, version, protocol, schema_version, started_at}; `version` is the root `package.json` version, `protocol` is 1 (D63); never queued' },
  { name: 'settings.set', needsUi: true, errors: [E.INVALID_PARAMS, E.VALIDATION], params: '{key, value}', result: '{}. `key` is `<section>.<name>` of a known setting and `value` has its type (-32602 otherwise). The core is the only writer of `settings.json`: it writes `settings.json.tmp-<pid>`, flushes it and renames it over the file, and refuses with -32003 "settings.json does not parse, line N" when the file is not JSON. A leftover `.tmp-*` file is deleted on start (M6-4)' },
  { name: 'automation.set', needsUi: true, errors: [E.NOT_FOUND, E.VALIDATION, E.INVALID_PARAMS], params: '{project_id, name, engine_id, prompt, every_min?, cron?, runner?: string[], script?, timeout_ms?, icon?, labels?: string[], approval?: "ask"|"edits"|"contained", id?}', result: '{id, next_due}; `approval` is the woken agent\'s approval level (null or missing means ask); `cron` is a 5-field local-time cron that wins over `every_min` (default 60); a non-empty `script` (relative to the project folder) is hashed and pinned on every save, run on schedule, and wakes the engine only when it exits 1; an empty script launches the engine on schedule; unknown labels are created with a default colour' },
  { name: 'automation.enable', needsUi: true, errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{id, enabled}', result: '{}; enabling restarts the schedule from now' },
  { name: 'automation.delete', needsUi: true, errors: [E.INVALID_PARAMS], params: '{id}', result: '{}; its runs go too' },
  { name: 'automation.list', params: '{project_id?}', result: '{automations: [{id, project_id, name, icon, cron, words, every_min, runner, script, engine_id, prompt, approval, timeout_ms, enabled, next_due, created_at, labels: [{name, colour}], runs: [last 8, newest first: {id, due_at, at, outcome, exit_code, detail, session_id}]}]}; `words` is the schedule in words' },
  { name: 'automation.run', needsUi: true, errors: [E.NOT_FOUND, E.VALIDATION], params: '{id}', result: '{run_id, outcome, session_id, detail}; runs it now (check script, then the engine on exit 1, or the engine straight away when it has no script) and records an automation_run; the schedule is unchanged; -32003 when it is already running' },
  { name: 'automation.labels-set', needsUi: true, errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{id, names: string[]}', result: '{labels: [{name, colour}]}; replaces its labels; unknown names are created with a default colour' },
  { name: 'label.list', params: '{}', result: '{labels: [{name, colour, count}]}; every label across sessions and automations; `count` is how many use it' },
  { name: 'label.set', needsUi: true, errors: [E.INVALID_PARAMS], params: '{name, colour}', result: '{name, colour}; creates the label or changes its `#rrggbb` colour' },
  { name: 'cron.next', params: '{cron, n?}', result: '{ok: true, runs: [ISO local, up to n (1-5, default 3)], words} or {ok: false, error}; the scheduler uses the same matcher' },
  { name: 'core.stop', needsUi: true, params: '{}', result: '{}; the core exits a moment after replying' },
  { name: 'account.state', params: '{}', result: '{state: "signed_in" | "signed_out"}; reflects the local sign-in status' },
  { name: 'project.open', stable: true, errors: [E.NOT_FOUND], params: '{path}', result: '{project_id}; any folder opens (sessions in a `sessions.ask_paths` folder start in `ask`). `project_id` = sha1 hex of the canonical path: `fs.realpathSync.native`, then the git toplevel if inside a repo (also through `realpathSync.native`), backslashes turned into forward slashes, the drive letter lower-cased, no trailing slash. Example: `C:\\Users\\wasif\\proj\\` becomes `c:/Users/wasif/proj`' },
  { name: 'project.clear', params: '{project_id}', result: "{}; hides the project's sessions that are not starting, working, waiting or unknown, and its runs that are not running or paused" },
  { name: 'project.hide', errors: [E.NOT_FOUND, E.VALIDATION], params: '{project_id}', result: '{}; drops the project from the project menu, files untouched; refused while one of its sessions is starting, working, waiting_for_you or unknown. `project.open` on its folder brings it back' },
  { name: 'session.launch', stable: true, errors: [E.NEEDS_UI, E.NOT_FOUND, E.VALIDATION, E.INVALID_PARAMS, E.ENGINE_UNAVAILABLE, E.CLOUD_UNAVAILABLE], params: '{project_id, engine_id, prompt?, approval?: "ask"|"edits"|"contained"|"isolated", session_secret?, model?, host?: "pty", browser?: boolean, browser_grant?: "look"|"act"|"debug", parent_id?, blocker_ids?: string[]}', result: '{session_id, prompt_delivered, model?}: with `blocker_ids` the prompt is held until every blocker exits with outcome succeeded.Every session except isolated ones and pipeline steps gets the `metatrooper-browser` MCP server; `browser: true` (a launch from the browser pane) always does. Plain launches get the act browser grant unless `browser_grant` or `browser: true` says otherwise. `parent_id` (set by `troop launch` from its own `TROOP_SESSION_ID`) is stored as `session.parent_id`; when the child exits, the parent gets one `notice` naming the child, its claimed files and whether each is committed, its last line and transcript path. A `browser: true` launch on the claude engine without `model` uses the project\'s `.troop/config.json` `models.browser`, else `claude-sonnet-5-5` (M8-43); `model` in the result is the model passed to the engine. `session_secret` (sent by `troop launch` from `TROOP_SESSION_SECRET`, which the core puts only in each session\'s environment) proves the calling session on a non-UI connection: the child cannot run looser than that session (a looser `approval` fails with -32012; an omitted one is capped), its `parent_id` is that session, an unknown secret fails with -32012 `unknown session secret`, and a different `parent_id` fails with -32012 `parent_id does not match the calling session`. A launch without a secret is treated as the user and keeps the requested approval or the settings default; this stops normal agent paths, not an agent that strips its secret. Trusted UI launches may choose any supported profile.' },
  { name: 'session.list', stable: true, params: '{project_id?, all?: bool}', result: '{sessions: [{id, project_id, engine_id, host, state, state_at, parent_id}]}, newest first; hidden sessions only with `all: true`' },
  { name: 'audit.list', needsUi: true, errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{project_id, limit?, before?, before_id?}', result: "{rows: [{id, at, session_id, agent, action, detail, source}]}: newest first; source is system (gate decisions, core events) or agent (the agent's own call or words); next page: pass the last row's at and id as before and before_id; read only, secrets scrubbed (M8-F21)" },
  { name: 'session.wait', stable: true, errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{session_id, states: [state, ...], timeout_ms, settle_ms?}', result: '{state, timed_out, wait_reason, waiting_on_person}: returns as soon as the session is in one of `states` (at once if already there), or with `timed_out: true` when `timeout_ms` passes. `settle_ms` (0 to 60000, default 0) makes it return only after the state held that long, going back to waiting if it leaves; on `timed_out: true` the state is whatever it was at the deadline, which can be one of `states`. `done` means the engine reported a turn end or its session file went quiet, so a session can go from `done` back to `working`. `states` must be non-empty and from `starting`, `working`, `waiting_for_you`, `done`, `idle`, `unknown`, `exited`; `timeout_ms` is 1 to 600000; `settle_ms` is 0 to 60000; -32602 otherwise. Not queued. A client passes a reply wait longer than `timeout_ms`' },
  { name: 'session.resume', stable: true, errors: [E.NOT_FOUND, E.INVALID_PARAMS, E.VALIDATION], params: '{session_id}', result: "{session_id, prompt_delivered, approval, resumed} for an `exited` session: same engine and folder, with the engine's `resume_args` when it has them and a `native_id`; the new session gets a `core.resumed` event naming the old id" },
  { name: 'session.continue', needsUi: true, errors: [E.NOT_FOUND, E.INVALID_PARAMS, E.ENGINE_UNAVAILABLE, E.VALIDATION], params: '{session_id, engine_id}', result: '{session_id, file}; continues a limit-stopped session with a redacted handoff in another installed engine' },
  { name: 'session.focus', stable: true, errors: [E.NOT_FOUND], params: '{session_id}', result: '{focused: bool}' },
  { name: 'session.live-text', stable: true, params: '{}', result: "{<session_id>: {line?, title?, held?: true}}: each terminal session's last non-empty screen row (first `terminal.last_line_chars` characters, read at most every `terminal.last_line_every_ms`) and last title. `held: true` marks a session whose launch prompt the core still holds for `session.paste-prompt`; such a session can appear with only that field. Held in core memory only and never written to the database, because typed text shows on screen (M1-05); empty after a core restart. Polled by the workbench once a second" },
  { name: 'session.search', needsUi: true, params: '{query, session_ids?}', result: "{hits: [{session_id, line, text}]}: lines of every live terminal's (or only the listed sessions') headless scrollback that contain `query` as plain text, ignoring case, wrapped rows joined; the most recently active terminal first and its newest line first, at most 50. `line` is the buffer row the line starts on; `text` is 300 characters of it around the match. Never queued and never written to the database (M6-19)" },
  { name: 'session.stop', needsUi: true, errors: [E.NOT_FOUND, E.VALIDATION], params: '{session_id}', result: '{stopped: boolean}; sends Ctrl+C, then kills the process tree after 3 s if it still runs; the session exits with outcome cancelled and raises no failed item. false when it had already exited' },
  { name: 'session.seen', errors: [E.NOT_FOUND], params: '{session_id}', result: '{}; moves `done` to `idle`. Sent by the workbench when a card is opened and by `session.focus`' },
  { name: 'session.hide', errors: [E.NOT_FOUND], params: '{session_id}', result: '{}' },
  { name: 'session.limit-resume', errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{session_id, on: bool}', result: '{}; sets the tile\'s "go on at a usage limit reset" toggle (`session.limit_resume`, M6-24). -32602 when `on` is not a boolean' },
  { name: 'usage.summary', errors: [E.INVALID_PARAMS], params: '{window: today|week|run, run_id?}', result: '{window, total, in, out, cache_read, cache_write, usd, usd_estimated, parts: [{kind, tokens}], by_agent: [{session_id, engine_id, tokens, usd, usd_estimated}], estimate: true, repeat_reads: [{session_id, file_path, count}], savers: [{id, on, saving}]}; token use for the window (run needs run_id), the parts sum to total; -32602 on a bad window or a run without run_id' },
  { name: 'usage.session', errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{session_id}', result: '{session_id, engine_id, tokens_in, tokens_out, cache_read, cache_write, usd, usd_estimated, unpriced, by_model: [{model, tokens_in, tokens_out, usd}]}; all-time session usage, models ordered by usd then total tokens descending; usd sums priced rows (0 when none), usd_estimated is true when any priced row is estimated, unpriced counts rows with null usd; -32002 session not found' },
  { name: 'stats.sessions', errors: [E.INVALID_PARAMS], params: '{project_id?, days?: 1-90 (14)}', result: '{days: [{day, succeeded, failed, unchecked, started: {starting, working, waiting_for_you, done, idle, unknown, exited}}]}; local calendar days oldest first through today, including hidden sessions; ended_at outcomes use the latest done_proof by at: exit_code 0 succeeds, any other value including null fails, no proof is unchecked; started_at counts by current state' },
  { name: 'stats.checks', errors: [E.INVALID_PARAMS], params: '{project_id?, days?: 1-90 (14)}', result: '{days: [{day, runs, passed, rate}]}; done_proof runs by at in local calendar days oldest first through today; passed counts exit_code 0, rate is passed / runs or null when runs is 0; project_id filters through the session' },
  { name: 'loop.choose', needsUi: true, errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{session_id, choice}', result: '{false_alarms}; answers a loop alarm nudge: `pause` interrupts the agent, `try-another-way` tells it to change approach, `not-a-loop` resets the count and is counted as a false alarm; `rewind` is refused until file restore exists. Resolves the nudge row' },
  { name: 'done.check', errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{session_id, command, acceptance?}', result: 'the stored done_proof row: runs `command` in the session folder, keeps the output tail, the folder tree and the exit code' },
  { name: 'done.result', errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{session_id}', result: '{result: done | checks_passed | needs_review, unverified, proof, current}: the latest check on the folder as it is now' },
  { name: 'session.clear-status', errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{session_id}', result: '{}: sets `idle`, appends `core.status-cleared`, marks its inbox rows read' },
  { name: 'session.owners', errors: [E.NOT_FOUND], params: '{project_id}', result: "{repo, paths: [{path, owners: [{id, title, state}], shared, unclaimed}]}: each uncommitted path of the project's repository with the session that owns it, from the latest `core.claim` naming it; a path committed after that claim is `unclaimed`" },
  { name: 'session.read', errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{session_id, lines?}', result: '{session_id, state, lines}: the last `lines` (1 to 500, default 50) non-empty rows of the session terminal, oldest first, with known secrets redacted' },
  { name: 'session.chat', errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{session_id, limit?}', result: "{session_id, engine_id, source: 'transcript'|'none', waiting, items}: the last `limit` (1 to 500, default 200) chat messages and tool rows, with known secrets redacted" },
  { name: 'session.handoff', errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{session_id}', result: '{handoff: {id, session_id, parent_id, to_session, at, cwd, summary, files: [{path, committed}], transcript} | null}: the latest handoff by at' },
  { name: 'session.labels-set', needsUi: true, errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{session_id, labels: string[]}', result: '{labels}' },
  { name: 'session.priority-set', needsUi: true, errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{session_id, priority: "none"|"low"|"medium"|"high"|"urgent"}', result: '{ok: true}' },
  { name: 'session.block-set', needsUi: true, errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{session_id, blocker_ids: string[]}', result: '{ok: true}; replaces the session\'s blockers; a held prompt is delivered once every blocker exits with outcome succeeded; -32602 for itself, a cycle or more than 20' },
  { name: 'session.block-clear', needsUi: true, errors: [E.NOT_FOUND], params: '{session_id}', result: '{ok: true}; removes every blocker of the session' },
  { name: 'labels.list', errors: [E.INVALID_PARAMS], params: '{project_id}', result: '{labels: [{name, count}]}' },
  { name: 'session.monitor-set', needsUi: true, errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{session_id, automation_id | null}', result: '{ok: true}: links the automation check to the session (null unlinks); a failed run of it is sent into the session, or once the session has exited, starts one follow-up child session' },
  { name: 'session.reviewers-set', needsUi: true, errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{session_id, reviewers: string[], approvers: string[]}', result: '{ok: true}; reviewers are engine ids, the only approver is "you"; a reviewer or approver already set keeps its state. When the session exits ok, each reviewer engine reviews its changes in a child session (parent_id = the session, same folder) and its last line VERDICT: PASS or FAIL sets the review passed or failed with a note; a child that exits without one fails with note "no verdict"' },
  { name: 'session.approve', needsUi: true, errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{session_id, note?}', result: '{ok: true}; marks the "you" approver passed; -32002 when the session has no approver' },
  { name: 'session.reject', needsUi: true, errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{session_id, note}', result: '{ok: true}; marks the "you" approver failed with `note` (required) and raises a failed Needs you row; -32002 when the session has no approver' },
  { name: 'session.send', errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{session_id, text}', result: '{sent: true}: pastes `text` (1 to 4000 characters, no control characters) then presses Enter; refused for an `external` session and while the session is `waiting_for_you`' },
  { name: 'session.paste-prompt', errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{session_id}', result: '{written, reason?}: types the held prompt once; refused for an `external` session' },
  { name: 'needs_you.mark-read', errors: [E.NOT_FOUND], params: '{id}', result: '{}' },
  { name: 'needs_you.mark-unread', errors: [E.NOT_FOUND], params: '{id}', result: '{}' },
  { name: 'needs.dismiss', needsUi: true, errors: [E.NOT_FOUND], params: '{id}', result: '{}; marks one needs-you item resolved (added by child #16 for items nothing else resolves, such as a missed schedule)' },
  { name: 'shell.list', params: '{}', result: '{shells: [{kind, label, argv}]}' },
  { name: 'shell.open', errors: [E.ENGINE_UNAVAILABLE, E.NOT_FOUND, E.VALIDATION], params: '{kind, project_id}', result: "{shell_id, label, cwd}: a shell tab in the project's folder" },
  { name: 'shell.close', errors: [E.INVALID_PARAMS], params: '{shell_id}', result: '{}' },
  { name: 'worktree.create', stable: true, needsUi: true, errors: [E.NOT_FOUND, E.VALIDATION, E.INVALID_PARAMS], params: '{project_id, branch?, base?: "HEAD"}', result: '{path, branch, trusted, existing?, existing_branch?}; an existing branch with no worktree folder is checked out as is (base is then INVALID_PARAMS)' },
  { name: 'ui.show', errors: [E.INVALID_PARAMS, E.NOT_FOUND, E.VALIDATION], params: '{session_id, surface, title?, zone?: "tab", catalogue?, spec}', result: '{surface, status: drawn | partly | rejected, fellBack: [{part, type, why}]}; stores or replaces the screen `session_id` drew and the workbench opens it as a tab. Every part is checked against the catalogue; a bad one is drawn as plain text and listed in `fellBack`. -32003 when another session owns `surface`; -32602 for a bad id, a zone other than `tab`, or a spec over 256 KB. Called by the `ouros_ui` MCP tool' },
  { name: 'ui.get', params: '{surface}', result: '{id, session_id, project_id, zone, title, catalogue, spec, status, seq, updated_at}; -32002 when it does not exist' },
  { name: 'ui.event', needsUi: true, errors: [E.INVALID_PARAMS, E.NOT_FOUND], params: '{surface, seq, event, context?: {[key]: string | number | boolean}}', result: '{delivered, to: session | inbox | null, dropped?: stale | repeat, seq, typed?}: a click on a drawn screen goes to the session that drew it as one `[ouros-ui] {surface, seq, event, context}` line, typed into its terminal with Enter, so an idle agent acts on it now. While the session is starting, waiting on a person, or holds what the user typed into it since its last state change, `typed` is false: an engine with hooks gets the line from its UserPromptSubmit hook, any other has it pasted without Enter. Dropped when `seq` is not the current seq of the surface or the same event was already sent for that seq. When the session has exited or has no open terminal the line becomes a needs-you item. Nothing about it expires with time. Only the workbench calls it' },
  { name: 'ui.hello', params: '{ui_key}', result: '{ok}; marks this connection as a trusted UI connection (see Access)' },
  { name: 'engines.check', params: '{}', result: '{} (results land in `engine_check`)' },
  { name: 'engines.models', errors: [E.NOT_FOUND], params: '{engine_id}', result: '{models: string[]}; the model names the engine manifest lists for the chat box picker, empty when it lists none or takes no model argument' },
  { name: 'hooks.install', needsUi: true, params: '{codex?: bool}', result: '{diff}' },
  { name: 'hooks.uninstall', needsUi: true, params: '{codex?: bool}', result: '{diff}' },
  { name: 'plugin.preview', errors: [E.NEEDS_UI], params: '{source}', result: '{valid, errors, manifest_hash, source, screen}; nothing is installed or run. Remote sources and claude-marketplace sources require ui.hello (-32012 otherwise); local folders and file URLs with an empty host or localhost do not. Git allows HTTPS and local sources only. `screen` is what the install screen shows (`plugins.md`, Install)' },
  { name: 'plugin.install', needsUi: true, errors: [E.VALIDATION], params: '{source, approved_permissions, manifest_hash?, secrets?: {NAME: value}}', result: '{plugin_id, missing_secrets}. -32003 when `approved_permissions` differs from what the manifest asks for, or `manifest_hash` differs from the manifest now on disk' },
  { name: 'plugin.remove', needsUi: true, params: '{plugin_id}', result: '{}' },
  { name: 'plugin.enable', needsUi: true, errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{plugin_id, on: boolean}', result: '{enabled}; persists the switch; a disabled plugin contributes no engines, MCP servers or actions to new sessions until it is turned on again' },
  { name: 'plugin.secret.set', needsUi: true, params: '{plugin_id, name, value}', result: '{}; `name` must be an approved `secrets:<NAME>`' },
  { name: 'browser.secret.set', needsUi: true, errors: [E.INVALID_PARAMS], params: '{name, origin, value}', result: '{}; saves a secret the browser 	ype tool fills from {{secret:NAME}}, only into a password field on origin (scheme, host and port); the value goes to the DPAPI store under plugin id core-browser, never to the command table; a value under 4 characters is refused, since output scrubbing skips such short values' },
  { name: 'mcp.resolve', params: '{plugin_id, server_id, token}', result: '{command, args, env, refs, missing} for the MCP shim, refused unless `token` is the one the core put in that plugin\'s shim command:`env` holds stored secret values, `refs` maps keys to `${VAR}` names the shim reads from its own environment' },
  { name: 'mcp.missing', errors: [E.NOT_FOUND], params: '{plugin_id, names, token}', result: '{}; raises a `missing-secret` needs-you item per name' },
  { name: 'notify.sink.set', stable: true, needsUi: true, params: '{kind, dest, name?, id?, kinds?, enabled?}', result: '{id}; `kind` is `ntfy`, `slack-webhook`, `discord-webhook`, `teams-workflow`, `webhook` or `command`; `dest` is the URL (or a JSON argv array for `command`) and is stored only in the secret store under plugin id `core-notify`; never written to the `command` table' },
  { name: 'notify.sink.list', stable: true, params: '{}', result: '{sinks: [{id, kind, name, kinds, enabled, dest_hash, approved_at}]}; no destination' },
  { name: 'notify.sink.test', stable: true, needsUi: true, params: '{id}', result: '{ok, error?}' },
  { name: 'notify.sink.remove', stable: true, needsUi: true, params: '{id}', result: '{}' },
  { name: 'comment.deliver', errors: [E.NOT_FOUND], params: '{comment_id}', result: "{clipboard_at, typed}: always copied; typed into the agent's terminal without Enter unless its engine takes comments through hooks (Claude), where the UserPromptSubmit hook delivers it" },
  { name: 'pane.open', stable: true, needsUi: true, errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{project_id, url?, session_id?, agent?: bool, lent?: bool}', result: "{pane_id}; `lent: true` (with `agent: true` and a `url` whose origin is in `browser.lent` for the project, -32602 otherwise) opens the agent pane on the project's kept profile; a browser pane the user opened, or with `agent: true` (needs `session_id`) one the workbench opened for an agent's first `navigate`, id `bp_agent_<ulid>`. Stable in the agent form" },
  { name: 'pane.close', needsUi: true, errors: [E.NOT_FOUND], params: '{pane_id}', result: '{}' },
  { name: 'pane.url', needsUi: true, params: '{pane_id, url}', result: '{}; the workbench reports each navigation' },
  { name: 'lend.ask', needsUi: true, errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{session_id, origin}', result: "{}; raises one Needs you row asking the user to lend their sign-in on `origin` (http or https) to agents in the session's project; one open row per project and origin" },
  { name: 'pane.note', needsUi: true, errors: [E.NOT_FOUND], params: '{pane_id, text}', result: '{}; raises one Needs you row about the pane; one open row per pane' },
  { name: 'lend.set', needsUi: true, errors: [E.NOT_FOUND, E.INVALID_PARAMS], params: '{project_id, origin, on}', result: '{sites}; adds or removes `origin` in the UI-only `browser.lent` setting for the project and resolves its open ask; removing one closes the project open lent panes. A lent agent pane uses the project kept browser profile and may only load lent origins in a frame' },
  { name: 'pane.assign', needsUi: true, errors: [E.NOT_FOUND], params: '{pane_id, session_id?}', result: '{}; sets or clears the one session allowed to drive the pane' },
  { name: 'pane.capture', needsUi: true, errors: [E.INVALID_PARAMS], params: '{pane_id, label}', result: '{snapshot_id}; the core calls `browser.capture` on the browser pipe and writes the `snapshot` row' },
  { name: 'approval.check', params: '{session_id, surface, target, action, args, control, password?, hidden?, file_dialog?, action_hash?}', result: '{decision, reason?, approval_id?, instruction?}; a `rejected` carries the instruction text of the user when they gave one; never queued; waits until a person decides; no timer (`contracts/approvals.md`)' },
  { name: 'approval.resolve', needsUi: true, errors: [E.GATE_STALE], params: '{approval_id, decision, scope?, instruction?}', result: '{status, scope}; `instruction` (up to 500 characters, only with `reject`) is sent to the agent as words from the user and also rejects the other waiting approvals of that session; -32602 when over the cap or not with reject; -32010 when the row is not `waiting`' },
  { name: 'desktop.ui-window', needsUi: true, params: '{pid, takeover_key, takeover_error}', result: "{}; the workbench's process id, whose windows are never listed or granted, and the take-over key it registered (`takeover_error` null) or why it failed; until a registered key is reported no window can be granted, and a failure ends live grants (`contracts/desktop-tools.md`)" },
  { name: 'grant.candidates', needsUi: true, params: '{}', result: '{windows: [{hwnd, title, exe, pid, process_start}]}: visible top-level windows that may be granted' },
  { name: 'grant.window', needsUi: true, errors: [E.NOT_FOUND, E.VALIDATION], params: '{session_id, hwnd, pid, process_start}', result: '{grant_id}; -32003 for a window whose pid or process start differ from the picked candidate, the workbench, an elevated window, a gone window or a non top-level window' },
  { name: 'grant.revoke', needsUi: true, errors: [E.NOT_FOUND], params: '{grant_id}', result: '{}; ends the grant' },
  { name: 'grant.pin', needsUi: true, errors: [E.NOT_FOUND, E.VALIDATION, E.INVALID_PARAMS], params: '{grant_id, title_pattern}', result: '{title_pattern}; binds the grant to a title pattern (`*` any run, the rest literal, whole title, case-sensitive) or null to unpin; a title that stops matching pauses the session' },
  { name: 'grant.live', needsUi: true, params: '{}', result: '{grants: [{id, session_id, hwnd, title, title_pattern, rect, minimized}]}; `rect` is `[x, y, w, h]` in physical pixels from the last 500 ms check' },
  { name: 'takeover.pause', needsUi: true, params: '{}', result: '{paused_at}; sets the take-over flag (D62) and replies once no desktop input chunk is in flight' },
  { name: 'takeover.resume', needsUi: true, errors: [E.NOT_FOUND], params: '{session_id}', result: '{}; clears the take-over flag for that session only; for a session that requested take-over, first reads its granted windows again and keeps the change summary for `takeover.status`' },
  { name: 'takeover.request', errors: [E.PANE_NOT_OWNED], params: '{session_id, pid, reason?}', result: '{requested, paused}; records an agent request for take-over; the user accepts it from the workbench tile, which calls `takeover.pause`; never pauses by itself; never queued' },
  { name: 'takeover.status', errors: [E.PANE_NOT_OWNED], params: '{session_id, pid}', result: '{requested, paused, changes?}; `changes` is the capped summary of what the user changed during a requested take-over, read fresh on `takeover.resume`, returned once' },
  { name: 'desktop.windows', errors: [E.PANE_NOT_OWNED], params: '{session_id, pid}', result: "{windows: [{window, title, exe, grant_id, owner}]}: the session's granted windows and the windows they own; never queued" },
  { name: 'desktop.describe', errors: [E.PANE_NOT_OWNED], params: '{session_id, pid, window, ref?}', result: '{grant_id, control, password, hidden, file_dialog, rect, token, minimized, covered_by}; `token` is opaque and names the element itself; `minimized` is true when the granted window is minimised; `covered_by` is the title of another program top-level window over the target centre, else empty (M6-18); -32030 "window not granted; ask the user to give it to you"' },
  { name: 'desktop.snapshot', errors: [E.PANE_NOT_OWNED], params: '{session_id, pid, window, max_nodes?}', result: '{text, nodes}: the UI Automation tree with refs' },
  { name: 'desktop.screenshot', errors: [E.PANE_NOT_OWNED], params: '{session_id, pid, window}', result: '{data_base64, mime, width, height}: JPEG, no side over 1,568 px' },
  { name: 'desktop.check', errors: [E.PANE_NOT_OWNED, E.INVALID_PARAMS], params: '{session_id, pid, window, checks}', result: '{passed, results: [{passed, actual}]}; up to 8 title or control value checks, run with no model' },
  { name: 'desktop.find', errors: [E.PANE_NOT_OWNED], params: '{session_id, pid, window, text}', result: '{found}: whether a node Name or value contains `text`' },
  { name: 'desktop.action.verify', errors: [E.NOT_FOUND, E.PANE_NOT_OWNED], params: '{session_id, pid, action_hash}', result: '{confirmed}; reads a held action predeclared exact title postcondition' },
  { name: 'desktop.action.held', needsUi: true, params: '{session_id}', result: '{actions: [{action_hash, target, status, updated_at}]}; up to 100 unresolved desktop outcomes' },
  { name: 'desktop.action.release', needsUi: true, errors: [E.GATE_STALE, E.INVALID_PARAMS], params: '{session_id, action_hash}', result: '{status: "released"}; clears a completed held desktop outcome' },
  { name: 'desktop.act', errors: [E.PANE_NOT_OWNED, E.INVALID_PARAMS], params: '{session_id, pid, window, action, ref?, text?, keys?, dy?, expect}', result: '{status, focus_returned?}; `type` goes in chunks of at most 8 characters with the take-over flag checked before each; -32030 "paused by the user"; -32035 when the control no longer matches `expect`; never queued' },
];

const cell = (s: string) => s.split('|').join('\\|');
const NOT_AGENT_PANE = 'only an agent pane can be given to a session; a user pane carries the whole kept sign-in, so lend the site instead';

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
  desktop?: Desktop;
  automationDeps?: AutomationDeps;
}

function int(p: Record<string, unknown>, key: string): number {
  const v = p[key];
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0) return v;
  throw new RpcError(E.INVALID_PARAMS, `${key} must be a whole number`);
}

export function buildMethods(db: DatabaseSync, ctl: CoreControl): Map<string, MethodSpec> {
  const m = new Map<string, MethodSpec>();
  m.set('auth.signIn', {
    needsUi: true,
    handler: (p) => {
      if (Object.keys(p).some((k) => k !== 'timeout_ms') || (p.timeout_ms !== undefined && (typeof p.timeout_ms !== 'number' || !Number.isInteger(p.timeout_ms) || p.timeout_ms < 1000 || p.timeout_ms > 600_000))) throw new RpcError(E.INVALID_PARAMS, 'timeout_ms must be 1000..600000');
      return auth.signIn(db, { timeout_ms: p.timeout_ms as number | undefined });
    },
  });
  m.set('auth.status', { needsUi: true, handler: (p) => {
    if (Object.keys(p).length) throw new RpcError(E.INVALID_PARAMS, 'auth.status takes no params');
    return auth.status();
  } });
  m.set('auth.signOut', { needsUi: true, handler: (p) => {
    if (Object.keys(p).length) throw new RpcError(E.INVALID_PARAMS, 'auth.signOut takes no params');
    return auth.signOut(db);
  } });
  const blockerList = (v: unknown): string[] => {
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) throw new RpcError(E.INVALID_PARAMS, 'blocker_ids must be an array of strings');
    const ids = [...new Set(v as string[])];
    if (ids.length > 20) throw new RpcError(E.INVALID_PARAMS, 'at most 20 blockers');
    const exists = db.prepare('SELECT 1 FROM session WHERE id = ?');
    for (const b of ids) if (!exists.get(b)) throw new RpcError(E.NOT_FOUND, `blocker session ${b} not found`);
    return ids;
  };

  m.set('account.state', { handler: () => ({ state: auth.status().signed_in ? 'signed_in' : 'signed_out' }) });

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

  const registerProject = (canonical: string) => {
    const id = projectId(canonical);
    const now = nowIso();
    db.prepare(
      `INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET last_opened = excluded.last_opened, hidden = 0, older = 0`,
    ).run(id, canonical, path.posix.basename(canonical), now, now);
    return { project_id: id };
  };
  m.set('project.open', {
    handler: (p) => {
      const input = str(p, 'path');
      let canonical: string;
      try { canonical = resolveProjectPath(input); }
      catch { throw new RpcError(E.NOT_FOUND, `folder not found: ${input}`); }
      return registerProject(canonical);
    },
    asyncHandler: async (p) => {
      const input = str(p, 'path');
      let canonical: string;
      try { canonical = await resolveProjectPathAsync(input); }
      catch { throw new RpcError(E.NOT_FOUND, `folder not found: ${input}`); }
      return registerProject(canonical);
    },
  });

  m.set('session.launch', {
    handler: (p, ctx) => {
      const project = db.prepare('SELECT id, path, name FROM project WHERE id = ?').get(str(p, 'project_id')) as
        | { id: string; path: string; name: string }
        | undefined;
      if (!project) throw new RpcError(E.NOT_FOUND, 'project not found');
      if (!fs.existsSync(project.path)) throw new RpcError(E.NOT_FOUND, `the project folder is gone: ${project.path}`);
      for (const k of ['approval', 'model']) if (p[k] != null && typeof p[k] !== 'string') throw new RpcError(E.INVALID_PARAMS, `${k} must be a string`);
      const requested = str(p, 'approval', false);
      const host = str(p, 'host', false) || (requested === 'isolated' ? 'sandbox' : 'pty');
      if (host !== 'pty' && host !== 'sandbox') throw new RpcError(E.ENGINE_UNAVAILABLE, `host ${host} is not installed`);
      if ((requested === 'isolated') !== (host === 'sandbox')) throw new RpcError(E.VALIDATION, 'isolated runs only on the sandbox host, and the sandbox host only runs isolated');
      const engine = getEngine(db, str(p, 'engine_id'));
      if (!engine) throw new RpcError(E.NOT_FOUND, 'engine not found');
      refuseGateway(engine);
      const check = db
        .prepare('SELECT installed FROM engine_check WHERE engine_id = ? ORDER BY julianday(checked_at) DESC LIMIT 1')
        .get(engine.id) as { installed: number } | undefined;
      if (check && !check.installed) throw new RpcError(E.ENGINE_UNAVAILABLE, `${engine.id} is not installed`);
      const worktreesRoot = canonicalPath(path.join(homeDir(), 'worktrees')).toLowerCase() + '/';
      const fallback = project.path.toLowerCase().startsWith(worktreesRoot) ? 'contained' : settings().sessions.approval;
      let approval = requested || (fallback !== 'isolated' && (fallback === 'ask' || engine.approval_profiles?.[fallback]) ? fallback : 'ask');
      if (approval !== 'ask' && !engine.approval_profiles?.[approval]) {
        throw new RpcError(E.INVALID_PARAMS, `${engine.id} has no approval profile ${approval}`);
      }
      let parent = str(p, 'parent_id', false) || undefined;
      const secret = p.session_secret;
      if (!ctx?.ui && secret !== undefined && secret !== null) {
        const proven = typeof secret === 'string' && secret ? proveSecret(secret) : null;
        const live = proven && db.prepare("SELECT 1 FROM session WHERE id = ? AND state != 'exited'").get(proven.session);
        if (!proven || !live) throw new RpcError(E.NEEDS_UI, 'unknown session secret');
        if (parent && parent !== proven.session) throw new RpcError(E.NEEDS_UI, 'parent_id does not match the calling session');
        parent = proven.session;
        const levels = ['ask', 'edits', 'contained', 'isolated'];
        const ceiling = proven.approval;
        if (requested && levels.indexOf(requested) > levels.indexOf(ceiling)) throw new RpcError(E.NEEDS_UI, `the calling session runs at ${ceiling}; a child cannot run looser`);
        if (!requested && levels.indexOf(approval) > levels.indexOf(ceiling)) approval = ceiling === 'ask' || engine.approval_profiles?.[ceiling] ? ceiling : 'ask';
      }
      const caller = parent ? db.prepare('SELECT id FROM session WHERE id = ?').get(parent) as { id: string } | undefined : undefined;
      if (parent && !caller) throw new RpcError(E.NOT_FOUND, 'parent session not found');
      const blockerIds = p.blocker_ids === undefined || p.blocker_ids === null ? [] : blockerList(p.blocker_ids);
      if (host === 'sandbox') {
        const refusal = sandboxRefusal(engine, project.path);
        if (refusal) throw new RpcError(E.VALIDATION, refusal);
      }
      let cfg: { browser?: { grant?: unknown }; models?: { browser?: unknown } } = {};
      try { cfg = JSON.parse(fs.readFileSync(path.join(project.path, '.troop', 'config.json'), 'utf8')) ?? {}; } catch {}
      const model = str(p, 'model', false) || (p.browser === true && engine.id === 'claude' ? (typeof cfg.models?.browser === 'string' && cfg.models.browser ? cfg.models.browser : 'claude-sonnet-5-5') : undefined);
      if (model && !engine.model_arg) throw new RpcError(E.VALIDATION, `${engine.id} does not take a model argument`);
      let grant: unknown = p.browser_grant;
      if (grant === undefined || grant === null) grant = cfg.browser?.grant;
      if (grant !== undefined && grant !== null && !isPreset(grant)) throw new RpcError(E.INVALID_PARAMS, `unknown browser grant ${String(grant)}; one of look, act, debug`);
      if (p.browser_grant == null && p.browser !== true) grant = grant === 'look' ? 'look' : 'act';
      return { ...launchSession(db, {
        host,
        approval,
        browserGrant: (grant as string | undefined) ?? undefined,
        projectId: project.id,
        projectPath: project.path,
        projectName: project.name,
        engine,
        prompt: str(p, 'prompt', false) || undefined,
        browser: p.browser === true,
        parentId: parent,
        model,
        blockerIds,
      }), ...(model ? { model } : {}) };
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

  m.set('audit.list', {
    needsUi: true,
    handler: async (p) => {
      const id = str(p, 'project_id');
      if (!db.prepare('SELECT 1 FROM project WHERE id = ?').get(id)) throw new RpcError(E.NOT_FOUND, 'project not found');
      const limit = p.limit;
      if (limit !== undefined && (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 500)) throw new RpcError(E.INVALID_PARAMS, 'limit must be a whole number from 1 to 500');
      const before = p.before;
      if (before !== undefined && typeof before !== 'string') throw new RpcError(E.INVALID_PARAMS, 'before must be a string');
      const beforeId = p.before_id;
      if (beforeId !== undefined && typeof beforeId !== 'string') throw new RpcError(E.INVALID_PARAMS, 'before_id must be a string');
      if (beforeId !== undefined && before === undefined) throw new RpcError(E.INVALID_PARAMS, 'before_id needs before');
      return { rows: auditRows(db, id, { limit, before, before_id: beforeId }, await scrubSecretValuesAsync()) };
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
      const settle = p.settle_ms ?? 0;
      if (typeof settle !== 'number' || !Number.isInteger(settle) || settle < 0 || settle > 60_000) {
        throw new RpcError(E.INVALID_PARAMS, 'settle_ms must be a whole number from 0 to 60000');
      }
      const read = () => (db.prepare('SELECT state FROM session WHERE id = ?').get(id) as { state: string } | undefined)?.state;
      // Wraps a wait result with why the session waits and whether only a person can act.
      const out = (state: string, timed_out: boolean) => ({ state, timed_out, wait_reason: (db.prepare('SELECT wait_reason FROM session WHERE id = ?').get(id) as { wait_reason: string | null } | undefined)?.wait_reason ?? null, waiting_on_person: state === 'waiting_for_you' });
      const end = Date.now() + timeout;
      let state = read();
      if (state === undefined) throw new RpcError(E.NOT_FOUND, 'session not found');
      // A state the core writes wakes the wait at once, so done -> idle between polls is not missed; the 200 ms poll catches other writers.
      let hit: string | undefined;
      let wake = () => {};
      let since = 0;
      const off = onStateChange((sid, s) => {
        if (sid !== id) return;
        if (settle > 0) { state = s; if (!states.includes(s)) since = 0; wake(); } else if (!hit && states.includes(s)) { hit = s; wake(); }
      });
      try {
        if (settle > 0) {
          for (;;) {
            const now = Date.now();
            if (!states.includes(state)) since = 0;
            else if (!since) since = now;
            if (since && now - since >= settle) return out(state, false);
            const left = end - now;
            if (left <= 0) return out(state, true);
            await new Promise<void>((r) => { wake = r; setTimeout(r, Math.min(200, left, since ? since + settle - now : 200)); });
            state = read() ?? state;
          }
        }
        while (!hit && !states.includes(state)) {
          const left = end - Date.now();
          if (left <= 0) return out(state, true);
          await new Promise<void>((r) => { wake = r; setTimeout(r, Math.min(200, left)); });
          state = read() ?? state;
        }
        return out(hit ?? state, false);
      } finally {
        off();
      }
    },
  });

  m.set('session.hide', {
    handler: (p) => {
      const id = str(p, 'session_id');
      const r = db.prepare('UPDATE session SET hidden = 1 WHERE id = ?').run(id);
      if (Number(r.changes) === 0) throw new RpcError(E.NOT_FOUND, 'session not found');
      forgetLive(id);
      return {};
    },
  });

  m.set('usage.summary', {
    handler: (p) => {
      if (p.window !== 'today' && p.window !== 'week' && p.window !== 'run') throw new RpcError(E.INVALID_PARAMS, 'window must be today, week or run');
      if (p.window === 'run' && typeof p.run_id !== 'string') throw new RpcError(E.INVALID_PARAMS, 'run_id is required for the run window');
      const o = { window: p.window, run_id: p.run_id as string | undefined };
      return { ...usageSummary(db, o), repeat_reads: repeatReads(db, o), savers: saverReport() };
    },
  });

  m.set('usage.session', {
    handler: (p) => {
      const usage = sessionUsage(db, str(p, 'session_id'));
      if (!usage) throw new RpcError(E.NOT_FOUND, 'session not found');
      return usage;
    },
  });

  m.set('stats.sessions', {
    handler: (p) => {
      if (p.project_id !== undefined && typeof p.project_id !== 'string') throw new RpcError(E.INVALID_PARAMS, 'project_id must be a string');
      return sessionStats(db, { project_id: p.project_id === undefined ? undefined : str(p, 'project_id', false), days: p.days as number | undefined });
    },
  });

  m.set('stats.checks', {
    handler: (p) => {
      if (p.project_id !== undefined && typeof p.project_id !== 'string') throw new RpcError(E.INVALID_PARAMS, 'project_id must be a string');
      return checkStats(db, { project_id: p.project_id === undefined ? undefined : str(p, 'project_id', false), days: p.days as number | undefined });
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
      const hide = db.prepare("UPDATE session SET hidden = 1 WHERE project_id = ? AND state NOT IN ('starting', 'working', 'waiting_for_you', 'unknown') RETURNING id").all(id) as Array<{ id: string }>;
      for (const s of hide) forgetLive(s.id);
      db.prepare("UPDATE run SET hidden = 1 WHERE project_id = ? AND status NOT IN ('running', 'paused')").run(id);
      return {};
    },
  });

  m.set('project.hide', {
    handler: (p) => {
      const id = str(p, 'project_id');
      if (db.prepare("SELECT 1 FROM session WHERE project_id = ? AND state IN ('starting', 'working', 'waiting_for_you', 'unknown') LIMIT 1").get(id)) throw new RpcError(E.VALIDATION, 'a session in this project is still running');
      if (Number(db.prepare('UPDATE project SET hidden = 1 WHERE id = ?').run(id).changes) === 0) throw new RpcError(E.NOT_FOUND, 'project not found');
      for (const s of db.prepare('SELECT id FROM session WHERE project_id = ?').all(id) as Array<{ id: string }>) forgetLive(s.id);
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

  m.set('session.stop', {
    needsUi: true,
    handler: (p) => {
      const id = str(p, 'session_id');
      const row = db.prepare('SELECT host, state FROM session WHERE id = ?').get(id) as { host: string; state: string } | undefined;
      if (!row) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (row.host === 'external') throw new RpcError(E.VALIDATION, 'this agent was opened outside cc; stop it in its own terminal');
      if (row.state === 'exited') return { stopped: false };
      appendEvent('core.user-stop', id, {}, db);
      return { stopped: term.stop(id) };
    },
  });
  m.set('session.seen', { handler: (p) => { markSeen(str(p, 'session_id')); return {}; } });
  m.set('session.live-text', {
    handler: () => {
      const out: Record<string, { line?: string; title?: string; held?: boolean }> = liveText();
      for (const id of heldPrompts()) out[id] = { ...out[id], held: true };
      return out;
    },
  });
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

  m.set('done.check', { handler: (p) => runCheck(db, str(p, 'session_id'), str(p, 'command'), str(p, 'acceptance', false)) });
  m.set('loop.choose', { needsUi: true, handler: (p) => chooseLoop(db, str(p, 'session_id'), str(p, 'choice')) });
  m.set('done.result', { handler: (p) => doneResult(db, str(p, 'session_id')) });

  m.set('session.clear-status', {
    handler: (p) => {
      const id = str(p, 'session_id');
      const s = db.prepare('SELECT state FROM session WHERE id = ?').get(id) as { state: string } | undefined;
      if (!s) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (s.state === 'exited') throw new RpcError(E.INVALID_PARAMS, 'the session has exited');
      appendEvent('core.status-cleared', id, {}, db);
      const at = nowIso();
      db.prepare("UPDATE session SET state = 'idle', state_at = ?, wait_reason = NULL WHERE id = ?").run(at, id);
      db.prepare('INSERT INTO session_state_log (session_id, at, state) VALUES (?, ?, ?)').run(id, at, 'idle');
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
  const continuing = new Set<string>();
  m.set('session.continue', {
    handler: async (p) => {
      const id = str(p, 'session_id');
      const target = str(p, 'engine_id');
      if (continuing.has(id)) throw new RpcError(E.INVALID_PARAMS, 'this session is already being continued');
      const old = db.prepare('SELECT s.engine_id, s.cwd, s.state, s.approval, s.limit_resume, p.id AS project_id, p.path, p.name FROM session s JOIN project p ON p.id = s.project_id WHERE s.id = ?').get(id) as
        { engine_id: string; cwd: string | null; state: string; approval: string | null; limit_resume: number; project_id: string; path: string; name: string } | undefined;
      if (!old) throw new RpcError(E.NOT_FOUND, 'session not found');
      const hit = db.prepare(`SELECT 1 FROM event h WHERE h.session_id = ? AND h.kind = 'core.limit-hit'
        AND h.seq = (SELECT MAX(e.seq) FROM event e WHERE e.session_id = h.session_id AND e.kind = 'core.limit-hit')
        AND NOT EXISTS (SELECT 1 FROM event r WHERE r.session_id = h.session_id AND r.kind = 'core.limit-resumed' AND r.seq > h.seq AND json_extract(r.payload, '$.limit_hit') = h.seq)
        AND NOT EXISTS (SELECT 1 FROM event l WHERE l.session_id = h.session_id AND l.seq > COALESCE(json_extract(h.payload, '$.after'), h.seq)
          AND ((l.kind LIKE 'claude.%' AND l.kind != 'claude.Notification') OR l.kind = 'core.prompt-written'))`).get(id);
      if (old.state === 'exited' || !hit) throw new RpcError(E.INVALID_PARAMS, 'session is not stopped at a usage limit');
      if (target === old.engine_id) throw new RpcError(E.INVALID_PARAMS, 'choose another engine');
      const engine = getEngine(db, target);
      if (!engine) throw new RpcError(E.NOT_FOUND, 'engine not found');
      refuseGateway(engine);
      const approval = old.approval && engine.approval_profiles?.[old.approval] ? old.approval : 'ask';
      const check = db.prepare('SELECT installed, auth FROM engine_check WHERE engine_id = ? ORDER BY julianday(checked_at) DESC LIMIT 1').get(target) as { installed: number; auth: string } | undefined;
      if (!check?.installed || check.auth === 'missing' || check.auth === 'expired') throw new RpcError(E.ENGINE_UNAVAILABLE, 'engine is not ready');
      continuing.add(id);
      let launched = false;
      let file = '';
      db.prepare('UPDATE session SET limit_resume = 0 WHERE id = ?').run(id);
      try {
        const titles = Object.fromEntries(Object.entries(liveText()).map(([key, value]) => [key, value.title]));
        const row = (await gatherHandoff(db, id, titles))!;
        row.cwd = old.cwd ?? old.path;
        row.transcript = handoffTranscript(db, id, old.engine_id, row.transcript);
        const prompt = buildHandoff(row, old.engine_id, titles[id], knownSecretValues());
        await fs.promises.mkdir(handoffDir(), { recursive: true });
        let n = Number((db.prepare('SELECT count(*) AS n FROM handoff WHERE session_id = ?').get(id) as { n: number }).n) + 1;
        for (;;) {
          const candidate = path.join(handoffDir(), `${id}-${n++}.md`);
          try { await fs.promises.writeFile(candidate, prompt, { flag: 'wx' }); file = candidate; break; }
          catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
        }
        const r = launchSession(db, { projectId: old.project_id, projectPath: old.path, projectName: old.name, engine, cwd: old.cwd ?? old.path, approval, host: approval === 'isolated' ? 'sandbox' : 'pty', prompt });
        processEvents(db);
        if (db.prepare("SELECT 1 FROM session WHERE id = ? AND state = 'exited'").get(r.session_id)) throw new RpcError(E.ENGINE_UNAVAILABLE, 'continued session exited during launch');
        launched = true;
        tx(db, () => {
          db.prepare('INSERT INTO handoff (id, session_id, parent_id, to_session, at, cwd, summary, files, transcript) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?)')
            .run(ulid(), id, r.session_id, nowIso(), row.cwd, row.summary, JSON.stringify(row.files), row.transcript);
          db.prepare('UPDATE session SET limit_resume = 0 WHERE id = ?').run(id);
          appendEvent('core.continued', id, { to: r.session_id, file }, db);
          appendEvent('core.continued-from', r.session_id, { from: id, file }, db);
        });
        return { session_id: r.session_id, file };
      } finally {
        if (!launched) db.prepare('UPDATE session SET limit_resume = ? WHERE id = ?').run(old.limit_resume, id);
        continuing.delete(id);
        if (!launched && file) await fs.promises.rm(file, { force: true });
      }
    },
  });
  m.set('session.resume', {
    handler: (p) => {
      const oldId = str(p, 'session_id');
      const prior = resumedAs.get(oldId);
      const live = prior && db.prepare("SELECT 1 FROM session WHERE id = ? AND state != 'exited'").get(prior);
      if (live) return { session_id: prior, resumed: false, existing: true, notice: 'Already started again; showing that session.' };
      const old = db.prepare('SELECT s.engine_id, s.native_id, s.cwd, s.state, s.approval, p.id AS project_id, p.path, p.name FROM session s JOIN project p ON p.id = s.project_id WHERE s.id = ?')
        .get(oldId) as { engine_id: string; native_id: string | null; cwd: string | null; state: string; approval: string | null; project_id: string; path: string; name: string } | undefined;
      if (!old) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (old.state !== 'exited') throw new RpcError(E.INVALID_PARAMS, 'the session is still running');
      const engine = getEngine(db, old.engine_id);
      if (!engine) throw new RpcError(E.NOT_FOUND, 'engine not found');
      const resumed = Boolean(engine.resume_args && old.native_id);
      const extraArgs = resumed ? engine.resume_args!.map((a) => a.split('{native_id}').join(old.native_id!)) : [];
      const r = launchSession(db, { projectId: old.project_id, projectPath: old.path, projectName: old.name, engine, cwd: old.cwd ?? old.path, approval: old.approval && old.approval !== 'isolated' ? old.approval : 'ask', extraArgs });
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
      if (beingRemoved(project.path)) throw new RpcError(E.VALIDATION, 'this worktree is being removed by the sweep; open another folder');
      if (!fs.existsSync(project.path)) throw new RpcError(E.NOT_FOUND, `the project folder is gone: ${project.path}`);
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
    handler: async (p) => {
      const project = db.prepare('SELECT path FROM project WHERE id = ?').get(str(p, 'project_id')) as { path: string } | undefined;
      if (!project) throw new RpcError(E.NOT_FOUND, 'project not found');
      const repo = await repoOfAsync(project.path);
      if (!repo) return { repo: null, paths: [] };
      const titles = Object.fromEntries(Object.entries(liveText()).map(([id, t]) => [id, t.title === undefined ? undefined : scrub(t.title, knownSecretValues())]));
      return { repo, paths: await ownersAsync(db, repo, titles) };
    },
  });

  m.set('session.read', {
    handler: async (p) => {
      const id = str(p, 'session_id');
      const n = p.lines === undefined ? 50 : p.lines;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 500) throw new RpcError(E.INVALID_PARAMS, 'lines must be a whole number from 1 to 500');
      const row = db.prepare('SELECT state FROM session WHERE id = ?').get(id) as { state: string } | undefined;
      if (!row) throw new RpcError(E.NOT_FOUND, 'session not found');
      const secrets = knownSecretValues();
      return { session_id: id, state: row.state, lines: ((await term.readLines(id, n)) ?? []).map((l) => scrub(l, secrets)) };
    },
  });

  m.set('session.chat', {
    handler: async (p) => {
      const id = str(p, 'session_id');
      const limit = p.limit === undefined ? 200 : p.limit;
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new RpcError(E.INVALID_PARAMS, 'limit must be a whole number from 1 to 500');
      const row = db.prepare('SELECT state, engine_id, cwd FROM session WHERE id = ?').get(id) as { state: string; engine_id: string; cwd: string | null } | undefined;
      if (!row) throw new RpcError(E.NOT_FOUND, 'session not found');
      const transcript = (db.prepare("SELECT json_extract(payload, '$.transcript_path') AS t FROM event WHERE session_id = ? AND json_extract(payload, '$.transcript_path') IS NOT NULL ORDER BY seq DESC LIMIT 1").get(id) as { t: unknown } | undefined)?.t ?? engineFile(id);
      const source = typeof transcript === 'string' && transcript.toLowerCase().endsWith('.jsonl') ? 'transcript' : 'none';
      let lines: string[] = [];
      if (source === 'transcript') {
        try {
          const file = await fs.promises.open(transcript as string, 'r');
          try {
            const size = (await file.stat()).size;
            const start = Math.max(0, size - 2 * 1024 * 1024);
            const buffer = Buffer.alloc(size - start);
            let read = 0;
            while (read < buffer.length) {
              const { bytesRead } = await file.read(buffer, read, buffer.length - read, start + read);
              if (!bytesRead) break;
              read += bytesRead;
            }
            lines = buffer.subarray(0, read).toString('utf8').split('\n');
            if (start > 0) lines.shift();
          } finally { await file.close(); }
        } catch {}
      }
      const permission = row.state === 'waiting_for_you'
        ? db.prepare("SELECT json_extract(payload, '$.tool_use_id') AS tool_use_id FROM event WHERE session_id = ? AND kind = 'claude.PermissionRequest' ORDER BY seq DESC LIMIT 1").get(id) as { tool_use_id: unknown } | undefined
        : undefined;
      const { items, waiting } = row.engine_id === 'claude'
        ? parseChat(lines, row.state, row.cwd, typeof permission?.tool_use_id === 'string' ? permission.tool_use_id : null)
        : parseEngineChat(lines, row.state);
      const secrets = knownSecretValues();
      return { session_id: id, engine_id: row.engine_id, source, waiting, items: items.slice(-limit).map((item) => item.kind === 'tool'
        ? { ...item, id: scrub(item.id, secrets), name: scrub(item.name, secrets), label: scrub(item.label, secrets), ...(item.file === undefined ? {} : { file: scrub(item.file, secrets) }),
          ...(item.preview === undefined ? {} : { preview: { ...item.preview, lines: item.preview.lines.map((line) => ({ ...line, text: scrub(line.text, secrets) })) } }),
          ...(item.output === undefined ? {} : { output: item.output.map((line) => scrub(line, secrets)) }) }
        : { ...item, text: scrub(item.text, secrets) }) };
    },
  });

  m.set('session.handoff', {
    handler: (p) => {
      const id = str(p, 'session_id');
      if (!db.prepare('SELECT 1 FROM session WHERE id = ?').get(id)) throw new RpcError(E.NOT_FOUND, 'session not found');
      const row = db.prepare('SELECT id, session_id, parent_id, to_session, at, cwd, summary, files, transcript FROM handoff WHERE session_id = ? ORDER BY julianday(at) DESC LIMIT 1').get(id) as
        | { id: string; session_id: string; parent_id: string | null; to_session: string | null; at: string; cwd: string | null; summary: string | null; files: string; transcript: string | null }
        | undefined;
      return { handoff: row ? { ...row, files: JSON.parse(row.files) } : null };
    },
  });

  m.set('session.labels-set', {
    handler: (p) => {
      const id = str(p, 'session_id');
      if (!Array.isArray(p.labels) || !p.labels.every((label) => typeof label === 'string')) throw new RpcError(E.INVALID_PARAMS, 'labels must be an array of strings');
      const labels = [...new Set((p.labels as string[]).map((label) => label.trim()))];
      if (labels.some((label) => label.length < 1 || label.length > 32)) throw new RpcError(E.INVALID_PARAMS, 'each label must be 1 to 32 characters');
      if (labels.length > 8) throw new RpcError(E.INVALID_PARAMS, 'at most 8 labels');
      if (!db.prepare('SELECT 1 FROM session WHERE id = ?').get(id)) throw new RpcError(E.NOT_FOUND, 'session not found');
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM session_label WHERE session_id = ?').run(id);
        const insert = db.prepare('INSERT INTO session_label (session_id, name) VALUES (?, ?)');
        for (const label of labels) insert.run(id, label);
        ensureLabels(db, labels);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return { labels: (db.prepare('SELECT name FROM session_label WHERE session_id = ? ORDER BY name').all(id) as Array<{ name: string }>).map((row) => row.name) };
    },
  });

  m.set('session.priority-set', {
    handler: (p) => {
      const id = str(p, 'session_id');
      if (!PRIORITIES.includes(p.priority as string)) throw new RpcError(E.INVALID_PARAMS, `priority must be one of ${PRIORITIES.join(', ')}`);
      if (Number(db.prepare('UPDATE session SET priority = ? WHERE id = ?').run(p.priority as string, id).changes) === 0) throw new RpcError(E.NOT_FOUND, 'session not found');
      return { ok: true };
    },
  });

  m.set('session.block-set', {
    handler: (p) => {
      const id = str(p, 'session_id');
      const ids = blockerList(p.blocker_ids);
      if (!db.prepare('SELECT 1 FROM session WHERE id = ?').get(id)) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (ids.includes(id)) throw new RpcError(E.INVALID_PARAMS, 'a session cannot block itself');
      const upstream = db.prepare('WITH RECURSIVE up(id) AS (SELECT blocker_id FROM session_block WHERE blocked_id = ? UNION SELECT b.blocker_id FROM session_block b JOIN up ON b.blocked_id = up.id) SELECT 1 FROM up WHERE id = ?');
      if (ids.some((b) => upstream.get(b, id))) throw new RpcError(E.INVALID_PARAMS, 'that would make a blocking cycle');
      tx(db, () => {
        db.prepare('DELETE FROM session_block WHERE blocked_id = ?').run(id);
        const insert = db.prepare('INSERT INTO session_block (blocked_id, blocker_id) VALUES (?, ?)');
        for (const b of ids) insert.run(id, b);
      });
      return { ok: true };
    },
  });

  m.set('session.block-clear', {
    handler: (p) => {
      const id = str(p, 'session_id');
      if (!db.prepare('SELECT 1 FROM session WHERE id = ?').get(id)) throw new RpcError(E.NOT_FOUND, 'session not found');
      db.prepare('DELETE FROM session_block WHERE blocked_id = ?').run(id);
      return { ok: true };
    },
  });

  m.set('labels.list', {
    handler: (p) => {
      const id = str(p, 'project_id');
      const labels = db.prepare('SELECT l.name, COUNT(*) AS count FROM session_label l JOIN session s ON s.id = l.session_id WHERE s.project_id = ? GROUP BY l.name ORDER BY count DESC, l.name ASC').all(id);
      return { labels };
    },
  });

  m.set('session.monitor-set', {
    handler: (p) => {
      const id = str(p, 'session_id');
      const automation = p.automation_id;
      if (automation !== null && (typeof automation !== 'string' || !automation)) throw new RpcError(E.INVALID_PARAMS, 'automation_id must be a string or null');
      if (!db.prepare('SELECT 1 FROM session WHERE id = ?').get(id)) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (automation === null) {
        db.prepare('DELETE FROM session_monitor WHERE session_id = ?').run(id);
        return { ok: true };
      }
      if (!db.prepare('SELECT 1 FROM automation WHERE id = ?').get(automation)) throw new RpcError(E.NOT_FOUND, 'automation not found');
      db.prepare('INSERT INTO session_monitor (session_id, automation_id) VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET automation_id = excluded.automation_id').run(id, automation);
      return { ok: true };
    },
  });
  m.set('session.reviewers-set', { handler: (p) => setReviewers(db, str(p, 'session_id'), p.reviewers, p.approvers) });
  m.set('session.approve', { handler: (p) => decide(db, str(p, 'session_id'), true, p.note) });
  m.set('session.reject', { handler: (p) => decide(db, str(p, 'session_id'), false, p.note) });

  m.set('session.send', {
    handler: (p) => {
      const id = str(p, 'session_id');
      const text = p.text;
      if (typeof text !== 'string' || text.length < 1 || text.length > 4000) throw new RpcError(E.INVALID_PARAMS, 'text must be a string of 1 to 4000 characters');
      if (/[\x00-\x1f\x7f-\x9f]/.test(text)) throw new RpcError(E.INVALID_PARAMS, 'text must not contain control characters');
      const row = db.prepare('SELECT host, state FROM session WHERE id = ?').get(id) as { host: string; state: string } | undefined;
      if (!row) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (row.state === 'waiting_for_you') throw new RpcError(E.INVALID_PARAMS, 'the session is waiting on a person; only the user can answer it');
      if (row.host === 'external') throw new RpcError(E.INVALID_PARAMS, 'the session was opened outside cc; type into its own terminal');
      // Pastes the text the way a delivered comment is pasted, then presses Enter.
      if (!term.paste(id, text)) throw new RpcError(E.INVALID_PARAMS, 'the session has no open terminal');
      term.write(id, '\r');
      return { sent: true };
    },
  });

  m.set('session.paste-prompt', {
    handler: (p) => {
      const id = str(p, 'session_id');
      const row = db.prepare('SELECT host FROM session WHERE id = ?').get(id) as { host: string } | undefined;
      if (!row) throw new RpcError(E.NOT_FOUND, 'session not found');
      if (row.host === 'external') throw new RpcError(E.INVALID_PARAMS, 'the session was opened outside cc; type into its own terminal');
      return writePrompt(db, id);
    },
  });

  m.set('engines.check', { handler: () => { void checkAll(db, ctl.engines()).catch(() => {}); return {}; } });
  m.set('engines.models', {
    handler: (p) => {
      const engine = ctl.engines().find((e) => e.id === str(p, 'engine_id'));
      if (!engine) throw new RpcError(E.NOT_FOUND, 'engine not found');
      return { models: engine.model_arg ? engine.models ?? [] : [] };
    },
  });

  m.set('worktree.create', {
    handler: async (p) => {
      const patterns = settings().worktree.preserve;
      validatePreserve(patterns);
      const project = db.prepare('SELECT id, path FROM project WHERE id = ?').get(str(p, 'project_id')) as
        | { id: string; path: string }
        | undefined;
      if (!project) throw new RpcError(E.NOT_FOUND, 'project not found');
      const branch = str(p, 'branch', false) || `troop/${ulid().toLowerCase()}`;
      const baseParam = str(p, 'base', false);
      const base = baseParam || 'HEAD';
      const root = path.join(homeDir(), 'worktrees', project.id);
      const dir = path.join(root, branch.replace(/[\\/]/g, '-'));
      if (path.dirname(dir) !== root || dir === root) throw new RpcError(E.INVALID_PARAMS, `branch ${branch} does not name a folder under the worktrees folder`);
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      if (fs.existsSync(path.join(dir, '.git'))) {
        const trusted = trustFolder(fs.realpathSync.native(dir), ctl.engines());
        return { path: dir.split(String.fromCharCode(92)).join('/'), branch, trusted, existing: true };
      }
      let existingBranch = true;
      try {
        await gitAsync(project.path, ['rev-parse', '--verify', '-q', `refs/heads/${branch}`], 60_000, {}, false);
      } catch {
        existingBranch = false;
      }
      if (existingBranch && baseParam) throw new RpcError(E.INVALID_PARAMS, 'base only applies to a new branch');
      const addArgs = existingBranch ? [dir, branch] : [dir, '-b', branch, base];
      try {
        await gitAsync(project.path, ['worktree', 'add', ...addArgs], 60_000, {}, false);
      } catch (e) {
        throw new RpcError(E.VALIDATION, `git worktree add failed: ${String((e as { stderr?: Buffer }).stderr ?? e).trim()}`);
      }
      try { await preserveFiles(project.path, dir, patterns); }
      catch (e) {
        await gitAsync(project.path, ['worktree', 'remove', '--force', dir], 60_000, {}, false);
        throw e;
      }
      const trusted = trustFolder(fs.realpathSync.native(dir), ctl.engines());
      const result = { path: dir.split(String.fromCharCode(92)).join('/'), branch, trusted };
      return existingBranch ? { ...result, existing_branch: true } : result;
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

  m.set('plugin.preview', { handler: (p, ctx) => {
    const source = str(p, 'source');
    if (!ctx?.ui && (!isLocalSource(source) || source.startsWith('claude-marketplace:'))) throw new RpcError(E.NEEDS_UI, 'git plugin previews need a trusted UI connection (ui.hello)');
    return previewPluginAsync(db, source);
  } });

  m.set('plugin.install', {
    handler: async (p) => {
      const approved = p.approved_permissions;
      if (!Array.isArray(approved) || approved.some((x) => typeof x !== 'string')) throw new RpcError(E.INVALID_PARAMS, 'approved_permissions must be an array of strings');
      const secrets = p.secrets ?? {};
      if (typeof secrets !== 'object' || Array.isArray(secrets) || Object.values(secrets).some((v) => typeof v !== 'string')) {
        throw new RpcError(E.INVALID_PARAMS, 'secrets must map names to strings');
      }
      const r = await installPluginAsync(db, {
        source: str(p, 'source'),
        approved_permissions: approved as string[],
        manifest_hash: str(p, 'manifest_hash', false) || undefined,
        secrets: secrets as Record<string, string>,
      });
      void checkAll(db, ctl.engines()).catch(() => {});
      return r;
    },
  });

  m.set('plugin.enable', {
    handler: (p) => {
      if (typeof p.on !== 'boolean') throw new RpcError(E.INVALID_PARAMS, 'on must be true or false');
      const r = db.prepare('UPDATE plugin SET enabled = ? WHERE id = ?').run(p.on ? 1 : 0, str(p, 'plugin_id'));
      if (!r.changes) throw new RpcError(E.NOT_FOUND, 'plugin not found');
      return { enabled: p.on };
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

  m.set('ui.show', { handler: (p) => showSurface(db, p) });
  m.set('ui.get', { handler: (p) => getSurface(db, str(p, 'surface')) });
  m.set('ui.event', {
    needsUi: true,
    handler: (p) => surfaceEvent(db, p, (id, engine, text, state, stateAt) => {
      if (!term.has(id)) return false;
      if (state === 'waiting_for_you' || state === 'starting' || term.typedAt(id) >= Date.parse(stateAt)) return getEngine(db, engine)?.state_source === 'hooks' || term.paste(id, text) ? null : false;
      return term.paste(id, text) && term.write(id, '\r') ? 'sent' : false;
    }),
  });

  m.set('mcp.resolve', {
    handler: (p) => {
      checkShimToken(str(p, 'plugin_id'), str(p, 'token'));
      return resolveMcpServerAsync(db, str(p, 'plugin_id'), str(p, 'server_id'));
    },
  });

  m.set('mcp.missing', {
    handler: (p) => {
      const pluginId = str(p, 'plugin_id');
      checkShimToken(pluginId, str(p, 'token'));
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

  const originOf = (url: string): string => {
    let u: URL;
    try { u = new URL(url); } catch { throw new RpcError(E.INVALID_PARAMS, 'not a URL'); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new RpcError(E.INVALID_PARAMS, 'only http and https sites can be lent');
    return u.origin;
  };
  const lentSites = (projectId: string): string[] => settings().browser.lent[projectId] ?? [];
  const lendRef = (projectId: string, origin: string) => `lend:${projectId} ${origin}`;

  m.set('lend.ask', {
    needsUi: true,
    handler: (p) => {
      const s = db.prepare('SELECT project_id, engine_id FROM session WHERE id = ?').get(str(p, 'session_id')) as { project_id: string; engine_id: string } | undefined;
      if (!s) throw new RpcError(E.NOT_FOUND, 'session not found');
      const origin = originOf(str(p, 'origin'));
      const ref = lendRef(s.project_id, origin);
      db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) SELECT ?, ?, 'other', ?, ? WHERE NOT EXISTS (SELECT 1 FROM needs_you WHERE ref = ? AND kind = 'other' AND resolved_at IS NULL)")
        .run(ulid(), nowIso(), ref, `${s.engine_id} wants to use your sign-in on ${origin}`, ref);
      return {};
    },
  });

  m.set('pane.note', {
    needsUi: true,
    handler: (p) => {
      const id = str(p, 'pane_id');
      if (!db.prepare('SELECT 1 FROM browser_pane WHERE id = ?').get(id)) throw new RpcError(E.NOT_FOUND, 'pane not found');
      db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) SELECT ?, ?, 'other', ?, ? WHERE NOT EXISTS (SELECT 1 FROM needs_you WHERE ref = ? AND kind = 'other' AND resolved_at IS NULL)")
        .run(ulid(), nowIso(), id, str(p, 'text'), id);
      return {};
    },
  });

  m.set('lend.set', {
    needsUi: true,
    handler: (p) => {
      const projectId = str(p, 'project_id');
      if (!db.prepare('SELECT 1 FROM project WHERE id = ?').get(projectId)) throw new RpcError(E.NOT_FOUND, 'project not found');
      if (typeof p.on !== 'boolean') throw new RpcError(E.INVALID_PARAMS, 'on must be true or false');
      const origin = originOf(str(p, 'origin'));
      const sites = lentSites(projectId).filter((o) => o !== origin);
      if (p.on) sites.push(origin);
      const all: Record<string, string[]> = { ...settings().browser.lent, [projectId]: sites };
      if (!sites.length) delete all[projectId];
      setSetting('browser', 'lent', all);
      if (!p.on) db.prepare('UPDATE browser_pane SET open = 0 WHERE lent = 1 AND open = 1 AND project_id = ?').run(projectId);
      db.prepare("UPDATE needs_you SET resolved_at = ? WHERE ref = ? AND kind = 'other' AND resolved_at IS NULL").run(nowIso(), lendRef(projectId, origin));
      return { sites };
    },
  });

  m.set('pane.open', {
    handler: (p) => {
      const projectId = str(p, 'project_id');
      if (!db.prepare('SELECT 1 FROM project WHERE id = ?').get(projectId)) throw new RpcError(E.NOT_FOUND, 'project not found');
      const sessionId = str(p, 'session_id', false) || null;
      if (sessionId && !db.prepare('SELECT 1 FROM session WHERE id = ? AND project_id = ?').get(sessionId, projectId)) throw new RpcError(E.NOT_FOUND, 'session not found in this project');
      if (p.agent === true && !sessionId) throw new RpcError(E.INVALID_PARAMS, 'agent panes need a session_id');
      if (p.agent !== true && sessionId) throw new RpcError(E.INVALID_PARAMS, NOT_AGENT_PANE);
      const lent = p.lent === true;
      if (lent && (p.agent !== true || !lentSites(projectId).includes(originOf(str(p, 'url'))))) throw new RpcError(E.INVALID_PARAMS, 'a lent pane is an agent pane on a site the user lent');
      const id = p.agent === true ? `bp_agent_${ulid()}` : `bp_${ulid()}`;
      db.prepare('INSERT INTO browser_pane (id, project_id, session_id, url, open, lent) VALUES (?, ?, ?, ?, 1, ?)').run(id, projectId, sessionId, str(p, 'url', false) || null, lent ? 1 : 0);
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
      if (sessionId && !str(p, 'pane_id').startsWith('bp_agent_')) throw new RpcError(E.INVALID_PARAMS, NOT_AGENT_PANE);
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

  const desktop = ctl.desktop ?? new Desktop(db);
  desktop.methods(m);
  const approvals = new Approvals(db, ctl.approvalTimeoutMs, scrubSecretValues, { paused: (s) => desktop.paused(s), granted: (s, t) => desktop.granted(s, t) });
  m.set('approval.check', {
    handler: (p) => approvals.check(p),
    asyncHandler: async (p) => {
      try { await scrubSecretValuesAsync(); }
      catch { return { decision: 'deny', reason: 'a saved browser secret could not be read, so this action cannot be recorded safely' }; }
      return approvals.check(p);
    },
  });
  m.set('approval.resolve', { needsUi: true, handler: (p) => approvals.resolve(p) });

  const labelsOf = (id: string) => db.prepare('SELECT l.name, l.colour FROM automation_label a JOIN label l ON l.name = a.name WHERE a.automation_id = ? ORDER BY l.name').all(id) as Array<{ name: string; colour: string }>;
  const setAutomationLabels = (id: string, raw: unknown) => {
    let names: string[];
    try { names = labelList(raw); } catch (e) { throw new RpcError(E.INVALID_PARAMS, (e as Error).message); }
    db.prepare('DELETE FROM automation_label WHERE automation_id = ?').run(id);
    const insert = db.prepare('INSERT INTO automation_label (automation_id, name) VALUES (?, ?)');
    for (const name of names) insert.run(id, name);
    ensureLabels(db, names);
  };
  m.set('automation.set', {
    needsUi: true,
    handler: (p) => {
      const project = db.prepare('SELECT path FROM project WHERE id = ?').get(str(p, 'project_id')) as { path: string } | undefined;
      if (!project) throw new RpcError(E.NOT_FOUND, 'project not found');
      if (!db.prepare('SELECT 1 FROM engine WHERE id = ?').get(str(p, 'engine_id'))) throw new RpcError(E.NOT_FOUND, 'engine not found');
      const cron = p.cron === undefined || p.cron === null || p.cron === '' ? null : p.cron;
      if (cron !== null) {
        if (typeof cron !== 'string') throw new RpcError(E.VALIDATION, 'cron must be a string');
        let next: Date | null;
        try { next = cronNext(cron, new Date()); } catch (e) { throw new RpcError(E.VALIDATION, (e as Error).message); }
        if (!next) throw new RpcError(E.VALIDATION, 'cron never matches');
      }
      const every = p.every_min ?? (cron !== null ? 60 : undefined);
      if (typeof every !== 'number' || !Number.isInteger(every) || every < 1) throw new RpcError(E.VALIDATION, 'every_min must be a whole number of at least 1');
      const timeout = p.timeout_ms ?? 60000;
      if (typeof timeout !== 'number' || !Number.isInteger(timeout) || timeout < 1000 || timeout > 600000) throw new RpcError(E.VALIDATION, 'timeout_ms must be 1000 to 600000');
      const icon = p.icon ?? null;
      if (icon !== null && (typeof icon !== 'string' || icon.length > 16)) throw new RpcError(E.VALIDATION, 'icon must be a short string');
      const approval = p.approval ?? null;
      if (approval !== null && !['ask', 'edits', 'contained'].includes(approval as string)) throw new RpcError(E.VALIDATION, 'approval must be ask, edits or contained');
      if (approval !== null && approval !== 'ask' && !getEngine(db, str(p, 'engine_id'))?.approval_profiles?.[approval as string]) throw new RpcError(E.VALIDATION, `${str(p, 'engine_id')} has no approval profile ${approval}`);
      const script = typeof p.script === 'string' ? p.script.trim() : '';
      const runner = p.runner ?? [];
      if (!Array.isArray(runner) || runner.some((r) => typeof r !== 'string' || !r)) throw new RpcError(E.VALIDATION, 'runner must be a list of strings');
      let sha = '';
      if (script) {
        if (!runner.length) throw new RpcError(E.VALIDATION, 'runner must be a non-empty list of strings when there is a check script');
        const abs = path.resolve(project.path, script);
        const rel = path.relative(project.path, abs);
        if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new RpcError(E.VALIDATION, 'script must be inside the project folder');
        try { sha = sha256File(abs); } catch (e) { throw new RpcError(E.VALIDATION, `script not readable: ${(e as Error).message}`); }
      }
      const next_due = nowIso(new Date(nextDue({ cron: cron as string | null, every_min: every }, Date.now())));
      const f = [str(p, 'project_id'), str(p, 'name'), every, JSON.stringify(script ? runner : []), script, sha, timeout, str(p, 'engine_id'), str(p, 'prompt'), icon as string | null, cron as string | null, approval as string | null, next_due];
      return tx(db, () => {
        let id: string;
        if (p.id !== undefined) {
          id = str(p, 'id');
          const r = db.prepare('UPDATE automation SET project_id = ?, name = ?, every_min = ?, runner = ?, script = ?, script_sha256 = ?, timeout_ms = ?, engine_id = ?, prompt = ?, icon = ?, cron = ?, approval = ?, next_due = ? WHERE id = ?').run(...f, id);
          if (!r.changes) throw new RpcError(E.NOT_FOUND, 'automation not found');
        } else {
          id = ulid();
          db.prepare('INSERT INTO automation (project_id, name, every_min, runner, script, script_sha256, timeout_ms, engine_id, prompt, icon, cron, approval, next_due, id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...f, id, nowIso());
        }
        if (p.labels !== undefined) setAutomationLabels(id, p.labels);
        return { id, next_due };
      });
    },
  });
  m.set('automation.enable', {
    needsUi: true,
    handler: (p) => {
      if (typeof p.enabled !== 'boolean') throw new RpcError(E.INVALID_PARAMS, 'enabled must be true or false');
      const a = db.prepare('SELECT every_min, cron FROM automation WHERE id = ?').get(str(p, 'id')) as { every_min: number; cron: string | null } | undefined;
      if (!a) throw new RpcError(E.NOT_FOUND, 'automation not found');
      const next = p.enabled ? nowIso(new Date(nextDue(a, Date.now()))) : null;
      db.prepare('UPDATE automation SET enabled = ?, next_due = COALESCE(?, next_due) WHERE id = ?').run(p.enabled ? 1 : 0, next, str(p, 'id'));
      return {};
    },
  });
  m.set('automation.delete', {
    needsUi: true,
    handler: (p) => {
      tx(db, () => {
        db.prepare('DELETE FROM session_monitor WHERE automation_id = ?').run(str(p, 'id'));
        db.prepare('DELETE FROM automation_run WHERE automation_id = ?').run(str(p, 'id'));
        db.prepare('DELETE FROM automation_label WHERE automation_id = ?').run(str(p, 'id'));
        db.prepare('DELETE FROM automation WHERE id = ?').run(str(p, 'id'));
      });
      return {};
    },
  });
  m.set('automation.list', {
    handler: (p) => {
      const rows = (typeof p.project_id === 'string'
        ? db.prepare('SELECT * FROM automation WHERE project_id = ? ORDER BY julianday(created_at)').all(p.project_id)
        : db.prepare('SELECT * FROM automation ORDER BY julianday(created_at)').all()) as Array<Record<string, unknown>>;
      const runs = db.prepare('SELECT id, due_at, at, outcome, exit_code, detail, session_id FROM automation_run WHERE automation_id = ? ORDER BY julianday(at) DESC, id DESC LIMIT 8');
      return {
        automations: rows.map((a) => ({
          id: a.id, project_id: a.project_id, name: a.name, icon: a.icon ?? null, cron: a.cron ?? null,
          words: a.cron ? cronWords(a.cron as string) : `Every ${a.every_min} min`, every_min: a.every_min, runner: JSON.parse(a.runner as string), script: a.script,
          engine_id: a.engine_id, prompt: a.prompt, approval: a.approval ?? null, timeout_ms: a.timeout_ms, enabled: a.enabled === 1, next_due: a.next_due, created_at: a.created_at, labels: labelsOf(a.id as string), runs: runs.all(a.id as string),
        })),
      };
    },
  });
  m.set('automation.run', {
    needsUi: true,
    handler: async (p) => {
      const id = str(p, 'id');
      if (!db.prepare('SELECT 1 FROM automation WHERE id = ?').get(id)) throw new RpcError(E.NOT_FOUND, 'automation not found');
      const deps = ctl.automationDeps ?? realDeps((a) => m.get('session.launch')!.handler(a, { ui: false, origin: 'automation' }) as { session_id: string });
      const r = await runAutomationNow(db, deps, id);
      if (!r) throw new RpcError(E.VALIDATION, 'automation is already running');
      return r;
    },
  });
  m.set('automation.labels-set', {
    needsUi: true,
    handler: (p) => {
      const id = str(p, 'id');
      if (!db.prepare('SELECT 1 FROM automation WHERE id = ?').get(id)) throw new RpcError(E.NOT_FOUND, 'automation not found');
      tx(db, () => setAutomationLabels(id, p.names));
      return { labels: labelsOf(id) };
    },
  });
  m.set('label.list', {
    handler: () => {
      ensureLabels(db);
      const labels = db.prepare('SELECT l.name, l.colour, (SELECT COUNT(*) FROM session_label s WHERE s.name = l.name) + (SELECT COUNT(*) FROM automation_label a WHERE a.name = l.name) AS count FROM label l ORDER BY count DESC, l.name ASC').all();
      return { labels };
    },
  });
  m.set('label.set', {
    needsUi: true,
    handler: (p) => {
      let name: string;
      try { name = labelList([str(p, 'name')])[0]!; } catch (e) { throw new RpcError(E.INVALID_PARAMS, (e as Error).message); }
      const colour = str(p, 'colour').toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(colour)) throw new RpcError(E.INVALID_PARAMS, 'colour must be #rrggbb');
      db.prepare('INSERT INTO label (name, colour) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET colour = excluded.colour').run(name, colour);
      return { name, colour };
    },
  });
  m.set('cron.next', {
    handler: (p) => {
      const n = p.n ?? 3;
      if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 5) return { ok: false, error: 'n must be 1 to 5' };
      if (typeof p.cron !== 'string') return { ok: false, error: 'cron must be a string' };
      const runs: string[] = [];
      try {
        let at = new Date();
        for (let i = 0; i < n; i++) {
          const next = cronNext(p.cron, at);
          if (!next) break;
          runs.push(nowIso(next));
          at = next;
        }
      } catch (e) { return { ok: false, error: (e as Error).message }; }
      if (!runs.length) return { ok: false, error: 'cron never matches' };
      return { ok: true, runs, words: cronWords(p.cron) };
    },
  });

  for (const name of MOVED_METHODS) m.set(name, { handler: () => { throw new RpcError(E.METHOD_NOT_FOUND, 'moved to the pipeline products'); } });
  for (const d of METHODS) if (d.needsUi && m.has(d.name)) m.get(d.name)!.needsUi = true;

  return m;
}
