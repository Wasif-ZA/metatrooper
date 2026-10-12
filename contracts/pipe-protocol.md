# Named-pipe protocol

Version 1. Two pipes, same framing.

| Pipe | Server | Clients |
|---|---|---|
| `\\.\pipe\metatrooper` | core service | workbench, tray, `troop` CLI |
| `\\.\pipe\metatrooper-browser` | workbench main process | `metatrooper-browser` MCP server (one per agent session) |

## Access

Trusted UI connections: at every start the core writes 32 random bytes, hex, to `~/.metatrooper/ui.key`
(replacing the old one). The workbench, the tray, and the `troop` CLI when it is attached to an interactive
terminal read it and send `ui.hello` on connect. Only such connections may call the methods marked "needs `ui.hello`". Code steps
and plugin actions are started by the core with the stripped environment, their cwd in the project, and no
method or helper that reads the key; the key file is outside every run directory and project. A script that
deliberately reads the key from disk is a hostile process running as the user, which the threat model in
`spec.md` places out of scope.

Pipes are created with Windows' default named-pipe security descriptor: full control for LocalSystem,
Administrators and the creating user; read-only for Everyone and Anonymous. Read-only clients cannot send a
request, so only the creating user (and admins) can issue commands. Other processes of the same user can
connect; that is the same trust boundary as the user's own files. A test proves a second, standard local
account cannot complete a request.

## Framing

Newline-delimited JSON (one JSON object per line, UTF-8, `\n` terminated, no embedded newlines). JSON-RPC 2.0.
Pipes run in byte mode. Maximum line length 1 MiB; a longer line gets error `-32600` and the connection is
closed.

Request:

```json
{"jsonrpc":"2.0","id":"01J9Z...","method":"run.start","params":{...},"meta":{"origin":"workbench","sent_at":"2026-09-29T14:05:00.123+10:00"}}
```

Response (exactly one per request, same `id`):

```json
{"jsonrpc":"2.0","id":"01J9Z...","result":{...}}
{"jsonrpc":"2.0","id":"01J9Z...","error":{"code":-32010,"message":"gate is stale","data":{...}}}
```

- `id` is a ULID made by the client. It is also the `command.id` used for the queue fallback.
- **Run once, whichever path delivers it.** Before executing any state-changing method, the core inserts or
  claims the `command` row in one transaction: `INSERT ... ON CONFLICT(id) DO UPDATE SET status = 'accepted'
  WHERE status = 'queued'`. If the row already exists with any status other than `queued`, the core does not
  execute; it replies with the stored `result` (or waits for it if `running`). The result is written to the
  row before the reply is sent. So a pipe request that timed out, got queued, and then also arrived runs once.
- The server replies as soon as the command is accepted. Long work reports progress through database rows.
  No reply is ever held open for work.
- Clients open one connection, send requests, read replies by `id`, and reconnect on error. There are no
  server-pushed messages. Windows learn about changes from the database watcher.

## Error codes

| Code | Meaning |
|---|---|
| -32700, -32600, -32601, -32602 | JSON-RPC standard: parse, invalid request, unknown method, bad params |
| -32002 | not found (project, session, run, pane, plugin) |
| -32003 | validation failed; `data.errors` lists them |
| -32010 | gate stale: the action changed since approval; for `approval.resolve`, the row is not `waiting` |
| -32011 | publish rule: no approved gate for this action |
| -32012 | this method needs a trusted UI connection (`ui.hello`) |
| -32098 | interrupted by core restart |
| -32020 | engine not installed or auth missing |
| -32030 | browser pane not owned by the calling session |
| -32031 | navigation blocked by the browser allowlist |
| -32040 | cloud not available yet (`run_in: cloud`, `provider: gateway`) |
| -32099 | internal error; the core stays up |

## Command status and crash recovery

Status moves `queued` -> `accepted` -> `running` -> `ok` or `error`. The core writes `accepted` when it
claims the row and `running` immediately before the first side effect (launching a process, writing a file,
calling a plugin action).

