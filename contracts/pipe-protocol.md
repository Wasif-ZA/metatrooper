# Named-pipe protocol

Version 1. Two pipes, same framing.

| Pipe | Server | Clients |
|---|---|---|
| `\\.\pipe\metatrooper` | core service | workbench, tray, `troop` CLI |
| `\\.\pipe\metatrooper-browser` | workbench main process | `metatrooper-browser` MCP server (one per agent session) |

## Access

Trusted UI connections: at every start the core writes 32 random bytes, hex, to `~/.metatrooper/ui.key`
(replacing the old one). The workbench, the tray, and the `troop` CLI when it is attached to an interactive
terminal read it and send `ui.hello` on connect. Only such connections may call `gate.resolve`. Code steps
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
| -32001 | project path refused (`work/ACU`) |
| -32002 | not found (project, session, run, pane, plugin) |
| -32003 | validation failed; `data.errors` lists them |
| -32010 | gate stale: the action changed since approval |
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

On start, before accepting new pipe requests, the core:

1. Re-executes every `accepted` row in `at` order. No side effect has happened for these.
2. Marks every `running` row `error` with `{"code":-32098,"message":"interrupted by core restart"}` and
   raises a needs-you item naming the method. It is never re-executed blindly, because its side effect may
   already have happened.
3. Executes every `queued` row in `at` order.

Client insert: `INSERT INTO command (id, at, origin, method, params, status) VALUES (?, <now ISO 8601>, ?, ?, ?,
'queued') ON CONFLICT(id) DO NOTHING`. If the pipe already accepted that id, the insert is a no-op and the client
reads the row's status as usual. This is the complete conflict rule.

## Queue fallback (client side)

Only state-changing methods are ever queued. Not queued (they fail fast with "core offline" instead):
`session.focus`, `engines.check`, `pipeline.validate`, every `browser.*` method, and the methods that carry
secret values (`plugin.preview`, `plugin.install`, `plugin.secret.set`, `mcp.resolve`), which are never
written to the `command` table.

1. Send the request on the pipe.
2. If no reply arrives within 300 ms, or the pipe does not exist, insert the same request into `command`
   (`id`, `origin`, `method`, `params`, `status = 'queued'`) and show "queued".
3. Keep waiting on the pipe reply. Whichever finishes, the UI reads the final status from `command` or the
   affected rows.
4. On start, the core runs every `queued` row in `at` order before accepting new pipe requests.

## Core methods (`\\.\pipe\metatrooper`)

Every other interaction is a database read.

| Method | Params | Result |
|---|---|---|
| `project.open` | `{path}` | `{project_id}`; error -32001 for ACU paths. `project_id` = sha1 hex of the canonical path: `fs.realpathSync.native`, then the git toplevel if inside a repo (also through `realpathSync.native`), backslashes turned into forward slashes, the drive letter lower-cased, no trailing slash. Example: `C:\Users\wasif\proj\` becomes `c:/Users/wasif/proj` |
| `session.launch` | `{project_id, engine_id, prompt?, host?: "wt" or "herdr"}` | `{session_id}` |
| `worktree.create` | `{project_id, branch?, base?: "HEAD"}` | `{path, branch}` |
| `session.hide` | `{session_id}` | `{}` |
| `session.focus` | `{session_id}` | `{focused: bool}` |
| `session.seen` | `{session_id}` | `{}`; moves `done` to `idle`. Sent by the workbench when a card is opened and by `session.focus` |
| `ui.hello` | `{ui_key}` | `{ok}`; marks this connection as a trusted UI connection (see Access) |
| `engines.check` | `{}` | `{}` (results land in `engine_check`) |
| `run.start` | `{pipeline_id, project_id, inputs, trigger?}` | `{run_id}` |
| `run.cancel` | `{run_id}` | `{}` |
| `run.resume` | `{run_id, max_tokens?, max_usd?, max_minutes?}` | `{}`; the limits can only be raised (`pipelines.md`, Runner details) |
| `gate.resolve` | `{gate_id, decision: "approve" or "reject", action_hash, note?}` | `{}`; -32010 if `action_hash` differs from the gate's; -32012 unless the connection completed `ui.hello`. `meta.origin` is informational only and never trusted |
| `schedule.set` | `{pipeline_id, project_id, cron, inputs, enabled}` | `{schedule_id}` |
| `plugin.preview` | `{source}` | `{valid, errors, manifest_hash, source, screen}`; nothing is installed or run. `screen` is what the install screen shows (`plugins.md`, Install) |
| `plugin.install` | `{source, approved_permissions, manifest_hash?, secrets?: {NAME: value}}` | `{plugin_id, missing_secrets}`; needs `ui.hello`. -32003 when `approved_permissions` differs from what the manifest asks for, or `manifest_hash` differs from the manifest now on disk |
| `plugin.remove` | `{plugin_id}` | `{}`; needs `ui.hello` |
| `plugin.secret.set` | `{plugin_id, name, value}` | `{}`; needs `ui.hello`; `name` must be an approved `secrets:<NAME>` |
| `mcp.resolve` | `{plugin_id, server_id}` | `{command, args, env, refs, missing}` for the MCP shim: `env` holds stored secret values, `refs` maps keys to `${VAR}` names the shim reads from its own environment |
| `mcp.missing` | `{plugin_id, names}` | `{}`; raises a `missing-secret` needs-you item per name |
| `pipeline.validate` | `{json}` | `{valid, errors}` |
| `comment.deliver` | `{comment_id}` | `{clipboard_at, herdr_at}` (prompt delivery happens in the hook) |
| `variant.pick`, `variant.discard` | `{run_id, idx}` | `{}` |
| `variant.combine` | `{run_id, indices: [int, ...], note}` | `{step_id}`; at least 2 indices |
| `hooks.install`, `hooks.uninstall` | `{codex?: bool}` | `{diff}` |
| `pane.open` | `{project_id, url?, session_id?}` | `{pane_id}`; needs `ui.hello`; a browser pane the user opened |
| `pane.close` | `{pane_id}` | `{}`; needs `ui.hello` |
| `pane.url` | `{pane_id, url}` | `{}`; needs `ui.hello`; the workbench reports each navigation |
| `pane.assign` | `{pane_id, session_id?}` | `{}`; needs `ui.hello`; sets or clears the one session allowed to drive the pane |
| `pane.capture` | `{pane_id, label}` | `{snapshot_id}`; needs `ui.hello`; the core calls `browser.capture` on the browser pipe and writes the `snapshot` row |
| `needs.dismiss` | `{id}` | `{}`; needs `ui.hello`; marks one needs-you item resolved (added by child #5 for items nothing else resolves, such as a missed schedule) |

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

Every call carries `pane_id`. The workbench checks that the connection's session owns the pane (or that the
pane belongs to the session's run and variant) before acting, else -32030. Tool schemas
are in `browser-tools.md`.

`browser.<tool>` for the 12 tools, plus `browser.panes` (lists panes this session may drive) and
`browser.capture` (`{pane_id, label}`, used by the core for before/after, board captures and comments).
