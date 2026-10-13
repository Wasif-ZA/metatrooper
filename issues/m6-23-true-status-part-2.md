# M6-23: True status, part 2: background work, StopFailure, interrupts, fatal patterns, opencode

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 2.5 CC days. Depends on: M6-5 (branch `m6-5-hook-state`, unmerged on 2026-10-14). Start from `main` once `m6-5-hook-state` is merged; record that `main` SHA as the base in the report.

## Context

The wall is only worth watching if a tile's state is true. Five gaps still make it lie (D73, from the idea mine, `ide-layer-research/idea-coverage.md` rows core-sessions 3 and 10, core 3, 7, 11 and 14):

- An orchestrating Claude fires `Stop` each time it pauses for subagents, so the tile says done (and a "finished" item fires) while it is still working.
- A turn that ends on an API error leaves no reason on the tile.
- Claude fires no hook when the user presses Escape, so an interrupted session stays `working`.
- A process engine that stops on "Invalid API key" or empty credits looks like it is still working.
- opencode has no state signal but a bell.

Each fix reads a signal the engine already gives. No new dependency.

## Current state (verified 2026-10-14 on `main` 4fb7ef9 and `m6-5-hook-state` f291675; find code by the quoted text, line numbers move)

| # | Fact | Where |
|---|---|---|
| 1 | `claude.Stop` always maps to `done`, and a `done` with no run raises a "finished" needs-you row | `state.ts` `case 'claude.Stop'`; `processor.ts` `note('done', ev.session_id, s.engine_id, 'finished')` |
| 2 | The Stop payload keeps only `session_id`, `transcript_path`, `cwd`, `stop_hook_active`; `background_tasks` is dropped | `redact.ts` `buildPayload` and `rebuildPayload`, `case 'claude.Stop'` |
| 3 | Claude Code 2.1.145 added `background_tasks` (and `session_crons`) to Stop and SubagentStop input (`~/.claude/cache/changelog.md`). This laptop runs 2.1.296 | changelog |
| 4 | `claude.StopFailure` already maps to `waiting_for_you`, its hook is installed from 2.1.78, and a `rate_limit` one calls `limitHit` (M6-24 merged before this child) | `state.ts`, `hooks/install.ts` `EVENTS`, `processor.ts` `limitHit` |
| 5 | No waiting reason is stored. `session` has no reason column and `queries.ts` selects none, so the renderer's `waitReason(x)` falls back to `last_tool`. The processor clears `last_tool` on StopFailure, so a rate-limited tile reads "question" | `contracts/schema.sql` `CREATE TABLE session`; `app.js` `function waitReason` |
| 6 | No title states. `state_titles` is specced under M6-5 and was not built (M6-5 report, "Left for Wasif" item 5). Titles live in core memory only (M1-05) | `terminal/events.ts` `onTitle` |
| 7 | `onTitle` drops a title whose only change is its leading symbols: `title.replace(/^[\p{S}\p{P}\s]+/u, '')` is the dedupe key. A spinner glyph swapping for an idle glyph is exactly such a change, so it never reaches `put()` | `terminal/events.ts` `titleKeys` |
| 8 | User keystrokes reach the pty through `write(id, data)`; there is no input hook | `terminal/index.ts` `export function write` |
| 9 | The only failure signal for a session is a nonzero exit (`note('failed', ..., 'exited with code ...')`). `needs_you` already has kind `failed`, and `note()` dedupes on ref and kind | `processor.ts` |
| 10 | `lastLine(id, max)` reads the headless buffer after pending output is parsed; nothing reads more than one line | `terminal/index.ts` |
| 11 | opencode: `state_source: "process"`, MCP config through `OPENCODE_CONFIG_CONTENT` (`format: "opencode-mcp"`). `mcpAttachEnv` returns `{}` when no MCP server attaches | `engines/opencode.json`; `plugins/mcp.ts` `mcpJson`, `mcpAttachEnv` |
| 12 | `comment.deliver` types comments only for engines whose `state_source` is not `hooks`, so switching opencode to `hooks` would stop comment delivery (the trap M6-5 hit with Gemini) | `methods.ts` `getEngine(db, c.engine_id)?.state_source !== 'hooks'` |
| 13 | `core/event.js` takes `<kind> --session <id>`, reads JSON on stdin, keeps only `buildPayload`'s allowlist, exits 0 within 240 ms | `core/src/hook/event.ts` |