On start the core first binds the pipe, which is the single-instance lock (M6-4). A second core whose bind fails
prints "core already running (pid N)" and exits 1 before it opens `troop.db`. Requests that arrive while the
first core is still starting wait for it. Then, before answering them, the core:

1. Re-executes every `accepted` row in `at` order. No side effect has happened for these.
2. Marks every `running` row `error` with `{"code":-32098,"message":"interrupted by core restart"}` and
   raises a needs-you item naming the method. It is never re-executed blindly, because its side effect may
   already have happened.
3. Executes every `queued` row in `at` order.

Client insert: `INSERT INTO command (id, at, origin, method, params, status) VALUES (?, <now ISO 8601>, ?, ?, ?,
'queued') ON CONFLICT(id) DO NOTHING`. If the pipe already accepted that id, the insert is a no-op and the client
reads the row's status as usual. This is the complete conflict rule.

Free text never outlives the command. When a row reaches `ok` or `error`, the core rewrites its `params` so each
`prompt` or `body` string becomes `<key>_length` (an integer). Pending rows keep the text because the queue must
still run them. On start the core applies the same rewrite to any finished row. The database runs with
`secure_delete` on, and the core truncates the WAL on start, every 30 s and on stop, so an old copy of a row
survives in the WAL for at most about 30 s.

## Queue fallback (client side)

Only state-changing methods are ever queued. Not queued (they fail fast with "core offline" instead):
`session.focus`, `session.live-text`, `session.list`, `session.wait`, `session.search`, `engines.check`, every `browser.*` method, and the methods that carry
secret values (`plugin.preview`, `plugin.install`, `plugin.secret.set`, `mcp.resolve`), which are never
written to the `command` table.

1. Send the request on the pipe.
2. If no reply arrives within 300 ms, or the pipe does not exist, insert the same request into `command`
   (`id`, `origin`, `method`, `params`, `status = 'queued'`) and show "queued".
3. Keep waiting on the pipe reply. Whichever finishes, the UI reads the final status from `command` or the
   affected rows.
4. On start, the core runs every `queued` row in `at` order before accepting new pipe requests.

## Core methods (`\\.\pipe\metatrooper`)

Every other interaction is a database read. This table is generated from `METHODS` in `core/src/methods.ts`
(`node core/gen-methods.ts`); edit the list there, never here. Methods marked stable keep their exact shape for
protocol 1; `core.ping` reports the protocol version. Calls on one connection run concurrently, so a long
`session.wait` does not hold up other requests.

