# M7-6: Sessions: Gemini usage, pi state, exit ladder, prompt check, turn refs, quiet phone alerts, worktree files

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: High. Effort: 2.5 CC days. Depends on: M6-5, M6-10, M6-20, M6-21, and M6-23 (its opencode reporter is the pattern the pi part copies). Start from `main` after the public release on 2027-01-19, once M6-5 and M6-23 are merged; record that `main` SHA as the base in the report.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-6, and the `### M7-6:` section under Milestone 7. D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` names the mined ideas this child builds: core-sessions 2 and 14, core 7, 8, 9, 10, 12 and 13.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins.

## Context

Seven gaps in how the core runs a session, each one making the wall wrong or leaving a mess: Gemini's cost chip reads "usage unknown", pi's state is a guess from its title, a closed agent leaves its dev server running, a pasted prompt that never landed waits silently, the Diff loses files the agent added, phone alerts fire while the user sits at the desk, and a new worktree is missing the `.env` the project needs.

## Current state (verified 2026-10-14 on `main` 4fb7ef9 and every unmerged branch; find code by the quoted text, line numbers move)

| # | Fact | Where |
|---|---|---|
| 1 | `engines/pi.json` has `"state_source": "process"` and `"usage_source": "none"`. There is no `engines/plugins/` folder and no state reporter for any engine on any branch; M6-23 (unbuilt, specced by lane e of 2026-10-14) adds the opencode one. Nothing in the repo describes pi's own events. `core/event.js` runs as `node event.js <kind> [--session <id>] ...`, reading the session from `--session` or `TROOP_SESSION_ID`. | `engines/pi.json`; `core/src/hook/event.ts`; `contracts/events-and-hooks.md` |
| 2 | `core/src/meter.ts` reads Claude, Codex and agy transcripts (`readClaudeTranscript`, `readCodexSession`, `readAgyTranscript`) and upserts `usage` rows on `dedupe_key`. `usage_source` is `'claude-transcript' \| 'codex-session' \| 'none'`. `usage.source` allows `'transcript','codex-session','callrouter','gateway','unknown'`. On main only `claude.*` events carry `transcript_path`. `m6-5-hook-state` adds Gemini hook plumbing but declares no Gemini hooks yet ("on Windows, Gemini CLI 0.63 skips a system settings file"). The M6-20 cost chip (`costChip`) sums `usage` per session and shows "usage unknown" when there are none. | `core/src/meter.ts`; `core/src/engines/registry.ts`; `contracts/schema.sql` `usage`; `workbench/renderer/app.js` `costChip`; `workbench/src/queries.ts` |
| 3 | There is no session close in the core: no `session.close` method, no `close.ts`, no `exit_cmd`. `session.hide` only sets `hidden = 1`. `kill()` calls `t.proc.kill()`; `killAll()` loops it; core `stop` runs `term.killAll()` after saving screens. `shell.close` kills `sh_` ids. `taskkill /T /F` is used only for plugin actions. Each engine process gets `TROOP_SESSION_ID` from `hook/launch.ts`. | `core/src/terminal/index.ts` `kill`, `killAll`; `core/src/main.ts` `stop`; `core/src/methods.ts` `shell.close`; `core/src/plugins/actions.ts` |
| 4 | `writePrompt` pastes the prompt, writes `\r` and appends `core.prompt-written`, for engines whose prompt does not go on argv (`promptDelivered: false`). `deliverPrompts` holds a prompt in memory (`pendingPrompts`) until the session is idle or waiting; past `prompt_wait_ms` it is skipped and nothing is raised. Nothing checks that the prompt landed. `noteTyped` and `typedAt` track the last keystroke per terminal in memory; only limit resume reads them. | `core/src/sessions/launch.ts`; `core/src/terminal/index.ts` |
| 5 | `needs_you.kind` is a CHECK list (`gate` ... `approval`, `other`) with no actions column; the inbox shows actions by kind (only "Open Git tab" for `uncommitted`). Rows are inserted inline at each call site. Migrations are numbered SQL files up to `003-grants.sql` (on `m6-15-computer-use`). | `contracts/schema.sql` `needs_you`; `app.js` inbox; `core/src/store/migrations/` |
| 6 | The live path calls `turnSnapshot` (`markTurnBase` is only used by a test). `turnSnapshot` already copies the index to a temp `troop-index-<ulid>` file, then runs `git stash create` with that `GIT_INDEX_FILE`, falling back to `rev-parse HEAD`. Untracked files are not in a stash commit, and nothing keeps the commit from `git gc`. The SHA is stored in `session.turn_base`; the workbench `diffBase` and the core `turnChanges` read it. No `refs/troop` anywhere. | `core/src/events/processor.ts` `turnSnapshot`, `setTurnBase` (spec.md's `:171` is stale); `workbench/src/main.ts` `diffBase`; `core/src/sessions/owners.ts` |
| 7 | `notifyTick` runs every 2 s and sends each new `needs_you` row once to each sink (`ntfy`, `slack-webhook`, `discord-webhook`, `teams-workflow`, `webhook`, `command`), skipping rows older than `STALE_MS` (24 h) and retrying at 10 s, 60 s, 300 s. No idle hold, no per-session coalescing, no `ui.idle`, no `powerMonitor`, `flashFrame` or `setOverlayIcon`. M6-10's part is merged: no OS toast for the focused session, and toasts name the task (`toastFor`). | `core/src/notify.ts`; `workbench/src/queries.ts` `toastFor` |
| 8 | `worktree.create` runs `execFileSync('git', [..., 'worktree', 'add', ...], {timeout: 60_000})`, so a slow checkout stops the event loop and the 2 s `core_heartbeat` with it. Settings are global only (`~/.metatrooper/settings.json`); there are no project settings. `worktree` holds `npm_ci` and `stale_days`. Node is 24.18.0, so `path.matchesGlob` is available. | `core/src/methods.ts` `worktree.create` (spec.md's `:276` is stale); `core/src/settings.ts`; `core/src/main.ts` `core_heartbeat` |

## Change

1. **pi state** (core 7). First step: read the pi version installed here and its extension or hook documentation, and record in this issue which events it raises for "started work", "asked permission" and "finished". If it raises them, `engines/plugins/pi-state.ts` follows M6-23's opencode reporter: pi loads it, and on each event it runs `node core/event.js pi.state --session $TROOP_SESSION_ID` with `{state: 'working' | 'waiting_for_you' | 'idle'}`; `engines/pi.json` sets `state_source` to the plugin with title states as the fallback. If pi raises none of them, nothing is built, pi keeps title states, and the finding goes in the issue and the report.
2. **Gemini usage** (core-sessions 2). First step, on Gemini CLI 0.58 here: find where it records a session's token counts (its chat recording under `~/.gemini/tmp/<project hash>/`) and record the file shape in this issue. `readGeminiTranscript` in `meter.ts` reads that file for a session, found from the session's start time and cwd when no hook gives a path, and upserts one `usage` row per model reply with `source: 'transcript'` and a `dedupe_key` from the file and message id. `usage_source: 'gemini-transcript'` joins the enum in `registry.ts` and `plugin-manifest.schema.json`, and `engines/gemini.json` sets it. If M6-5 later supplies `transcript_path`, the reader takes it first.
3. **Exit ladder** (core 12, core-sessions 14).
   - New pure `closeGracefully(state, engine, io)` in `core/src/terminal/close.ts`, with `io` holding `paste`, `write`, `alive`, `kill`, `taskkill` and a clock. A session in `waiting_for_you` goes straight to kill. Otherwise: paste the engine's `exit_cmd` and Enter, wait 3 s, send Enter if still alive, wait 3 s, kill. On Windows, if the pid is alive 1.5 s after the kill, `taskkill /T /F /PID <pid>`. An engine with no `exit_cmd` skips to kill.
   - `exit_cmd` is a new engine field in `registry.ts` and the schema: `/exit` for Claude, `/quit` for Gemini; Codex and the others are set only after the step below checks them.
   - New UI method `session.close {id}` runs the ladder. Core `stop` runs it for every live session at once, with the whole stop capped at 8 s, then `killAll()` for what is left. `shell.close` keeps a plain kill.
   - First step: kill a fixture session that started a node server and list the processes still carrying its `TROOP_SESSION_ID` (`Get-CimInstance Win32_Process` command lines and environment where readable), recorded in this issue before and after the ladder.
4. **Prompt check** (core 10). After `core.prompt-written`, if the session's state does not become `working` within 20 s (from hooks or the activity watcher), the core raises a `needs_you` row of new kind `prompt-unsent` with the text "the prompt may not have been sent" and `ref` the session id. The prompt stays in `pendingPrompts` until `working` is seen. The inbox shows a Resend action on that kind, calling new UI method `session.resend-prompt {id}`, which pastes the prompt once more with Enter and resolves the row. `writePrompt` waits until 2 s after the tile's last keystroke (`typedAt`) before pasting. Migration `004-prompt-unsent.sql` rebuilds `needs_you` with the new kind in its CHECK list.
5. **Turn bases as hidden refs** (core 9). `turnSnapshot` keeps its temp index copy and replaces `git stash create` with: `git add -A` (respects `.gitignore`), `git write-tree`, `git commit-tree <tree> -p HEAD -m "troop turn <n>"`, and `git update-ref refs/troop/turn/<session>/<n> <commit>`, all with `GIT_INDEX_FILE` set to the temp copy, which is deleted after. `n` counts this session's turns from 1. `session.turn_base` keeps holding the commit SHA, so `diffBase` and `turnChanges` need no change. On an unborn HEAD the commit has no parent. Hiding a session keeps its refs; this child deletes none. The user's index, HEAD and branches are never touched.
6. **Quiet phone alerts** (core 8).
   - The workbench sends `ui.idle {seconds}` (new UI method, `powerMonitor.getSystemIdleTime()`) every 30 s. The core keeps the latest value and its time in memory.
   - `notifyTick` holds a row for `ntfy`, `slack-webhook`, `discord-webhook` and `teams-workflow` sinks until idle is at least `notify.hold_until_idle_s` (180), or the row is `notify.hold_max_s` (300) old and still open. With no idle report in the last 90 s nothing is held. `webhook` and `command` sinks are never held. A row resolved while held is not sent.
   - Rows for one session raised within 5 s of each other are sent as one message (the first row's text plus "and N more").
   - While the window is hidden or minimised and any row is open, the workbench calls `flashFrame(true)` and sets a taskbar overlay with the open count (`1` to `9`, then `9+`), from 10 small PNGs in `workbench/assets/badge/`. Both clear when the window is shown.
7. **Worktree files** (core 13). `worktree.preserve: string[]` in the global settings, empty by default. After `git worktree add`, the core lists the source repo's untracked and ignored files (`git ls-files --others --exclude-standard --ignored -z` plus `--others --exclude-standard -z`), keeps those matching a pattern with `path.matchesGlob`, and copies each into the new worktree at the same relative path. A pattern that is empty, absolute, a drive or UNC path, or holds `..` is refused with the pattern named. A source that is a symlink, or a source or destination whose real path is outside its tree, is refused. `worktree.create` moves to async `execFile`, so the heartbeat keeps ticking.

## Acceptance criteria

The first seven are copied from `spec.md` and must not be reworded here.

- [ ] M7-06a. A 3-turn fixture Gemini transcript gives `usage` rows whose tokens sum to the transcript's, and M6-20's chip shows them.
- [ ] M7-06b. `closeGracefully()` passes a fake-clock table for all five steps. A session in `waiting_for_you` is killed with nothing typed. Killing a fixture session that started a node server leaves 0 processes carrying its `TROOP_SESSION_ID` 3 s after the kill step.
- [ ] M7-06c. A fixture engine that ignores input raises 1 "may not have been sent" item at 20 s (fake clock); one that goes `working` at 5 s raises 0. Resend pastes the prompt once more. A prompt due while the user typed into the tile 1 s ago is written 2 s after that keystroke, not before.
- [ ] M7-06d. In a fixture repo with an untracked file holding "a" before the turn, a turn that changes it to "b" leaves "a" in the turn ref's tree and shows a one-line change in the Diff; after `git gc --prune=now` the ref still resolves; the index file's hash is unchanged; hiding the session leaves the ref in place.
- [ ] M7-06e. With idle at 0 s, an open row is not sent at 60 s and is sent at 300 s; with idle at 200 s it is sent on the next tick; with no idle report for 90 s it is sent at once; 3 rows in 5 s on one session send 1. With the window hidden and a row open, `flashFrame(true)` is called and the taskbar overlay shows the open count.
- [ ] M7-06f. `preserve: [".env*"]` copies `.env.local`; `../x`, `C:\x`, `\\h\s` and an empty pattern are refused; a symlink out of the repo is refused; the core heartbeat ticks at least every 2 s during a slow fixture checkout.
- [ ] M7-06g. A pi session shows `working`, `waiting_for_you` on a permission ask and `idle` from its plugin, not its title.
- [ ] M7-06h. The pi and Gemini first-step findings, and the before and after process lists from the exit ladder's first step, are recorded in this issue with the commands that produced them.
- [ ] M7-06i. Running the Gemini reader twice on the same file adds 0 rows.
- [ ] M7-06j. Core stop with 3 live fixture sessions that ignore `exit_cmd` returns within 8 s and leaves 0 of their processes.
- [ ] M7-06k. A `webhook` sink gets a row on the next tick with idle at 0 s. A row resolved at 60 s while held is never sent.
- [ ] M7-06l. After the migration, existing `needs_you` rows keep their ids, kinds and text, and a `prompt-unsent` row inserts.
- [ ] M7-06m. A repo with no commits gets a turn ref with no parent, and the Diff shows the agent's new files.
- [ ] M7-06n. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M7-06o. The existing core and workbench suites still pass.

## Testing plan

Codex writes every test below through `/tests-brief` (D65), with a mutation run that must fail at least one test per part: skip the `waiting_for_you` shortcut, drop the 2 s typing hold, use `stash create` again, send held rows at once, allow `..` in a pattern, and leave the Gemini `dedupe_key` out.

| Layer | What | Count |
|---|---|---|
| Unit (fake clock) | b (the ladder table), c (prompt check and typing hold), e (hold rules and coalescing), k | +4 |
| Core with a temp home and fixture repos | a, i (Gemini fixture), d, m (turn refs), f (patterns, symlink, heartbeat), j, l | +7 |
| Electron | e (`flashFrame`, overlay count) | +1 |
| On this laptop, recorded | g (pi, if built), h (process lists) | 2 runs |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: never "make the tests pass".
2. Real code lands with Codex's tests in the same change; you do not write the tests (D65).
3. Any change to an existing test, timeout or threshold is reported on its own line first, with its reason.
4. A reported command names the command and its observed result; stderr is never silenced in a cited command.
5. Your report is a claim until the parent re-runs it.
6. Never commit, push or open PRs; hand back the command. No em dashes; comments say what the code does.
7. Nothing here starts before the public release on 2027-01-19.

## Rollback

Revert the merge. Migration 004 only widens a CHECK list, so older code reads the table; `prompt-unsent` rows show as unknown kinds. Turn refs stay in user repos under `refs/troop/` and are removed with `git for-each-ref --format="delete %(refname)" refs/troop | git update-ref --stdin`.

## Effort

0.25 Gemini usage and its first step, 0.25 pi state and its first step, 0.5 exit ladder (`close.ts`, `exit_cmd`, `session.close`, core stop, the process-list step), 0.25 prompt check (migration, Resend, typing hold), 0.75 turn refs, 0.25 quiet phone alerts, 0.25 worktree files and async create = 2.5 CC days.

## Files

| File | Change |
|---|---|
| `engines/plugins/pi-state.ts`, `engines/pi.json` | new reporter, if pi raises the events |
| `core/src/meter.ts`, `engines/gemini.json` | `readGeminiTranscript`, `usage_source` |
| `core/src/engines/registry.ts`, `contracts/plugin-manifest.schema.json` | `gemini-transcript`, `exit_cmd` |
| `engines/claude.json` or the built-in Claude spec in `registry.ts` | `exit_cmd: "/exit"` |
| `core/src/terminal/close.ts` | new |
| `core/src/main.ts` | stop runs the ladder |
| `core/src/methods.ts` | `session.close`, `session.resend-prompt`, `ui.idle`, async `worktree.create` with preserve |
| `core/src/sessions/launch.ts` | 20 s check, typing hold, prompt kept until `working` |
| `core/src/store/migrations/004-prompt-unsent.sql`, `contracts/schema.sql` | new kind |
| `core/src/events/processor.ts` | `turnSnapshot` with refs |
| `core/src/notify.ts`, `core/src/settings.ts` | hold and coalescing; `notify.hold_until_idle_s`, `notify.hold_max_s`, `worktree.preserve` |
| `workbench/src/main.ts`, `workbench/assets/badge/` | `ui.idle` every 30 s, `flashFrame`, overlay icon |
| `workbench/renderer/app.js` | Resend on `prompt-unsent` rows |
| `contracts/pipe-protocol.md`, `contracts/events-and-hooks.md` | the new methods and `pi.state` |
| `core/test/`, `workbench/test/` | Codex's tests above |

## Out of scope

- A stop button on the tile (it needs this ladder; a later UI child adds it).
- Deleting old turn refs.
- Per-project settings; `worktree.preserve` is global.
- Gemini hooks themselves (M6-5).
- A job object that ends every descendant on close (M7-10, D82); the ladder's `taskkill /T` is the stopgap until then.
