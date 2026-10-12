# Events and hooks contract

Version 1. Every writer here appends one row to `event` (see `schema.sql`) and exits. None of them waits on
the core.

## The writer: `core/event.js`

One invocation form: `node event.js <kind> [--session <id>] [--pid <n>] [--engine <id>] [--cwd <path>]`.

- Claude hooks: `<kind>` is `claude.<EventName>` (for example `claude.PreToolUse`); the payload is stdin.
  The session id comes from `TROOP_SESSION_ID` in the environment.
- Launch: `launch.js` appends the `launch` event in-process through the same module. `node event.js launch
  --session <id> --pid <n> --engine <id> --cwd <path>` also works, for tools that launch engines themselves.
- The Codex notify wrapper imports the same module and calls its `append(kind, sessionId, payload)` function.

1. Read stdin (hooks) or build the payload from the flags (launch).
2. Open `troop.db` with `busy_timeout = 200`. Insert one `event` row.
3. On any error (no database, locked past 200 ms, bad JSON): write one line to
   `~/.metatrooper/logs/event-errors.log` if that is possible, then exit 0.
4. Never write to stdout, except for `UserPromptSubmit` (below).

Total time budget: 250 ms from start to exit. A Claude hook that exceeds it is still fine for Claude (its own
hook timeout is far longer); the budget exists so nothing the user sees slows down.

## Event kinds and payloads