## Change

1. **Background work holds a Stop.**
   - `buildPayload` and `rebuildPayload` for `claude.Stop` keep `background_tasks` as at most 50 entries of `{type, status}`. Each value must match `^[a-z_]{1,40}$` or the entry is dropped. `id`, `description` and `session_crons` are never kept.
   - In `nextState`, a `claude.Stop` whose payload has an entry with `type` in `subagent`, `teammate` or `workflow` and `status` not in `completed`, `failed`, `killed`, `stopped`, `cancelled` returns `working` (null when already `working`).
   - Build step 1 is a capture. Run one live Claude 2.1.296 tile that starts a background subagent, with a hook that dumps the raw Stop input to the scratch folder. Record the real `type` and `status` strings in the report and pin them in the fixtures. If the field is absent or empty while a subagent runs, stop this item: Stop keeps mapping to `done`, and the gap goes in Known limits. No transcript parsing.
   - A held Stop does not raise the "finished" row and does not push the turn-end job (`turns.push({kind: 'end'})`). Both run when the session really reaches `done`.
   - **Fallback.** `checkHeldStops(db, now)` runs every 5 s from `core/src/main.ts`. A session that is `working`, whose last event other than `term.*` is a `claude.Stop`, and whose Stop is 600,000 ms old or more gets one `core.stop-fallback` event. `nextState` maps that event to `done` when the session is `working`.
2. **A reason on every wait the core knows.**
   - New nullable column `session.wait_reason`, added by the next free numbered migration, and added to `contracts/schema.sql`.
   - The processor sets it in the same transaction that moves a session into `waiting_for_you`, and sets it to null on any move out. Values:
     - `claude.StopFailure`: `stopped: <error_type>`. The `error_type` must match `^[a-z_]{1,40}$`, else the reason is `stopped: error`.
     - `opencode.state` with `why: "permission"`: `permission`.
     - `opencode.state` with `why: "error"`: `stopped: error`.
     - Anything else: null.
   - `queries.ts` selects `wait_reason AS reason`. `waitReason(x)` already prefers `x.reason`, so the renderer does not change.
3. **Title states, the part M6-5 left.**
   - `EngineSpec` gains `state_titles?: {working?: string, waiting?: string, idle?: string}`: regex sources, case-insensitive, compiled once at engine load. A pattern that does not compile is logged and ignored, and the engine still loads.
   - The manifest schema gets the same field, with each pattern at most 200 characters.
   - `onTitle` tests the raw title against the patterns before the dedupe in fact 7.
   - The first match whose state differs from the last one seen for that session appends `core.title-state {state}`. The state is one of the three names; the title text is never stored.
   - `nextState` handles `core.title-state` only for engines whose `state_source` is `process`:
     - `waiting` maps to `waiting_for_you`.
     - `working` maps to `working`.
     - `idle` maps to `done` from `working`, and changes nothing from any other state.
   - For opencode, title states are ignored once that session has any `opencode.state` event.
   - Build step 2 is a capture. Record the working and idle titles of one live Claude tile and one live opencode tile, and the bytes Escape sends from a wall tile. Pin them as fixtures.
   - Ship `state_titles.idle` on the `claude` registry entry from that capture (Claude is `hooks`, so only Change 4 reads it). Ship opencode's patterns only if its title carries state.
4. **Interrupts.**
   - `TermHooks` gains `onInput(id, data)`, called from `write()`.
   - `terminal/events.ts` treats as Escape only `data === '\x1b'`, plus the kitty forms `\x1b[27u` and `\x1b[27;1u`. Anything longer that starts with `\x1b[` (arrows, function keys) is not Escape.
   - On Escape into a session that is `working`, it records a baseline: time, `state_at`, and the highest event `seq` that is not `term.*`.
   - When a raw title matching the engine's `state_titles.idle` arrives within 5,000 ms of that Escape, it appends one `core.interrupted`. This happens only if the session is still `working` with the same `state_at` and no newer non-`term.*` event. A later Escape replaces the baseline, which covers engines that need a double Escape.
   - `nextState` maps `core.interrupted` to `idle` from `working`.
   - An engine with no idle pattern gets no interrupt detection.
