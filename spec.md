# MetaTrooper: pipeline IDE, epic

Drafted 2026-09-29 through `/gstack-spec`; rewritten 2026-09-29T15:30+10:00 after a Codex (3/10) and Gemini
(2/10) executability review. Status: draft, waiting for Wasif's confirmation and a re-score.

Exact formats live in `contracts/`. This file says what to build and why; the contracts say precisely how
the pieces talk. Where they differ, the contract wins and this file is the bug.

| Contract | Covers |
|---|---|
| `contracts/schema.sql` | every table, column, key and owner (loads cleanly in `node:sqlite`, checked 2026-09-29) |
| `contracts/events-and-hooks.md` | event kinds and payloads, session linking, state mapping, hook install, UserPromptSubmit output, Codex notify wrapper |
| `contracts/pipe-protocol.md` | named-pipe framing, JSON-RPC methods, error codes, queue fallback, access |
| `contracts/pipeline.schema.json` and `contracts/pipelines.md` | pipeline file format and how a run executes it |
| `contracts/plugin-manifest.schema.json` and `contracts/plugins.md` | plugin manifest, permissions, action process contract, pane bridge, importers |
| `contracts/browser-tools.md` | the 13 `metatrooper-browser` tools, capture, and the browser safety rules |

## Context

MetaTrooper is a desktop IDE for any coding assistant (Claude Code, Codex, Gemini, or any CLI a plugin
adds). Each assistant runs in a terminal inside the app, owned by the core service, with its results opening
beside it. Work flows through pipelines anyone can define, across 12 lanes from coding to video
to study. It is built for Wasif first, and for anyone to point at a project of their choosing, as an
open-source product (AGPL-3.0 core) whose local use is free and whose later cloud services are metered. The
scope is wide on purpose. It ships in three milestones so nothing is built on a core that has not survived
daily use.

Evidence (`ide-layer-research/pipeline-map.html`, `ide-layer-research/pipeline-catalog.md`):

- One loop is 67.6% of Wasif's AI work: ACU 130 + uni 45 + projects 34 + frontend 25 = 234 of 346 sessions
  (2026-06-01 to 2026-09-29).
- It leaks time in three measured places:

| Friction | Measured |
|---|---|
| Visual redo loops | 36 corrections, 12 pasted screenshots, 29 "show me / run it" asks |
| Engine plumbing | 26 of 183 engine runs (14.2%) were smoke tests; 22 plugin, MCP and login commands |
| Lost place | 38 `/clear`, 12 `/resume`, 22 "continue", 24 status asks; 58% of prompts sent while another session was live |

- Shell output is 63.2% of his agent tokens; a 400-token cap has a 34.7% saving ceiling
  (`projects/callrouter/docs/measurement.md`).
- Two market scans agree the unmet needs across pipelines are: a stop before anything external, seeing what
  the agent actually did, memory per project, Windows support with no forced login and your own
  subscription, and spend control.
- The 25 most popular real pipelines, ranked with sources, are in the catalog. Top: Spec to PR
  (obra/superpowers, 292,523 stars), website build (131,282 stars), multi-platform posts (n8n template,
  205,470 views).

## Decisions