<!-- methods:start -->
| Method | Params | Result | Errors | Stable | Needs `ui.hello` |
|---|---|---|---|---|---|
| `core.ping` | `{}` | {ok: true, pid, version, protocol, schema_version, started_at}; `version` is the root `package.json` version, `protocol` is 1 (D63); never queued |  | yes |  |
| `settings.set` | `{key, value}` | {}. `key` is `<section>.<name>` of a known setting and `value` has its type (-32602 otherwise). The core is the only writer of `settings.json`: it writes `settings.json.tmp-<pid>`, flushes it and renames it over the file, and refuses with -32003 "settings.json does not parse, line N" when the file is not JSON. A leftover `.tmp-*` file is deleted on start (M6-4) | -32602, -32003 |  | yes |
| `core.stop` | `{}` | {}; the core exits a moment after replying |  |  | yes |
| `account.state` | `{}` | {state: "signed_out"}: the only state until the cloud milestone; nothing prompts for sign-in |  |  |  |
| `project.open` | `{path}` | {project_id}; any folder opens (sessions in a `sessions.ask_paths` folder start in `ask`). `project_id` = sha1 hex of the canonical path: `fs.realpathSync.native`, then the git toplevel if inside a repo (also through `realpathSync.native`), backslashes turned into forward slashes, the drive letter lower-cased, no trailing slash. Example: `C:\Users\wasif\proj\` becomes `c:/Users/wasif/proj` | -32002 | yes |  |
| `project.clear` | `{project_id}` | {}; hides the project's sessions that are not working or waiting, and its runs that are not running or paused |  |  |  |
| `session.launch` | `{project_id, engine_id, prompt?, host?: "pty", browser?: boolean, parent_id?}` | {session_id, prompt_delivered}: `browser: true` (a launch from the browser pane) attaches the `metatrooper-browser` MCP server; other sessions do not get it. `parent_id` (set by `troop launch` from its own `TROOP_SESSION_ID`) is stored as `session.parent_id`; when the child exits, the parent gets one `notice` naming the child, its claimed files and whether each is committed, its last line and transcript path | -32002, -32003, -32020, -32040 | yes |  |
| `session.list` | `{project_id?, all?: bool}` | {sessions: [{id, project_id, engine_id, host, state, state_at, parent_id}]}, newest first; hidden sessions only with `all: true` |  | yes |  |
| `session.wait` | `{session_id, states: [state, ...], timeout_ms}` | {state, timed_out}: returns as soon as the session is in one of `states` (at once if already there), or with `timed_out: true` when `timeout_ms` passes. `states` must be non-empty and from `starting`, `working`, `waiting_for_you`, `done`, `idle`, `unknown`, `exited`; `timeout_ms` is 1 to 600000; -32602 otherwise. Not queued. A client passes a reply wait longer than `timeout_ms` | -32602, -32002 | yes |  |
| `session.resume` | `{session_id}` | {session_id, prompt_delivered, approval, resumed} for an `exited` session: same engine and folder, with the engine's `resume_args` when it has them and a `native_id`; the new session gets a `core.resumed` event naming the old id | -32002, -32602 | yes |  |
| `session.focus` | `{session_id}` | {focused: bool} | -32002 | yes |  |
| `session.live-text` | `{}` | {<session_id>: {line?, title?}}: each terminal session's last non-empty screen row (first `terminal.last_line_chars` characters, read at most every `terminal.last_line_every_ms`) and last title. Held in core memory only and never written to the database, because typed text shows on screen (M1-05); empty after a core restart. Polled by the workbench once a second |  | yes |  |
| `session.search` | `{query, session_ids?}` | {hits: [{session_id, line, text}]}: lines of every live terminal's (or only the listed sessions') headless scrollback that contain `query` as plain text, ignoring case, wrapped rows joined; the most recently active terminal first and its newest line first, at most 50. `line` is the buffer row the line starts on; `text` is 300 characters of it around the match. Never queued and never written to the database (M6-19) |  |  | yes |
| `session.seen` | `{session_id}` | {}; moves `done` to `idle`. Sent by the workbench when a card is opened and by `session.focus` | -32002 |  |  |
| `session.hide` | `{session_id}` | {} | -32002 |  |  |
| `session.limit-resume` | `{session_id, on: bool}` | {}; sets the tile's "go on at a usage limit reset" toggle (`session.limit_resume`, M6-24). -32602 when `on` is not a boolean | -32602, -32002 |  |  |
| `session.clear-status` | `{session_id}` | {}: sets `idle`, appends `core.status-cleared`, marks its inbox rows read | -32002, -32602 |  |  |
| `session.owners` | `{project_id}` | {repo, paths: [{path, owners: [{id, title, state}], shared, unclaimed}]}: each uncommitted path of the project's repository with the session that owns it, from the latest `core.claim` naming it; a path committed after that claim is `unclaimed` | -32002 |  |  |
| `session.paste-prompt` | `{session_id}` | {written, reason?}: types the held prompt once; refused for an `external` session | -32002, -32602 |  |  |
| `needs_you.mark-read` | `{id}` | {} | -32002 |  |  |
| `needs_you.mark-unread` | `{id}` | {} | -32002 |  |  |
| `needs.dismiss` | `{id}` | {}; marks one needs-you item resolved (added by child #16 for items nothing else resolves, such as a missed schedule) | -32002 |  | yes |
| `shell.list` | `{}` | {shells: [{kind, label, argv}]} |  |  |  |
| `shell.open` | `{kind, project_id}` | {shell_id, label, cwd}: a shell tab in the project's folder | -32020, -32002 |  |  |
| `shell.close` | `{shell_id}` | {} | -32602 |  |  |
| `worktree.create` | `{project_id, branch?, base?: "HEAD"}` | {path, branch, trusted, existing?} | -32002, -32003 | yes |  |
| `ui.hello` | `{ui_key}` | {ok}; marks this connection as a trusted UI connection (see Access) |  |  |  |
| `engines.check` | `{}` | {} (results land in `engine_check`) |  |  |  |
| `hooks.install` | `{codex?: bool}` | {diff} |  |  | yes |
| `hooks.uninstall` | `{codex?: bool}` | {diff} |  |  | yes |
| `plugin.preview` | `{source}` | {valid, errors, manifest_hash, source, screen}; nothing is installed or run. `screen` is what the install screen shows (`plugins.md`, Install) |  |  |  |
| `plugin.install` | `{source, approved_permissions, manifest_hash?, secrets?: {NAME: value}}` | {plugin_id, missing_secrets}. -32003 when `approved_permissions` differs from what the manifest asks for, or `manifest_hash` differs from the manifest now on disk | -32003 |  | yes |
| `plugin.remove` | `{plugin_id}` | {} |  |  | yes |
| `plugin.secret.set` | `{plugin_id, name, value}` | {}; `name` must be an approved `secrets:<NAME>` |  |  | yes |
| `browser.secret.set` | `{name, origin, value}` | {}; saves a secret the browser 	ype tool fills from {{secret:NAME}}, only into a password field on origin (scheme, host and port); the value goes to the DPAPI store under plugin id core-browser, never to the command table; a value under 4 characters is refused, since output scrubbing skips such short values | -32602 |  | yes |
| `mcp.resolve` | `{plugin_id, server_id}` | {command, args, env, refs, missing} for the MCP shim: `env` holds stored secret values, `refs` maps keys to `${VAR}` names the shim reads from its own environment |  |  |  |
| `mcp.missing` | `{plugin_id, names}` | {}; raises a `missing-secret` needs-you item per name | -32002 |  |  |
| `notify.sink.set` | `{kind, dest, name?, id?, kinds?, enabled?}` | {id}; `kind` is `ntfy`, `slack-webhook`, `discord-webhook`, `teams-workflow`, `webhook` or `command`; `dest` is the URL (or a JSON argv array for `command`) and is stored only in the secret store under plugin id `core-notify`; never written to the `command` table |  | yes | yes |
| `notify.sink.list` | `{}` | {sinks: [{id, kind, name, kinds, enabled, dest_hash, approved_at}]}; no destination |  | yes |  |
| `notify.sink.test` | `{id}` | {ok, error?} |  | yes | yes |
| `notify.sink.remove` | `{id}` | {} |  | yes | yes |
| `comment.deliver` | `{comment_id}` | {clipboard_at, typed}: always copied; typed into the agent's terminal without Enter unless its engine takes comments through hooks (Claude), where the UserPromptSubmit hook delivers it | -32002 |  |  |
| `pane.open` | `{project_id, url?, session_id?, agent?: bool}` | {pane_id}; a browser pane the user opened, or with `agent: true` (needs `session_id`) one the workbench opened for an agent's first `navigate`, id `bp_agent_<ulid>`. Stable in the agent form | -32002, -32602 | yes | yes |
| `pane.close` | `{pane_id}` | {} | -32002 |  | yes |
| `pane.url` | `{pane_id, url}` | {}; the workbench reports each navigation |  |  | yes |
| `pane.assign` | `{pane_id, session_id?}` | {}; sets or clears the one session allowed to drive the pane | -32002 |  | yes |
| `pane.capture` | `{pane_id, label}` | {snapshot_id}; the core calls `browser.capture` on the browser pipe and writes the `snapshot` row | -32602 |  | yes |
| `approval.check` | `{session_id, surface, target, action, args, control, password?, hidden?, file_dialog?, action_hash?}` | {decision, reason?, approval_id?}; never queued; waits until a person decides or 120 s pass (`contracts/approvals.md`) |  |  |  |
| `approval.resolve` | `{approval_id, decision, scope?}` | {status, scope}; -32010 when the row is not `waiting` | -32010 |  | yes |
| `run.start`, `run.cancel`, `run.clear`, `run.resume`, `run.item-set`, `gate.resolve`, `schedule.set`, `pipeline.validate`, `template.list`, `variant.pick`, `variant.discard`, `variant.combine`, `board.pin`, `board.remove` | any | -32601 "moved to the pipeline products" (M6-1) | -32601 | | |
<!-- methods:end -->

### Worktree sweep

The core sweeps worktree projects at startup and once an hour (`core/src/worktree.ts`), one worktree at a time with asynchronous git calls, so terminals, pipe requests and the heartbeat keep running; a sweep still running when the next is due is not started twice, and a worktree whose session started while git ran is left as it was. It looks only at `project` rows whose path is exactly `<METATROOPER_HOME>/worktrees/<parent project id>/<name>`, where `worktree.create` puts them, and whose real path is still under that folder. Every other row and folder is left alone.

- **Folder gone.** The row gets `hidden = 1`.
- **The menu rule.** The workbench shows the open project, and otherwise only a row with `hidden = 0` whose folder exists and, if it is a MetaTrooper worktree, still holds a `.git` entry (`goneCheckout` in `workbench/src/queries.ts`). A gone folder leaves the menu at once, without waiting for the next sweep.
- **Stale.** A worktree is stale when none of its sessions is in any state other than `exited`, and its newest `last_opened`, session `started_at`, `state_at` or `ended_at` is `worktree.stale_days` (setting, default 7) or more days ago. A worktree with a live session is never stale, however old it is.
  - Stale, clean (`git status --porcelain` prints nothing, untracked files included) and merged (`HEAD` is an ancestor of the parent repo's main branch: the branch `origin/HEAD` names, else `main`, else `master`). The core runs `git worktree remove <path>` from the parent repo, never with `--force`. It then drops the folder's engine trust entries, sets `hidden = 1` and logs `worktree sweep: removed <path> ...`. The branch is kept.
  - Stale but dirty, unmerged, with no main branch found, or failing to be removed. Nothing is deleted. The row gets `older = 1` and the menu shows it in a collapsed **Older** group instead of **Worktrees**.
  - Not stale, or no longer stale. `older` goes back to 0.
  - Stale, and the folder is still there but git has let go of it (no `.git` entry), as when `git worktree remove` deregistered it and Windows refused to delete the folder. The core removes the folder only if it is empty, then drops its trust entries and sets `hidden = 1`. Otherwise it logs and tries again next sweep; the row is neither hidden nor marked older, and the menu leaves it out because it has no `.git`.
- Rows are hidden, never deleted, because `session`, `run`, `browser_pane` and `schedule` reference `project(id)`. `project.open` on the same folder sets `hidden` and `older` back to 0.

## Browser methods (`\\.\pipe\metatrooper-browser`)

Trusted core connection: the core itself connects to the browser pipe and sends `browser.hello` with
`{"ui_key": <key>}`. That connection may call `browser.capture` on any open pane of any registered project,
and nothing else.

`browser.hello`: params `{"session_id": str, "pid": int}` (from `metatrooper-browser`; `pid` is its own process id,
and the workbench checks that the session's `pid` is among that process's ancestors) or `{"ui_key": str}` (from the core);
result `{"ok": true, "bound": "session" or "core"}` or error -32030 if the session is unknown or not an
ancestor of the caller, as found below.

Session binding: when `metatrooper-browser` starts, it finds its own session by walking its parent process chain
(`Get-CimInstance Win32_Process`, `ParentProcessId`, up to 8 levels) until it reaches a pid equal to a
`session.pid`. It does not rely on environment variables, so it works for engines such as Codex whose MCP
configuration is global. It sends that session id in a `browser.hello` request first; the connection is then
bound to it and every later call on that connection is checked against it. A connection that has not said
hello, or whose ancestry found no session, can only call `browser.panes` (empty) and gets -32030 for the rest.

Every call carries `pane_id`. The workbench checks that the connection's session owns the pane before acting, else -32030. Tool schemas
are in `browser-tools.md`.

`browser.<tool>` for the 12 tools, plus `browser.panes` (lists panes this session may drive) and
`browser.capture` (`{pane_id, label}`, used by the core for before/after and comments), and `browser.outcome`
(`{pane_id, tool, status}`: a checked tool and `error <code>`, else -32602; writes the `browser.tool` audit row for a
call the MCP server stopped before sending it).

## Terminal pipe

A second pipe, `<prefix>-term` next to the main pipe (`metatrooper-term` by default), carries terminal bytes.
It is separate because the main pipe has no server-pushed messages. Same ACL as the main pipe.

- NDJSON, UTF-8, one JSON object per line. One session per connection; a tile grid of 6 opens 6 connections.
- Client to server: `{"op":"attach","session":"<id>","cols":120,"rows":40,"ui_key":"<ui.key>"}` first, then any
  of `{"op":"input","data":"<string>"}`, `{"op":"resize","cols":N,"rows":N}`, `{"op":"ack","bytes":N}`,
  `{"op":"detach"}`.
- `attach` carries the ui key because input types into an agent, which is as strong as approving a gate. A
  wrong key gets `{"op":"error","code":"needs-ui"}` and the connection closes.
- Server to client: `{"op":"snapshot","seq":0,"data":"<serialized terminal>"}` once, then
  `{"op":"output","seq":N,"data":"<string>"}` with `seq` rising by 1 per message, then `{"op":"exit","code":N}`
  and close. The snapshot is one message and can be larger than 64 KiB; clients must not cap its line length.
- No gap and no repeat between snapshot and live output: the viewer is registered before the snapshot is
  taken, and only output the snapshot does not hold is sent after it.
- `output` data is split on code-point boundaries, at most 64 KiB per message, written to xterm.js in `seq`
  order. No reassembly.
- Byte credit (M6-7): the client sends `ack` with the `data` length (UTF-16 code units) of each `snapshot` and
  `output` once xterm.js has written it. The server keeps at most 64 KiB unacknowledged per connection and holds
  the rest. When more than 1 MiB is held, the held output is dropped and, once the client's acks bring it back
  under 64 KiB, the server sends a fresh `snapshot` (the client resets on it). The pty never waits for a viewer.
- The core pauses a pty while its headless terminal is more than 1 MiB of output behind and resumes it under
  256 KiB. With no viewer attached, replies the headless terminal generates to a program's queries go back to
  the pty; with a viewer attached, the viewer answers.
- An unparseable line, an unknown `op`, or input before `attach` gets `{"op":"error","code":"bad-op"}` and is
  ignored. `attach` to a session whose terminal has ended and whose last screen was saved
  (`~/.metatrooper/screens/<session>.json`, the last 200 rows, written when the pty exits and when the core stops)
  gets that screen as `{"op":"snapshot","seq":0,"data":...}`, then `{"op":"exit","code":<exit code or "unknown">}`, and
  closes. `attach` to an unknown session, or an ended one with no saved screen, gets
  `{"op":"error","code":"no-session"}` and closes. Saved screens older than 30 days are deleted at core start.
- Disconnect is an implicit detach; the pty keeps running. Several viewers on one session all receive output;
  input from any goes to the pty; the latest `resize` wins.