5. **Fatal patterns.**
   - `EngineSpec` and the manifest schema gain `fatal_patterns?: string[]`: 1 to 20 fixed strings of 3 to 200 characters, matched case-insensitively as substrings, never as regex.
   - New `lastLines(id, n)` beside `lastLine` returns the last `n` non-empty lines, with wrapped rows joined.
   - New `core/src/sessions/fatal.ts` exports `checkFatal(db, now, read = lastLines)`, which runs every 5 s from `main.ts`. For each `working` session whose engine declares patterns, it reads the last 20 lines.
   - On the first pattern match it remembers `{pattern, hash, since}` in memory. The hash is SHA-256 of the 20 lines joined; the lines themselves are never kept.
   - A later check with the same hash, at least 60,000 ms after `since`, raises `note('failed', id, engine, 'failed: <pattern>')` once.
   - The memory entry resets when the hash changes, no pattern matches, or the session leaves `working`.
   - Ship `claude` with `["Credit balance is too low", "Invalid API key"]`, the two strings Warp's Claude harness watches (idea mine core 11). Other engines get patterns only when one is observed.
6. **opencode state plugin.**
   - New `engines/plugins/opencode-state.js` (MIT like `engines/`), built after herdr's `src/integration/assets/opencode/herdr-agent-state.js` (Apache-2.0, idea mine core 7). It exports an opencode server plugin whose `event` hook maps:
     - `session.status` busy/retry/running, `tool.execute.before`, `tool.execute.after`, `permission.replied`, `question.replied`, `question.rejected`: `working`.
     - `permission.asked`: `waiting` with `why: "permission"`.
     - `question.asked`: `waiting`.
     - `session.error`: `waiting` with `why: "error"`.
     - `session.idle`: `done`.
     - Child-session events (`info.parentID` set) report under their root, and only the waiting/working pairs, as herdr does.
   - For each state it spawns `TROOP_NODE TROOP_EVENT_JS opencode.state --session TROOP_SESSION_ID` detached, with `windowsHide`, and writes `{"state": ..., "why": ..., "seq": n}` to stdin. `seq` is a counter that rises within the plugin. It never awaits the child, and does nothing when any of the three variables is missing.
   - Launch sets `TROOP_NODE` (the core's `process.execPath`) and `TROOP_EVENT_JS` (the absolute `core/event.js`) for engines that declare `state_plugin`.
   - `engines/opencode.json` gains `"state_plugin": "plugins/opencode-state.js"` and keeps `state_source: "process"` (fact 12).
   - `mcpJson` for `opencode-mcp` adds `"plugin": ["<file URL of the plugin>"]`. `mcpAttachEnv` writes `OPENCODE_CONFIG_CONTENT` even when no MCP server attaches, if the engine has a `state_plugin`. Nothing in the user's opencode config is written.
   - `buildPayload` and `rebuildPayload` keep only:
     - `state`, one of `working`, `waiting`, `done`;
     - `why`, `permission` or `error`;
     - `seq`, an integer.
   - `nextState` maps `opencode.state`: `working` to `working`, `waiting` to `waiting_for_you`, `done` to `done`. A `seq` not above the last one processed for that session changes nothing.
   - Build step 3 is a spike before writing the plugin. Confirm that opencode on this laptop (version in the report) loads a plugin named by file URL in `OPENCODE_CONFIG_CONTENT`, and that the plugin's process sees `TROOP_SESSION_ID`. If it loads only from a plugin folder, use `OPENCODE_CONFIG_DIR` pointed at a per-session folder under `~/.metatrooper/engines/opencode/<session>/`, deleted on exit as Gemini's file is in M6-5.
7. **Contracts.** `contracts/events-and-hooks.md` gets:
   - the new kinds `core.stop-fallback`, `core.title-state`, `core.interrupted`, `opencode.state`, with their payload allowlists;
   - the `background_tasks` allowlist on `claude.Stop`;
   - the state rows from Changes 1 to 6.

## Acceptance criteria

- [ ] M6-23a. A Claude `Stop` fixture with a running `subagent` background task leaves the session `working`; 10 minutes with no event (fake clock) moves it to `done`. Exactly: at 599,999 ms `checkHeldStops` appends nothing; at 600,000 ms it appends one `core.stop-fallback`, and the session reads `done` after processing. No "finished" row exists before that, and exactly 1 after. A `Stop` whose only task is `{type: "shell", status: "running"}`, or a `subagent` with `status: "completed"`, goes to `done` at once. A `claude.PreToolUse` at 300,000 ms restarts the 10 minutes.
- [ ] M6-23b. A `claude.StopFailure` fixture shows `waiting_for_you` with reason `stopped: rate_limit`. The snapshot row's `reason` is `stopped: rate_limit`; `error_type: "Rate Limit!"` gives `stopped: error`; the next `claude.UserPromptSubmit` leaves `wait_reason` null.
- [ ] M6-23c. Escape in a working fixture session whose title then matches the idle pattern within 5 s gives `idle` and one `core.interrupted` event. The same title at 5,001 ms gives no event. A title change after `\x1b[A` (an arrow key) gives none. A `claude.PreToolUse` between the Escape and the title gives none.
- [ ] M6-23d. A fixture engine printing a `fatal_patterns` string and then nothing for 60 s raises one needs-you item naming the pattern; no screen text is stored in it. The fixture prints a unique marker on the same line as the pattern. After the item is raised, the marker appears in no `needs_you`, `event` or `session` row. Output that keeps changing for 120 s with the pattern on screen raises nothing. A second minute of the same frozen screen does not raise a second item.
- [ ] M6-23e. An opencode session shows `working` and `done` from its plugin, not from its title. In the fixture, the title never changes, and the plugin's events alone move the session. A `seq` lower than the last one changes nothing. With `TROOP_SESSION_ID` unset, the plugin spawns no process.
- [ ] M6-23f. A `claude.Stop` payload with a `background_tasks` entry carrying `description: "<marker>"` stores no marker in `event.payload`.
- [ ] M6-23g. An engine file whose `state_titles.idle` is `(` loads, logs one line naming the engine and field, and has no interrupt detection.
- [ ] M6-23h. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M6-23i. The existing core and workbench suites still pass. `m6-24-limits.test.ts` passes unchanged.

## Testing plan

Codex writes the tests (D65, `spec.md` Testing lists M6-23) through `/tests-brief`, from this file and the code, in `core/test/m6-23-true-status.test.ts`. Then a mutation run must fail at least one test per change: remove the `subagent` hold, the 600,000 ms check, the `wait_reason` write, the Escape baseline check, the 60,000 ms stall check, and the `seq` guard.

| Layer | What | Count |
|---|---|---|
| Unit (`nextState`, `buildPayload`, `checkHeldStops`, `checkFatal` with injected `now` and `read`) | a, b, d, f, g | +6 |
| Integration (core terminal with a fixture engine from `fake-engine.js`) | c (Escape plus title through `write` and `onTitle`), d (printed pattern through the headless buffer) | +2 |
| Plugin (node runs `opencode-state.js` against a fake opencode event stream and a fake `TROOP_EVENT_JS`) | e | +1 |
| Live, by hand, recorded in the report | one real Claude subagent Stop, one real Escape, one real opencode session | 3 runs |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: never "make the tests pass".
2. You write the code; Codex writes the tests (D65). Do not write or edit tests yourself. Report a test you think is wrong on its own line.
3. Any change to an existing test, timeout or threshold is reported on its own line first, with its reason.
4. A reported command names the command and its observed result; stderr is never silenced in a cited command.
5. Your report is a claim until the parent re-runs it.
6. Never commit, push or open PRs; hand back the command. No em dashes; comments say what the code does.
7. The three capture steps (Changes 1, 3, 6) run first. Their raw output goes to the scratch folder, never the repo. Only the pinned strings go into fixtures, and no prompt or reply text goes anywhere.

## Rollback

Revert the merge. The `wait_reason` column stays, unused and nullable, which older code ignores (as D58 keeps unused tables). The opencode plugin is gone once `state_plugin` is gone, because nothing was written to opencode's own config.

## Effort

Idea sizes as `spec.md` uses them (S 0.25, M 0.75), plus the title-state work M6-5 left:

- 0.25 background work (allowlist, hold, fallback tick, capture);
- 0.25 StopFailure reason (column, migration, processor, query);
- 0.25 title states (fact 6);
- 0.75 interrupts (input hook, raw title path, baseline);
- 0.25 fatal patterns;
- 0.75 opencode (plugin, launch env, config, spike).

Total: 0.25 + 0.25 + 0.25 + 0.75 + 0.25 + 0.75 = 2.5 CC days, against the 2.25 in `spec.md`. The extra 0.25 is the title states, which `spec.md` counts under M6-5's bullet but M6-5 did not build.

## Files

| File | Change |
|---|---|
| `core/src/events/state.ts` | `claude.Stop` hold; `core.stop-fallback`, `core.title-state`, `core.interrupted`, `opencode.state` cases |
| `core/src/events/processor.ts` | `wait_reason` set and cleared; held Stop skips the finished row and turn-end job; `opencode.state` seq guard |
| `core/src/redact.ts` | `background_tasks` and `opencode.state` allowlists in `buildPayload` and `rebuildPayload` |
| `core/src/terminal/index.ts` | `onInput` hook in `write`; `lastLines` |
| `core/src/terminal/events.ts` | raw-title state match before the dedupe; Escape baseline; `core.interrupted` |
| `core/src/sessions/fatal.ts` | new: `checkFatal` |
| `core/src/sessions/watch.ts` or `core/src/sessions/held-stop.ts` | `checkHeldStops` (in `watch.ts` beside `checkActivity` if it fits under 40 lines, else new) |
| `core/src/main.ts` | two 5 s timers |
| `core/src/engines/registry.ts` | `state_titles`, `fatal_patterns`, `state_plugin` on `EngineSpec`; claude's idle title and fatal patterns |
| `core/src/plugins/mcp.ts` | opencode `plugin` entry; config written when only a state plugin needs it |
| `core/src/sessions/launch.ts` | `TROOP_NODE`, `TROOP_EVENT_JS` for `state_plugin` engines |
| `core/src/store/migrations/<next>-wait-reason.sql` | `ALTER TABLE session ADD COLUMN wait_reason TEXT` |
| `workbench/src/queries.ts` | `wait_reason AS reason` |
| `engines/opencode.json`, `engines/plugins/opencode-state.js` | `state_plugin`; new plugin |
| `contracts/events-and-hooks.md`, `contracts/schema.sql`, `contracts/plugin-manifest.schema.json` | Change 7; `wait_reason`; the three engine fields |
| `core/test/m6-23-true-status.test.ts` | new, by Codex |

## Risks

- **Claude's title glyphs are not a contract.** A CLI update can change them and silently turn interrupt detection off. The failure is quiet: the tile stays `working` as it does today. The capture fixture pins today's strings, and the live check in the report is redone when the CLI version changes.
- **`background_tasks` status strings are not documented.** A new status word for a finished task would hold the session up to 10 minutes, after which the fallback releases it.
- **opencode plugin loading may differ by version.** The spike decides between `OPENCODE_CONFIG_CONTENT` and a per-session config folder before any plugin code is written.
- **Fatal patterns run only while `working`.** A process engine that never reaches `working` never trips one. Known limits gets this line.
- **Title states move process engines on a regex.** A loose pattern can mark a session `done` mid-turn. Only patterns from a live capture ship. M7-05d later adds the safe-regex check for `state_titles`.

## Out of scope

- pi's state plugin (M7-6, core 7's remaining half).
- Parsing Claude transcripts for pending work (idea mine core 14; dropped for the payload field).
- A needs-you item for every StopFailure; the tile reason and M6-24's rate-limit handling cover it.
- `session_crons` (never read, as vibeyard does).
- Title states for `hooks` engines other than the interrupt's idle pattern.