| # | Decision | Chosen |
|---|---|---|
| D4 | Relation to callrouter | Separate project; callrouter plugs in |
| D5 | How assistants run | Real interactive CLIs; never `claude -p` or the Agent SDK for agent steps |
| D7 | Done measure | Usage and friction numbers over 14 days (adoption gate after milestone 1) |
| D10 | Shells | Node core service; Electron workbench; Tauri tray companion |
| D11 | Call log | Callrouter Plan A C1 writes `callrouter.db`; the IDE only reads it |
| D13, D14 | Browser | Shared live browser with visible agent cursors, an inspiration board, parallel variants |
| D15 | Plugins | Native `troop-plugin.json` plus importers for Claude Code plugins and Codex/agy MCP and skills |
| D16 | Pipelines | `pipeline.json` with a form editor, plus optional TypeScript code steps |
| D17 | Tokens | Live meter, callrouter Plan A as the first plugin, cheapest-capable-engine routing |
| D19 | Terminals | In-app terminals owned by the core service (node-pty over ConPTY); the window only shows them, and close and reopen reattaches. Revised 2026-10-02 by the UI revision (issues/archive/ui-revision-epic.md D1) |
| D21 | Browser MCP | Own `metatrooper-browser` MCP, no WebSocket |
| D24 | Transport | Direct database reads; hooks append events; commands over a named pipe with a queue fallback. No TCP port, token file, WebSocket or SSE |
| D25, D27 | Pipelines shipped | 17 working built-ins across 12 lanes; the other 17 catalog pipelines as templates |
| D28 | Business model | Open core: the local IDE is free with no account; only things Wasif hosts and pays for are metered |
| D29 | Cloud | Seams in this epic; the metered cloud is its own later epic |
| D30 | Licence | Core AGPL-3.0; SDK, manifest schema, contracts for plugins, and pipeline files MIT |
| D32 | herdr | Dropped 2026-10-02 (UI revision D8): one way to run agents |
| D33 | Borrowed | Usage limits and reset timers, done vs idle, free SignPath signing, diff annotation, file drag, an agent-native CLI and skill |
| D35 | Step handoff | Files between steps always; each agent step starts a fresh session with its prompt; `continue: true` falls back to a fresh session with a visible note |
| D36 | Review fixes | Contracts pack, contradiction cleanup, security hardening, operational fixes: all applied |
| D37 | Scope | Keep all 31 children, ship in 3 milestones; sandbox-host added 2026-09-29 (D43) |
| D40 | Phone | Using the terminals and the IDE from a phone (like Claude Code Remote Control) is a v3 epic, after the cloud epic |
| D41 | Approval profiles | Per-engine registry data: `ask`, `edits`, `contained`, and `isolated` (sandbox host only). `contained` is the default on a MetaTrooper worktree (2026-09-29). Elsewhere the default is the `sessions.approval` setting, `contained` out of the box (Wasif, 2026-10-05: every terminal starts in its engine's auto mode); an engine with no profile of that name starts in `ask`. Pipeline steps keep their own `approval` field |
| D42 | Worktree trust | `worktree.create` marks the new worktree trusted in every engine that declares a trust store in its registry entry; the core names no engine (2026-09-29); removing a worktree removes those entries again with `untrustFolder` (2026-10-08) |
| D43 | Trooper sandbox | Own container host plugin, child sandbox-host in milestone 2, built after the adoption gate. Ideas from AIO Sandbox and CubeSandbox, neither adopted; read-only login mounts plus an egress allow-list; agy logs in once into a keyring volume (2026-09-29) |
| D44 | Workbench screen | A wall of tiled live terminals with the list behind Ctrl+B, floating search on Ctrl+K and gates in a bottom sheet; each pipeline run shown in one of 15 layouts. Core approved 2026-10-04, pipeline screens 2026-10-05. Replaces layout A (archived UI revision D2, D3, D10, D15). See Workbench and Pipeline UI |
| D45 | Default project | `projects.default` setting, opened at core start. Superseded the same day by D46: the vault, including `work/ACU`, now opens (2026-10-05) |
| D46 | ACU access | Wasif, 2026-10-05: open the whole vault including `work/ACU`, as Claude Code already does. Sessions whose folder is in or contains `work/ACU` always start in `ask` (every tool call needs his OK), whatever approval was requested, so auto mode and unattended Codex or agy never touch ACU unasked. Replaces the M1-30 refusal |
| D47 | Claude drives agy | Wasif, 2026-10-05: agy stalls in pipeline steps, so an agent step whose engine is agy runs as a claude session (the driver) that hands agy the step prompt in print mode (`agy --print`), checks the output file's front matter after each turn, sends a follow-up naming what is missing, and after 3 turns writes `status: failed` with the reason. The driver never does the step's work. A driven step with no `approval` runs `contained` (driver claude in auto mode, agy with `--mode accept-edits --sandbox`); in or around `work/ACU` both run `ask` (D46). While the driver session is still working, an output with `status: done` but missing keys does not fail the step; the driver gets its turns first. A driver engine that is not usable logs `driver unavailable` and the step runs agy directly. The engine field `driver` turns it on; the session row keeps `driven_engine`; the tile reads `claude > agy`. Wall launches of agy stay plain terminals. Superseded 2026-10-08 by D51 |
| D48 | External engines near ACU | Wasif, 2026-10-05: engines flagged `ask_near_acu` (codex and agy, which send to OpenAI and Google) start in `ask` in any folder that sits under a tree containing `work/ACU`, such as a project inside the vault, because one shell command reaches ACU from there. claude keeps the requested approval there, as in his own Claude Code; D46 still makes every engine ask in or around `work/ACU` itself |
| D49 | Launch and close | Wasif, 2026-10-05: open it like VS Code. `workbench/bin/install-launcher.ps1` adds a `metatrooper` command (`metatrooper .` opens that folder as the project) and Start menu and desktop shortcuts. The window starts the core when none answers, without the parent Claude Code session's variables. Closing asks Keep running / Stop everything only when the window started the core and agents or runs are open (Keep is the default); an idle own core is stopped; a core started elsewhere is left alone. Ctrl+K has Restart core and Stop core. Chosen by Codex and Gemini independently (both B) |
| D50 | First user, distro and accounts | Wasif, 2026-10-07: a first outside user exists. Distribution waits on the signed installer (#31, SignPath); no unsigned release in the meantime. Accounts with sign-in are wanted, but in the cloud milestone with the gateway and sync, not now; this epic stays `signed_out`. Next work is the UI port, phases D and E |
| D51 | agy print loop | Wasif, 2026-10-08: the claude driver (D47) cost about $0.56 a step and retried an identical auto-denied agy call 3 times, so a plain code loop replaces it, with no model. An agent step whose engine has `print_args` (agy) launches that engine itself as the session: `agy <approval flags> --print <step prompt> --print-timeout 0 --output-format text --add-dir <cwd> --add-dir <run folder>`, and keeps the prompt beside the output as `<step>.prompt.md`. A step with no `approval` runs `contained`; D46 and D48 still force `ask`. While the session runs, `status: done` with missing keys does not fail the step. When the session exits without meeting the output contract, the runner launches one more session, unless the error text (the runner's error plus the terminal's last line) contains `auto-denied` or equals the `reason` of the failed output the previous attempt left; after the last attempt it writes `status: failed` with that reason. `driven_engine` stays in the schema and is no longer written. Wall launches of agy stay plain terminals |

## Current state, verified 2026-09-29

- `projects/metatrooper/` holds research, this spec and `contracts/`. No code. Outside vault git
  (`.gitignore:15`); it becomes its own repo.
- Callrouter: specified, not built. Plan A is C1 foundation (12 h), C9 replay (8 h), C7 rewrite and cap
  (10 h) (`projects/callrouter/docs/spec.md:28-47`). Python.
- sprawll: `projects/sprawll/harness/` is empty on laptop-ops.
- Agent-Reach 1.5.0 works through `~/.local/bin/agent-reach` (a bash wrapper added 2026-09-29).
- Installed and checked: Windows Terminal 1.24.11911.0, Claude Code 2.1.284, codex-cli 0.155.1, agy 1.2.12,
  gh 2.93.0, Vercel CLI 59.13.1, ffmpeg 9.0.1, yt-dlp 2026.08.19 (through uv's Python), node 24.16.0.
- Gemini CLI state: 76 `conversations/*.db` files and 76 `brain/<id>/.system_generated/logs` folders under
  `~/.gemini/antigravity-cli/`.
- `~/.codex/config.toml:11` sets `notify` to Codex's computer-use helper.
- Smart App Control is in enforce mode. Stock npm `electron.exe` 44.4.5 launches. uv's `~/.local/bin` shims
  are blocked. A packaged app or self-built Tauri or native binary is expected to be blocked until signed.

## Architecture

```
 +--------------------------------+   +-------------------------+   +-------------------+
 | Electron workbench             |   | Tauri tray (milestone 3)|   | troop CLI         |
 | wall of live terminals         |   | lights, needs-you, meter|   | (agents use it)   |
 | pipeline layouts, gate sheet   |   +-----+-------------+-----+   +----+---------+----+
 +----+-------------+-------------+         |             |              |         |
      | reads       | commands              | reads       | commands     | reads   | commands
      | direct      | \\.\pipe\metatrooper| direct      |              | direct  |
      v             +-----------------------+-------------+--------------+---------+
 +----+--------------------------------------------------+
 | ~/.metatrooper/troop.db (SQLite, WAL)             |<---- hooks, launch.js, codex notify
 | core-owned tables  |  queue tables: event, command,   |      append `event` rows (250 ms budget,
 |                    |  comment                          |      exit 0 always)
 +----+--------------------------------------------------+
      ^ sole writer of core-owned tables
 +----+--------------------------------------------------+
 | core service (node 24, TypeScript)                    |
 | event processor | state machine | launcher | runner    |
 | plugins | schedules | meter | limits | reads callrouter.db
 +----+--------------------------------------------------+
      | node-pty (ConPTY), one pty per session; bytes to the window over the terminal pipe
      v
 +--------------------------------------------------------+
 | in-app terminals: headless xterm keeps 10,000 rows per  |
 | session; the workbench draws them with xterm.js         |
 +--------------------------------------------------------+

 Agents -> metatrooper-browser (stdio MCP) -> \\.\pipe\metatrooper-browser -> workbench browser panes
```

### Rules

1. **The agent's terminal never depends on the window.** Each assistant runs in a pty owned by the core
   service. Closing or crashing the workbench leaves every agent working, and reopening it reattaches with
   scrollback. Killing the core ends its terminals: every live session becomes `exited` and shows one-click
   Resume through the engine's own resume flag (revised 2026-10-02, UI revision D1 and D9).
2. **Logic lives in the core service.** Shells read the database and send commands; they never decide.
3. **A broken MetaTrooper is indistinguishable from an absent one.** Every hook, the launcher step and the
   notify wrapper finish within 250 ms, swallow every error and exit 0. They print nothing, with one named
   exception: the `UserPromptSubmit` hook prints the exact JSON in `events-and-hooks.md` when it has
   comments to deliver, and nothing otherwise.
4. **No window ever waits on another process.** Windows draw from direct database reads. A slow or crashed
   core means slightly old data and a "core offline" badge (heartbeat in `meta.core_heartbeat` older than
   6 s), never a frozen screen.
5. **Table ownership.** The core is the only writer of core-owned tables. Three queue tables have other
   writers: `event` (hooks, launcher, notify), `command` (workbench, tray, CLI), `comment` (workbench).
   Only the core marks queue rows processed.
6. **Nothing MetaTrooper writes lives in the vault or OneDrive**, except `<project>/.troop/runs/`, which is
   git-excluded automatically.
7. **ACU asks first (D46).** `project.open` opens any folder, `work/ACU` included. A session (interactive or a
   pipeline step) whose folder is in or contains `work/ACU` starts in `ask`, whatever approval it requested.
8. **Default project.** `projects.default` in `~/.metatrooper/settings.json` (empty by default) names the folder
   the core opens through `project.open` at start, so it is the most recent project and the window selects it
   when nothing else is chosen. It resolves like any project, to its git repo root, so a plain folder inside the
   vault opens as the vault.

### Transport

| Path | How | Target | Core down |
|---|---|---|---|
| Reads | Windows open `troop.db` read-only and query it | p95 under 1 ms per query | last state stays, "core offline" badge |
| Updates | `fs.watch` on the `~/.metatrooper/` folder (Electron) or the `notify` crate (Tauri), filtered to `troop.db*` names, 50 ms debounce, re-query on change. Watching the folder, not the `-wal` file, survives checkpoints deleting or replacing that file. A 1 s poll of `PRAGMA data_version` is the source of truth; the watcher only makes it faster. | under 100 ms write to redraw | nothing changes |
| Events | append to `event` (`events-and-hooks.md`) | under 20 ms | rows wait; processed in order on restart |
| Commands | JSON-RPC on `\\.\pipe\metatrooper` (`pipe-protocol.md`) | p95 under 20 ms | after 300 ms the command becomes a `command` row, shown "queued", run on restart |

The core checkpoints the WAL every 30 s (`PRAGMA wal_checkpoint(TRUNCATE)`), so old copies of scrubbed rows leave the WAL. Readers rely on SQLite's own
`busy_timeout` (200 ms); if a read still fails, the window keeps the previous frame and tries on the next
wake. Windows read on a read-only connection and open a short-lived read-write connection only to insert
`command` and `comment` rows.

## Sessions

### Launching

The core opens a pty (core/src/terminal/, the only file that imports node-pty) running:

```
node --no-warnings "<core>/launch.js" --session <id> --engine <engine> --args-b64 <base64 of a JSON array: command, args, prompt>
```

The engine's arguments travel as one base64 JSON value so no quoting layer can split them. The launcher is node rather than PowerShell because PowerShell 5.1 drops embedded double
quotes when it passes arguments to native programs (verified 2026-09-29), and prompts contain quotes.

`launch.js`:

1. Sets `TROOP_SESSION_ID` in its own environment, which the engine and every hook inherit.
2. Appends the `launch` event in-process (`pid` = the launcher's own pid), giving up after 250 ms.
3. Resolves the command without a shell: an `.exe` on PATH runs directly; an npm `.cmd` shim is unwrapped to
   its target (`claude.cmd` to `claude.exe`, `codex.cmd` to `node codex.js`). Only an unknown shim falls back
   to a shell.
4. Spawns the engine with `stdio: 'inherit'` in the same console, ignores Ctrl+C itself (the engine receives
   it), and exits with the engine's exit code. Verified 2026-09-29: quotes, spaces, semicolons, trailing
   backslashes and empty arguments arrive unchanged.

The engine inherits the user's normal environment, exactly as when started by hand; MetaTrooper adds only
`TROOP_SESSION_ID`. (Environment stripping applies to plugin actions, not to the user's own agents.)

One exception, decided 2026-10-05: when the core itself was started from inside a Claude Code session, it drops
that session's identity variables from every pty it opens (`PARENT_SESSION_ENV` in `core/src/terminal/`:
`CLAUDECODE`, `CLAUDE_PID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ID`, the messaging socket and
token, and the rest of that set). Otherwise every `claude` agent runs as that session's child and prints
"Transcript saving is off", and it inherits the parent's messaging token. Claude Code settings the user sets
(for example `CLAUDE_CODE_USE_BEDROCK`) are not in the set and pass through.

One pty per session, in the session's folder. The window attaches over the terminal pipe
(`pipe-protocol.md`, "Terminal pipe"); `session.focus` writes the `ui_selection` row and the window selects
that session. An engine with no `prompt_arg` gets its prompt typed into the pty when it first reaches `idle`
or `waiting_for_you`, once (`core.prompt-written`); "Paste prompt" does the same by hand. The IDE never kills
an agent; the user exits it.

### Linking and state

How each engine's own session is linked, and how every event maps to `starting`, `working`,
`waiting_for_you`, `done`, `idle`, `unknown` or `exited`, is specified in `events-and-hooks.md`. `done` means
finished and not yet looked at; opening the card or focusing the session moves it to `idle`.
A card that cannot know the state says "state unknown". The IDE never reads terminal output to guess.

### Engine registry

An engine is any interactive CLI, defined by the `engine` object in `plugin-manifest.schema.json`. Built-ins:

| id | command | prompt_arg | state_source | auth_cmd, auth_ok | roles | cost_rank | usage_source |
|---|---|---|---|---|---|---|---|
| `claude` | `claude` | positional | hooks | none (auth `unknown`) | research, plan, worker, review, verify, visual-check | 3 | claude-transcript |
| `codex` | `codex` | positional | notify | `codex login status`, exit 0 | plan, worker, review, verify | 2 | codex-session |
| `agy` | `agy` | none (clipboard handoff until verified in child #12) | file-activity, glob `~/.gemini/antigravity-cli/brain/*/.system_generated/logs/**` | none | research, worker, review, visual-check | 1 | none |

Role binding picks the lowest `cost_rank` engine that lists the role, is installed, and is not red; the user
can pin an engine per step or per project. Health: `version_cmd` and `auth_cmd` on start, every 10 minutes,
and on `engines.check`, 10 s timeout each. Lights: green (installed, auth ok), grey (auth unknown), red
(missing or failed). Grey is never shown as green.

### Usage limits and meter

- Token meter: Claude usage from the session transcript's `message.usage`, deduplicated by `message.id`
  (streamed partial records share an id; the last one wins). Codex usage from its session files, deduplicated
  by turn id. Other engines: `unknown`, never guessed. Rows go to `usage`. The transcript is read
  incrementally from the last byte offset, never re-read whole.
- Prices: `core/prices.json`, dated, per model, edited by hand. Dollars only where the model is known.
- Callrouter adds "saved" per session from its `call` rows. If `callrouter.db` is missing, locked or on an
  unknown schema version, "saved" shows "unavailable" and nothing else changes.
- Usage limits: per provider, current use against plan windows (5-hour, daily, weekly) with reset times and a
  warning chip at 80%, stored in `limit_reading`. Sources follow Orca's documented per-provider approach
  (`onorca.dev/docs/agents/usage-tracking`); Orca is MIT, so its readers may be adapted with its copyright
  notice kept. A provider with no local source shows "usage unavailable".

## Workbench

Decided 2026-10-04 (core screen) and 2026-10-05 (pipeline screens). This replaces layout A from the UI revision
(`issues/archive/ui-revision-epic.md`, D2, D3, D10, D15). The terminal core, status, tools and panes from that
revision stay underneath (terminal-core, status-and-notifications, zero-setup-tools, result-panes). The port is `issues/ui-port-epic.md`.

### The wall

The screen is a wall of tiled live terminals, one tile per session. Each tile is a real terminal over the
terminal pipe; you type into it in place. One tile holds the big slot and the rest tile around it.

- **Title bar.** Slim, one row: list toggle (Ctrl+B), wordmark, project / branch / core crumb, the "need you"
  chip (its count opens the gate sheet), the usage chip, the Agent button with an engine picker, PowerShell and
  Git Bash buttons, window controls.
- **Tile header.** Engine, task, branch and the working indicator. The selected tile adds Diff (Ctrl+D) and Hand
  back, and a Pair button.
- **List, behind Ctrl+B.** It slides over the wall: New agent, pwsh, bash, then agents, Runs and Usage. A click
  puts a session in the big slot. Shift+click pairs it.
- **Search, Ctrl+K.** One floating box over agents, gates and commands. Pipelines are the one-click commands
  (zero-setup-tools). Arrows move, Enter opens, Esc closes.
- **Gate sheet.** A bottom sheet that peeks as a tab. The tab shows the gate count and each run's step N of M.
  Each gate card draws its run's steps as a pipe, with Approve, Reject and Open run. A opens the sheet, then
  approves the top gate. R rejects it.
- **Esc** closes search first, then the sheet, then the list.
- **Runs that need you, with nothing selected.** When no selected session owns a run, the step list under the
  big slot shows the newest run that needs the user (waiting at a gate, or failed), labelled "Needs you: <pipeline>"
  so it never reads as the selected agent's run. Decided 2026-10-05 by Codex and Gemini independently (both A).
  A failed run qualifies only while its `run-failed` needs-you item is unresolved, so acknowledging it clears
  the row. Codex picked this (C); Gemini picked "failed since the window opened" (B), with the risk that a
  failure just before opening is missed; the conservative choice, C, was taken.
- **Run before Cancel in search.** Ctrl+K lists Run items before Cancel items, so a pipeline name plus Enter
  starts a run and never arms a cancel.
- **Cancel a run** from its run screen header, its step list row under the big slot, its 36px background bar, or
  Ctrl+K ("Cancel run: <pipeline>"). One confirm, then `run.cancel`: the run ends `cancelled`, waiting gates
  are rejected, its actions and dev servers stop, and the agent sessions that run launched are closed (Wasif,
  2026-10-05). Agents the user started are never touched.
- **Copy and paste in a terminal** work like PuTTY (Wasif, 2026-10-05): highlighting text with the mouse copies
  it at once; right-click pastes. Ctrl+C copies when text is selected and otherwise reaches the agent as an
  interrupt; Ctrl+Shift+C copies; Ctrl+V pastes (as a bracketed paste).
- **Exited sessions** show as strips with Reopen (Resume or Start new here, status-and-notifications). The inbox and toasts are status-and-notifications's.
- **Side tabs.** Diff, Hand-back, Browser, Runs and the Pipelines editor from layout A open as overlays over the
  wall. They are not a fixed split.

### The nine ideas

Mined from the other round-8 concepts and approved with the wall:

1. Done and exited panes fold to 36px bars; the freed height goes to live panes.
2. A one-off attention sweep runs before the breathing edge.
3. The pane that needs you glides into the big slot. If one is already waiting, it queues.
4. A NEEDS YOU stamp stays on the pane until answered.
5. Pair mode: two terminals side by side in the big slot.
6. The working indicator is a live sparkline or a 3-bar equalizer (`spark` or `eq`).
7. A gate shows an APPROVED or REJECTED stamp in place before its card leaves.
8. The usage chip opens a hover popover with each provider's windows, with no scrim.
9. In small panes the question card sits beside the log, so the log is not crushed.

### Look and motion

- **Dither is the default look.** Flat #0b0b0c, ink #f2f2f2, and orange #ff7a1a only for "needs you" and gates.
  Space Mono labels, Silkscreen wordmark and stamps, dotted pane borders, dot halos, dot-bar working indicator.
- **Warp charcoal ships as a theme** (Geist and Geist Mono). The other palettes from the rounds are also
  selectable themes. Theme values live in settings; no colour is hardcoded in the CSS.
- **Motion is GSAP**, loaded from `workbench/renderer/vendor/` (CSP is `script-src 'self'`). Lines stream in,
  counters tick, the pane that needs you breathes at its edge, reflow glides, overlays spring. Reduced motion
  turns it off.

### Pipelines on the wall

- A run's step list sits under the big slot as a glance. Its header opens the run screen: the full window under
  the title bar, in the run's layout (Pipeline UI below). Esc goes back to the wall. `agent-split` keeps the
  agent's live terminal in the big slot and fills the rest. A foreground run opens its run screen at start.
- A background run folds to the 36px wall bar and opens only when it needs the user.
- A step's `view` pane renders inside the active layout's output slot.
- Keys follow focus. When a run screen is open, 1 to 5 pick its layout and 0 goes back
  to automatic. When the focused tile is an agent asking a question, 1 and 2 answer it.

## Pipelines

Format: `contracts/pipeline.schema.json`. Execution: `contracts/pipelines.md`, which defines validation (with
the publish rule), the run directory, the step handoff contract from D35, completion signals, gates bound
to the exact action by `action_hash`, fan-out with worktrees and dynamically allocated ports, loops, resume,
the 3-failure breaker, budgets with a one-step maximum overshoot and `max_minutes` for engines with unknown
usage, schedules (only while the core runs, missed fires reported and never back-filled), and code steps.

Roles: `trigger`, `ingest`, `research`, `plan`, `worker`, `review`, `verify`, `visual-check`, `gate`,
`publish` (from the catalog's analysis of 25 pipelines).

The workbench form view edits `pipeline.json` for non-coders (add step, pick role, pick engine, toggle gate)
and runs `pipeline.validate` on every change.

### Built-ins and templates

| Lane | Built-in | Catalog # | Plugins | Milestone |
|---|---|---|---|---|
| Coding | `spec-build-review-handback` (Wasif's loop) | none | repo | 1 |
| Coding | `two-engine-review` | 17 | repo | 1 |
| Coding | `spec-to-pr` | 1 | repo, github | 2 |
| Coding | `e2e-browser-qa` | 7 | repo | 2 |
| Design | `website-build` | 2 | repo, deploy | 2 |
| Design | `design-variants` | 14 | repo, agent-reach | 2 |
| Docs and releases | `docs-and-release-notes` | A5 | repo, github | 2 |
| Security and upkeep | `security-review-and-upgrade` | A6 | repo, security | 2 |
| Video and social | `footage-to-edit` | 6 | media | 3 |
| Video and social | `clips-to-scheduled-posts` | 8 | media, social-scheduler | 3 |
| SEO | `seo-audit-fix` | 11 | seo, repo, deploy | 3 |
| Research | `deep-research-cited` | 10 | agent-reach, cite-check | 3 |
| Lead gen | `prospect-list-to-drafts` | 13 | agent-reach, gmail | 3 |
| Personal ops | `inbox-triage-drafts` | 12 | gmail | 3 |
| Data | `data-to-dashboard` | 23 | data | 3 |
| Study and documents | `study-notes-to-pdf` | none (Wasif's uni lane) | docs-export | 3 |
| Desktop and forms | `form-fill-batch` | A7 | desktop | 3 |

Each built-in starts from its catalog sketch. Each has a fixture under `tests/fixtures/<pipeline id>/` (a
sample repo, a 3-minute sample video, a sample site, a sample CSV, a sample lecture PDF, a local test form
with a captcha stand-in, a repo with one outdated dependency) and a test Gmail account for the two Gmail
pipelines. Templates: the other 13 of the top 25 and the remaining 4 appendix pipelines, 17 in all, in a
gallery that shows each template's `requires` and says "ready" only when all are installed.

### Pipeline UI

Decided 2026-10-04 and 2026-10-05. Each pipeline run is shown in one layout from a frozen library of 15. Field
format and precedence: `contracts/pipelines.md`, "Layout and background".

The library:

- `run-log`: a step list and the selected step's log; every failure lands here.
- `pipe`: all steps and gates at a glance, fan-outs and loops drawn as lanes and arcs.
- `agent-split`: one agent live beside its newest output; a worktree rail on fan-out steps.
- `artifact-columns`: a chain of documents left to right, gates on the seams.
- `pr-first`: the one change, release or upgrade you will ship, with its ship gate at the foot.
- `hand-back`: the numbered list of what only you can do, each with its exact command; no commit button.
- `pr-inline`: findings pinned to the lines they are about.
- `duel`: two verdicts side by side, equal weight, never a winner.
- `buckets`: findings sorted into piles.
- `coverage-map`: rows of strips showing what was covered and where things happened.
- `triage`: a ranked queue with the selected item large and its actions.
- `before-after`: old next to new, to prove a change worked.
- `preview-stage`: the running product fills the screen; width, version and A / B / C tabs on top.
- `variants-grid`: several products at equal weight; pick or combine one.
- `timeline`: frames and tracks under a playhead; a text view as a toggle.

A pipeline spec picks its five layouts from the library by name. It may add at most one new layout, with one
line saying why none of the 15 fits.

Rules:

- The agent running the pipeline picks the layout by that pipeline's pick rule. There is no fixed default.
- Each step may carry a `layout` hint. The pipeline `layout` is only a fallback.
- Keys 1 to 5 pick one of the pipeline's five layouts by hand. The pick holds until 0 (back to automatic) or the
  run ends.
- A failed step always shows `run-log`.
- A step's `view` renders inside the active layout's output slot. Every layout has one output slot. When the
  layout changes, the pane moves with it. The `view` field and the pane code (result-panes) do not change.
- Automatic mode moves the screen only when a gate starts waiting, a step fails, or a step has run for 5 s or
  more. Never within 2 s of a click or key. The move is a calm glide.
- A background pipeline folds to a 36px wall bar: step, progress dots, elapsed time, the last agent line, and at
  most one small live extra. It opens only when it needs the user, in the layout the agent picks. Esc folds it,
  Enter or a click opens it by hand. Done, it settles as a calm bar that says `nothing needs you`.
- Orange means only the user can act: a waiting gate, a failure, a flag left for the user, and what points at
  them. Everything else is ink. Orange stops once the user answers, in every layout at once.

| Built-in | Runs | Five layouts (keys 1 to 5) | Opens when |
|---|---|---|---|
| `spec-build-review-handback` | background | hand-back, artifact-columns, agent-split, agent-split (worktree rail), run-log | `approve-spec` waits, the hand-back list is written, a verify or fix step fails |
| `two-engine-review` | background | pr-inline, duel, buckets, coverage-map, triage | the Disagree bucket is not empty, or a finding is critical |
| `spec-to-pr` | foreground | run-log, artifact-columns, pr-first, pipe, agent-split | opens its run screen at start |
| `e2e-browser-qa` | background | timeline (trace), run-log, coverage-map, before-after, timeline (session) | a finding is left open, `reverify` fails, a critical finding lands |
| `website-build` | background | preview-stage, before-after, pipe, agent-split, run-log | `approve` waits, critique gives up after round 3, `preview` or `production` fails |
| `design-variants` | background | variants-grid, artifact-columns, preview-stage, agent-split, artifact-columns (direction lanes) | `approve-directions` or `pick` waits, a variant or `polish` fails, a port never answers |
| `docs-and-release-notes` | background | pr-first, run-log, before-after, preview-stage, artifact-columns | `approve` waits, a sample still fails after the fix pass, `release` fails, a breaking PR has no migration doc |
| `security-review-and-upgrade` | background | pr-first, triage (ledger), triage, before-after, run-log | `approve-upgrade` waits, a high reachable finding is not fixed by the plan, the check loop hits max, a licence conflicts |
| `footage-to-edit` | background | timeline, preview-stage, before-after, pipe, run-log | `approve-plan` or `approve-final` waits, the last edit pass leaves a flag for the user, any step fails |
| `clips-to-scheduled-posts` | background | variants-grid, preview-stage, timeline, pr-first, run-log | `pick` or `approve` waits, any step fails |
| `seo-audit-fix` | background | triage, coverage-map, before-after, pr-first, run-log | `approve` waits, the speed loop ends with a key page under 90, `crawl` or `deploy` fails |
| `deep-research-cited` | background | artifact-columns, run-log, coverage-map, pr-inline, preview-stage | `approve-plan` waits, cite-check hits loop max, any step fails; never on done |
| `prospect-list-to-drafts` | background | coverage-map, triage, preview-stage, pr-first, run-log | `approve-spend` or `approve` waits, any step fails |
| `inbox-triage-drafts` | background | triage, buckets, preview-stage, pr-first, run-log | `approve` waits, any step fails |
| `data-to-dashboard` | background | preview-stage, artifact-columns, coverage-map, before-after, run-log | `signoff` waits, readback hits loop max with a headline wrong, `load` or `qa` fails |
| `study-notes-to-pdf` | background | preview-stage, before-after, artifact-columns, coverage-map, run-log | `signoff` waits, a line is still unsourced, proof hits loop max, any step fails |
| `form-fill-batch` | foreground | coverage-map, triage, preview-stage, pr-first, run-log | opens its run screen at start; folded by hand, reopens when a gate waits or a step fails |

`design-variants` has no `run-log` among its five: a failure opens `agent-split` on the failing worktree, with its
terminal output. Each pipeline's pick rule is in its child issue.

## Browser

Tools, capture, cursor and safety rules: `contracts/browser-tools.md`. In short:

- Each browser pane is an Electron `WebContentsView` in a per-project session partition. Electron runs with
  no remote debugging port.
- Agents drive panes through `metatrooper-browser`, a stdio MCP server attached to every session. Every tool names
  a `pane_id`; the workbench only lets the owning session drive a pane (error -32030 otherwise). With
  fan-out, each variant has its own pane owned by its own session.
- Commands run in-process through `webContents.debugger.sendCommand`. The cursor overlay moves to each click
  or type point before the action runs. The overlay is drawn above the view, never injected into the page.
- Requests are intercepted: public http(s), and loopback only on this project's dev ports. `file:`, other
  loopback ports and private ranges are blocked unless the project allows the host. `evaluate` runs in an
  isolated world under the same interception.
- Full-page capture uses the pane's debugger (`Page.captureScreenshot` with `captureBeyondViewport`), because
  `capturePage()` only captures the viewport and stitching repeats sticky headers.
- `metatrooper-browser` finds its own session by walking its parent processes, so Codex's global MCP config works,
  and one session cannot drive another session's pane by accident.
- Private-range blocking resolves each host first, so a public name pointing at a private address is blocked.
- If the workbench is closed, the next browser tool call returns "browser not available". The agent keeps
  running.

Point-to-comment: press C, click an element, type a note, pick a target session. The comment (note, CSS
selector, first 2,000 characters of outer HTML, and a crop saved at
`~/.metatrooper/comments/<session_id>/<comment_id>.png`) goes into `comment` and is delivered by the
session's route: clipboard always; for Claude, also as context on the next prompt (at least once, never lost;
a rare duplicate is marked with the comment id).

Before/after: capture a pane at 390 and 1280 px, full page, as `before` and `after` snapshots; side by side
per width; hold Space to swap.

### Inspiration board

The `agent-reach` plugin's `inspiration-board` action returns 8 to 12 references (Exa search, GitHub
libraries) and the core captures each reference's first screen through a browser pane. Cards show capture,
source link, reason, pin and remove. The step then proposes N directions (default 3) naming the pinned
references each draws on, and a gate lets the user edit or approve them before the build fan-out. Items are
stored in `board_item`, captures under `~/.metatrooper/boards/<run_id>/`.

### Variants grid

One live pane per variant, with its cost and engine. Pick marks the winner and the hand-back tray shows that
worktree's diff. Combine starts a new agent step in a fresh worktree with the user's note and the selected
tiles' crops. Discard removes the worktree (`git worktree remove`) after a confirm.

## Hand-back tray

Shows `git diff --cached --stat`, untracked files listed separately and never staged by MetaTrooper, binary
files and submodules shown by name only, a drafted commit message, and the exact command to run. A Copy
button and no Commit button. No code path runs `git commit`, `git push`, `git rebase` or `git commit
--amend`.

Diff annotation: click a line in the diff, type a comment; it becomes a `comment` row of kind `diff-line`
(file, line, text) delivered the same way as point-to-comment. File drag: dropping files or images on a
session card creates a `file` comment containing their absolute paths.

## Two-engine review

Codex: `codex exec --sandbox read-only`, stdin from `/dev/null`, with the `/codex:review` prompt, which returns
the shared Verdict JSON (`{verdict, findings:[{file, line_start, line_end, severity, title, body}]}`). Gemini:
the `agy-review` runner and schema, `gemini-3.8-flash-high` only. Both run in parallel. Findings match when
they name the same file and their line ranges overlap after widening each by 3 lines. Buckets: `both`,
`codex_only`, `gemini_only`, `disagree` (a match where one says `approve` and the other lists it). The view
never picks a winner. The review lane refuses ACU paths like everything else.

## Threat model for gates and pipes

Agents run as the user. Any agent with a shell can already do anything the user's account can, including
posting or pushing without the IDE. So MetaTrooper does not claim to stop a hostile process running as the
user. What gates guarantee is narrower and testable: a pipeline never performs a publish or external step
unless a person approved that exact action in the workbench, tray, or an interactive CLI; a pipeline, a code
step, a plugin action, or a cooperating agent using the `troop` CLI non-interactively cannot approve one.
Approval needs a trusted UI connection, proven with a per-start key in `~/.metatrooper/ui.key` that only the
workbench, tray and interactive CLI read; code steps and plugin actions get no method or helper that reaches
it. A script that deliberately reads that file is a hostile same-user process and out of scope.
The named pipes accept requests only from the user's own account (tested, M1-10), and browser panes are bound
to their session by process ancestry so well-behaved agents cannot drive each other's panes.

## Agent-native CLI and skill

`troop session launch|list|wait`, `troop run start|status|wait|resume`, `troop worktree create`,
`troop browser panes|snapshot|click|type`, all with `--json`. Every command is a pipe method or a database
read. `run wait` returns when the run reaches `done`, `failed`, or any gate. A skill file teaches agents when
to use each. Publishing still stops at a gate, and `gate.resolve` from the CLI requires an interactive
terminal (it refuses when stdin is not a TTY), so an agent cannot approve its own gate.

## Plugins

Manifest, permissions, action process contract, pane bridge and importers: `contracts/plugins.md`. Key
points: nothing runs before the user approves the permission list; actions get an environment built from
scratch plus only approved `secrets:<NAME>` values; actions that time out are killed with their whole
process tree; filesystem and network permissions are declared and shown but not OS-enforced in version 1,
and the install screen says so; importers never copy secret values and never import hooks.

First-party plugins:

| Plugin | Gives | Built on | Milestone |
|---|---|---|---|
| `callrouter` | shell-output cap, call log, "saved" figure | callrouter Plan A (Python, run through uv's real interpreter path, never a `~/.local/bin` shim) | 1 |
| `repo` | worktrees, test-runner detection, diff | git | 1 |
| `agent-reach` | research sources, inspiration board | Agent-Reach 1.5.0 | 2 |
| `github` | issues, PRs, checks; opening a PR is external | gh | 2 |
| `deploy` | preview and production deploys; production is external; project id from config | Vercel CLI | 2 |
| `security` | security review prompt set, dependency listing and upgrade, licence report | npm, pip and uv metadata | 2 |
| `media` | download, probe, cut, captions, samples, transcription with word timestamps | yt-dlp, ffmpeg, faster-whisper on CPU (API optional) | 3 |
| `social-scheduler` | one `schedule_post` interface; every post is external | OpusClip MCP (needs OpusClip Pro), Postiz | 3 |
| `seo` | crawl through a browser pane, Lighthouse, sitemap and meta checks; Search Console optional | Lighthouse CLI | 3 |
| `cite-check` | verify step: each quote must appear in its fetched source after normalising whitespace, HTML entities, curly quotes and dashes, and case | string match, no model | 3 |
| `gmail` | read, label, draft; send is external | Gmail API with the user's own OAuth client | 3 |
| `data` | load CSV or SQLite, query, render a static HTML dashboard | node:sqlite | 3 |
| `docs-export` | ingest PDF, DOCX, audio, transcripts; export PDF (Electron `printToPDF`) and DOCX | pdf.js, `media` | 3 |
| `desktop` | Windows app control: UI tree, click, type, read, window screenshot; 10 s timeout per call; elements selected by AutomationId, then Name plus ControlType | Windows UI Automation through PowerShell | 3 |

### Trooper sandbox host plugin

An alternative session host (D43), child sandbox-host. It exists so the `isolated` approval profile can run an engine
with every approval skipped: that is only safe inside a boundary MetaTrooper controls. The ideas come from
agent-infra/sandbox (one environment, shared filesystem, localhost only) and TencentCloud/CubeSandbox
(credentials kept out of reach, egress allow-list); neither product is used. Both stay documented fallbacks:
AIO Sandbox (Apache-2.0, 6,036 stars, needs `seccomp=unconfined`) and CubeSandbox (12,751 stars, KVM micro-VMs,
Linux hosts only).

**Runtime.** Docker Desktop on WSL2, or Podman; the plugin uses the first of `docker`, `podman` on PATH. Neither
is installed on laptop-ops as of 2026-09-29: installing one is a hand-back. Windows Sandbox is rejected (one
instance at a time).

**Image.** `metatrooper-trooper:<plugin version>`, built by `troop sandbox build` from the plugin's
`Dockerfile`: Debian 12 slim, node 24, git 2.48 or newer, a non-root user `trooper` (uid 1000), the MetaTrooper
hook scripts copied to `/opt/troop/`, and each engine installed from its registry entry's `sandbox.install`
lines. Engine hooks inside the image point at `/opt/troop/event.js` and `/opt/troop/codex-notify.js`. No
credential is ever written into the image.

**Launch.** `session.launch` with `approval: "isolated"` sets `host: "sandbox"`; `isolated` on any other host
is refused with -32003. The pty command is unchanged except `launch.js` gets `--host sandbox`, and the
launcher, inside the pty, runs:

```
docker run --rm -it --name troop-<id8> --network troop-egress --user 1000:1000 --cap-drop ALL
  --security-opt no-new-privileges --pids-limit 512 --memory 4g --cpus 2 --read-only
  --tmpfs /tmp --tmpfs /home/trooper
  -v <worktree>:<mapped worktree> -v <main repo .git>:<mapped .git>
  -v ~/.metatrooper/spool/<session id>:/troop/spool
  <login mounts from the engine's sandbox.logins>
  -e TROOP_SESSION_ID=<id> -e METATROOPER_SPOOL=/troop/spool
  -e HTTPS_PROXY=http://troop-proxy:3128 -e HTTP_PROXY=http://troop-proxy:3128
  -w <mapped worktree> metatrooper-trooper:<version> /opt/troop/entry.sh <engine argv with isolated args>
```

A host path `C:\a\b` maps to `/host/c/a/b`. Worktrees are created with `git worktree add --relative-paths`, so
the worktree's `.git` file and the main repo's `.git/worktrees/<name>/gitdir` resolve inside the container
when both are mounted at their mapped paths. The main repo's working tree is not mounted, so `isolated` is
refused outside a MetaTrooper worktree. The main repo's `.git/hooks` and `.git/config` are mounted read-only over
the writable `.git`, so nothing written inside runs on the host at its next git command. The terminal owns the
container (`--rm -it`); when the session ends the core also runs `docker rm -f troop-<id8>`, since killing the
docker client leaves its container running (2026-10-08).

**Logins.** Each engine's registry `sandbox.logins` lists read-only file mounts,
for example `~/.claude/.credentials.json` and `~/.codex/auth.json`, mounted `:ro` under `/troop/logins/<engine>/`;
`entry.sh` links each into its place under `/home/trooper`, which stays writable (2026-10-08). Read-only means an engine cannot rotate a refresh token and log the host out. Before
launching, the launcher checks `claudeAiOauth.expiresAt` in the Claude file and refuses with "run claude once
on the host to refresh its login" if it expires within 60 minutes; for Codex it runs `codex login status` on
the host. agy keeps its login in a Linux keyring, so its entry declares a named volume instead
(`troop-agy-keyring` at `/home/trooper/.local/share/keyrings`); `troop sandbox login agy` opens a container
that starts dbus and `gnome-keyring-daemon`, runs agy's headless code login, and keeps the volume. The keyring
password is a DPAPI secret (`sandbox/keyring`) passed in as an environment variable. `entry.sh` starts dbus
and unlocks the keyring only when that volume is mounted.

**Egress.** `troop-egress` is a Docker network created `--internal` (no route out). `troop-proxy` is a second
container on both that network and the default bridge, running the plugin's dependency-free node CONNECT
proxy on port 3128, which is never published to the host (D24 holds: MetaTrooper opens no host port). It
allows only the union of every engine's `sandbox.egress` hosts plus `registry.npmjs.org`, answers 403 to
anything else, and appends each denied host (host name only) to `~/.metatrooper/logs/egress-denied.log`.

**Event bridge.** Inside the container the event writer sees `METATROOPER_SPOOL` and appends one NDJSON line
per event to `/troop/spool/events.ndjson` instead of opening `troop.db`, which never crosses the boundary.
The core ingests every 250 ms (see `events-and-hooks.md`, "Spool ingest"), re-redacting every payload on the
host, and deletes the spool folder once the session is `exited` and fully ingested.

**Rule exceptions (opt-in, sandbox host only).** Rule 1 holds: the terminal is still a core-owned pty, and
the engine runs in a container that pty owns. "The engine inherits the user's normal environment" does not
hold: a sandboxed engine sees only its worktree, the repo's `.git`, its spool and its read-only logins.

**Registry shape.** Per engine, data only:

```ts
sandbox?: {
  install: string[];                                   // Dockerfile RUN lines
  logins: Array<{ file: string; mode: 'ro' } | { volume: string; at: string }>;
  egress: string[];                                    // host names, no wildcards
};
approval_profiles.isolated: string[];                  // e.g. claude ['--dangerously-skip-permissions']
```

A bypass flag is allowed only in `isolated`; a unit test keeps it out of every other profile.

## Open core, licence, prior art

Free, with no account: the whole local IDE, every lane and plugin, on the user's own CLI logins and keys.
Signed out (the only state in this epic), the core, workbench and tray make no network connections of their
own; plugins with `network` do, and are listed. One exception, Wasif's call on 2026-10-09: when Windows "Automatically
detect settings" is on, the workbench window (Chromium) looks up the LAN host `wpad`, as Chrome and Edge do, so the
browser pane keeps working behind auto-detected proxies.

Metered later, in the cloud epic: a model gateway on Wasif's API keys for users without a subscription,
cloud runs, hosted transcription and rendering, and sync. Users' own subscriptions are never metered or
routed through the gateway.

Seams in this epic: the `usage` ledger (in `schema.sql`, built with the core); the engine `provider` field
(`gateway` is refused with -32040); an account state that is `signed_out` with no sign-in prompt; pipeline
`run_in: "cloud"` refused with -32040.

Licence: `core/`, `workbench/`, `tray/`: AGPL-3.0. `sdk/`, `contracts/plugin-manifest.schema.json`,
`contracts/plugins.md`, `contracts/pipeline.schema.json`, `contracts/pipelines.md`, `contracts/browser-tools.md`
and `pipelines/`: MIT. Plugins interact only through the manifest, action processes, the pane `postMessage`
bridge and the named pipes, so a plugin never links to AGPL code. Electron is MIT and Tauri Apache-2.0 or
MIT, both compatible.

Prior art, checked 2026-09-29:

| | Orca (stablyai/orca) | herdr (herdrdev/herdr) | MetaTrooper |
|---|---|---|---|
| Stars, licence | 80,844, MIT | 41,291, Apache-2.0 | new, AGPL-3.0 core |
| Where agents run | terminals embedded in the Electron app | herdr's server; viewed in any terminal | in-app terminals owned by the core service |
| Agent state | yes | blocked, working, done, idle, unknown, 12 agents on Windows | hooks, notify, file activity; terminal bell when those are silent |
| Worktrees | compare and merge | create and open | fan-out variants with pick, combine, discard |
| Click element to prompt | Design Mode | no | point-to-comment with agent cursors |
| Pipelines, lanes, gates | no | no | 12 lanes, 17 built-ins, publish rule bound to the exact action |
| Token saving | no | no | callrouter |

## Milestones and child issues

Estimates are Claude Code days and were raised after the review said the first ones were too low.

### Milestone 1: the core loop (about 28 CC days)

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

| # | Title | Effort | Depends on |
|---|---|---|---|
| 12 | Core service: `schema.sql` (frozen first), event processor with redaction, state machine, launcher, session linking, engine registry and health, named-pipe server with run-once commands, queue, port leases, DPAPI secret store, schedules, `usage` ledger, licence files, ACU refusal | 4.5 | none |
| 13 | Plugin system: manifest validation, install screen and approval, action runner with env stripping and tree kill, pane bridge, Claude and Codex/agy importers | 3.5 | 12 |
| 14 | Callrouter Plan A, in the callrouter repo, meeting its own criteria 1 to 8; then its `troop-plugin.json` | 2.5 | 13 (for the plugin part only) |
| 15 | Pipeline runner: validation with the publish rule, handoff contract, completion signals, gates with `action_hash`, fan-out, worktrees, port allocation, loops, resume, breaker, budgets, code steps, `repo` plugin | 4.5 | 12, 13 |
| 16 | Electron workbench: project picker, session cards and focus, engine lights, runner view, form editor, gate panel, needs-you queue, "core offline" badge, database watcher | 3 | 12, 15 |
| 17 | Live browser: panes, `metatrooper-browser` MCP, browser pipe with ownership checks, cursor overlay, request interception, isolated `evaluate`, full-page capture, point-to-comment, before/after | 5 | 12, 16 |
| 18 | Two-engine review pipeline and view | 1 | 15, 16 |
| 19 | Hand-back tray | 0.5 | 12, 16 |
| 20 | Token meter and prices (reads `usage` from #12 and callrouter "saved") | 1.5 | 12, 14 |
| 21 | Agent-native `troop` CLI and skill | 1.5 | 12, 15 |
| 22 | Measurement tooling for the adoption gate | 0.5 | 16 to 20 |

#16's screen was revised twice: the UI revision (terminal-core to result-panes, `issues/archive/`) and the wall port
(`issues/ui-port-epic.md`, phases A to E).

Then the **adoption gate**: 14 days of Wasif's daily use, measured by #22, before milestone 2 starts.

### Milestone 2: design and coding lanes (about 18 CC days)

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

| # | Title | Effort | Depends on |
|---|---|---|---|
| 23 | Inspiration board and `agent-reach` plugin | 1.5 | 13, 15, 17 |
| 24 | Variants grid: tiles, pick, combine, discard | 2 | 15, 17 |
| 25 | `github` and `deploy` plugins; `spec-to-pr`, `e2e-browser-qa`, `website-build`, `design-variants` | 2.5 | 15, 16, 17, 23, 24 |
| 26 | `docs-and-release-notes` | 1 | 25 |
| 27 | `security` plugin and `security-review-and-upgrade` | 1.5 | 18, 25 |
| 28 | herdr host plugin (dropped 2026-10-02, UI revision D8) | 0 | none |
| 29 | Usage limits and account switcher | 2 | 12, 16 |
| 30 | Diff annotation and file drag | 1 | 19 |
| 31 | Signed packaging through SignPath Foundation (Electron now; Tauri in milestone 3) | 1.5 | 16 |
| sandbox-host | Trooper sandbox host plugin: container image, `--host sandbox` launcher path, read-only logins, agy keyring login, egress proxy, spool bridge, escape self-test | 3 | 12, 13, 15 |

### Milestone 3: every other lane (about 18.5 CC days)

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

| # | Title | Effort | Depends on |
|---|---|---|---|
| 32 | `media` plugin and `footage-to-edit` | 2.5 | 15, 16 |
| 33 | `social-scheduler` plugin and `clips-to-scheduled-posts` | 1.5 | 32 |
| 34 | `seo` plugin and `seo-audit-fix` | 2 | 17, 25 |
| 35 | `cite-check` plugin and `deep-research-cited` | 1 | 15, 17, 23 |
| 36 | `gmail` plugin, `prospect-list-to-drafts`, `inbox-triage-drafts` | 2 | 15, 16, 23 |
| 37 | `data` plugin and `data-to-dashboard` | 1 | 15, 16 |
| 38 | `docs-export` plugin and `study-notes-to-pdf` | 1.5 | 18, 32 |
| 39 | `desktop` plugin, handoff gate UI, `form-fill-batch` | 3 | 15, 16, 17 |
| 40 | Template gallery (17 templates) | 1 | 13, 15, 16 |
| 41 | Tauri tray companion, signed through #31's pipeline | 2 | 12, 31 |
| 42 | Open-core seams: `provider: gateway` and `run_in: cloud` refusals, account state | 1 | 12, 15 |

Total: about 64.5 CC days (28 + 18 + 18.5). Human-team equivalent: about 12 months.

Sequencing: #12's schema and pipe protocol are frozen before any client is built, because everything else
reads them. Plugins come before the runner because steps call actions. Callrouter's own code (C1, C9, C7)
can be built in parallel from day one; only its plugin manifest waits for #13. The browser precedes the board
and variants because both render through it. Milestone 2 waits for the adoption gate so lanes are built on a
core that has survived daily use; milestone 3 lanes are independent of each other.

### Milestone 4: improve what runs today (about 11.75 CC days)

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

M1 is built and dogfooding has started (UI-01 still TODO). Three costs show up in daily use. Review steps tell
agents to read whole source files. Agents rebuild things open-source tools already do. Small rough edges
show up in real runs and in the test suites. M4 adopts researched tools into code that runs today, gives
every pipeline optional helper tools, applies ideas mined from those tools, and fixes what real use finds.
Tools and ideas for pipelines that are not built yet go into their M2 and M3 issues (M4-D1).

Specced 2026-10-05 through `/spec`. Research behind it: `research-core-coding.md`, `research-lanes.md`,
`research-assists.md`, `ideas-coding.md`, `ideas-lanes.md` (scratch, 2026-10-05). Each child's detail is in its
issue file; the Codex gate scored the single-file draft 4/10 twice, so each child file is scored on its own
before it is built.

#### Milestone 4 decisions

| # | Decision | Chosen |
|---|---|---|
| M4-D1 | Scope | Built parts only: core, the five built pipelines, the wall, fixes from real use. Tools and ideas for unbuilt pipelines amend their issues (M4-8) |
| M4-D2 | Done | The replay gate (M4-03) passes, the real confirm runs point the same way (M4-04), UI-01 passes, and both suites run clean alone (M4-02) |
| M4-D3 | Tools | Code map, TOON output, gitleaks at publish gates, OSC notifications as a needs-you signal |
| M4-D4 | Code map | `tirth8205/code-review-graph` (MIT, 31,923 stars, pushed 2026-09-18), installed with the real Python 3.14 interpreter like `metarouter` (`Python314/Scripts`, on PATH). `codebase-memory-mcp` is an unsigned .exe that Smart App Control is expected to block |
| M4-D5 | Measuring tokens | A deterministic replay of offered context (a proxy, not the bill) is the gate; one real run per pipeline before and after must point the same way, no threshold |
| M4-D6 | Secret findings at a publish gate | Approve is replaced by "Approve anyway" plus a typed reason; a scanner that cannot run shows a red line and Approve still works |
| M4-D7 | Code-map install | Never run `code-review-graph install` or `uninstall`: they edit every agent's settings, hooks and rules files. MetaTrooper starts the server through its own manifest and `mcp-shim.js` |
| M4-D8 | TOON default | Opt-in flag. A command's default flips only when its recorded payload saves at least 15% and decoding gives back the same JSON |
| M4-D9 | Helper tools | Every one of the 17 pipelines lists optional helper tools that steps use when installed. A pipeline never depends on one. User-installed, never bundled, so the dependency gate does not apply; each shows licence risk and what it sends off the machine |
| M4-D10 | Worktree dependencies | Revised after reading the code: every step with `worktree: true` today is an agent step, and the runner cannot intercept an agent's own `npm install`, so no junction is used. A fresh worktree with a `package-lock.json` and no `node_modules` gets `npm ci --prefer-offline --no-audit --no-fund` before its dev server or agent starts |
| M4-D11 | Secret hit before an external send | Same rule as M4-D6 for `review.diff` before Codex and Gemini read it |
| M4-D12 | Replay scope | Revised after reading the code: only `two-engine-review` `codex-review` is replayed. `gemini-review` runs on agy, which gets no MCP servers yet (`contracts/plugins.md:112`, `agy-config` "not attached yet"); `spec-to-pr`'s agent steps (`spec`, `build`) read open-ended parts of the repo, so no fixed context exists to replay. Both are covered by the real confirm runs instead |

#### Milestone 4 current state

- `pipelines/two-engine-review.json`: steps `diff` (code), `codex-review` (agent, codex), `gemini-review`
  (agent, agy), `bucket` (code). Both review prompts say "Read that file and the source files it touches".
- `pipelines/two-engine-review/diff.mjs`: writes `git diff <range>` of `ctx.projectPath` to `review.diff`.
  `bucket.mjs`: matches findings across engines after widening each range by 3 lines (`WIDEN = 3`); buckets
  `both`, `codex_only`, `gemini_only`, `disagree`; no check against the diff hunks.
- `workbench/renderer/layouts/rules.js:11`: a review run opens (leaves the 36px bar) when
  `disagree || critical`; `review.js:36-37` counts both over all four buckets.
- `pipelines/spec-to-pr.json`: `spec` (agent, plan), `approve-spec` (gate), `build` (agent, worker,
  `worktree: true`), `verify` (action `plugin:repo/run-tests`), `approve-pr` (gate), `open-pr` (action
  `plugin:github/create-pr`, role `publish`). Input `base_branch` defaults to `main`.
- `pipelines/website-build.json`: `build` (agent, worktree, `serve: before`), `critique` (agent, one pass,
  no `until`), `preview` (action), `approve` (gate), `production` (action `plugin:deploy/production`,
  role `publish`, `with.path: {{steps.build.outputs.worktree}}`).
- `core/src/pipelines/runner.ts:489-504` `placeIndex`: creates a worktree at
  `~/.metatrooper/worktrees/<project id>/<run>-<step>-<idx>` on branch `troop/<same>` from the project HEAD;
  the starting commit is not recorded. `:754` `gateStep` opens gates; `:775` `checkApproval` binds them to
  `action_hash`. `:137` `needsYou(kind, ref, text)` inserts a `needs_you` row. `:646-675` is the wait loop
  for an agent step; `:670` fails with "the session exited without writing <path>".
- `contracts/schema.sql`: `gate` has no scan or override columns; `needs_you.kind` allows `other`.
  `core/src/store/db.ts:33` adds a missing column with `ALTER TABLE` at open (the `driven_engine` pattern).
- `core/src/methods.ts:279-297` `gate.resolve {gate_id, decision, action_hash, note?}`.
  `workbench/renderer/app.js:670` `resolveGate` and `:877` a Ctrl+K "Approve: <summary>" quick action call it.
- `contracts/plugin-manifest.schema.json:103-114`: an `mcp` entry has `id`, `command`, `args`, `env_keys`
  (secrets only), `engines`; no literal `env`, no argument templating. Attach kinds that work:
  `claude-mcp-config-flag`, `codex-config`.
- `core/src/terminal/index.ts:56`: `head.onBell` feeds `term.bell`; no OSC handler is registered.
- `core/cli.ts:361-390` `troop run` has `start`, `wait`, `status`; no `cancel`. `run.cancel {run_id}` exists
  (`contracts/pipe-protocol.md:131`).
- `core/src/hook/browser-mcp.ts:15` and `workbench/src/browser/panes.ts:414`: `snapshot {pane_id, max_nodes}`.
  The other browser tools return small JSON objects; `snapshot` returns text.
- `core/src/engines/registry.ts:63`: agy has `print_args`; pipeline steps run it in print mode (D51).
- The meter counts Claude (`message.usage`) and Codex tokens; agy has none (M1-28). Test pipelines use a
  fake engine, so the meter reads zero for them.

#### Milestone 4 children

| # | Title | Issue file | Priority | Effort (CC days) | Depends on |
|---|---|---|---|---|---|
| M4-1 | Replay harness, baselines, before-runs | `issues/m4-01-replay-harness.md` | Critical | 0.75 | none |
| M4-2 | Test suites clean up after themselves | `issues/m4-02-clean-test-suites.md` | Critical | 0.5 | none |
| M4-3 | `code-map` plugin and the codex review prompt | `issues/m4-03-code-map-plugin.md` | High | 2 | M4-1 |
| M4-4 | Secret scan at publish gates and before external sends | `issues/m4-04-secret-scan.md` | High | 2 | M4-2 |
| M4-5 | TOON output for `troop` | `issues/m4-05-toon-output.md` | Low | 0.5 | M4-1 |
| M4-6 | OSC notification probe and signal | `issues/m4-06-osc-signal.md` | Medium | 0.5 | none |
| M4-7 | Fixes from real use | `issues/m4-07-fixes-from-real-use.md` | High | 1.5 | M4-2 |
| M4-8 | M2 and M3 issue amendments (docs only) | `issues/m4-08-issue-amendments.md` | Medium | 0.5 | M4-9 |
| M4-9 | Helper tools for every pipeline (`assists`) | `issues/m4-09-helper-tools.md` | High | 1.5 | none |
| M4-10 | Ideas mined from the helper repos, built pipelines | `issues/m4-10-mined-ideas.md` | High | 2 | M4-2, M4-4 |

Total about 11.75 CC days.

```
M4-1 baselines ──┬─> M4-3 code map ──┐
                 └─> M4-5 TOON       ├─> M4-04 real after-runs, M4-03 replay check
M4-2 clean suites ─┬─> M4-4 secret scan ──> M4-10 ideas
                   └─> M4-7 fixes ──> M4-12 UI-01 workday
M4-9 assists ──> M4-8 issue edits
M4-6 OSC probe   (any time)
```

Why this order: baselines and before-runs must exist before any prompt or tool changes, or nothing can be
compared. The suites must run clean first because every later child adds tests, and leftover listeners on
ports 3001 to 3100 make the full core suite hang today (M2-STATUS, M2-01).

#### Milestone 4 rollback and out of scope

Each child lands as its own commit. The code-map plugin uninstalls through the plugin screen and the codex
prompt still works without it. `gate.scan` and `gate.override_reason` are nullable additions, so reverting
the code leaves a database older code can open. TOON is opt-in until a measured flip. `assists` is optional
in the schema; removing it from a pipeline file restores the old prompts. `worktree.npm_ci: false` turns off
I8 without a code change.

Out of scope:

- Tools and ideas for pipelines not built yet (they go into their issues through M4-8).
- `browser.hello` trusting a self-reported pid: same-user processes can already read the ui key, so a pid
  check is not the boundary, and a real fix needs a native module (spec.md: no native module).
- UI-02 (installer and a fresh account): waits on #31 SignPath.
- Code map for agy: waits on a verified `agy-config` attach.
- Installing helpers for the user; helpers contributed by third-party plugins (first-party registry only).
- TOON for browser tools.
- Later list, all gate passes, not built in M4: OpenSpec change-proposal handoff for plan steps, repomix
  `--compress` context packs, difftastic as a diff display, context7 and github-mcp-server as recommended
  MCPs, `anthropics/sandbox-runtime` (Apache-2.0) as a Docker-free option for sandbox-host.

### Milestone 5: launch (about 30 CC days, freeze 2026-11-05, public 2026-12-01)

M1 to M4 built a desk Wasif uses every day. M5 is what a stranger needs on 2026-12-01: a signed installer that works
without Node, a first run that explains itself, Pro on sale, docs that match the app, a catalogue cut to what people
asked for, and a way to plug in the tools teams already use. Specced 2026-10-09 under `/goal` while Wasif was away;
open calls decided by Codex and Gemini (both chose A on all eleven, M5-D1 to M5-D11), money and account calls left
to him (hand-back list below).

Research behind it: `ide-layer-research/m5-demand.md` (what users ask for, with reaction counts),
`ide-layer-research/m5-integrations-demand.md` (which tools, with install counts), the read-only launch audit in
`issues/m5-00-rebaseline.md`, and a repo idea scan per pipeline (17 pipelines, about 1,640 READMEs read by the local model, then
checked for relevance by Haiku and Sonnet), distilled into M5-17, `ide-layer-research/m5-hardening-coding.md` and
`ide-layer-research/m5-repo-scan-preview.md`, which each preview pipeline's issue links.

#### Milestone 5 decisions

| # | Decision | Chosen |
|---|---|---|
| M5-D1 | Pipelines at launch | 5 built-ins: spec-to-pr, spec-build-review-handback, two-engine-review, e2e-browser-qa, and the Pro pr-review-fix. 10 others ship as preview templates (files kept, runnable once added) |
| M5-D2 | No-signal pipelines | prospect-list-to-drafts, inbox-triage-drafts, study-notes-to-pdf leave the gallery and the installer until someone asks; kept in the repo |
| M5-D3 | Features with no demand signal | Inspiration board, variants grid, agent cursors and 12 of the 15 layouts are frozen as they are: no new work, no marketing, fixed only when they break a built-in |
| M5-D4 | Linux | Source install, beta, at launch; packaged Linux in December |
| M5-D5 | Sandbox host | Experimental flag, off by default; its three P0s are after launch |
| M5-D6 | Default approval for a new user | `ask`, with a first-run choice of auto mode; an existing settings file keeps its value |
| M5-D7 | ACU path rule | Becomes the setting `sessions.ask_paths`, empty by default; Wasif's settings carry his path |
| M5-D8 | Integrations at launch | Remote MCP (M5-12), the importer shape fix (M5-13 step 1) and the outbound notification sink (M5-15). Engines as data, marketplace and registry importers and the issue trigger in January 2027 |
| M5-D9 | Pro timing | Pro (M5-6, M5-7) is built before the freeze; the freeze covers it. Supersedes the money plan's "Exams" row |
| M5-D10 | Tray and TOON | Cut: issue files archived, GitHub #41 closed as not planned |
| M5-D11 | Hardening budget | The 5 built-ins are hardened in code (M5-17); preview pipelines get the scan's ideas in their issue files only |
| M5-D12 | Packager | electron-builder, NSIS per-user. It is MIT but under the 25k-star gate, so it ships only after Wasif grants the exception, as xterm got one |
| M5-D13 | MCP servers that write outside | A server marked `writes: external` never attaches to a pipeline-step session, and in interactive sessions only under profiles where the engine still asks per tool. Codex named it a missing call; this is the conservative reading of the gate rule |
| M5-D15 | Where undone work lives | Wasif, 2026-10-09: every undone issue or spec item from M1 to M4 goes into M5 (launch). `issues/m5-00-rebaseline.md` lists each one as BLOCKER (ships 12-01) or M5 (after 12-01, still this milestone). M1 to M4 keep their history; their ledgers point here for anything open. Cut items (M5-D10, CUT rows) are not undone work |
| M5-D16 | T2, what "disagree" means | A finding both engines placed on the same lines always goes to `both`, so the fix loop sees it; when their verdicts differ it carries `split: true`, and the review screen's disagreement rule reads `split` instead of the bucket name. Verdicts are lower-cased and trimmed first. Added to the M5-17 launch set (0.5 CC days). Claude's call after Wasif delegated the open calls on 2026-10-09 ("the rest i think you can answer") |
| M5-D17 | Token saving (A-05) | Stays a standing goal and an internal measurement (M4-03 replay median 0.35 already passes its 0.70 gate). Not a launch claim and not a launch gate; marketing quotes no saving until a real billed run shows one. Claude's call on the same delegation |
| M5-D18 | Public repo scrub | Current files only: the employer path rule becomes the `sessions.ask_paths` setting (M5-D7), and spec.md, the ledgers and `ide-layer-research/` drop the employer's name, the employer path and the personal session counts for neutral wording. Git history is not rewritten (no force push), so what is already public stays in history. Part of M5-10. Claude's call on the same delegation |
| M5-D19 | Code signing (recommendation) | Certum Open Source Code Signing (established CA, issues to individuals worldwide, about EUR 49 a year); OSSign only if Certum's identity check fails. It costs money, so it stands once Wasif buys it |
| M5-D20 | Pro code and licence (recommendation) | Pro as a separate plugin in a private repo with its own licence; Lemon Squeezy licence keys with one user-triggered activation call, cached, documented as the second network exception beside wpad. Stands once Wasif creates the repo and the store |
| M5-D21 | Packager | electron-builder (MIT, 14,670 stars, pushed 2026-10-09) runs only at build time and never ships inside the app, so it falls under the gate's exemption for local tooling. Claude's call on the same delegation |
| M5-D14 | One instruction file | Added after Gemini named it as missing: each engine reads `AGENTS.md` when its own file is absent, through the engine's own flag, never by writing into the project (M5-19) |

#### Milestone 5 children

| # | Title | Issue file | Priority | Effort (CC days) | Depends on |
|---|---|---|---|---|---|
| M5-0 | Every undone M1 to M4 item, now M5 work (BLOCKER or M5 rows) | `issues/m5-00-rebaseline.md` | Mixed, per row | per row | per row |
| M5-1 | Installer and bundled runtime | `issues/m5-01-installer.md` | Critical | 3.75 | M5-D12 |
| M5-2 | Code signing | `issues/m5-02-signing.md` | Critical | 0.5 | M5-1, Wasif's pick |
| M5-3 | First run, engine messages, safe default | `issues/m5-03-first-run.md` | Critical | 1.0 | none |
| M5-4 | Logs | `issues/m5-04-logs.md` | High | 0.5 | none |
| M5-5 | Linux source beta | `issues/m5-05-linux.md` | Medium | 0.5 | none |
| M5-6 | Pro review and fix loop with proof gate | `issues/m5-06-pro-review-proof-gate.md` | Critical | 3.5 | M5-8 S5 |
| M5-7 | Pro licence, trial, checkout | `issues/m5-07-pro-licence-checkout.md` | Critical | 2.5 | M5-6, Wasif's two decisions |
| M5-8 | Launch security subset (S5 is built on m4-harden as M4-4) | `issues/m5-08-launch-security.md` | Critical | 1.0 | none |
| M5-9 | Release gate, CI, versioning | `issues/m5-09-release-gate.md` | High | 1.75 | none |
| M5-10 | Public docs, licences, privacy, ACU setting | `issues/m5-10-public-docs.md` | High | 2.5 | M5-3, M5-18 |
| M5-11 | Site, waitlist, demo data | `issues/m5-11-site-and-demo.md` | High | 1.75 | M5-6 for the GIFs |
| M5-12 | Remote MCP servers | `issues/m5-12-remote-mcp.md` | High | 3.0 | none |
| M5-13 | Importer shape fix (step 1 only at launch) | `issues/m5-13-catalogue-importers.md` | High | 0.5 | M5-12 |
| M5-14 | Engines as data | `issues/m5-14-engines-as-data.md` | M5, after 12-01 | 3.0 | none |
| M5-15 | Notification sink (outbound) | `issues/m5-15-notification-sink.md` | Medium | 2.0 | none |
| M5-16 | Issue trigger and gated write-back | `issues/m5-16-issue-trigger.md` | M5, after 12-01 | 2.5 | M5-14 |
| M5-17 | Hardening the built-ins from the repo scan | `issues/m5-17-pipeline-hardening.md` | High | 5.1 | M5-9 |
| M5-18 | Catalogue cut: built-ins, preview, unshipped | `issues/m5-18-catalogue-cut.md` | High | 0.5 | none |
| M5-19 | One instruction file | `issues/m5-19-one-instruction-file.md` | Medium | 0.5 | none |

Launch total, worked: 3.75 + 0.5 + 1.0 + 0.5 + 0.5 + 3.5 + 2.5 + 1.0 + 1.75 + 2.5 + 1.75 + 3.0 + 0.5 + 2.0 + 0.5 +
0.5 + 5.1 (M5-17) = 30.85 CC days. Calendar: 2026-10-09 to 2026-11-05 is 27 days. 30.85 is more than 27, so M5 fits
only with parallel sessions and the slip rule below; Wasif's review hours are the limit, not Claude's. M5-14 and
M5-16 are after launch and are re-scored by the Codex gate before anyone builds them.

```
M5-18 cut ──> M5-10 docs
M5-8 security (S5 scan) ──> M5-6 Pro loop ──> M5-7 licence ──> M5-11 site and GIFs
M5-1 installer ──> M5-2 signing ──> clean-machine run (M5-01a)
M5-9 release gate ──> M5-17 hardening
M5-12 remote MCP ──> M5-13 shape fix
M5-3, M5-4, M5-5, M5-15, M5-19   (any time)
```

Why this order: the cut comes first because docs, gallery and hardening all depend on which pipelines ship. The
secret scan comes before the Pro loop because Pro sends every diff to OpenAI and Google. The installer comes before
signing because signing needs files to sign. The release gate comes before hardening because every hardening item
adds tests and the suites must already run clean.

Slip rule, decided now so it needs no meeting: on 2026-10-26, if fewer than half the Critical children are done,
M5-15 and M5-19 move to January, then M5-12 and M5-13, then M5-5 to December. Critical children never move; the
launch date moves instead.

#### Milestone 5 hand-back (only Wasif)

1. Buy the Certum certificate and pass its identity check (M5-D19), or say no to it. Nothing public ships before a
   signed installer.
2. Create the private Pro repo and the Lemon Squeezy store: A$19 monthly with a 14-day trial, tax and payout
   (M5-D20), or say no to that shape.
3. Read and accept the Anthropic, OpenAI and Google terms for automated runs and logo use (money plan rule).
4. A fresh Windows account with Smart App Control on, and a Linux box (M5-1, M5-5).
6. On screen for the first real pr-review-fix run, one workday in the app (UI-01), the GIFs (M5-11).

## Acceptance criteria

### Milestone 1

- M1-01. `npm run dev` opens the workbench on laptop-ops with Smart App Control on.
- M1-02 (superseded 2026-10-02 by UI-03 and UI-11). Launching claude, codex and agy for one project opens three Windows Terminal windows named
  `troop-<id8>`, each a normal interactive session on the existing logins, with no API key set.
- M1-03 (superseded 2026-10-02 by UI-06). Independence, per engine: start a long turn, kill the workbench and the core. The agent finishes its
  turn, the user can keep typing, and restarting the core rediscovers the live sessions by pid within 10 s.
- M1-04. With the core never started, every hook and `launch.js` exits 0 with no output, and the engine
  starts no more than 1 s later than without MetaTrooper.
- M1-05. A test types a marker string into a session and asserts it appears in no MetaTrooper log or table.
- M1-06. Speed with 3 live sessions and a running pipeline: window reads p95 under 1 ms; a hook event is on
  screen within 100 ms; pipe commands p95 under 20 ms.
- M1-07. Over a 10-minute scripted session, including two core kills and restarts, the workbench renderer has
  no main-thread task over 50 ms (long-task observer).
- M1-08a. Killing the core between `accepted` and `running` re-executes that command on restart; killing it
  after `running` marks it `error` "interrupted by core restart" with a needs-you item, and it is not re-run.
- M1-08b. A connection without `ui.hello` gets -32012 from `gate.resolve`, whatever `meta.origin` it claims; a
  code step's `ctx` has no path to approve.
- M1-08. Commands sent while the core is down show "queued" within 300 ms and all run, in order, within 2 s
  of restart. A command that arrives both by pipe and by queue (forced by delaying the reply past 300 ms) runs
  exactly once. `session.focus` is never queued.
- M1-09. `Get-NetTCPConnection -State Listen` shows no port owned by the core, workbench or
  `metatrooper-browser`, and no connection upgrades to WebSocket, during a full `two-engine-review` run.
- M1-10. A standard local account other than the owner cannot complete a request on either pipe.
- M1-11. A Claude session shows `waiting_for_you` within 2 s of a permission Notification, `done` within
  2 s of Stop, and `idle` after its card is opened (`session.seen`).
- M1-12. Codex and agy sessions get a `native_id` by the rules in `events-and-hooks.md`, or show "state
  unknown"; they never show a wrong state on the fixture runs.
- M1-13. `hooks install` then `hooks uninstall` leaves `~/.claude/settings.json` and `~/.codex/config.toml`
  byte-identical; the Codex computer-use helper still receives every notify while installed.
- M1-14. The UserPromptSubmit hook delivers a queued comment as the JSON in `events-and-hooks.md`; killing
  the hook before it prints leaves the comment for the next prompt (never lost); a normal run prints it once.
- M1-15. A plugin folder with a valid manifest adds an engine that appears in `engine` and can be bound to a
  role with no core code change; an invalid manifest is rejected with its schema errors.
- M1-16. An action's environment contains only the base variables and approved secrets (checked by a
  fixture action that prints its environment to a file); a hung action is killed with its child processes at
  its timeout.
- M1-17. An imported Claude Code plugin with one MCP server and one env key asks for `secrets:<KEY>`, and the
  value is not written to any MetaTrooper file.
- M1-18. A pipeline with a publish step and no earlier approve gate fails validation from the file and the
  form view; so does a publish or external step with `fanout`, and an agent publish step without a pinned
  `engine`.
- M1-18a. A `kind: "pipeline"` step runs its child with the parent's remaining budget, shows the child's
  gates in the parent, and returns the child's last-step outputs; nesting a pipeline inside itself fails
  validation.
- M1-18b. The same folder opened as `C:\Proj\` and `c:/proj` (on a case-insensitive volume) gets one
  `project_id`.
- M1-19. Changing a publish step's arguments after approval marks the gate `stale` and pauses for a new
  approval; a `code` step and a non-TTY CLI cannot resolve a gate.
- M1-20. A loop that never passes stops at `max`; a step failing 3 times trips the breaker; resume restarts
  from the failed step with earlier outputs kept, and after the breaker it clears the failure counts.
- M1-21. A run over `max_tokens` starts no new step; its overshoot is at most the usage of the steps running
  at that moment, and never more than `max_parallel` of them.
- M1-22. Fan-out 3 on the fixture repo gives 3 worktrees, 3 leased ports starting at 3001 (skipping a port the
  test occupies), and 3 browser panes; each pane is drivable only by the session found through its own
  process ancestry, including for Codex sessions.
- M1-23. The cursor overlay reaches within 5 px of a click point before the click lands, from Claude, Codex
  and agy sessions.
- M1-24. Browser interception blocks `file:`, a loopback port the project does not own, `192.168.x.x`, `[::1]`
  on an unowned port, a `fd00::` address, and a test hostname that resolves to `127.0.0.1`, including requests
  made by page scripts and by `evaluate`.
- M1-25. Full-page capture of a 5,000 px fixture page with a sticky header produces one image 5,000 px tall
  with the header shown once.
- M1-25a. An action spawned with the stripped environment can still run `npm` and a `.cmd` script by name.
- M1-25b. An imported MCP server whose config held a literal env value still starts after import through the
  MCP shim, and the value appears in no MetaTrooper file or engine config in plain text (only in its `.dpapi`
  blob). With the variable missing, the session starts, that server reports the missing name, and a needs-you
  item appears.
- M1-25c. A `dev_command` variant is shown in its pane only after its port answers; discarding the variant
  leaves no process from its tree running and releases the port lease.
- M1-26. `two-engine-review` on a diff with one planted bug returns both verdicts and the four buckets within
  5 minutes.
- M1-27. The hand-back tray has no commit path (grep plus a test that stubs `git`).
- M1-28. The meter's per-session tokens for a Claude session equal the sum over unique `message.id` values in
  its transcript.
- M1-29. toolrouter (renamed from callrouter 2026-09-30, CLI only, no hooks) records `shown_bytes` per call,
  `toolrouter ingest --since --until --json` reports `shell_read_tokens` and `saved_tokens` with ACU excluded
  (#22, section 5), and the repo ships a `troop-plugin.json` whose `ingest` action validates with
  `validateManifest`. Superseded 2026-09-30: callrouter Plan A criteria 1 to 8.
- M1-30. (Revised 2026-10-05, D46.) `project.open` on the vault root and on a folder inside `work/ACU` succeeds;
  `session.launch` there with `approval: contained` (and a pipeline step asking for `contained`) starts in `ask`,
  with no auto-mode flags in the engine's arguments; a session in an ordinary project still starts in auto mode.
- M1-31. `troop run start two-engine-review --json` from inside an agent session starts a run, and `troop
  run wait` returns at its first gate.
- M1-32. `core/`, `workbench/`, `tray/` carry AGPL-3.0; `sdk/`, `pipelines/` and the MIT contract files carry
  MIT.
- M1-33. A core started with `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION` and `CLAUDE_CODE_MESSAGING_TOKEN` set
  opens agent and shell ptys without them, while `CLAUDE_CODE_USE_BEDROCK` and `PATH` pass through. Added
  2026-10-05: agents launched from a core started inside Claude Code saved no transcripts.
- M1-34. With `projects.default` set to an existing folder, a fresh core start leaves that folder as the most
  recent project; set to a folder that does not exist, the core starts, logs it and opens nothing.
- M1-35. Installing the Codex notify hook over a config whose `notify` already runs MetaTrooper's
  `codex-notify.js` (even wrapped several times, with no hooks state) leaves exactly one MetaTrooper wrapper
  around the user's original notify. Added 2026-10-05: Wasif's config had the wrapper nested twice.
- M1-36. A Codex session launched by MetaTrooper gets its MCP servers and its notify wrapper as `-c`
  overrides, and launching never edits `config.toml`; `troop hooks uninstall --codex` removes the MetaTrooper
  block older versions wrote there. Changed 2026-10-08 (H8): the global block started `metatrooper-browser` in
  every Codex run on the laptop. On 2026-10-05 `-c` was seen to put Codex in embedded mode ("Running without
  the shared background server"); that is the accepted cost of not touching the global config.
- M1-37. `session.launch` with no `approval` in an ordinary project starts claude with `--permission-mode auto`
  and codex with `--approve-for-me` (the `contained` profile); with `sessions.approval` set to `ask` it adds
  neither; an engine without a `contained` profile starts in `ask` instead of failing.
- M1-38. A pipeline agent step bound to agy launches agy as the session with `--print`, a prompt carrying the
  step's `output_path` and its required keys, and `--add-dir` for the run folder; with `print_args` removed
  from agy it launches agy interactive. In a `work/ACU` folder the command carries no `--mode` or `--sandbox`
  flags. An agy that writes the output on its second run completes the step; one that never writes it fails
  the step after two runs with the last error as `reason`; an auto-denied run is not retried, and a resumed
  step whose error repeats that reason runs once. Added 2026-10-05 (D47), reshaped 2026-10-08 (D51).
- M1-39. In a project inside a folder tree that contains `work/ACU` (but not containing it itself), `session.launch`
  with `approval: contained` starts codex and agy with no auto-mode flags (ask) and claude with `--permission-mode
  auto`; a project outside any such tree starts all three in auto mode; an agy pipeline step there runs agy without
  `--mode accept-edits --sandbox`.

### Adoption gate (14 days after milestone 1, measured by #22)

Baselines come from 2026-06-01 to 2026-09-29, non-ACU only: 496 prompts (845 total minus 349 ACU).

- A-01. At least 70% of non-ACU Claude sessions in the window have their `sessionId` in `session.native_id`.
- A-02. Status asks per 100 non-ACU prompts fall below 1. Baseline: 24 / 496 x 100 = 4.8. A status ask is a
  prompt matching `what are you doing|how long|\beta\b|/btw eta|status\?` (case-insensitive).
- A-03. Smoke-test engine runs fall below 3% of engine runs. Baseline: 26 / 183 = 14.2%. An engine run is one
  Codex session file under `~/.codex/sessions/` or one Gemini conversation under
  `~/.gemini/antigravity-cli/conversations/` started in the window, excluding ACU cwds. It is a smoke test
  when its first user message is under 80 characters and matches
  `reply (ready|ok)|name the model|which model|echo|ping|say ok|are you (there|working)` (case-insensitive).
  MetaTrooper's own `engine_check` rows are not engine runs.
- A-04. Pasted screenshots per 100 non-ACU prompts fall below 0.5. Baseline: 12 / 496 x 100 = 2.4. Counted as
  prompts in `~/.claude/history.jsonl` in the window whose `display` contains `[Image #`, excluding ACU
  sessions (same rule as the baseline). #22 re-runs the 2026-09-29 baseline scripts unchanged so both numbers
  are measured the same way.
- A-05. toolrouter saves at least 20% of shell and Read result tokens in the window:
  `saved_tokens / (shell_read_tokens + saved_tokens)`, from `toolrouter ingest` (#22, section 5).

### Milestone 2

- M2-01. Each milestone-2 built-in runs end to end on its fixture and stops at every gate before a publish
  step.
- M2-02. The inspiration board returns at least 8 references with captures for the fixture brief.
- M2-03. Variants: Pick shows that worktree's diff in the tray; Combine starts a new worktree with the note
  and crops; Discard removes the worktree.
- M2-04 (dropped 2026-10-02 with #28). With the herdr plugin, a `continue` step reaches the earlier herdr pane via `agent.prompt` and the
  run advances on herdr `done`; without it, the same pipeline runs in Windows Terminal and the log shows
  `memory not kept`.
- M2-05. The usage bar shows Claude and Codex usage against their windows with reset times, or "usage
  unavailable"; it never shows an invented number.
- M2-06. A diff-line comment and a dropped file reach the target session by its delivery route.
- M2-07. Once SignPath approves, the signed Electron installer installs and launches on laptop-ops with Smart
  App Control on.
- M2-08. Hands-off: `troop launch --jobs` with `approval: "isolated"` on the tinyutils fixture (3 seeded bugs,
  one per engine) ends with each engine's own test file passing in its worktree, zero approval prompts, zero
  trust prompts, and each session reaching `done` from spool events alone.
- M2-09. Escape self-test (`troop sandbox selftest`, same flags as a trooper, no engine): each of these fails
  from inside the container, and each positive check passes. Fails: writing any host path outside the mounted
  worktree, `.git` and spool; writing `.git/hooks` or `.git/config`; reading the host home folder; writing a
  read-only login file (EROFS); an HTTPS
  request to a host not on the allow-list (proxy 403); any request that bypasses the proxy (no route); reaching
  the Docker socket; gaining root. Passes: writing in the worktree; `git commit` on the worktree's branch;
  an HTTPS request to one allow-listed host.
- M2-10. A marker typed into a sandboxed session appears in no MetaTrooper table, log, spool file or WAL once
  the session is `exited` and ingested (M1-05 extended to the sandbox).
- M2-11. Closing a sandboxed session's window leaves no `troop-<id8>` container within 5 s; killing the core
  mid-turn leaves the agent working, and its spooled events are ingested in order after restart.
- M2-12. `isolated` on the `pty` host, a launch before `troop sandbox build`, a Claude login expiring within
  60 minutes, and an ACU path are each refused with a stated reason, and nothing starts.

### Milestone 3

- M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish
  step.
- M3-02. `cite-check` fails a report with one planted quote absent from its source and passes the same report
  with curly quotes and extra whitespace in a real quote.
- M3-03. `form-fill-batch` pauses at a handoff gate when the fixture form shows its captcha stand-in and
  resumes on Continue.
- M3-04. The gallery lists all 17 templates, each "ready" only when its `requires` are installed.
- M3-05. The Tauri tray shows the same session states and gates as the workbench.
- M3-06. `provider: gateway` and `run_in: cloud` are refused with -32040 and nothing else changes; signed
  out, a full `spec-to-pr` run makes zero outbound connections from the core, workbench or tray.

### Milestone 4

M4 is done when M4-02, M4-03 and M4-04 below pass and UI-01 passes as M4-12 defines. Every other
criterion lives in its child's issue file.

- M4-02. The full core suite, run alone twice in a row, passes, and `tests/windows/listeners.ps1` prints
  `count=0` after each run. Same for the workbench suite.
- M4-03. Replay: for each of `small`, `medium`, `large`, compute `after.tokens / before.tokens` for
  `codex-review`. The median of the three ratios is at most 0.70.
- M4-04. After M4-3, M4-9 and M4-10 land, the same two real runs as `real-before.json` are repeated on the
  same fixture and inputs: for each pipeline, the total Claude plus Codex tokens of its agent steps is lower
  than before. Recorded in `tests/fixtures/token-replay/real-after.json`. No threshold.
- M4-12. UI-01, evidence-based: on one weekday Wasif works only in the app. Evidence: `troop gate --since
  <day> --until <next day> --json` shows at least 5 sessions launched from the app and 1 completed pipeline
  run, and Wasif records in UI-STATUS any moment he left the app for an agent task (zero for a pass).

### Milestone 5

M5 is done when the acceptance criteria in the issue files of M5-1 to M5-13, M5-15, M5-17, M5-18 and M5-19 pass
(minus any child the slip rule moved, which then counts under its new milestone), and these four hold:

- M5-01a. A fresh Windows account with Smart App Control on and no Node installs the signed installer and starts a
  claude agent within 30 s.
- M5-06a and M5-06d. pr-review-fix counts a finding as fixed only with a passing proof and a clean rereview, on the
  fixture and in one real run.
- M5-07b. A test-mode purchase unlocks Pro.
- M5-09a. `tests/release.ps1` passes twice in a row on the commit tagged `v0.1.0`.

## Testing

The builder writes code; Codex writes the tests for #12, #15, #17 and sandbox-host (the parts others will trust), matching the
rule already binding callrouter. Every contract file gets a conformance suite: `schema.sql` loads; every
built-in and template validates against `pipeline.schema.json`; every first-party manifest validates against
`plugin-manifest.schema.json`; the pipe protocol has a replay suite of recorded requests and replies.

| Layer | What | Count |
|---|---|---|
| Unit | project id and ACU refusal; event to state mapping per engine; session linking; role binding; validation and the publish rule; `action_hash`; loop, breaker, resume, budget; port allocation; finding merge; manifest and importer mapping; usage dedupe; cite-check normalisation | +45 |
| Integration | launch to event to state; pipe request and queue fallback; crash recovery of accepted and running commands; hooks install and uninstall round trip; action env and tree kill; MCP shim with a missing secret; browser ownership and interception (IPv4 and IPv6); full-page capture; UserPromptSubmit at-least-once delivery including a marked duplicate; sub-pipeline budget and gates; code-step IPC; dev-server start, readiness and stop | +20 |
| E2E | open a fixture project, run `spec-build-review-handback` with stub engines through every gate; `two-engine-review`; point-to-comment round trip; kill-the-core independence run | +5 |
| Conformance | contracts as above | +4 suites |

## Rollback

- Code: delete the repo; nothing else imports it.
- Hooks: `troop hooks uninstall` (byte-identical, M1-13); callrouter's own rollback in its
  `spec.md:145-151`.
- Codex notify: restored by uninstall; a manual backup is at `~/.codex/config.toml.troop-bak`.
- Worktrees: delete `~/.metatrooper/worktrees/`, then `git worktree prune` in each project.
- Run files: delete `<project>/.troop/`.
- Data: delete `~/.metatrooper/`.

## Dependencies

| Package | Licence | Stars (2026-09-29) | Use |
|---|---|---|---|
| electron | MIT | 123,297 | workbench |
| tauri | Apache-2.0 or MIT | 111,464 | tray |
| @modelcontextprotocol/typescript-sdk | not declared in GitHub metadata | 13,485 | `metatrooper-browser`; its LICENSE file is read before install, and if it is not MIT or Apache-2.0 the server is written as plain JSON-RPC over stdio instead (about 200 lines) |
| pdf.js | Apache-2.0 | not checked | `docs-export` plugin, PDF ingest. Accepted exception to the MIT rule |
| Google Node client | Apache-2.0 | not checked | `gmail` plugin. Accepted exception to the MIT rule |
| Postiz | AGPL-3.0 | 36,699 (2026-10-05) | `social-scheduler` schedule backend, reached over its HTTP API only; never bundled or linked. Accepted exception to the MIT rule |

No terminal library, WebSocket library or native module is needed.

## Files

| Path | Change |
|---|---|
| `projects/metatrooper/contracts/` | the contracts above (written 2026-09-29) |
| `projects/metatrooper/core/` | service, `event.js`, `launch.js`, `codex-notify.js`, runner, plugins, meter, limits, `metatrooper-browser`, CLI |
| `projects/metatrooper/workbench/` | Electron main and renderer |
| `projects/metatrooper/tray/` | Tauri app |
| `projects/metatrooper/sdk/` | plugin helper library (MIT) |
| `projects/metatrooper/pipelines/` | 17 built-ins and 17 templates (MIT) |
| `projects/metatrooper/plugins/` | the first-party plugins above |
| `projects/metatrooper/tests/fixtures/` | one fixture per built-in |
| `projects/callrouter/` | Plan A code plus `troop-plugin.json` |
| `~/.claude/settings.json`, `~/.codex/config.toml` | hook and notify entries, merged and reversible |

## Later epics

- **v2, metered cloud:** gateway, cloud runs, hosted media, sync, accounts, payments (D29).
- **v3, phone:** see and drive sessions from a phone, like Claude Code Remote Control. It must keep rule 1:
  the phone reaches an agent through the engine's own remote feature (Claude Code Remote Control), never by
  streaming an agent's terminal through MetaTrooper. MetaTrooper's side is
  read-only status, the needs-you queue and gate approvals on the phone, which the cloud epic's relay makes
  possible. Nothing in this epic blocks it: state is already in the database and approvals already need a
  trusted UI connection.

## Out of scope

- The metered cloud and phone control: later epics, above.
- Scheduled runs while the core is not running; back-filling missed schedules.
- OS-level sandboxing of plugin filesystem and network access (AppContainer). Trooper sandboxing is sandbox-host, not this.
- Auto-update.
- The sprawll plugin, until sprawll's code is present with its machine contract.
- Paid data integrations beyond the listed adapters (Ahrefs, Semrush, DataForSEO, Clay, Apollo); users add
  them as plugins.
- Any setting that turns off the publish rule.
- Running any lane on ACU projects.
- Callrouter Plan B.
- A visual node-graph editor.
- macOS testing; the code stays portable. Linux is a source-install beta at launch and packaged in December (M5-D4).

## Related

- `ide-layer-research/pipeline-map.html`: Wasif's own pipelines and the market scans.
- `ide-layer-research/pipeline-catalog.md`: 25 ranked pipelines plus 7 appendix pipelines, with sources.
- `projects/callrouter/docs/`: Plan A, schema and the failure rule reused here.
- Orca `github.com/stablyai/orca`, herdr `github.com/herdrdev/herdr`: prior art.