| kind | source | payload (JSON) |
|---|---|---|
| `launch` | launch | `{"session_id": str, "pid": int, "cwd": str, "engine": str, "started_at": ts}` |
| `claude.PreToolUse` | claude-hook | `session_id`, `transcript_path`, `cwd`, `tool_name`, `tool_use_id`, and `tool_input` redacted (below) |
| `claude.PostToolUse` | claude-hook | as PreToolUse, plus `response_length` (characters). The response itself is never stored |
| `claude.UserPromptSubmit` | claude-hook | `session_id`, `transcript_path`, `cwd`, `prompt_length`. The prompt text is never stored |
| `claude.Notification` | claude-hook | `session_id`, `cwd`, `class` (`permission` when the message asks to use a tool, `input` when it says Claude is waiting for input, else `other`), `message_length`. The message text is never stored |
| `claude.PermissionRequest` | claude-hook | as PreToolUse (Claude Code 2.0.45 and later) |
| `claude.PostToolUseFailure` | claude-hook | as PreToolUse; the error text is never stored (Claude Code 2.1.119 and later) |
| `claude.Stop` | claude-hook | `session_id`, `transcript_path`, `cwd`, `stop_hook_active` |
| `claude.StopFailure` | claude-hook | `session_id`, `transcript_path`, `cwd`, `error_type` (for example `rate_limit`) |
| `claude.SessionEnd` | claude-hook | `session_id`, `cwd`, `reason` |
| `codex.turn` | codex-notify | `type`, `thread-id`, `turn-id`, `cwd`, `input_length`, `reply_length` |
| `codex.SessionStart`, `codex.PermissionRequest`, `codex.Stop`, `codex.Interrupt` | codex-hook | `session_id`, `transcript_path`, `cwd`, `tool_name`, `notification_type`, `source` (whichever the hook input has). No prompt, reply or tool input is stored |
| `gemini.SessionStart`, `gemini.BeforeAgent`, `gemini.AfterTool`, `gemini.Notification`, `gemini.AfterAgent` | gemini-hook | as the Codex hook kinds |
| `term.bell` | core | `{}` (terminal bell, used only when the session has been silent 30 s) |
| `term.output` | core | `{}` (first output after a counted bell) |
| `core.prompt-written` | core | `{}` (the held prompt was typed into the pty) |
| `core.status-cleared` | core | `{}` (Clear status from the session menu) |
| `core.activity` | core | `{"state": "working" or "quiet" or "blocked", "changed_at": <file mtime, ms; on working only>}`: written by the core when a linked codex or agy file grew in the last 5 s (`working`) or has not changed for 20 s (`quiet`, or `blocked` when the engine's `activity_waiting.last_line_regex` matches the last line of the file) |
| `core.process-gone` | core | `{"pid": int}`: the session pid no longer exists. At core start, every `pty` session the last core left open gets one with `pid` null before any event is processed, then is resumed (`core/src/sessions/resume-all.ts`) |
| `core.resumed` | core | `{"from": session id}`: written on the new session by `session.resume`; the workbench reads it as `resumed_from` to put the new session in the old one's tile. Never changes state |
| `core.seen` | core | `{}`: the user opened the card or focused the session (`session.seen`) |
| `core.stalled` | core | `{}`: the session is still `starting` 15 s after launch (5 s check); the engine is sitting on a trust prompt, a login, or an empty input box |
| `core.claim` | core | `{repo, turn_base, from, at, files: [{path, owners: [session ids], shared}]}`: written processed at each `claude.Stop` and `claude.SessionEnd` for the files changed in that turn (`git diff --name-only <turn_base>`, plus untracked files modified since the turn's `UserPromptSubmit`). Paths are relative to `repo`. A file another session also changed in an overlapping turn goes to the session whose Edit, Write or MultiEdit hook named it; with no such hint, or when an earlier live owner's change is still uncommitted, both are listed and `shared` is true (M4-11) |
| `core.limit-hit` | core | `{"window": str or null, "resets_at": ts or null, "after": int}`: written while processing a `claude.StopFailure` whose `error_type` is `rate_limit`; `after` is that event's `seq`. `window` and `resets_at` come from the Claude `limit_reading` rows whose reset is still ahead: the latest reset among windows at 100% or more, else the fullest window's (M6-24) |
| `core.limit-resumed` | core | `{"limit_hit": int}`: the `seq` of the `core.limit-hit` it answers. Written before the paste, so a restart never pastes twice (M6-24) |
| `core.*` | core | other internal kinds: `core.checkpoint`, `core.recovered`, `core.missed-schedule`; they never change state |

Every payload is built from an explicit allowlist of fields, exactly as listed in this table. Any field not
listed is dropped before the insert, including fields a future Claude Code or Codex version adds.

Privacy: no prompt text, assistant text, tool response or terminal output is ever written. Tool inputs are
redacted before the insert:

| Tool | Stored from `tool_input` |
|---|---|
| `Bash`, `PowerShell` | `{"first_word": str, "length": int}`: the first word of the command and the command's length |
| `Read`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit` | `{"file_path": str}` only |
| `Grep`, `Glob` | `{"path": str}` only |
| `WebFetch` | `{"host": str}`: the URL's host only |
| anything else, including MCP tools | a flat object mapping each input key to the length of its value, e.g. `{"query": 14, "count": 4}` (strings by character count, anything else by the length of its JSON) |

This is what lets test M1-05 (a marker string typed into a session appears nowhere in MetaTrooper) pass.

## Linking a MetaTrooper session to the engine's own session

| Engine | How `session.native_id` is set |
|---|---|
| claude | First hook event carrying `TROOP_SESSION_ID` (inherited from `launch.js`); its `session_id` field is the native id. Exact. |
| codex | With the Codex hooks on, the `session_id` of a `codex.*` hook event. Otherwise: the core matches the newest `~/.codex/sessions/**/rollout-*.jsonl` whose first-line `session_meta.cwd` equals the session cwd and whose file was created within 30 s after the launch event; the thread id in that file name is the native id. If a `codex.turn` arrives before that match, its `thread-id` is used instead. A `codex.turn` whose `thread-id` differs from the native id (a side thread) changes no state. |
| gemini | The `session_id` of the first `gemini.*` hook event (SessionStart). A later SessionStart with another id (resume, `/clear`) relinks the session; any other `gemini.*` event with another id changes no state. Exact. |
| agy | The newest folder under `~/.gemini/antigravity-cli/brain/` created within 30 s after the launch event, only if exactly one agy session was launched in that window. Otherwise `native_id` stays NULL and state stays `unknown`. |

## State mapping

The core processes events in `seq` order and sets `session.state`:

| Event | New state |
|---|---|
| `launch` | `starting` |
| `claude.UserPromptSubmit`, `claude.PostToolUse` | `working` |
| `claude.PreToolUse` | `working`, except from `done` or `idle`: Claude Code can fire one after `Stop` for a call that never runs (no PostToolUse, not in the transcript), so a finished session moves on PostToolUse or a prompt instead |
| `claude.Notification` with `class` `permission` or `input`, `claude.PermissionRequest` | `waiting_for_you` |
| `claude.Notification` with `class` `other` | no change |
| `claude.Stop` | `done` |
| `claude.StopFailure` | `waiting_for_you` |
| `claude.SessionEnd` | `idle` (the conversation ended; the terminal lives on, and `core.process-gone` marks the real exit) |
| `claude.PostToolUseFailure` | as `claude.PostToolUse` |
| `codex.SessionStart`, `gemini.SessionStart` | `idle` from `starting`; otherwise no change (they link `native_id`) |
| `codex.PermissionRequest`, `gemini.Notification` | `waiting_for_you` |
| `codex.Stop`, `gemini.AfterAgent` | `done` |
| `codex.Interrupt` | `idle` |
| `gemini.BeforeAgent`, `gemini.AfterTool` | `working` |
| `codex.turn` | `done` |
| `core.activity` with `state` `working` (codex rollout file or agy files grew in the last 5 s, 1 s poll) | `working`, except from `waiting_for_you` when `changed_at` is not after the time the wait began: growth written before the ask (the turn leading up to it) does not answer it. While `waiting_for_you`, growth after the wait began writes a fresh `working` even if the poll already counted the file as growing |
| `core.activity` with `state` `quiet` while `working` (no change for 20 s) | `done` |
| `core.activity` with `state` `blocked` while `working` (no change for 20 s, last line is an unanswered tool call) | `waiting_for_you` |
| `term.bell` | `working`, `unknown` or `starting` to `waiting_for_you` |
| `term.output` | `waiting_for_you` or `unknown` to `working`, except a wait a hook asked for (`codex.PermissionRequest`, `gemini.Notification`, `claude.PermissionRequest`, or a `claude.Notification` of class `permission` or `input`) after the last `term.bell`: output after that bell does not answer it |
| `core.process-gone` (5 s check; not for `external` sessions) | `exited` |
| `claude.SessionEnd` on an `external` session | `exited` |
| `core.stalled` while `starting` | `waiting_for_you` |
| `core.seen` while `done` | `idle` |

A Claude permission wait is held on one tool call: the `tool_use_id` of the last `claude.PermissionRequest`, or, with
no PermissionRequest since the last prompt or Stop, of the last `claude.PreToolUse` before the last permission
`claude.Notification`. Once the last PermissionRequest's call has finished, a permission Notification after that
call's PostToolUse (or PostToolUseFailure) is a new wait, held on the last `claude.PreToolUse` before it; a Notification
from before that finish is not. A PermissionRequest without a `tool_use_id` waits on the last `claude.PreToolUse` before it with
the same `tool_name`. In both fallbacks only a call still open at the prompt counts: one whose PostToolUse (or
PostToolUseFailure) came before the PermissionRequest or Notification is skipped. Two open calls with the same
`tool_name` cannot be told apart (the redacted `tool_input` is not used), so the later one is taken. While a session is `waiting_for_you` on such a call that has not finished, a `claude.PreToolUse`,
`claude.PostToolUse` or `claude.PostToolUseFailure` for any other `tool_use_id` changes no state and leaves `last_tool`
alone; that call's own PostToolUse (or PostToolUseFailure), a prompt, Stop or StopFailure ends the wait. Only events
of the session's own conversation (`session_id` equal to its `native_id`) count here; a side conversation's
PermissionRequest, Notification or tool events under the same session neither hold nor end the wait. A
`claude.PermissionRequest` sets `last_tool` from its own `tool_name`, so the tool shown is the call the wait is on.

`exited` is final: once a session is `exited`, no event changes its state again.

## Resume at a limit reset (M6-24)

Every 5 s the core looks at each `core.limit-hit` with no `core.limit-resumed` naming it. A hit written with
`resets_at` null takes it from `limit_history`: each Claude window's first reset after the hit, picked the same way as
at the hit. Once `resets_at` has passed, it acts only when the session is `waiting_for_you`, its pty is open,
`session.limit_resume` is 1 (the tile's toggle, default on), the user has not typed into the terminal since the hit
(focus, device and cursor reports and arrow keys do not count; held in memory only), and no event has arrived for the
session after the failure (`seq` above `after`) of kind `claude.*` other than `claude.Notification`, or
`core.prompt-written`. It then appends `core.limit-resumed` and pastes `Continue where you left off.` followed by
Enter, once. Turning the toggle off stops the paste.

Every 60 s, after `limit_reading` is refreshed, each `ok` reading is copied to `limit_history` once per `read_at`,
and only the last 6 per window are kept. When a window's last 6 readings share one `resets_at`, the usage slope
from the first to the last reading is positive, and `last read_at + (100 - last used_pct) / slope` falls after now
and before `resets_at`, the core adds one `needs_you` row of kind `other`, ref
`limit-early:<provider>:<account>:<window>:<resets_at>`, text `<Provider> <window> window ends early at about
HH:MM` (local time). A ref is never written twice.

## Hook installation

Claude Code's settings keep hooks in an object keyed by event name, each holding an array of matcher groups;
this is the shape already used in the vault's `.claude/settings.json`.

A Claude session launched by MetaTrooper gets these hooks per session: the core writes
`~/.metatrooper/mcp/<session id>.settings.json` holding only the entries below and adds `--settings=<file>`.
Launching never edits `~/.claude/settings.json`. When the user's settings already hold MetaTrooper's entries
(from `troop hooks install`), no `--settings` is added, so no hook fires twice.

`troop hooks install` is optional, for users who want the hooks in every Claude session. It merges these entries into `~/.claude/settings.json` under `hooks`, one per
event name. It prints a unified diff and asks before writing. It never removes or reorders an existing entry.

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "*", "hooks": [{ "type": "command", "command": "node \"<core>/event.js\" claude.PreToolUse", "timeout": 5 }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "node \"<core>/event.js\" claude.Stop", "timeout": 5 }] }
    ]
  }
}
```

`matcher` is set only on `PreToolUse` and `PostToolUse`; the other events get a group with no matcher.

Event names installed: `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Notification`, `Stop`,
`SessionEnd`, and, when the installed CLI version lists them, `StopFailure` (2.1.78), `PermissionRequest` (2.0.45) and
`PostToolUseFailure` (2.1.119). `PermissionRequest` and `PostToolUseFailure` get `matcher` `*` like the tool events. The entry is identified for uninstall by the exact command string containing
`<core>/event.js`. `hooks uninstall` removes only entries whose command matches, and deletes an event name's
array only if it becomes empty and was absent before install (recorded in
`~/.metatrooper/hooks-install.json`). With no install record (hooks written by an older first launch),
`hooks uninstall` still removes exactly the matching entries and leaves every user hook.

Without `TROOP_SESSION_ID`, `event.js` exits 0 at once for every kind but `claude.*`. A `claude.*` event with a
`session_id` and a `cwd` is appended with `session_id` NULL only when its `session_id` is already a session's
`native_id`, or `cwd` lies inside a registered project; otherwise the hook writes nothing. The core adopts the
first such event of a conversation as a session with `host = 'external'`, `engine_id = 'claude'`, the project
that holds `cwd`, and that `native_id`, and links later events to it. An external session is never typed into
or closed by MetaTrooper, and ends on its `claude.SessionEnd` (M4-11).

## The one hook with output: UserPromptSubmit

This is the named exception to "hooks print nothing".

1. Insert the `claude.UserPromptSubmit` event as above.
2. Select `comment` rows for this session with `prompt_at IS NULL`, ordered by `at`.
3. If any were selected, print exactly one line and wait for stdout to flush:

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Comments from the MetaTrooper browser:\n\n<comment 1 body>\n\n<comment 2 body>"}}
```

4. After the flush completes, set `prompt_at = now` on exactly those comment ids, with `WHERE prompt_at IS
   NULL` so a concurrent hook cannot mark them twice.
5. If anything fails before printing, print nothing and exit 0; the comments go with the next prompt.

Rows of kind `notice` (written by the core: file overlaps and a child session's hand-back, M4-11) are printed
in the same line after the comments, under `Notices from MetaTrooper:`; with no comments the context starts with
that header. Each notice body starts with `[notice <key>]`, and the core never writes the same key twice to a
session.

## PreToolUse: edit warning

For `Edit`, `Write` and `MultiEdit`, when the latest `core.claim` naming `tool_input.file_path` lists a live
session other than this one, and `git status --porcelain` still shows the file changed, the hook prints one
line and never blocks:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"<path> has uncommitted changes from session <title> (<id8>), state <state>. Edit only your own lines; do not reformat or revert the file."}}
```

It reads only `core.claim` rows through `event_kind_idx` and stays inside the 240 ms hook budget.

Delivery is at least once and never lost. A duplicate is possible only if the hook dies after printing and
before step 4; each body starts with `[comment <id>]` so a repeat is recognisable. Two prompts within 50 ms can
both print the same comment for the same reason; that is the accepted cost of never losing one.

## Codex and Gemini hooks

An engine declares its per-session hooks in its engine entry as `hooks: {kind, events}`. Each hook runs
`node "<core>/event.js" <prefix>.<Event> --session <MetaTrooper session id>`, the session id on the command line
because an engine may not pass its environment to hooks; it prints nothing.

- `codex-config` (prefix `codex`): one `-c hooks.<Event>=[{hooks=[{type="command",command="..."}]}]` override per
  event on the launch command line. `config.toml` is never edited and `--dangerously-bypass-hook-trust` is never used.
  The built-in Codex engine declares no `hooks` until the trust spike in
  `issues/m6-05-state-from-each-engine-s-hooks-with-the.md` passes; until then it keeps the notify wrapper below. A
  Codex engine that declares hooks gets them instead of the per-session notify wrapper, not both.
- `gemini-system-settings` (prefix `gemini`): the core writes `~/.metatrooper/engines/gemini/<session id>.json`
  holding only `{"hooks": {...}}` (one group per event, `timeout` 5000 ms) and launches with
  `GEMINI_CLI_SYSTEM_SETTINGS_PATH` set to it. `~/.gemini/settings.json` is never touched. The file is deleted when
  the session becomes `exited`, and any left behind by a session that is gone are swept at the next launch. The sweep
  touches only `<id>.json` files there (in `~/.metatrooper/mcp/`, only `<id>.json`, `<id>.settings.json` and `<id>`
  folders), so other files in either folder are left alone.
  `engines/gemini.json` declares no `hooks` yet: on Windows, Gemini CLI 0.63 skips a system settings file whose folder
  is not owned by Administrators or SYSTEM (see the M6-5 issue).

## Codex notify wrapper

A Codex session launched by MetaTrooper, when its engine declares no `hooks`, gets the wrapper per session as `-c notify=[...]`, wrapping the
user's own `notify` with any MetaTrooper wrapper peeled off; launching never edits `config.toml`. The install
below is optional, for users who want the wrapper in every Codex run.

`troop hooks install --codex` backs up `~/.codex/config.toml` to `config.toml.troop-bak`, then sets
`notify` to `["node", "<core>/codex-notify.js", <the previous notify array as JSON>]`.

`codex-notify.js`:

1. Spawn the previous notify command (from its own argv) with the same trailing JSON argument, detached, and
   do not wait for it.
2. Append a `codex.turn` event.
3. Exit 0.

Uninstall puts back the file recorded in `hooks-install.json` when `config.toml` is unchanged since install.
Otherwise it peels MetaTrooper's wrapper off the current `notify` only when that line still starts with it; a
`notify` another tool has since replaced is left alone.

## Spool ingest (sandbox host, child sandbox-host)

A sandboxed engine cannot reach `troop.db` or the named pipe. When `METATROOPER_SPOOL` is set, the event writer
appends one line per event to `$METATROOPER_SPOOL/events.ndjson` instead of opening the database:
`{"kind": str, "at": ts, "payload": {...}}`, payload already built by `buildPayload`. It never writes stdout,
keeps the 250 ms budget, and on any error exits 0 silently.

The core, every 250 ms, for each non-`exited` session on the `sandbox` host:

1. Reads `~/.metatrooper/spool/<session id>/events.ndjson` from the byte offset stored in `meta` under
   `spool_offset:<session id>`, and only whole lines.
2. Per line: drops it if it is over 64 KiB, not JSON, or its `kind` is not in the table above; otherwise
   runs `rebuildPayload(kind, payload)` on the host (the fields `buildPayload` emits for that kind, typed and
   capped, `tool_input` in its redacted shape; `buildPayload` itself would zero every length), forces `session_id` to the spool's session (any id in
   the line is ignored), and inserts the `event` row with `source` as for that kind.
3. Stores the new offset in the same transaction as the inserts.
4. Stops ingesting a spool that passes 10 MiB and adds one `needs_you` row (`kind` `spool-too-large`).

Once a session is `exited`, the core reads its spool a last time, drops any unfinished last line, and deletes the
spool folder. Only the claude hook kinds (including `claude.PermissionRequest` and `claude.PostToolUseFailure`) and `codex.turn` are
accepted from a spool.

## Notification sinks (outbound)

`core/src/notify.ts` reads `needs_you` rows every 2 s and sends each new row once to every enabled sink whose
`kinds` include the row's kind. The message is a fixed template: kind, the row's one-line text, and the link
`metatrooper://needs-you/<id>`. Methods and shapes: `notify.sink.*` in `pipe-protocol.md`.

The workbench sets sinks up from the command palette ("Notification sinks"). The destination is asked for on every
save and is never shown again. The workbench registers `metatrooper://`; opening `metatrooper://needs-you/<id>`
focuses the window and opens that item, or the inbox when the item is already resolved.
