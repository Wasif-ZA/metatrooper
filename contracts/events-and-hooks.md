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
| `claude.UserPromptSubmit` | claude-hook | `session_id`, `cwd`, `prompt_length`. The prompt text is never stored |
| `claude.Notification` | claude-hook | `session_id`, `cwd`, `class` (`permission` when the message asks to use a tool, `input` when it says Claude is waiting for input, else `other`), `message_length`. The message text is never stored |
| `claude.Stop` | claude-hook | `session_id`, `cwd`, `stop_hook_active` |
| `claude.SessionEnd` | claude-hook | `session_id`, `cwd`, `reason` |
| `codex.turn` | codex-notify | `type`, `thread-id`, `turn-id`, `cwd`, `input_length`, `reply_length` |
| `herdr.state` | herdr | `{"pane": str, "state": "blocked" or "working" or "done" or "idle" or "unknown", "agent": str}` |
| `core.activity` | core | `{"state": "working" or "quiet" or "blocked"}`: written by the core when a linked codex or agy file grew in the last 5 s (`working`) or has not changed for 20 s (`quiet`, or `blocked` when the engine's `activity_waiting.last_line_regex` matches the last line of the file) |
| `core.process-gone` | core | `{"pid": int}`: the session pid no longer exists |
| `core.seen` | core | `{}`: the user opened the card or focused the session (`session.seen`) |
| `core.stalled` | core | `{}`: the session is still `starting` 15 s after launch (5 s check); the engine is sitting on a trust prompt, a login, or an empty input box |
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

This is what lets test M1-05 (a marker string typed into a session appears nowhere in Metatrooper) pass.

## Linking a Metatrooper session to the engine's own session

| Engine | How `session.native_id` is set |
|---|---|
| claude | First hook event carrying `TROOP_SESSION_ID` (inherited from `launch.js`); its `session_id` field is the native id. Exact. |
| codex | The core matches the newest `~/.codex/sessions/**/rollout-*.jsonl` whose first-line `session_meta.cwd` equals the session cwd and whose file was created within 30 s after the launch event; the thread id in that file name is the native id. If a `codex.turn` arrives before that match, its `thread-id` is used instead. A `codex.turn` whose `thread-id` differs from the native id (a side thread) changes no state. |
| agy | The newest folder under `~/.gemini/antigravity-cli/brain/` created within 30 s after the launch event, only if exactly one agy session was launched in that window. Otherwise `native_id` stays NULL and state stays `unknown`. |
| herdr host | herdr's pane id (`herdr_pane`); native id from herdr's `agent.get` when it reports one. |

## State mapping

The core processes events in `seq` order and sets `session.state`:

| Event | New state |
|---|---|
| `launch` | `starting` |
| `claude.UserPromptSubmit`, `claude.PreToolUse`, `claude.PostToolUse` | `working` |
| `claude.Notification` with `class` `permission` or `input` | `waiting_for_you` |
| `claude.Notification` with `class` `other` | no change |
| `claude.Stop` | `done` |
| `claude.SessionEnd` | `exited` |
| `codex.turn` | `done` |
| `core.activity` with `state` `working` (codex rollout file or agy files grew in the last 5 s, 1 s poll) | `working` |
| `core.activity` with `state` `quiet` while `working` (no change for 20 s) | `done` |
| `core.activity` with `state` `blocked` while `working` (no change for 20 s, last line is an unanswered tool call) | `waiting_for_you` |
| `herdr.state` | blocked to `waiting_for_you`; working, done, idle, unknown map to themselves |
| `core.process-gone` (5 s check) | `exited` |
| `core.stalled` while `starting` | `waiting_for_you` |
| `core.seen` while `done` | `idle` |

`exited` is final: once a session is `exited`, no event changes its state again.

## Hook installation

Claude Code's settings keep hooks in an object keyed by event name, each holding an array of matcher groups;
this is the shape already used in the vault's `.claude/settings.json`.

`troop hooks install` merges these entries into `~/.claude/settings.json` under `hooks`, one per
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
`SessionEnd`. The entry is identified for uninstall by the exact command string containing
`<core>/event.js`. `hooks uninstall` removes only entries whose command matches, and deletes an event name's
array only if it becomes empty and was absent before install (recorded in
`~/.metatrooper/hooks-install.json`).

Hooks do nothing outside a Metatrooper session: when `TROOP_SESSION_ID` is not set, `event.js` exits 0
immediately without opening the database.

## The one hook with output: UserPromptSubmit

This is the named exception to "hooks print nothing".

1. Insert the `claude.UserPromptSubmit` event as above.
2. Select `comment` rows for this session with `prompt_at IS NULL`, ordered by `at`.
3. If any were selected, print exactly one line and wait for stdout to flush:

```json
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"Comments from the Metatrooper browser:\n\n<comment 1 body>\n\n<comment 2 body>"}}
```

4. After the flush completes, set `prompt_at = now` on exactly those comment ids, with `WHERE prompt_at IS
   NULL` so a concurrent hook cannot mark them twice.
5. If anything fails before printing, print nothing and exit 0; the comments go with the next prompt.

Delivery is at least once and never lost. A duplicate is possible only if the hook dies after printing and
before step 4; each body starts with `[comment <id>]` so a repeat is recognisable. Two prompts within 50 ms can
both print the same comment for the same reason; that is the accepted cost of never losing one.

## Codex notify wrapper

`troop hooks install --codex` backs up `~/.codex/config.toml` to `config.toml.troop-bak`, then sets
`notify` to `["node", "<core>/codex-notify.js", <the previous notify array as JSON>]`.

`codex-notify.js`:

1. Spawn the previous notify command (from its own argv) with the same trailing JSON argument, detached, and
   do not wait for it.
2. Append a `codex.turn` event.
3. Exit 0.

Uninstall restores `notify` to the previous array exactly, read from `hooks-install.json`.

## Spool ingest (sandbox host, child #32)

A sandboxed engine cannot reach `troop.db` or the named pipe. When `METATROOPER_SPOOL` is set, the event writer
appends one line per event to `$METATROOPER_SPOOL/events.ndjson` instead of opening the database:
`{"kind": str, "at": ts, "payload": {...}}`, payload already built by `buildPayload`. It never writes stdout,
keeps the 250 ms budget, and on any error exits 0 silently.

The core, every 250 ms, for each non-`exited` session on the `sandbox` host:

1. Reads `~/.metatrooper/spool/<session id>/events.ndjson` from the byte offset stored in `meta` under
   `spool_offset:<session id>`, and only whole lines.
2. Per line: drops it if it is over 64 KiB, not JSON, or its `kind` is not in the table above; otherwise
   runs `buildPayload(kind, payload)` again on the host, forces `session_id` to the spool's session (any id in
   the line is ignored), and inserts the `event` row with `source` as for that kind.
3. Stores the new offset in the same transaction as the inserts.
4. Stops ingesting a spool that passes 10 MiB and adds one `needs_you` row (`kind` `spool-too-large`).

Once a session is `exited` and its spool is fully ingested, the core deletes the spool folder.
