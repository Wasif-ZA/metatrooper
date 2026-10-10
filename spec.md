# MetaTrooper: the agent desk, epic

Re-specced 2026-10-10T23:30+11:00 from the pipeline-IDE epic (now kept beside the pipeline products as
`../suite-of-products/shared/spec-2026-09-29-pipeline-ide.md`; in this repo's git it is `spec.md` before 8c6da1b). Wasif decided the scope in this session: MetaTrooper is four
parts, the agent wall, browser use, computer use and the core services. Pipelines leave the product. They become
their own apps, built later for learning, and those apps drive MetaTrooper's core instead of running inside it.
The draft was reviewed by Codex and Gemini (both 4/10); all 19 accepted findings are applied below
(`~/.cache/claude-scratch/metatrooper-respec-2026-10-10/review.html`).

Exact formats live in `contracts/`. This file says what to build and why; the contracts say precisely how the
pieces talk. Where they differ, the contract wins and this file is the bug.

| Contract | Covers | Change in this epic |
|---|---|---|
| `contracts/schema.sql` | every table, column, key and owner | new `approval`, `grant`, `session_port`, `session_dev_server`, `schema_migration`; pipeline tables kept unused (D58) |
| `contracts/events-and-hooks.md` | event kinds, session linking, state mapping, hook install | Codex and Gemini hooks, new Claude events, `claude.SessionEnd` fixed to `idle` (M6-5) |
| `contracts/pipe-protocol.md` | named-pipe framing, JSON-RPC methods, error codes, queue, access | protocol version, exact shapes for stable methods, pipeline methods removed (M6-1, M6-17) |
| `contracts/plugin-manifest.schema.json`, `contracts/plugins.md` | plugin manifest, permissions, actions, importers | pipeline-only fields removed |
| `contracts/browser-tools.md` | the `metatrooper-browser` tools and safety rules | version 2 (M6-11, M6-12) |
| `contracts/desktop-tools.md` | the `metatrooper-desktop` tools and safety rules | new (M6-15) |
| `contracts/approvals.md` | approval checks, risky-action rules, scopes, hash | new (M6-2) |
| `contracts/agent-cursor.md` | cursor messages, timing, overlay windows | new (M6-18) |
| `contracts/pipeline.schema.json`, `contracts/pipelines.md` | pipeline format and runner | move to the pipelines repo (M6-1) |

## Context

MetaTrooper is a desk where you run all your coding agents at once on Windows. Claude Code, Codex, Gemini or any
CLI an engine file adds each run in a terminal the core service owns, on one wall that tells you which one needs
you. Agents can drive a browser inside the app and, new in this epic, the native apps on your desktop. You see
each agent's own cursor move to what it clicks, and anything risky stops for you first. It is open source
(AGPL-3.0 core), free, with no account.

Why the cut. M1 to M5 built 17 pipelines, 15 run layouts and a runner on top of the desk. Getting all of them to
work at once was too much, and the parts people compare desks on (the wall, agent state, browser, Windows) were
not getting the time. The pipeline code is not wasted: it moves to its own repo and becomes the start of separate
apps (D53, D54).

Evidence for what to build, gathered 2026-10-10 (board:
`~/.cache/claude-scratch/metatrooper-idea-mine-2026-10-10/board.html`):

- Six research lanes triaged about 850 repos and read 101 in depth for the browser, core and wall: 97 ideas, each
  naming a MetaTrooper file and a source file at a commit. A seventh lane read 10 repos for the agent cursor.
- Rival issues ranked by reactions (Orca, t3code, cmux, Superset, emdash, Warp, Claude in Chrome and others). The
  asks that repeat across rivals: agents come back after a reboot (cmux 50, 37 and 27 reactions), a status that is
  true (cmux 42), any CLI as an engine (t3code: Pi 198, Copilot 185, OpenCode 130), Windows with no login (cmux
  Windows 51, Warp login 506), a browser that works without debug ports or extensions (Claude in Chrome connect 79,
  WSL 67), and an embedded browser at all (Warp 76).
- Computer use: the best models now pass most desktop tasks (OSWorld-Verified, official sheet dated 2026-08-01:
  Claude Fable 5 85.96%, Opus 5 83.39%). So MetaTrooper does not build a vision stack; it gives agents a scoped way
  to see and act on Windows apps, and shows you what they do.
- Orca (88.9k stars, MIT) now ships signed Windows builds, usage limits and computer use. "Windows" alone no longer
  sets MetaTrooper apart. Depth does: per-agent isolation, true state from hooks, approvals before risky actions,
  a visible cursor per agent, and everything coming back after a restart.

## Threat model

Agents run as the user. Any agent with a shell can already do anything the user's account can, including reading
`~/.metatrooper/ui.key` or driving Windows apps without MetaTrooper. So MetaTrooper does not claim to stop a hostile
process running as the user, and nothing in this spec says it does.

Agents keep their auto mode (D70), so an agent can also script the desktop through its own shell and skip
MetaTrooper's tools. That is covered by watching, not by blocking: the watch layout and the input watcher (M6-22).

What grants, approvals and take-over guarantee is narrower and testable: an agent using MetaTrooper's own browser
and desktop tools cannot act outside the panes and windows it was given, cannot perform a D61 risky action without a
person approving that exact action in the workbench, and stops at the take-over key. `approval.resolve` and the
grant methods need a trusted UI connection (`ui.hello`); the MCP servers, plugins and pipeline apps get no path to
them. A process that deliberately reads the UI key is a hostile same-user process and out of scope, as before.

## Decisions

Decisions D4 to D51 and M4-D1 to M5-D29 stay in the archived spec as history. These still bind and are restated
where they matter below: D5 (real interactive CLIs, never `claude -p`), D10 (Node core, Electron workbench), D19
(core-owned terminals), D21 (own browser MCP, no WebSocket), D24 (no TCP port), D28 (free, no account), D30
(licences), D41, D42, D46, D48 (approval profiles, worktree trust, private paths, now `sessions.ask_paths`), D49
(launch and close), D50 (first user, signed installer before any release), M5-D4 (Linux source beta), M5-D12 and
M5-D21 (electron-builder), M5-D14 (one instruction file), M5-D19 and M5-D23 (Certum signing), M5-D26 (vendor terms
for the free app), M5-D29 (sandbox runs code, not agents). M5-D24 (Hyper-V VM) is replaced by D67.

| # | Decision | Chosen |
|---|---|---|
| D52 | Scope | Wasif, 2026-10-10: four parts only. The wall, browser use, computer use, core services |
| D53 | Pipeline code | Wasif, 2026-10-10: pipelines become products in `projects/suite-of-products/` (one repo per product, mapped in each product's README). Each pipeline's files and issues were copied to its product on 2026-10-10; five with no product yet went to `suite-of-products/unassigned/`, and the shared machinery (runner, layouts, templates, helpers, pipeline contracts, old spec, pipeline research) to `suite-of-products/shared/`. M6-1 removes them from this repo |
| D54 | How pipeline apps run agents | Wasif, 2026-10-10: through MetaTrooper's core, over the `troop` CLI and the named pipe. Their agents show on the wall. So the pipe becomes a public API with a version (M6-17) |
| D55 | Approvals | Wasif, 2026-10-10: gates stay, re-shaped for single agent actions in the browser and on the desktop. Same trusted-UI key (`ui.hello`) |
| D56 | Computer use | Wasif, 2026-10-10: on his own desktop, with take-over. An agent acts only on windows it was given. Driver chosen by D71, checked by a spike first (M6-14) |
| D57 | Finish line | Wasif, 2026-10-10: a free public release, no Pro. Date moved by D66; how it installs is D72 |
| D58 | Pipeline tables | Kept in `schema.sql` and in existing databases, unused, with their rows, until a numbered migration drops them after the release. Dropping data is one-way; keeping unused tables costs nothing. Nothing new references them |
| D59 | Licences after the split | Every file keeps the licence it has: the runner and layouts AGPL-3.0, `pipelines/` and the pipeline contracts MIT. The new repo carries both licence files |
| D60 | Port ownership without pipelines | An agent pane may open a loopback port that its own session owns: either the listening process descends from the session's pty, or the session's terminal printed that URL and the port started listening within 60 s after (covers detached `npm run dev` children). A user pane may open any loopback port the user types; an agent can never drive a user pane (rule 8) |
| D61 | Risky actions | Every input tool call (click, type, key, select, scroll that triggers a click, navigate) is checked right before it is sent. It needs an approval card, every time, when: the target is a password field (browser `type=password`, UI Automation `IsPassword`); the typed text matches a credential pattern (the core's redaction rules) or the field's label matches password, token, secret, key, cvv or card; the focused or clicked control's Name or AutomationId matches send, submit, pay, buy, purchase, order, checkout, delete, remove, erase, publish, post, transfer, authorize or confirm (English only, listed in Known limits); a key press of Enter, Space or a shortcut while such a control has focus; a standard file dialog (`#32770`) opens; or it is the first input in a window or origin the session was not granted. Reading tools (snapshot, screenshot, windows, read, console, network) never ask |
| D62 | Take-over | Ctrl+Alt+Q (setting `desktop.takeover_key`) sets one pause flag in the core. Every desktop and browser input is checked against the flag at dispatch, per chunk of at most 8 characters for typing, and queued calls are dropped. After the flag is set, no input reaches any app; calls return "paused by the user". Resume is per session from its tile |
| D63 | Protocol stability | `core.ping` returns `{ok, pid, version, protocol, schema_version, started_at}`. Methods marked stable in `pipe-protocol.md`, with their exact params and errors, keep their shape within a protocol version. A breaking change raises the version, and the old shape answers for one more minor release |
| D64 | Pro and money | Out of this epic. M5-6 code moves with the pipelines (pr-review-fix is a pipeline). M5-7 is cut |
| D65 | Tests | Codex writes the tests for the core, browser, desktop, approval and cursor children (M6-2, M6-4, M6-5, M6-6, M6-11, M6-12, M6-15, M6-18), through `/tests-brief`, then a mutation run proves they bite |
| D66 | Dates | Wasif, 2026-10-10: keep the full scope and move the date. Freeze 2026-12-26, public release 2027-01-19 (worked in Milestone 6) |
| D67 | Clean-machine test | Wasif, 2026-10-10: when an installer exists (D72), it is tested on a second real Windows PC (his or a friend's) with Smart App Control on and a fresh standard account, instead of a Hyper-V VM (this laptop is Windows 11 Home) |
| D68 | Rival extras | Wasif, 2026-10-10: search across all terminals, a cost chip per tile, and changed files per tile join this milestone (M6-19 to M6-21) |
| D70 | Auto mode and watching | Wasif, 2026-10-10: agents stay in their auto mode (the default) even while they hold a desktop grant; edits and ask modes are too slow to work with. An auto-mode agent can script the desktop through its own shell and skip grants, cards and take-over, so protection is watching, two ways. (1) The wall can run on a second monitor in a watch layout (M6-15) that shows each granted window's live thumbnail beside its agent's tile. (2) The core runs a watcher (M6-22): a low-level input hook sees every mouse and keyboard event Windows marks as injected (`LLMHF_INJECTED`, `LLKHF_INJECTED`). Injected input that arrives while no `metatrooper-desktop` action is in flight raises a needs-you item "input from another program" naming the foreground window, and, with `desktop.watch_pause` on (default on), sets the take-over pause flag. A second listener catches what injected input misses: UI Automation's own system-wide events (focus changed, window opened, control invoked). One of those while the user made no physical input in the last 2 s (`GetLastInputInfo`) and no `metatrooper-desktop` action was in flight raises "the desktop changed while you were away from it", with the same pause setting. The watcher cannot name the process behind either signal; it says so |
| D69 | Agent cursor | Wasif, 2026-10-10: every agent action in the browser and on the desktop shows that agent's own cursor gliding to the target like a person's mouse, then the click. It never moves the real pointer and adds at most 250 ms per action. One MetaTrooper cursor serves both surfaces; if cua-driver is ever added (D71) it runs with `--no-overlay` (M6-18) |
| D71 | Desktop driver | Wasif, 2026-10-10: nothing is installed for computer use until it is really needed. MetaTrooper ships its own driver on Windows' built-in UI Automation (a long-lived PowerShell helper, no install, no new dependency). cua-driver (trycua/cua, MIT) stays the named upgrade behind the same tool list, added only when the built-in driver proves too weak on real apps, and only with Wasif's yes to install it |
| D72 | Signing and installer | Wasif, 2026-10-10: no money on a certificate for now. The first public release is a source install (`git clone`, `npm install`, `npm start`; signed `node.exe` runs under Smart App Control, as on this laptop). The installer (M5-1, WIP kept on `agent/m5-1`) and signing (M5-2) wait until Wasif sees real users outside himself; then he decides whether to pay. D50's rule stands: no unsigned installer is published |
| D73 | Mined ideas | Wasif, 2026-10-10: every mined idea that closes a gap named by a rival angle (users of Orca, t3code, cmux and others asking for it) joins this milestone as M6-23 to M6-27, for the best product at launch. Every other gap waits until after the release (After the release, below), High-value ones included. Moves D66's dates: freeze 2027-01-10, public release 2027-02-03 |
| D74 | Script in owned dev pages | Wasif, 2026-10-10: MetaTrooper adds nothing to a page's own code, with one exception. A pane showing a dev server that one of the user's sessions owns (a `ready` `session_dev_server` row, D60) gets a read-only 30-line devtools-hook stub before load, so a pick can name the component and its source file. No other origin ever gets it (M6-23) |

## Current state, verified 2026-10-10

- `main` at dba0709 (the tile-header merge from another session: top bar, strip, Diff, Git and a Pipelines tab in
  `workbench/renderer/app.js`). M5 paused at 2026-10-10T21:45+11:00. Last full suites on main before that merge:
  core 501 tests, 491 pass, 1 fail (fixed in e377207), 9 skipped; workbench 165 pass, 0 fail, 59 skipped (`status/M5-STATUS.md`,
  paused section).
- The core answered `troop ping` at session start (pid 10032) and was offline at 2026-10-10T20:52+11:00, the time
  of the last database write; seen in this session, cause not recorded anywhere.
- Pipeline code that leaves: `core/src/pipelines/` (runner.ts 1,388 lines, assists, devserver, panes, secrets-scan,
  store, template, validate), `core/src/schedules.ts`, `pipelines/`, 15 layouts in `workbench/renderer/layouts/`,
  `workbench/src/rundetail.ts`, the pipeline plugins.
- Code that stays but imports it (M6-1 must change each): `core/src/main.ts:18,22,24` (Runner, syncPipelines,
  tickSchedules, and its timers), `core/src/methods.ts:19,24-31` (Runner type in `CoreControl`, schedules, store,
  validate, panes), `core/src/plugins/manifest.ts`, `workbench/src/main.ts:25` (`paneData` from
  `core/src/pipelines/panes.ts`), `core/cli.ts` (`troop run`; `troop gate` is the adoption-gate measurement and
  stays), 8 renderer and
  workbench call sites of `gate.resolve`, `run.start` or `run.cancel`, the Runs and Pipelines tabs in `app.js:13`,
  and the inspiration board path `panes.ts` `boardCapture`. 70 of 142 test files mention pipelines, the runner or
  `run_id`; M6-1 sorts each into move, keep or edit.
- Approval logic lives inside the runner: `gate` rows need `run_id` and `step_id` (`contracts/schema.sql:194-207`);
  `gate.resolve` is in `core/src/methods.ts:326-344`. `core/src/gate.ts` is the adoption-gate measurement, not
  approvals.
- Browser port ownership comes only from pipeline rows: `browser_pane.dev_port` and `variant.dev_port`
  (`workbench/src/browser/panes.ts:124-127`), fed to `PolicyContext.ownedPorts` (`core/src/browser/policy.ts:14-21`).
  No code path sets `dev_port` for a pane the user or an agent opens outside a run. `port_lease` and `dev_server`
  both require a `run_id` (`schema.sql:251-274`); `core/src/ports.ts` leases by run.
- Session state (`core/src/events/state.ts`, 48 lines): Codex moves to `done` on `codex.turn`; a Codex approval
  prompt reaches `waiting_for_you` only through a terminal bell or, after 20 s of quiet, `core.activity` `blocked`,
  and `blocked` only moves a session that is still `working` (`state.ts:29`), so a prompt after `codex.turn` is missed.
  Process engines (opencode, copilot, gemini, pi) have no hook state. `claude.SessionEnd` maps to `idle` in code
  but to `exited` in `contracts/events-and-hooks.md:84`.
- Browser snapshot refs restart at `e1` on every call (`panes.ts` `snapshotLines`: `pane.refs.clear()`, `refN = 0`),
  so an old ref can name a different element. `Accessibility.getFullAXTree` is called with no frame id. The cursor
  overlay is one hardcoded blue dot (`workbench/renderer/overlay.css`), and `panes.ts:543-544` sleeps a fixed time
  and reads the cursor back before each action.
- Terminals spawn with `useConpty: true` (`core/src/terminal/index.ts:48`), but neither xterm sets `windowsPty`,
  and there is no flow control (no `pause`/`resume`).
- CLIs on this laptop: Claude Code 2.1.296, codex-cli 0.160.1 (`codex features list`: `hooks` stable; the binary
  names PermissionRequest, Interrupt, Stop, SessionStart, SessionEnd, PreToolUse, PostToolUse, UserPromptSubmit,
  Notification, SubagentStop, PreCompact; hooks need persisted trust or `--dangerously-bypass-hook-trust`), Gemini
  CLI 0.58.0 (reads `GEMINI_CLI_SYSTEM_SETTINGS_PATH`; events BeforeTool, AfterTool, Notification, SessionStart,
  SessionEnd, BeforeAgent, AfterAgent), agy 1.3.3. This laptop runs Windows 11 Home.
- Computer use: not built. The old plan (`issues/39-desktop.md`, now in `../suite-of-products/unassigned/issues/`) was a PowerShell UI Automation plugin inside the
  `form-fill-batch` pipeline. cua-driver (trycua/cua, MIT, 29,237 stars, pushed 2026-10-10) is not installed.

## Architecture

```
 +--------------------------------+      +-------------------+      +--------------------------+
 | Electron workbench             |      | troop CLI         |      | pipeline apps (later,    |
 | the wall, browser panes,       |      | (agents and you)  |      |  own repos, D54)         |
 | approval cards, agent cursors, |      +----+---------+----+      +-----+--------------+-----+
 | desktop overlay windows        |           |         |                 |              |
 +----+-------------+-------------+           | reads   | commands        | commands     |
      | reads       | commands                |         |                 |              |
      v             +---- \\.\pipe\metatrooper (protocol 1, D63) ----------+--------------+
 +----+--------------------------------------------------+
 | ~/.metatrooper/troop.db (SQLite, WAL)                 |<---- hooks (Claude, Codex, Gemini), launch.js
 +----+--------------------------------------------------+
      ^ sole writer of core-owned tables
 +----+--------------------------------------------------+
 | core service (node 24, TypeScript)                    |
 | events, state, launcher, sessions, approvals, grants, |
 | take-over flag, meter, limits, plugins, notify, ports |
 +----+--------------------------------------------------+
      | node-pty (ConPTY), one pty per session
      v
 in-app terminals (headless xterm in core, xterm.js tiles in the wall)

 Agents -> metatrooper-browser (stdio MCP) -> core check (D61, D62) -> workbench pane: cursor glide, then input
 Agents -> metatrooper-desktop (stdio MCP) -> core check (grants, D61, D62) -> workbench desktop cursor glide
                                           -> UI Automation helper (built into Windows, D71)
```

### Rules

1. **The agent's terminal never depends on the window.** Closing the workbench leaves every agent working;
   reopening reattaches with scrollback.
2. **Logic lives in the core service.** Windows and apps read the database and send commands; they never decide.
   The core is also the only writer of `~/.metatrooper/settings.json`; the workbench sends `settings.set`.
3. **A broken MetaTrooper is indistinguishable from an absent one.** Every hook and the launcher finish within
   250 ms, swallow every error and exit 0. This covers the Codex and Gemini hooks too.
4. **No window ever waits on another process.** "Core offline" badge after 6 s without a heartbeat.
5. **Table ownership.** The core is the only writer of core-owned tables. Queue tables: `event`, `command`,
   `comment`. `approval` and `grant` rows are written by the core only, and changed only by `ui.hello` calls.
6. **Nothing MetaTrooper writes lives in the vault or OneDrive.**
7. **Private folders ask first** (`sessions.ask_paths`, unchanged).
8. **An agent acts only on what it was given.** A browser pane it owns, or a desktop window granted to it. Never
   another session's pane or window, never a user pane, never the workbench window.
9. **Risky actions stop for a person** (D61). An agent, a plugin or a pipeline app cannot approve one.

### Transport

Unchanged: direct read-only database reads (p95 under 1 ms), a folder watch plus a 1 s `PRAGMA data_version` poll,
events appended to `event`, commands on `\\.\pipe\metatrooper` with a 300 ms queue fallback. No TCP port,
WebSocket or SSE (D24).

## Core services

### Sessions and state (M6-5, M6-6)

Launching, the engine registry, health lights, usage and limits work as built. Changes:

- **Codex hooks.** Installed per launch with `-c` overrides, never editing `config.toml` (M1-36): PermissionRequest
  to `waiting_for_you`, Stop to `done`, Interrupt to `idle`, SessionStart to the `native_id` link. The first M6-5
  task is a 0.5-day spike with this order: hooks given by `-c` run with no trust prompt (use them); or Codex has a
  command that records trust for a named hook (MetaTrooper runs it once, at hook install, and shows the user what it
  trusted). `--dangerously-bypass-hook-trust` is never used. If neither works, Codex keeps the notify path plus
  terminal-title states, and M6-05a's fallback branch applies.
- **Gemini hooks.** A per-session settings file at `~/.metatrooper/engines/gemini/<session>.json`, passed through
  `GEMINI_CLI_SYSTEM_SETTINGS_PATH`, adds MetaTrooper's hooks without touching `~/.gemini/settings.json`.
  Notification to `waiting_for_you`, AfterAgent to `done`, SessionStart to the link. The file is deleted when the
  session exits.
- **Claude hooks.** Add PermissionRequest and PostToolUseFailure when the installed CLI version lists them. A
  permission wait stays `waiting_for_you` until the PostToolUse of that same tool call (matched by `tool_use_id`)
  or a new prompt; a PreToolUse for a different call does not end it. `claude.SessionEnd` maps to `idle` for
  terminal sessions and `exited` only for `external` sessions; the contract is corrected to match.
- **Title states.** For engines without hooks, each engine file may declare `state_titles` (regex to state). A
  title matching a `waiting` pattern maps to `waiting_for_you`, a `working` pattern to `working`. No engine name
  is in core code.
- **Comes back after a restart.** When the core starts and finds sessions that were live when it stopped, it
  resumes them with the engine's `resume_args`: at most 3 at a time, 2 s apart plus up to 1 s of random jitter. It
  stops resuming an engine after 2 failures whose output matches that engine's `auth_error` pattern, and raises one
  needs-you item. The wall layout (big slot, pairs, folded bars, split sizes) is saved through `settings.set` on
  every change and restored with the sessions. Each session's last screen (headless serialize, last 200 rows) is
  saved at exit, so a dead tile shows what it was doing. Desktop grants never survive a restart (M6-15).
- **Waiting reasons.** Each `waiting_for_you` carries `reason` (`permission: <tool>`, `question`, `approval:
  <summary>`, `title`) and `since`, the time it entered the state. "Oldest waiting" means smallest `since`; ties go
  to the lower session id.
- **Usage limits.** A reading past its reset time shows as expired, never as current (`core/src/limits.ts`).
- **True status, part 2** (M6-25). A Claude `Stop` whose payload lists a `background_tasks` entry of type
  `subagent`, `teammate` or `workflow` that is not finished keeps the session `working`; with no event for 10
  minutes after it, the session moves to `done`. `claude.StopFailure` (when the CLI version lists it) maps to
  `waiting_for_you` with reason `stopped: <error_type>`. An Escape typed into a `working` session followed within
  5 s by a title matching the engine's `idle` title pattern appends `core.interrupted` and maps to `idle`. Each
  engine file may declare `fatal_patterns` (fixed strings): while a session is `working`, the last 20 lines of its
  headless screen are checked every 5 s, and a match whose lines stay unchanged for 60 s raises a needs-you item
  "failed: <pattern>" (the pattern, never the screen text). opencode gets a state-reporter plugin file under
  `engines/plugins/` that runs `core/event.js` with `opencode.state`; its title states stay as the fallback.
- **Limits that carry on** (M6-26). On `claude.StopFailure` with `error_type: rate_limit`, the core writes
  `core.limit-hit` with the window's `resets_at`. When `resets_at` passes, the session's pty is still open and no
  later event arrived, the core pastes "Continue where you left off." and Enter once (`core.limit-resumed`, keyed by
  the limit-hit event id so it never fires twice). Per-session toggle on the tile, default on. The last 6 readings
  per window are kept; when the usage slope says the window runs out before `resets_at`, one needs-you item names
  the time ("Claude 5h window ends early at about 16:40"). A tile stopped by a limit offers "Continue in <engine>":
  the core writes a handoff file (at most 6 KB: the task line, the last 10 turns, the session's changed files from
  `session.owners`, the last failing command) to the session folder and launches the chosen engine with it as the
  prompt. By hand only.
- **Notifications** (M6-10): no OS toast for a session whose tile is focused while the window has focus; a toast
  names the session's task line, not only the engine.

### Reliability (M6-4)

- **One core only.** The single-instance lock (the pipe bind) is taken before the database opens or any command is
  recovered. Today `core/src/main.ts` opens the database and runs `commands.recover()` first.
- **Settings.** The core is the only writer: the workbench's `writeSetting` becomes a `settings.set {key, value}`
  pipe call (needs `ui.hello`). The core never overwrites a file that does not parse; it writes
  `settings.json.tmp-<pid>`, flushes, and renames it over the old file. On start, a leftover `.tmp-*` file is
  deleted and the real file is used. A file that does not parse shows "settings.json does not parse, line N" in the
  workbench and the core runs on defaults without writing.
- **Numbered migrations.** `core/src/store/db.ts`'s add-column-if-missing chain becomes numbered migrations in
  `core/src/store/migrations/NNN-<name>.sql` with a `schema_migration (id INTEGER PRIMARY KEY, applied_at TEXT)`
  table. Migration 001 records the M5 schema as applied without changing it.
- **A stale core is visible.** `core.ping` returns D63's shape; a workbench that finds a core of another `version`
  says so and offers Restart core.
- **Who restarts the core.** The workbench restarts only a core it started (D49), at most 3 times in 60 s, then shows
  the last 20 lines of `~/.metatrooper/logs/core.log`. A core started by `troop serve` is never restarted by the
  window.

### Ports and dev servers (M6-3, D60)

New tables replace the run-keyed ones for everything outside pipelines (migration 002):

```sql
CREATE TABLE session_port (                   -- ports leased to a session (worktree dev servers)
  port         INTEGER PRIMARY KEY,
  session_id   TEXT NOT NULL REFERENCES session(id),
  leased_at    TEXT NOT NULL
);

CREATE TABLE session_dev_server (             -- dev servers seen in a session's terminal
  id           TEXT PRIMARY KEY,               -- 'ds_<ulid>'
  session_id   TEXT NOT NULL REFERENCES session(id),
  project_id   TEXT NOT NULL REFERENCES project(id),
  port         INTEGER NOT NULL,
  url          TEXT NOT NULL,
  pid          INTEGER,                        -- the listening process when found
  matched_by   TEXT NOT NULL CHECK (matched_by IN ('ancestry','printed')),
  status       TEXT NOT NULL CHECK (status IN ('ready','stopped')),
  seen_at      TEXT NOT NULL
);
```

- The core scans each session's terminal output for `http://localhost:<port>`, `http://127.0.0.1:<port>` and
  `http://[::1]:<port>`. For each URL it takes the port from that URL only and looks up the listening process
  (`Get-NetTCPConnection -State Listen -LocalPort <port>` on a loopback or any-address socket, owning pid) every 1 s
  for 60 s. If that pid descends from the session's pty it writes `matched_by: ancestry`. If not, it is `printed`
  only when the port was absent from the core's listening-port snapshot taken when the URL was printed (Windows
  keeps no listen start time, so the snapshot is the evidence). More than one owning pid on the port, or a port that
  was already listening at the print, writes nothing. The row stores the pid; a different pid on that port later
  turns the row `stopped`. The tile shows an "Open preview" chip for each `ready` row.
- A row turns `stopped` when the port stops listening (checked every 5 s while the session lives) or the session
  exits.
- Browser policy: an agent pane may load a loopback port only through a `ready` row of its own session. A user pane
  may load any loopback port the user typed. The private-range and DNS-rebinding rules are unchanged.
- `ports.ts` leases from `session_port`. `port_lease`, `dev_server` and `variant` stay unused (D58).

### Approvals (M6-2, D55, D61)

```sql
CREATE TABLE approval (
  id           TEXT PRIMARY KEY,               -- 'ap_<ulid>'
  session_id   TEXT NOT NULL REFERENCES session(id),
  surface      TEXT NOT NULL CHECK (surface IN ('browser','desktop')),
  target       TEXT NOT NULL,                  -- browser: origin; desktop: grant id
  control      TEXT,                           -- the control's role, Name and AutomationId, when one is involved
  action       TEXT NOT NULL,                  -- tool name: click, type, key, select, scroll, navigate
  action_hash  TEXT NOT NULL,                  -- see below
  summary      TEXT NOT NULL,                  -- in words, redacted: "click Send in Outlook"
  reason       TEXT NOT NULL,                  -- which D61 rule fired
  shot         TEXT,                           -- path of a redacted crop of the target
  status       TEXT NOT NULL CHECK (status IN ('waiting','approved','rejected','expired')),
  scope        TEXT CHECK (scope IN ('once','session')),
  created_at   TEXT NOT NULL,
  decided_at   TEXT
);
```

- `control` is JSON: `{"automation_id": string, "name": string, "role": string}` with empty strings for missing
  parts, or `null` when no control is involved; the `approval.control` column stores that JSON text.
- `action_hash` is the sha256 hex of the JSON text of `{"action","args","control","session_id","surface","target"}`
  with keys sorted at every level, no whitespace, and strings as JSON escapes them. Typed text in `args` is replaced
  by its own sha256 before hashing, so the hash never carries a secret.
- Flow: the MCP server sends `approval.check` to the core before every input call. The core answers `allow`,
  `deny` (with a reason), or `ask`. On `ask` it writes the `approval` row and a `needs_you` row of kind `approval`
  (the wall already wakes on `needs_you`), and the server's call waits until the row is decided or 120 s pass
  (`expired`; the tool returns "not approved in time"). The agent is never told how to approve.
- `approval.resolve {approval_id, decision: "approve"|"reject", scope: "once"|"session"}` needs `ui.hello` (-32012
  otherwise); -32010 if the row is not `waiting`. `once` approves this call. `session` approves the same action on
  the same target and the same control (matched by `control`) for the rest of the session. D61's password,
  credential and file-dialog rules ask every time whatever the scope.
- Re-check at dispatch: after approval, the server re-reads the target and control right before sending. If the
  control's Name or AutomationId changed, the approval is void and a new check runs.
- The wall shows waiting approvals oldest first as cards in the bottom sheet and as a count on the agent's tile:
  redacted crop, summary, reason, Approve once, Approve for this session, Reject. A and R act on the top card only
  when the sheet has focus; inside a terminal they are ordinary keys.
- Summaries, crops and the `control` field pass through the core's redaction before they are stored.

### Public API (M6-17, D54, D63)

- Each pipe method is declared once in `core/src/methods.ts` with its params schema, errors, `stable` flag and
  `needs_ui` flag. `pipe-protocol.md`'s method table, `troop --help` and the agent skill are generated from that
  list, and a test fails when they differ.
- Stable in protocol 1, each with its exact shape in `pipe-protocol.md`: `core.ping`, `project.open`,
  `session.launch`, `session.list`, `session.wait`, `session.resume`, `session.focus`, `session.live-text`,
  `worktree.create`, `pane.open` (agent form), `notify.sink.*`.
- `session.wait {session_id, states: [state, ...], timeout_ms}`: `states` must be non-empty and from the state list
  (-32602 otherwise); `timeout_ms` from 1 to 600,000 (-32602 otherwise); an unknown session is -32004. It returns
  `{state, reason?, timed_out}` as soon as the session is in one of the states (at once if already there) or when
  the timeout passes.
- Removed with the pipelines: `run.*`, `gate.resolve`, `schedule.set`, `pipeline.validate`, `template.list`,
  `variant.*`. Calling one returns -32601 "moved to the pipeline products".

### Plugins and sandbox

Plugins, importers, remote MCP and the notification sink stay as built (M5-12 to M5-15). The pipeline-only plugins
(`media`, `social-scheduler`, `seo`, `cite-check`, `gmail`, `data`, `docs-export`, `github`, `deploy`, `security`)
move with the pipelines. The sandbox (M5-D29) stays an experimental flag, off by default.

## The wall

The approved wall (title bar, tile header from dba0709, list behind Ctrl+B, Ctrl+K search, the nine ideas, the
dither look, GSAP motion) stays. Removed: the Runs and Pipelines tabs, run screens, the 15 layouts, background-run
bars and the gate sheet's pipeline cards. The bottom sheet now holds approval cards.

Added:

- **Keys** (M6-9). Wall keys use Alt, so a focused terminal keeps every Ctrl key the agent needs:
  - Alt+arrow moves focus to the tile in that direction, from the rectangles `wall.js` already computes.
  - Alt+N labels every tile with a letter for 2 s; a letter jumps there; Shift plus a letter swaps that tile into the
    big slot.
  - Alt+J jumps to the oldest waiting session (smallest `since`); its tile header shows the `reason`.
  - Alt+Backspace returns to the previous tile.
- **Focus-steal rule** (M6-9). A tile that starts waiting never takes the big slot within 3 s of a key press or
  mouse click in the big tile; it queues and glides in after.
- **Tile chips.** "Open preview" (D60), "driving: <window>" while an agent holds a desktop grant, the approval
  count, the cost chip (M6-20) and the changed-files count (M6-21).
- **Agent input** (M6-8). Shift+Enter sends a newline as a bracketed paste of `\n`, never Enter. A pasted or dropped
  image is saved to `~/.metatrooper/paste/<session>/<ulid>.png` and its path is pasted. File paths,
  `path:line:col` and URLs in terminal output are links, checked on disk before they are underlined.
- **Terminal speed** (M6-7). Both xterms set `windowsPty: {backend: 'conpty', buildNumber}`. The core answers
  cursor-position and device-attribute queries while no tile is attached. Each viewer gets output by byte credit
  (64 KB window) and acknowledges it; the core pauses the pty when the headless terminal is more than 1 MB behind and
  resumes under 256 KB, replacing the 4 MB "slow viewer" drop. Folded tiles get no stream and repaint from the
  headless snapshot when unfolded. WebGL renders the 4 most recently active tiles; the rest use the DOM renderer.
- **Search all terminals** (M6-19). Ctrl+K also searches every live session's headless scrollback (plain text, case
  insensitive, at most 50 hits, newest first). A hit opens that tile scrolled to the line.
- **Cost chip** (M6-20). Each tile header shows the session's tokens and dollars from the `usage` table, or
  "usage unknown" for engines with no source. Hidden in demo mode.
- **Changed files** (M6-21). Each tile header shows how many uncommitted files the session owns (`session.owners`);
  a click lists them and opens the Diff tab on one.
- **Context fill** (M6-27). Beside the cost chip, the tile shows how full the context window is: the last turn's
  `tokens_in + cache_read + cache_write` from `usage` over the model's window from the engine file
  (`context_window` per model). At 85% the chip turns orange and says "compacts soon". Engines with no source show
  nothing.

## Browser use

The pane model (Electron `WebContentsView` per pane, no remote debugging port, agent panes owned by one session,
request interception, full-page capture, point-to-comment) stays. `contracts/browser-tools.md` goes to version 2:

- **Stable refs** (M6-11). A ref is kept for the life of the element in its document (keyed by frame id plus
  `backendDOMNodeId`). Navigation of a frame ends that frame's refs. A gone element's ref fails with "no longer on the
  page". `since_last` returns added and removed lines.
- **The page answers every action** (M6-11). `click`, `type`, `select`, `navigate` and `back` wait up to 1 s for the
  page to settle, then return the URL, title, any dialog, new console errors and the interactive snapshot diff.
- **Bounded output** (M6-11). `snapshot` takes `max_tokens` (default 4,000, counted with the meter's tokenizer) and
  `scope_ref`, and returns a `continue` cursor when cut. Child frames and open shadow roots are included, with
  frame-tagged refs. Screenshots are JPEG by default, no side over 1,568 px, with an optional element crop. A `read`
  tool returns the page's main text with an optional search filter.
- **Tool hints** (M6-11). `tools/list` marks `panes`, `snapshot`, `screenshot`, `read`, `console`, `network` and
  `wait_for` with `readOnlyHint`, and every other tool with `destructiveHint`. Hints are labels for the agent; D61's
  check is what enforces.
- **Crashes are reported** (M6-11). A crashed or hung pane makes the next call fail at once with "the page crashed"
  or "the page is not responding".
- **Hand the pane to the user** (M6-12). `handoff {pane_id, reason}`: the pane becomes the user's, the agent's
  browser tools fail with "the user has the pane", and the tile shows the reason and a Give back button.
- **Origins** (M6-12). Origin means scheme, host and port after redirects. The first input on a new origin raises an
  approval (D61) unless `.troop/config.json` allows it; Approve for this session covers that origin.
- **Secrets by placeholder** (M6-12). `type` accepts `{{secret:NAME}}` only into a password field or a field the user
  approved for that secret once, and only on the origin saved with it. The workbench main process fills the value
  through `Input.insertText`; it never returns in any tool result, log, crop or event. Secrets live in the existing
  DPAPI store.
- **Scrubbed output and audit** (M6-12). Console, network and `read` results, approval summaries and audit rows
  pass through the core's redaction (secret values, bearer tokens, cookies, URL credentials and token-looking query
  values). Every browser tool call is an append-only `event` row (`browser.tool`: tool, pane, origin, result
  status, no typed text), kept 30 days, listed as a timeline in the tile's Browser tab.
- **Pane hygiene** (M6-13). Load errors, certificate errors and renderer crashes show their own page. OAuth popups
  keep their opener; a page cannot open a new pane without a click. `capture()` restores the viewport override in a
  `finally`. A picked element is sent as at most 4 KB of sanitised HTML, labelled as page content the agent must not
  follow as instructions; arrow keys walk the element stack before sending.
- **Comments that come back** (M6-23). A comment row stays open until resolved and holds a short thread. The overlay
  view draws a numbered pin at each open comment's element (`DOM.getBoxModel` by `backendNodeId`, refreshed on
  scroll and resize); a resolved pin turns green and shows the agent's reply on hover. New browser tools:
  `comments` (open rows for this session's panes), `reply_comment {id, text}`, `resolve_comment {id, reply?}` and
  `reveal {ref}` (flashes the session's cursor on an element). The snapshot marks the user's last pick with
  `(you pointed here)`. Several picks made before the next prompt go as one batch. Replies pass through the core's
  redaction.
- **Source file of a pick** (M6-23, D74). On a pane at an owned dev port, a pick also returns up to 5 component
  names with `file:line` ("Component: <PricingCard> at src/components/PricingCard.tsx:42") from the React fiber;
  Vue and Svelte give names only. Any other origin gets no stub and no source line.
- **Mark up** (M6-23). M freezes the pane to a still with four tools (pen, arrow, box, text); Done saves one PNG
  (at most 2 MB and 4 MP) into the same comment row. Shapes are kept as JSON.
- **Picks in cross-origin frames** (M6-23). `Target.setAutoAttach` (flattened) gives each child frame its own
  debugger session; a pick inside one is routed to that session, its box offset by the frame, and the comment
  records the frame URL.
- **Compare the page** (M6-24). The pane menu gets Device (Responsive, four presets, Rotate; the emulated viewport is
  centred and scaled to fit the pane) and Rendering (colour scheme, reduced motion, six vision types, CPU 4x and 6x,
  offline). Both live in one record per pane, re-applied on every navigation and after DevTools detaches; an
  `emulate` browser tool sets the same record so an agent sees what the user sees. Overlay reference draws a saved
  capture over the live pane with a drag divider and an opacity slider, following the page's scroll; it never
  touches the page. Follow session (off by default) reloads the pane when its session goes from `working` to
  `done` or `idle`.

## Computer use

What it is, in plain words. Windows keeps a live list of every control on screen, with its name, type and position:
UI Automation. A computer-use tool reads that list plus a screenshot of one window, lets the model pick a control,
and sends the click or keystrokes to that window. Windows ships UI Automation itself, so MetaTrooper's driver needs
nothing installed (D71). It acts through each control's own built-in actions, so your mouse and keyboard stay yours
while it works.

- **The driver** (M6-15). One long-lived PowerShell helper per core, `core/src/desktop/uia-helper.ps1`, loads
  `UIAutomationClient` and a small C# class compiled with `Add-Type` for screenshots and window rectangles. It talks
  to the MCP server over a named pipe, one JSON request per line. Reading: the control tree from
  `AutomationElement.FromHandle` (role, Name, AutomationId, `BoundingRectangle` in physical pixels, `IsPassword`),
  and a window screenshot with `PrintWindow` (`PW_RENDERFULLCONTENT`), so a covered window still captures. Acting,
  in this order: the control's pattern (`InvokePattern.Invoke` for a click, `ValuePattern.SetValue` for type,
  `TogglePattern`, `SelectionItemPattern`, `ExpandCollapsePattern`, `ScrollPattern`); with no pattern, a
  background `PostMessage` of `WM_LBUTTONDOWN`/`WM_LBUTTONUP` at the control's centre, or `WM_CHAR` per character.
  `key` sends `WM_KEYDOWN`/`WM_KEYUP` with `PostMessage`. It never calls `SendInput`, which would move the real
  pointer and need focus. After each action it re-reads the control and returns `confirmed` (the value, toggle state
  or tree changed as expected) or `unverifiable`.
- **Upgrade path.** If the built-in driver fails on apps Wasif really uses, cua-driver can replace the helper behind
  the same tools (D71); nothing else changes.

What MetaTrooper adds around the driver:

- **Grants** (M6-15). A grant row binds a session to one window:

  ```sql
  CREATE TABLE grant (
    id           TEXT PRIMARY KEY,               -- 'gr_<ulid>'
    session_id   TEXT NOT NULL REFERENCES session(id),
    hwnd         INTEGER NOT NULL,
    pid          INTEGER NOT NULL,
    process_start TEXT NOT NULL,                 -- the process creation time, so a reused pid never matches
    exe          TEXT NOT NULL,
    title        TEXT NOT NULL,                  -- at grant time, shown on the tile
    created_at   TEXT NOT NULL,
    ended_at     TEXT                            -- window closed, process ended, revoked, or core restarted
  );
  ```

  A grant covers that window and the windows it owns (menus, combo popups, its own dialogs: `GetWindow(hwnd,
  GW_OWNER)` chains back to the granted window, same pid and process start). A standard file dialog (`#32770` with a
  file list) is covered but every input in it asks (D61). A grant ends when its window is destroyed, its process
  ends, the user revokes it on the tile, or the core restarts. Grants are made only from the workbench (`grant.window
  {session_id, hwnd}`, `ui.hello`): pick a window from a list, or drag the tile's "give window" handle onto it. The
  workbench window, its children, elevated windows and the secure desktop can never be granted.
- **The MCP server.** `metatrooper-desktop` is a stdio MCP server MetaTrooper attaches like `metatrooper-browser`.
  It finds its session by process ancestry. For every input it: (1) calls `approval.check` on the core pipe (grant,
  D61, D62); (2) calls `cursor.glide {session, target_rect_px, caption}` on the workbench pipe (`\\.\pipe\metatrooper-browser`,
  which the workbench already serves; this is its one new method) and waits for the reply, sent on the overlay's
  `arrived` or after `ms + 16`; (3) checks the pause flag again; (4) sends the action to the UI Automation helper. With the workbench
  closed every desktop tool fails with "desktop not available: the MetaTrooper workbench is closed", since approvals
  and the cursor need the window. Calls on a window outside the session's grants fail with "window not granted; ask the
  user to give it to you".
- **Tools** (`contracts/desktop-tools.md`): `windows` (granted windows only), `snapshot {window, max_nodes}` (UI
  Automation tree, refs as in the browser), `screenshot {window}` (JPEG, 1,568 px max side), `click {window, ref}`,
  `type {window, ref, text}`, `key {window, keys}`, `scroll`, `wait_for`. Each action result says `confirmed`,
  `unverifiable`, from the helper's re-read after the action.
- **Seeing it.** The agent's own cursor glides to each target (M6-18). While a session holds a grant, a thin frame in
  its colour outlines the window and the tile shows "driving: <window>".
- **Taking over** (D62). Ctrl+Alt+Q pauses all agent input everywhere, at dispatch.
- **Watching** (D70). Agents keep their auto mode. The wall's watch layout (Ctrl+Alt+W, meant for a second monitor)
  shows each granted window as a live thumbnail (Electron `desktopCapturer` per window, 2 frames a second) beside its
  agent's tile, with the agent's cursor drawn on it. The input watcher (M6-22) runs whenever any grant is live: a
  small helper process started by the core holds `WH_MOUSE_LL` and `WH_KEYBOARD_LL` hooks, reads the injected
  flag, and reports each injected event to the core over the pipe with its time and the foreground window. The core
  compares it with the in-flight `metatrooper-desktop` actions (by time, 200 ms slack) and, for unmatched injected
  input, raises the needs-you item and sets the pause flag (D70). The hook class runs its own thread with a Win32
  message loop (`GetMessage`, `TranslateMessage`, `DispatchMessage`), because low-level hooks deliver nothing
  without one and Windows removes a hook whose callback stalls past `LowLevelHooksTimeout`; the callback only queues
  the event and returns. It sees input sent with `SendInput`, `keybd_event` and `mouse_event`, which is what
  PowerShell and .NET `SendKeys` and most automation libraries use. The helper is a PowerShell script that compiles
  its hook class with `Add-Type` at start (no native module and no unsigned binary, as for the rest of the core);
  if Smart App Control or PowerShell policy blocks it, the wall shows "input watcher off" in orange on every
  granted tile. The same helper subscribes to UI Automation's desktop-wide events (`FocusChangedEvent`,
  `Window_WindowOpenedEvent`, `Invoke_InvokedEvent`) on its own thread. It reports an event only when
  `GetLastInputInfo` shows no physical input for 2 s and the core has no `metatrooper-desktop` action in flight;
  the core then raises "the desktop changed while you were away from it" naming the window, and pauses when
  `desktop.watch_pause` is on. Apps that change on their own (a toast, a timer, a download finishing) also trip it,
  so it only runs while a grant is live and each window can be muted for the session from the needs-you item.
- **Spike first** (M6-14, time-boxed to 1 day, nothing installed). On this laptop, with Smart App Control on, the
  helper: lists top-level windows (checked 2026-10-10: `UIAutomationClient` loads from plain PowerShell and lists
  them), reads Notepad's tree, captures Notepad with `PrintWindow` while it is covered, types into Notepad with
  `ValuePattern` while another window has focus without moving the pointer, clicks a Calculator button with
  `InvokePattern`, reaches Notepad's Save As as an owned window, gets an access error on an elevated window, and
  compiles its `Add-Type` class (the same check covers M6-22's hook helper). It also records which of five apps Wasif
  uses most expose usable patterns (names chosen at the spike). Each check is recorded pass or fail with the command
  and output. If pattern actions fail on most of those apps, the spike says so and D71's cua-driver upgrade is
  raised to Wasif as a question, not installed.
- **Agents test MetaTrooper** (M6-16). The workbench gets accessible names and roles on every control the wall uses.
  A `--demo` instance runs with its own `METATROOPER_HOME`, demo data only, no secrets and a fake approval key; its
  window is the only workbench window that can be granted, and only to a session of that demo core.

## The agent cursor (M6-18, D69)

One cursor per agent session, in the session's colour (the same colour as its tile), with a chip naming the agent
and its task (28 characters at most). It glides to each target like a person's mouse, the click fires the moment
it arrives, and a ripple and a one-line caption ("click Sign in", "type 14 characters", "press Enter") play after,
off the critical path. Typed text is never shown. The real pointer never moves.

- **One renderer, two hosts.** `workbench/renderer/overlay.js` draws cursors. Host 1 is the existing overlay view
  above each browser pane. Host 2 is one transparent, click-through, non-focusable Electron window per display for
  the desktop (`transparent`, `frame: false`, `focusable: false`, `skipTaskbar`, `setIgnoreMouseEvents(true)`,
  `showInactive()`), hidden when no agent is acting.
- **Flow.** Browser: the workbench main process already runs every browser tool, so it glides the pane cursor
  itself after `approval.check` allows. Desktop: `metatrooper-desktop` asks for the glide with `cursor.glide` on the
  workbench pipe (Computer use). In both, the workbench main process sends the overlay `{session, colour, label, from, to, targetRect, ms, caption, reducedMotion}`; the overlay plans the path
  once as timed samples, plays it by the clock, and replies `arrived`. Main fires the input on `arrived`, or at
  `ms + 16` if the reply is late. Repeated actions on the same target skip the glide.
- **Timing.** Glide time is `clamp(70 + 55 * log2(D / W + 1), 90, 220)` ms, D the distance and W the target width
  in pixels. Worked: a 600 px move to an 80 px button is 600 / 80 + 1 = 8.5; log2(8.5) = 3.09; 70 + 55 x 3.09 = 240,
  capped to 220 ms. A 40 px hop to a 120 px button is 40 / 120 + 1 = 1.33; log2(1.33) = 0.41; 70 + 22.6 = 93 ms.
  Added cost per action: at most 220 ms glide plus about 15 ms for the reply, so under 250 ms. The fixed sleep and
  read-back in `panes.ts:543-544` go.
- **Desktop placement.** The helper reports window and element rectangles (`BoundingRectangle`) in physical pixels; the workbench converts
  with `screen.screenToDipRect` and picks the display with `screen.getDisplayMatching`, one overlay window per
  display so mixed 100% and 150% screens stay sharp. It refits on `display-metrics-changed`, `display-added`,
  `display-removed`, and every 250 ms while a cursor shows. A minimised, closed or empty target hides the cursor; a
  jump over 25% of the display snaps instead of gliding. A target covered by another window still gets the cursor,
  drawn on top, and the caption adds "behind <window title>".
- **Z-order.** Only while an action is in flight: `setAlwaysOnTop(true, 'floating')` and `moveTop()`, re-asserted
  every 100 ms; 1.5 s after the last action, `setAlwaysOnTop(false)` and hide. Never left in the always-on-top band.
- **Out of the agent's screenshots.** `setContentProtection(true)` at creation, and one frame (about 16 ms) is
  waited after showing before the next agent screenshot. If protection is not available, the screenshot result says
  `overlay_may_show: true`. Pane cursors live in a separate view and never appear in page captures.
- **Many agents.** Each session's cursor stays; the latest mover draws on top. Idle for 5 s, a cursor fades over
  300 ms. Reduced motion (CSS and `systemPreferences.getAnimationSettings()`): snap and a 120 ms colour flash.
- **Settings.** `agent_cursor.mode`: `off`, `instant` (snap and ripple), `snappy` (default, above), `human` (slower
  curved paths with overshoot, for demos; breaks the 250 ms budget on purpose). `agent_cursor.show_caption` (true),
  `agent_cursor.idle_fade_ms` (5000), `agent_cursor.show_in_recordings` (false; true turns content protection off
  for `/demo-capture`).
- **Sources** (ideas, not code): trycua/cua's Windows overlay (motion planner, capture exclusion, idle fade; MIT),
  microsoft/playwright's action highlight, bytedance/UI-TARS-desktop's overlay window, Xetera/ghost-cursor's curved
  paths for the `human` preset.

## The split (M6-1, D53, D58, D59)

One session owns the split; nothing else merges to `main` while it runs.

1. Tag `main` as `pipelines-final` and push the tag. Git history keeps every leaving file.
2. Copy the code that is not yet in `../suite-of-products/shared/` there, keeping each file's path: `core/src/pipelines/`, `core/src/schedules.ts`, `pipelines/`,
   `workbench/renderer/layouts/`, `workbench/src/rundetail.ts`, `contracts/pipeline.schema.json`,
   `contracts/pipelines.md`, the pipeline plugins, and the test files sorted as "move".
3. First write `issues/m6-01-split-inventory.md`: every hit of `rg -n "Runner|runner\.|pipelines/|schedules|gate\.resolve|run\.(start|cancel|resume|clear|status)|variant|template\.list|rundetail|boardCapture|pipeline" core/src core/cli.ts workbench/src workbench/renderer`,
   one row each, marked move, remove, replace or keep (with why). Then change every stay-side caller: remove the runner, store sync and schedule
   timers from `main.ts`; drop `runner` from `CoreControl` and the pipeline methods from `methods.ts`; replace
   `workbench/src/main.ts`'s `paneData` import with the pane code it needs; remove `troop run` (keep `troop gate`, the adoption measurement); remove the Runs and Pipelines tabs and their actions from `app.js`; remove `boardCapture` and the
   `variant` half of the port query in `panes.ts` (ownership comes from M6-3; until it lands, agent panes reach no
   loopback port, which is safe).
4. Delete the leaving paths, including `pipelines/` (already copied to the products on 2026-10-10). `npm run build`
   and both default suites pass. Calls to removed methods return -32601 "moved to the pipeline products"; removed
   CLI commands print it and exit 2.
5. Pipeline tables and rows stay (D58). Schedules simply stop firing; their rows are kept.
6. GitHub issues for pipelines and any product repos on GitHub wait for Wasif (deferred, Hand-back).

## Milestone 6: the desk (about 92 CC days, freeze 2027-01-10, public 2027-02-03)

Replaces the rest of M5. Every M5 child is mapped in the re-baseline table below. Estimates were raised after both
review engines called the first draft too low.

### Children

| # | Title | Priority | Effort (CC days) | Depends on |
|---|---|---|---|---|
| M6-1 | Split the pipelines out | Critical | 3.5 | none |
| M6-2 | Approvals for agent actions | Critical | 3.0 | M6-1 |
| M6-3 | Session ports and dev-server previews | Critical | 1.5 | M6-1, M6-4 |
| M6-4 | Core reliability: lock order, settings writer, migrations, ping, restart owner | Critical | 2.0 | none |
| M6-5 | State from each engine's hooks, with the Codex trust spike | Critical | 3.5 | M6-4 |
| M6-6 | Everything comes back after a restart | Critical | 4.0 | M6-5 |
| M6-7 | Terminal speed and correctness | Critical | 5.0 | none |
| M6-8 | Agent input: Shift+Enter, image paste, links | High | 1.5 | M6-7 |
| M6-9 | Wall keys and attention | High | 2.0 | M6-1, M6-5 |
| M6-10 | Quiet, named notifications | Medium | 0.5 | M6-5 |
| M6-11 | Browser tools version 2 | Critical | 4.0 | M6-1 |
| M6-12 | Browser handoff, origins, secrets, audit | Critical | 3.5 | M6-2, M6-11 |
| M6-13 | Browser pane hygiene and picks | High | 2.0 | M6-11 |
| M6-14 | Computer-use spike on this laptop, built-in UI Automation | Critical | 1.0 | none |
| M6-15 | Computer use: `metatrooper-desktop`, grants, frame, take-over, watch layout | Critical | 12.0 | M6-2, M6-14 |
| M6-16 | Agents test the workbench through the desktop tools | Medium | 1.5 | M6-15, M6-18 |
| M6-17 | Public API: one method list, exact shapes, `session.wait` | High | 2.0 | M6-1 |
| M6-18 | Agent cursor for browser and desktop | Critical | 4.5 | M6-11, M6-15 |
| M6-19 | Search all terminals | High | 1.0 | M6-7 |
| M6-20 | Cost chip per tile | Medium | 0.5 | none |
| M6-21 | Changed files per tile | Medium | 1.0 | none |
| M6-22 | Input watcher: injected input and UI Automation changes from other programs | Critical | 4.5 | M6-14 |
| M6-23 | Comments that come back: threads, replies, source file, mark-up, cross-origin picks | High | 6.0 | M6-3, M6-11, M6-13 |
| M6-24 | Compare the page: device, rendering, reference overlay, follow session | High | 2.0 | M6-11 |
| M6-25 | True status, part 2: background work, StopFailure, interrupts, fatal patterns, opencode | Critical | 2.25 | M6-5 |
| M6-26 | Limits that carry on: resume at reset, early-end warning, continue in another engine | High | 2.5 | M6-25 |
| M6-27 | Context fill per tile | Medium | 0.75 | M6-20 |
| M5-9 | Release gate: two clean source-install runs and green CI | Critical | 0.5 | M6-1 |
| M5-10 | Public docs rewritten for the four parts | Critical | 1.0 | M6-1, M6-15 |
| M5-11 | Site and demo redone for the four parts | High | 0.75 | M6-18 |
| M5-15 | Notification sink settings UI (code done) | Medium | 0.5 | none |

Effort, worked:

- M6 children, M6-1 to M6-22 in table order: 3.5 + 3.0 + 1.5 + 2.0 + 3.5 + 4.0 + 5.0 + 1.5 + 2.0 + 0.5 + 4.0 + 3.5
  + 2.0 + 1.0 + 12.0 + 1.5 + 2.0 + 4.5 + 1.0 + 0.5 + 1.0 + 4.5 = 64.0 CC days (raised after round 2 for M6-1, M6-15,
  M6-18 and M6-22, which both engines named; M6-22 again for the UI Automation listener; M6-15 by 2.0 for the
  built-in driver, D71).
- Mined rival-angle children (D73), each idea sized S 0.25, M 0.75, L 1.5 from the idea mine:
  M6-23 = 1.5 source file + 1.5 threads and pins + 0.75 agent comment tools + 0.75 mark-up + 1.5 cross-origin picks
  = 6.0; M6-24 = 0.75 device + 0.75 reference overlay + 0.25 rendering + 0.25 follow session = 2.0; M6-25 = 0.25
  background work + 0.25 StopFailure + 0.75 interrupts + 0.25 fatal patterns + 0.75 opencode = 2.25; M6-26 = 0.75
  resume at reset + 0.25 early-end warning + 1.5 continue in another engine = 2.5; M6-27 = 0.75. Sum: 6.0 + 2.0 +
  2.25 + 2.5 + 0.75 = 13.5 CC days.
- Carried M5 work: M5-9 0.5 + M5-10 1.0 + M5-11 0.75 + M5-15 0.5 = 2.75 CC days (M5-1 and M5-2 wait, D72).
- Review, merge and two-engine checks, at 15% of the build: (64.0 + 13.5 + 2.75) x 0.15 = 80.25 x 0.15 = 12.0 CC
  days.
- Total: 80.25 + 12.0 = 92.25, about 92 CC days.
- Pace: M5 planned 30.85 CC days over 27 calendar days with four parallel sessions and paused with work unfinished,
  so this plan assumes 1 CC day per calendar day, limited by Wasif's review time, not by sessions.
- Calendar: 92 days from 2026-10-11 is 2027-01-10 (21 days left in October, 30 in November, 31 in December, 10 in
  January: 21 + 30 + 31 + 10 = 92). Freeze 2027-01-10 (D73). The same 24 days as before run to the public release
  on 2027-02-03 (21 more in January, 3 in February: 21 + 3 = 24) and hold the source-install runs on a second PC,
  the docs and site. There is no slack inside the 92 days, so the slip rule below is the buffer.

```
M6-1 split ─┬─> M6-2 approvals ─┬─> M6-12 browser handoff, origins, secrets
            │                   └─> M6-15 computer use ─┬─> M6-18 agent cursor ──> M6-16 self-test
            │       M6-14 spike ────────┘               └─> M5-10 docs
            ├─> M6-11 browser v2 ─┬─> M6-13 hygiene
            │                     └─> M6-18
            ├─> M6-17 public API
            └─> M5-9 source-install release runs
M6-4 reliability ─┬─> M6-3 ports
                  └─> M6-5 hook state ──> M6-6 comes back ──> M6-10 notifications
                                     └──> M6-9 wall keys
M6-7 terminal ──> M6-8 input, M6-19 search
M6-14 spike ──> M6-22 input watcher
M6-20 cost chip, M6-21 changed files, M5-15   (any time)
M6-20 ──> M6-27 context fill
M6-3, M6-11, M6-13 ──> M6-23 comments; M6-11 ──> M6-24 compare
M6-5 ──> M6-25 true status 2 ──> M6-26 limits
```

Why this order: the split goes first because every other child edits files that import the runner. Reliability
comes before ports and hook state because both add migrations and events into the database the lock fix protects.
Approvals come before the browser's origin rule and computer use, because both call `approval.check`. The spike
gates computer use because nobody has driven real apps through the built-in UI Automation helper here yet. The cursor comes after browser v2 and
computer use because it hooks the `approval.check` answer both of them send. The release runs start right after the
split so the source install is proven on a second PC well before the freeze.

Slip rule, decided now: on 2026-11-23, if fewer than half the Critical children are done, M6-16, M6-10, M6-20 (with
M6-27, which builds on it), M6-21, M5-15 and M6-13 (except its picked-element payload, which M6-23 builds on) move after the release, in
that order. If M6-14's spike fails, M6-15 builds the PowerShell
fallback at the same effort. Critical children never move; the dates move instead, by the days still owed.

### Re-baseline of M5

| M5 child | Goes |
|---|---|
| M5-0 re-baseline | Done; its pipeline rows move with the split |
| M5-9 release gate | Stays, for the source install (above) |
| M5-1 installer, M5-2 signing | Wait for real users (D72); `agent/m5-1` keeps the WIP |
| M5-3 first run, M5-4 logs, M5-5 Linux beta, M5-8 security, M5-12 remote MCP, M5-13 importers, M5-14 engines as data, M5-19 one instruction file | Done; stay in the product |
| M5-10 docs, M5-11 site | Done for the old scope; redone (above) |
| M5-15 notification sink | Code stays; settings UI owed (above) |
| M5-6 Pro review loop, M5-17 pipeline hardening, M5-18 catalogue cut, M5-20, M5-21 | Move with the pipelines |
| M5-7 Pro licence, M5-16 issue trigger | Cut (D64; the trigger starts pipelines) |

## Acceptance criteria

Carried and still binding, full text in the archived spec: M1-01, M1-04 to M1-17, M1-22 to M1-25c, M1-27, M1-28,
M1-30, M1-33 to M1-37, M1-39. M5-01a (installer on a clean machine) waits with the installer (D72); instead,
M6-00a: on a second Windows PC with Smart App Control on, the README's source-install steps start a claude agent
on the wall within 10 minutes of `git clone`. The pipeline
criteria (M1-18 to M1-21, M1-26, M1-31, M1-38, M2, M3, M4) move with the split.

- M6-01a. After the split, every row of `issues/m6-01-split-inventory.md` is closed, and re-running its `rg`
  command returns only rows marked keep; `npm run build` and both default suites pass; `troop run start` prints "moved to
  the pipeline products" and exits 2; `core.ping` still answers.
- M6-01b. `../suite-of-products/shared/core/src/pipelines/runner.ts` exists and matches the tagged copy; the tag
  `pipelines-final` exists on MetaTrooper's origin.
- M6-02a. A browser `click` on a fixture button named "Send" creates one `approval` row in `waiting` and the call
  returns only after `approval.resolve`; rejected, the button's handler never runs (fixture counter stays 0).
- M6-02b. Focusing that button and calling `key {keys: "Enter"}` also creates an approval. Typing a string matching
  a credential pattern into a plain text field also creates one.
- M6-02c. `approval.resolve` without `ui.hello` returns -32012. A pending approval left 120 s returns "not approved
  in time" and the row reads `expired`.
- M6-02d. Approve for this session on a plain button covers the next click on it with no new row; renaming the
  button in the fixture voids it and asks again; typing into a password field asks every time.
- M6-02e. The same action computed in the MCP server and in the core gives the same `action_hash` (shared test
  vector in `contracts/approvals.md`).
- M6-03a. A fixture dev server started in a session's terminal prints its URL; within 2 s a `session_dev_server` row
  with `matched_by: ancestry` exists, the tile shows "Open preview", and that session's agent pane loads it.
- M6-03b. A fixture `npm run dev` that starts a detached child gets a `printed` row and the same result. A port
  served by a process started outside MetaTrooper before the URL was printed is blocked for agent panes.
- M6-03c. A user pane loads `http://localhost:<any listening port>` typed by hand; no agent tool can drive that pane.
- M6-04a. Starting a second core while one runs exits with "core already running (pid N)" before it opens
  `troop.db` (the database file's mtime is unchanged and a fixture command left `accepted` runs exactly once).
- M6-04b. A `settings.json` holding invalid JSON is left byte-identical after the workbench changes a setting, and
  the workbench shows "settings.json does not parse, line N". A valid change writes the new value; killing the core
  between the temp write and the rename leaves the old file valid and the next start removes the temp file.
- M6-04c. A database at the M5 schema opens under the new code, applies its numbered migrations once, and opens
  again with no change.
- M6-05a. A Codex session shows `waiting_for_you` within 2 s of a PermissionRequest and `done` within 2 s of Stop on
  the M1-12 fixtures, and never shows `done` while an approval prompt is on screen. Fallback branch, used only if
  the spike's result file says neither trust path works: `waiting_for_you` within 2 s of the approval prompt's title
  or bell, and the gap is in Known limits.
- M6-05b. A Gemini CLI session gets a `native_id` and shows `waiting_for_you` and `done` from its hooks;
  `~/.gemini/settings.json` is byte-identical afterwards and the per-session file is gone.
- M6-05c. A Claude session in a permission wait stays `waiting_for_you` through a PreToolUse for a different
  `tool_use_id`, and moves to `working` on the PostToolUse of the waited call.
- M6-06a. With 4 live sessions (claude, codex, gemini, a shell), killing the core and the workbench and starting
  them again brings all 4 back in their tiles, in the same layout, within 30 s, never more than 3 resuming at once.
- M6-06b. An engine whose resume fails twice with its `auth_error` output stops being resumed and raises one
  needs-you item. A session that exited shows its saved last screen.
- M6-07a. Printing a 50 MB file in one tile keeps every other tile's input echo under 100 ms (long-task observer),
  and the core's memory grows by less than 64 MB during it.
- M6-07b. With no workbench attached, a fixture program that sends a cursor-position query gets its answer.
- M6-08a. Shift+Enter in a Claude, Codex and Gemini tile inserts a newline and does not submit, checked on each live
  CLI.
- M6-09a. Alt+J focuses the session with the smallest `since`. A key press in the big tile, then a second session
  starts waiting: the big slot stays unchanged for 3 s, then the waiting tile glides in.
- M6-11a. Two snapshots of an unchanged page give the same refs; after one element is removed its old ref fails with
  "no longer on the page" and `since_last` lists it as removed; after the frame navigates, every old ref in that
  frame fails.
- M6-11b. A fixture page with a same-origin iframe and an open shadow root shows controls from both, and clicking a
  frame-tagged ref clicks inside the frame.
- M6-11c. A 4,000-token budget on a 20,000-node fixture returns at most 4,000 tokens and a `continue` cursor that
  returns the rest.
- M6-12a. `handoff` makes every other browser tool fail with "the user has the pane" until Give back.
- M6-12b. `type` with `{{secret:NAME}}` into a password field on the saved origin fills it; on another origin or a
  plain field it fails; the value appears in no `event` row, log, tool result, approval row or crop (marker test as
  M1-05).
- M6-14a. The spike's checks are recorded pass or fail in `issues/m6-14-computer-use-spike.md` with the commands run
  and their output, within 1 day of starting.
- M6-15a. A session granted Notepad types into it while another app has focus, and the pointer does not move. The
  same session acting on Calculator (not granted) gets "window not granted". Notepad's Save As dialog is reachable
  and every input in it raises an approval.
- M6-15b. Ctrl+Alt+Q while an agent types a 2,000-character string: after the core acknowledges the pause, no
  further character reaches Notepad (checked by comparing the file text at the acknowledgement and 2 s later).
- M6-15c. The workbench window never appears in `windows`, and a direct call naming its handle fails. Closing a
  granted window ends its grant; a new window that gets the same handle is not granted. After a core restart, no
  grant is live.
- M6-16a. An agent drives a `--demo` workbench: opens a tile, approves a card, reads the "Open preview" chip; no
  screenshot shows a real session, and the demo core cannot see the real database.
- M6-17a. The generated method table, `troop --help` and the skill list the same methods as `methods.ts`; a test
  fails when one is edited by hand.
- M6-17b. `session.wait` returns within 1 s of the state change, at once when already in the state, at the timeout
  when it never comes, and -32602 for an empty `states` or a `timeout_ms` of 0.
- M6-18a. In a browser pane and in Notepad, every click and type shows the session's own cursor arriving at the
  target before the input lands, measured from the overlay's `arrived` message and the input time; the added time
  per action is under 250 ms at the 95th percentile over 100 actions.
- M6-18b. Two agents acting at once show two cursors in their own colours. The real pointer's position is unchanged
  throughout (read before and after).
- M6-18c. An agent screenshot taken while its cursor is visible does not show the cursor (pixel check at the cursor's
  position), or the result carries `overlay_may_show: true`.
- M6-18d. On two displays at 100% and 150%, the cursor lands within 3 px of the target after the target window is
  dragged from one display to the other.
- M6-19a. A unique marker printed in one of 4 tiles is found by Ctrl+K within 1 s and opens that tile at the line.
- M6-20a. A Claude tile's cost chip equals the session's tokens in `usage`; an engine with no usage shows "usage
  unknown".
- M6-21a. A session that edits 3 files shows "3 changed"; committing one shows "2 changed".
- M6-22a. With a grant live, a fixture PowerShell `SendKeys` run from an agent's terminal raises one "input from
  another program" needs-you item within 1 s and sets the pause flag; a `metatrooper-desktop` `type` in the same
  window raises none.
- M6-22b. With the helper blocked (fixture policy), every granted tile shows "input watcher off".
- M6-22c. With a grant live and no physical input for 5 s, a fixture script that clicks a button in another app
  through UI Automation `InvokePattern` raises one "the desktop changed while you were away from it" item within
  1 s; the same script while the tester is typing raises none.
- M6-23a. An agent calls `comments`, gets the user's open note, replies and resolves it; the pane's pin turns green
  and shows the reply, and the row reads resolved.
- M6-23b. A pick on a fixture React app served from an owned dev port names `<PricingCard>` and its `file:line`; the
  same app on a non-owned origin gets no stub (no `__REACT_DEVTOOLS_GLOBAL_HOOK__` defined by MetaTrooper) and no
  source line.
- M6-23c. A pick inside a cross-origin iframe returns that element, a crop of it, and the frame URL.
- M6-23d. A mark-up with an arrow and a box saves one PNG under 2 MB into the comment row.
- M6-24a. Device iPhone preset, then a navigation: the page still reports `innerWidth` 390. `emulate {color_scheme:
  "dark"}` makes `matchMedia('(prefers-color-scheme: dark)')` true on the next snapshot.
- M6-24b. With Follow session on, a session moving from `working` to `done` reloads its shown pane once.
- M6-25a. A Claude `Stop` fixture with a running `subagent` background task leaves the session `working`; 10 minutes
  with no event (fake clock) moves it to `done`.
- M6-25b. A `claude.StopFailure` fixture shows `waiting_for_you` with reason `stopped: rate_limit`.
- M6-25c. Escape in a working fixture session whose title then matches the idle pattern within 5 s gives `idle` and
  one `core.interrupted` event.
- M6-25d. A fixture engine printing a `fatal_patterns` string and then nothing for 60 s raises one needs-you item
  naming the pattern; no screen text is stored in it.
- M6-25e. An opencode session shows `working` and `done` from its plugin, not from its title.
- M6-26a. A limit-hit fixture whose `resets_at` passes (fake clock) gets "Continue where you left off." pasted exactly
  once; a core restart after that does not paste it again; with the tile's toggle off, nothing is pasted.
- M6-26b. Six readings 10 minutes apart rising from 40% to 90%, with the reset 2 h after the last one, raise one
  early-end item naming a time 10 minutes after the last reading. Worked: slope = (90 - 40) / 50 minutes = 1 point
  per minute; (100 - 90) / 1 = 10 minutes, which is before the reset, so the item fires.
- M6-26c. "Continue in Codex" writes a handoff file of at most 6 KB holding the task line and changed files, and a
  Codex session starts with it as the prompt.
- M6-27a. A Claude tile whose last turn used 170,000 of a 200,000-token window shows 85% in orange with "compacts
  soon"; an engine with no usage shows no context chip.

## Testing

Codex writes the tests for M6-2, M6-4, M6-5, M6-6, M6-11, M6-12, M6-15, M6-18, M6-22, M6-23, M6-25 and M6-26 (D65), with a mutation run per child
that must fail at least one test. Conformance suites stay for `schema.sql`, the manifest schema and the pipe
protocol, plus new ones for `approvals.md` (including the hash test vector), `desktop-tools.md` and
`agent-cursor.md`.

| Layer | What | Count |
|---|---|---|
| Unit | D61 rule matching (names, AutomationId, keys, credential text, file dialogs); approval scopes, expiry, re-check; action hash vector; port ownership by ancestry and by print; dev-server URL parsing; title states; resume stagger and breaker; ref lifetime; token budget; secret placeholder rules; migrations; glide timing formula; grant ownership chain | +50 |
| Integration | Codex and Gemini hook round trips; approval over the pipe; dev server to an owned preview; core kill and resume of 4 sessions; flow control under a 50 MB burst; grant enforcement and take-over against a fake driver; cursor `arrived` before input; settings crash between write and rename | +22 |
| E2E | the M6-16 demo run; a browser handoff login on a fixture; a Notepad typing run with take-over on the laptop; two cursors at once | +4 |
| Conformance | approvals, desktop tools, agent cursor | +3 suites |

## Rollback

- The split: the tag `pipelines-final` restores every removed path (`git checkout pipelines-final -- <path>`).
- Each child lands as its own commit and reverts alone.
- Migrations only add tables in this epic; pipeline tables and rows stay (D58), so older code opens the database.
- Computer use: disabling the `desktop` plugin detaches `metatrooper-desktop` and stops the UI Automation helper;
  nothing was installed. The agent cursor: `agent_cursor.mode: off`.
- Codex and Gemini hooks: per launch only, nothing written to their global config; the Gemini file is deleted with
  the session.

## Dependencies

| Package | Licence | Stars | Use |
|---|---|---|---|
| electron | MIT | 123,297 (2026-09-29) | workbench, overlay windows |
| @xterm/xterm and addons | MIT | 21,253 (2026-10-05) | terminals, an existing exception |
| electron-builder | MIT | 14,670 (2026-10-09) | build-time only (M5-D21) |

No new runtime dependency. Computer use runs on Windows' built-in UI Automation (D71); cua-driver (trycua/cua, MIT,
29,237 stars, 2026-10-10) is the named upgrade, not installed.

## Files

| Path | Change |
|---|---|
| `core/src/approvals.ts` | new: `approval.check`, D61 rules, scopes, expiry, hash, take-over flag |
| `core/src/grants.ts` | new: grant rows, ownership chain, ending grants |
| `core/src/watch/input-hook.ps1`, `core/src/watch/watcher.ts` | new: the input watcher helper and its matcher |
| `core/src/methods.ts` | method declarations with schemas, `stable`, `needs_ui`; `approval.*`, `grant.*`, `settings.set`, `session.wait`; pipeline methods removed |
| `core/src/main.ts` | lock before database; runner, store sync and schedule timers removed |
| `core/src/events/state.ts` | Codex and Gemini events, sticky permission wait, title states, `reason` and `since` |
| `core/src/hooks/install.ts` | per-launch Codex hooks, Gemini settings file, version-chosen Claude events |
| `core/src/sessions/resume-all.ts` | new: resume after restart |
| `core/src/terminal/index.ts`, `core/src/terminal/pipe.ts` | query answering, byte credit, pty pause, last-screen save, dev-server URL scan |
| `core/src/browser/policy.ts`, `core/src/ports.ts` | ownership from `session_dev_server`, leases from `session_port` |
| `core/src/settings.ts`, `core/src/store/db.ts`, `core/src/store/migrations/` | single writer, safe writes, numbered migrations |
| `core/src/hook/browser-mcp.ts`, `workbench/src/browser/panes.ts` | browser tools version 2, `approval.check`, handoff, secrets, audit, cursor timing |
| `core/src/hook/desktop-mcp.ts` | new: `metatrooper-desktop`, grants, approval and cursor calls |
| `core/src/desktop/uia-helper.ps1` | new: the built-in UI Automation driver (D71) |
| `workbench/renderer/overlay.js`, `overlay.css`, `overlay.html` | the agent cursor renderer |
| `workbench/src/desktop-overlay.ts` | new: per-display overlay windows, refit, z-order, content protection |
| `workbench/renderer/wall.js`, `app.js`, `terminal.js` | keys, focus rule, chips, approval cards, input, WebGL pool, search, context chip, limit toggle and "Continue in"; Runs and Pipelines tabs removed |
| `workbench/src/browser/source.ts`, `workbench/renderer/markup.js` | new: devtools-hook stub and fiber walk for owned dev ports (D74); mark-up tools (M6-23) |
| `workbench/src/browser/emulation.ts` | new: per-pane device and rendering record, reference overlay (M6-24) |
| `core/src/sessions/limit-resume.ts`, `core/src/sessions/handoff.ts` | new: resume at reset, early-end warning, handoff file (M6-26) |
| `engines/plugins/opencode-state.js` | new: opencode state reporter (M6-25) |
| `workbench/src/main.ts` | take-over hotkey, `settings.set`, `paneData` import removed |
| `contracts/approvals.md`, `contracts/desktop-tools.md`, `contracts/agent-cursor.md` | new |
| `contracts/browser-tools.md`, `contracts/pipe-protocol.md`, `contracts/events-and-hooks.md`, `contracts/schema.sql` | updated |
| `issues/m6-*.md` | one file per child |
| `issues/` | only M6 children and the carried M5 work; finished desk history in `issues/archive/` |

## Known limits

- D61's control-name list is English only; other languages rely on the first-input and credential rules.
- An app that draws its own controls without UI Automation (some games, some custom toolkits) shows no tree; the
  agent gets screenshots only and every click there asks (first input in an unknown control).
- Exclusive fullscreen apps may hide the desktop cursor overlay.
- Grants and approvals do not stop a hostile process running as the user (Threat model).
- An auto-mode agent can script the desktop through its own shell (D70). The input watcher catches injected input
  but cannot name the program that sent it. Input sent as window messages (`PostMessage`, `SendMessage`) or through
  UI Automation patterns (`InvokePattern`, `ValuePattern`) makes no input event and is not seen, so an agent's own
  UI Automation script is caught only by the away-from-desktop listener: it fires on focus, new windows and
  invoked controls, but not on a value set silently in a window that keeps focus (`ValuePattern.SetValue`), and it
  stays quiet while the user is actively using the machine.

## Hand-back (only Wasif)

Deferred by Wasif on 2026-10-10, nothing waits on them before the freeze:

1. GitHub homes for the pipeline products and where pipeline GitHub issues go.
2. A second Windows PC for the source-install run (M6-00a). No certificate now (D72).

## Out of scope

- Pipelines, run layouts, schedules, the template gallery, Pro, the pipeline plugins: they move (D53, D64).
- Which pipelines become which app, and whether MetaTrooper also ships as an SDK: decided when the first pipeline
  app is specced.
- A Linux desktop sandbox for computer use (Xvfb and noVNC in Docker): after the release.
- A vision or grounding model of MetaTrooper's own.
- Localised D61 control names.
- Phone control and the metered cloud: later epics.
- macOS testing.

## After the release (D73)

Mined 2026-10-10 and checked against this spec; each line names its idea in the idea mine (`<lane> <n>`). They
are not in Milestone 6 and get specced after the release.

- Browser tools: per-session tool presets that hide tools not held (browser-control 4); screenshots with numbered
  boxes (10); a `batch` tool (11); WebMCP page tools (12); wider `wait_for` and one isolated world per document
  (15); lend a login to an agent pane (16); covered and off-screen tags (19).
- Browser pane: re-arm CDP after a detach and docked DevTools (browser-pane 13); Google sign-in and passkeys (16).
- Core: terminals that survive a core upgrade in a pty host (core-services 3); retention prune for all event and
  command rows (9); redaction rules as data with keyword gates (11); WAL truncate by size (12); dev-server ports by
  bind test (13); Gemini usage from hooks (core-sessions 2); limits read by probe (7); regex caps for user patterns
  (12); stale hook repair (13); `taskkill /T` after a kill (14); bundled ConPTY (core 5); taskbar flash and idle-held
  sinks (core 8); turn bases as hidden refs (9); confirm a typed prompt took (10); exit ladder (12); copy ignored
  config into new worktrees (13).
- Wall: splitters with a preview line (wall-layout 4); layout fractions (5); Ctrl+K fuzzy ranking (6); cross-fade
  on reflow (7); snap to a bar below minimum size (8); layout by pane count (9); drag a header to pair or swap (12);
  "+N more" fold stack (13); where new agents land (15); no wheel on unfocused tiles (16).
- Terminal: multi-line paste as bracketed paste (wall-terminal 7); OSC 133 shell integration (8); leading-edge
  output batching (10); OSC 9 and 777 status (11); leading-edge resize (12); copy last command output (13); Unicode
  graphemes (14); Ctrl+F in one tile (15); screen-reader mode (16); compose box (17); viewport anchor on clear (18).

## Related

- The pipeline-IDE spec this replaced: `../suite-of-products/shared/spec-2026-09-29-pipeline-ide.md`.
- Review of this spec: `~/.cache/claude-scratch/metatrooper-respec-2026-10-10/review.html` (Codex and Gemini,
  reconciled).
- Idea mine, rival research and cursor design: `~/.cache/claude-scratch/metatrooper-idea-mine-2026-10-10/`
  (board.html, `<lane>/ideas.json`, `differentiate/*.json`, `computer-use/report.json`, `agent-cursor/design.md`).
- Orca `github.com/stablyai/orca`, cua `github.com/trycua/cua`: prior art.
