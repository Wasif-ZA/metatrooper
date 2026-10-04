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
| `contracts/browser-tools.md` | the 12 `metatrooper-browser` tools, capture, and the browser safety rules |

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
| D19 | Terminals | In-app terminals owned by the core service (node-pty over ConPTY); the window only shows them, and close and reopen reattaches. Revised 2026-10-02 by the UI revision (issues/ui-revision-epic.md D1) |
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
| D37 | Scope | Keep all 31 children, ship in 3 milestones; #32 added 2026-09-29 (D43) |
| D40 | Phone | Using the terminals and the IDE from a phone (like Claude Code Remote Control) is a v3 epic, after the cloud epic |
| D41 | Approval profiles | Per-engine registry data: `ask`, `edits`, `contained`, and `isolated` (sandbox host only). `contained` is the default on a MetaTrooper worktree, `ask` elsewhere (2026-09-29) |
| D42 | Worktree trust | `worktree.create` marks the new worktree trusted in every engine that declares a trust store in its registry entry; the core names no engine (2026-09-29) |
| D43 | Trooper sandbox | Own container host plugin, child #32 in milestone 2, built after the adoption gate. Ideas from AIO Sandbox and CubeSandbox, neither adopted; read-only login mounts plus an egress allow-list; agy logs in once into a keyring volume (2026-09-29) |

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
 | board | browser | variants |   |   | lights, needs-you, meter|   | (agents use it)   |
 | runner | review | hand-back    |   +-----+-------------+-----+   +----+---------+----+
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
7. **ACU refusal.** `project.open` refuses any path containing `work/ACU` (case-insensitive) with error
   -32001. ACU work stays in plain Claude Code.

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
| `agy` | `agy` | none (clipboard handoff until verified in child #1) | file-activity, glob `~/.gemini/antigravity-cli/brain/*/.system_generated/logs/**` | none | research, worker, review, visual-check | 1 | none |

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
| SEO | `seo-audit-fix` | 11 | seo, repo | 3 |
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

An alternative session host (D43), child #32. It exists so the `isolated` approval profile can run an engine
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
when both are mounted at their mapped paths. The main repo's working tree is not mounted. The terminal owns
the container (`--rm -it`): closing the window removes it, and the core never starts or stops one.

**Logins.** Each engine's registry `sandbox.logins` lists read-only file mounts,
for example `~/.claude/.credentials.json` and `~/.codex/auth.json`, mounted `:ro` at the same place under
`/home/trooper`. Read-only means an engine cannot rotate a refresh token and log the host out. Before
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
own; plugins with `network` do, and are listed.

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

| # | Title | Effort | Depends on |
|---|---|---|---|
| 1 | Core service: `schema.sql` (frozen first), event processor with redaction, state machine, launcher, session linking, engine registry and health, named-pipe server with run-once commands, queue, port leases, DPAPI secret store, schedules, `usage` ledger, licence files, ACU refusal | 4.5 | none |
| 3 | Plugin system: manifest validation, install screen and approval, action runner with env stripping and tree kill, pane bridge, Claude and Codex/agy importers | 3.5 | 1 |
| 2 | Callrouter Plan A, in the callrouter repo, meeting its own criteria 1 to 8; then its `troop-plugin.json` | 2.5 | 3 (for the plugin part only) |
| 4 | Pipeline runner: validation with the publish rule, handoff contract, completion signals, gates with `action_hash`, fan-out, worktrees, port allocation, loops, resume, breaker, budgets, code steps, `repo` plugin | 4.5 | 1, 3 |
| 5 | Electron workbench: project picker, session cards and focus, engine lights, runner view, form editor, gate panel, needs-you queue, "core offline" badge, database watcher | 3 | 1, 4 |
| 6 | Live browser: panes, `metatrooper-browser` MCP, browser pipe with ownership checks, cursor overlay, request interception, isolated `evaluate`, full-page capture, point-to-comment, before/after | 5 | 1, 5 |
| 9 | Two-engine review pipeline and view | 1 | 4, 5 |
| 10 | Hand-back tray | 0.5 | 1, 5 |
| 11 | Token meter and prices (reads `usage` from #1 and callrouter "saved") | 1.5 | 1, 2 |
| 31 | Agent-native `troop` CLI and skill | 1.5 | 1, 4 |
| 13 | Measurement tooling for the adoption gate | 0.5 | 5 to 11 |

Then the **adoption gate**: 14 days of Wasif's daily use, measured by #13, before milestone 2 starts.

### Milestone 2: design and coding lanes (about 18 CC days)

| # | Title | Effort | Depends on |
|---|---|---|---|
| 7 | Inspiration board and `agent-reach` plugin | 1.5 | 3, 4, 6 |
| 8 | Variants grid: tiles, pick, combine, discard | 2 | 4, 6 |
| 14 | `github` and `deploy` plugins; `spec-to-pr`, `e2e-browser-qa`, `website-build`, `design-variants` | 2.5 | 4, 5, 6, 7, 8 |
| 23 | `docs-and-release-notes` | 1 | 14 |
| 25 | `security` plugin and `security-review-and-upgrade` | 1.5 | 9, 14 |
| 27 | herdr host plugin (dropped 2026-10-02, UI revision D8) | 0 | none |
| 29 | Usage limits and account switcher | 2 | 1, 5 |
| 30 | Diff annotation and file drag | 1 | 10 |
| 28 | Signed packaging through SignPath Foundation (Electron now; Tauri in milestone 3) | 1.5 | 5 |
| 32 | Trooper sandbox host plugin: container image, `--host sandbox` launcher path, read-only logins, agy keyring login, egress proxy, spool bridge, escape self-test | 3 | 1, 3, 4 |

### Milestone 3: every other lane (about 18.5 CC days)

| # | Title | Effort | Depends on |
|---|---|---|---|
| 15 | `media` plugin and `footage-to-edit` | 2.5 | 4, 5 |
| 16 | `social-scheduler` plugin and `clips-to-scheduled-posts` | 1.5 | 15 |
| 17 | `seo` plugin and `seo-audit-fix` | 2 | 6, 14 |
| 18 | `cite-check` plugin and `deep-research-cited` | 1 | 4, 6, 7 |
| 19 | `gmail` plugin, `prospect-list-to-drafts`, `inbox-triage-drafts` | 2 | 4, 5, 7 |
| 20 | `data` plugin and `data-to-dashboard` | 1 | 4, 5 |
| 22 | `docs-export` plugin and `study-notes-to-pdf` | 1.5 | 9, 15 |
| 24 | `desktop` plugin, handoff gate UI, `form-fill-batch` | 3 | 4, 5, 6 |
| 21 | Template gallery (17 templates) | 1 | 3, 4, 5 |
| 12 | Tauri tray companion, signed through #28's pipeline | 2 | 1, 28 |
| 26 | Open-core seams: `provider: gateway` and `run_in: cloud` refusals, account state | 1 | 1, 4 |

Total: about 64.5 CC days (28 + 18 + 18.5). Human-team equivalent: about 12 months.

Sequencing: #1's schema and pipe protocol are frozen before any client is built, because everything else
reads them. Plugins come before the runner because steps call actions. Callrouter's own code (C1, C9, C7)
can be built in parallel from day one; only its plugin manifest waits for #3. The browser precedes the board
and variants because both render through it. Milestone 2 waits for the adoption gate so lanes are built on a
core that has survived daily use; milestone 3 lanes are independent of each other.

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
  from the failed step with earlier outputs kept.
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
  (#13, section 5), and the repo ships a `troop-plugin.json` whose `ingest` action validates with
  `validateManifest`. Superseded 2026-09-30: callrouter Plan A criteria 1 to 8.
- M1-30. `project.open` on a path containing `work/ACU`, or on a folder with `work/ACU` (or, for a folder named
  `work`, `ACU`) directly below it, returns -32001. Added 2026-10-02: opening the parent would let an engine read ACU.
- M1-31. `troop run start two-engine-review --json` from inside an agent session starts a run, and `troop
  run wait` returns at its first gate.
- M1-32. `core/`, `workbench/`, `tray/` carry AGPL-3.0; `sdk/`, `pipelines/` and the MIT contract files carry
  MIT.

### Adoption gate (14 days after milestone 1, measured by #13)

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
  sessions (same rule as the baseline). #13 re-runs the 2026-09-29 baseline scripts unchanged so both numbers
  are measured the same way.
- A-05. toolrouter saves at least 20% of shell and Read result tokens in the window:
  `saved_tokens / (shell_read_tokens + saved_tokens)`, from `toolrouter ingest` (#13, section 5).

### Milestone 2

- M2-01. Each milestone-2 built-in runs end to end on its fixture and stops at every gate before a publish
  step.
- M2-02. The inspiration board returns at least 8 references with captures for the fixture brief.
- M2-03. Variants: Pick shows that worktree's diff in the tray; Combine starts a new worktree with the note
  and crops; Discard removes the worktree.
- M2-04 (dropped 2026-10-02 with #27). With the herdr plugin, a `continue` step reaches the earlier herdr pane via `agent.prompt` and the
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
  worktree, `.git` and spool; reading the host home folder; writing a read-only login file (EROFS); an HTTPS
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

## Testing

The builder writes code; Codex writes the tests for #1, #4, #6 and #32 (the parts others will trust), matching the
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
- OS-level sandboxing of plugin filesystem and network access (AppContainer). Trooper sandboxing is #32, not this.
- Auto-update.
- The sprawll plugin, until sprawll's code is present with its machine contract.
- Paid data integrations beyond the listed adapters (Ahrefs, Semrush, DataForSEO, Clay, Apollo); users add
  them as plugins.
- Any setting that turns off the publish rule.
- Running any lane on ACU projects.
- Callrouter Plan B.
- A visual node-graph editor.
- macOS and Linux testing; the code stays portable, only Windows is tested.

## Related

- `ide-layer-research/pipeline-map.html`: Wasif's own pipelines and the market scans.
- `ide-layer-research/pipeline-catalog.md`: 25 ranked pipelines plus 7 appendix pipelines, with sources.
- `projects/callrouter/docs/`: Plan A, schema and the failure rule reused here.
- Orca `github.com/stablyai/orca`, herdr `github.com/herdrdev/herdr`: prior art.
