# Changelog

All notable changes to MetaTrooper are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).
The version lives in the root `package.json`; `node tests/version-check.mjs` checks every other manifest against it.

## [Unreleased]

### Added

Milestone 6 makes MetaTrooper four parts: the wall, browser use, computer use and core services (spec.md D52).

- Computer use on Windows (M6-15). The `metatrooper-desktop` MCP server acts on windows the user gives a session from
  its tile, through a UI Automation helper built into Windows (nothing installed). Password fields, send-like
  controls and file dialogs ask every time; the workbench, elevated windows and the secure desktop can never be
  granted; Control and Shift chords are refused. Ctrl+Alt+Q pauses all agent input. A grant frame outlines each
  granted window, and Ctrl+Alt+W opens the watch layout.
- Input watcher (M6-22). While a grant is live, injected input that no MetaTrooper action sent, or a desktop change
  while the user is away, raises a needs-you item and pauses the agents (`desktop.watch_pause`, default on).
- Agent cursor (M6-18, landing). Each session gets its own cursor in its colour, gliding to each browser or desktop
  target before the input lands, in under 250 ms. The real pointer never moves. `agent_cursor.*` settings.
- Demo mode (M6-16, landing). `npm run dev -- --demo` opens an isolated copy with demo sessions and no secrets,
  whose window is the only one an agent may be given, so agents can test the workbench.
- Approvals for agent actions (M6-2). Risky browser and desktop inputs stop at an approval card in the window:
  Approve once, Approve for this session, or Reject. Only the trusted UI connection can resolve one.
- Browser tools version 2 (M6-11): stable refs, an answer from the page after each action, bounded snapshots with
  frames and shadow roots, a `read` tool, crash reports. Pane hygiene and picks (M6-13).
- Session ports and dev-server previews (M6-3). A dev server a session starts gets an "Open preview" chip; agent
  panes load only loopback ports their own session owns.
- Core reliability (M6-4): one core per home, a single safe settings writer, numbered migrations, `core.ping` with
  version and protocol, and a restart owner.
- State from each engine's hooks (M6-5) for Claude Code, Codex and Gemini, with a reason and time on every wait.
  True status part 2 (M6-23): background work, StopFailure, interrupts, fatal patterns and opencode.
- Terminal speed (M6-7): flow control by byte credit and query answers with no window attached. Agent input
  (M6-8): Shift+Enter, image paste and links. Wall keys and attention (M6-9) on Alt, with a focus-steal rule.
- Quiet, named notifications (M6-10). Search all terminals from Ctrl+K (M6-19). Cost, context fill and changed files
  per tile (M6-20, M6-25, M6-21). Limits that carry on after a reset, with an early-end warning (M6-24).
- Public API (M6-17): one method list generates `pipe-protocol.md`, `troop --help` and the skill; stable methods keep
  their shape within a protocol version; `session.wait`.
- Wall repairs and no hide on live agents (M6-26, M6-27).
- Browser handoff, origins, secrets and audit (M6-12). An agent can hand a browser pane to the user with `handoff`;
  every other browser tool then fails with "the user has the pane" until the user presses Give back. The first input
  on a new origin asks for approval unless the `browser.allow_origins` setting lists it (a UI-only setting since D5, not the
  agent-writable `.troop/config.json`). `type` with
  `{{secret:NAME}}` fills a secret saved with `troop browser secret <NAME> <origin>` (DPAPI store), only into a
  password field on that origin; the value never reaches the agent, an event, a log or an approval row. Browser tool
  output is scrubbed of secret values, bearer tokens, cookies, URL credentials and token-looking query values, and
  every browser tool call is a `browser.tool` event row kept 30 days, shown as the pane's Timeline.
- Sessions come back after a restart (M6-6). At start the core resumes every terminal session the last core left
  open, at most 3 at a time, 2 s apart plus up to 1 s of jitter. An engine whose resumed screen matches its new
  `auth_error` pattern twice is not resumed again and raises one needs-you item. The workbench saves the wall layout
  and its shells per project in `ui.layout` through `settings.set` and rebuilds both, with resumed sessions in their
  old tiles. Each terminal's last 200 rows are saved under `~/.metatrooper/screens/` when it exits or the core stops,
  and an ended session's tile shows them.
- metarouter joins the repo as `router/`, with its history. `troop route <args>` runs it with no separate install
  (Python 3.11+, or `TROOP_PYTHON`); `troop gate` reads A-05 from the same copy; `router/` is also a plugin whose
  `ingest` action now answers in the plugin contract shape. Its tests run in CI.
- metarouter is on by default in every session the desk starts: `router/bin` first on `PATH`, and Claude sessions get
  the metarouter block through `--append-system-prompt`. `sessions.metarouter: false` turns it off.
- Opt-in Claude Code hook `python -m metarouter.hook` (PreToolUse, matcher Bash) runs plain Bash commands through
  `metarouter exec`. It leaves bare cd/export/source, git writes, rm, background commands, private-pattern matches
  and `MR_RAW=1` commands raw, and sets no permission decision. `METAROUTER_HOOK=off` disables it.
- Release gate `tests/release.ps1`: version check, core and workbench suites, every opt-in suite, then the listener check.
- CI on `windows-latest` and `ubuntu-24.04` for every push to main; a `v*` tag makes a draft release with SHA-256 checksums.
- One version source in the root `package.json`, with `tests/version-check.mjs`.

### Changed

- MetaTrooper installs from source (D72). The Windows installer and code signing wait until there are users
  outside the author; the README describes the source install only.
- The repo plugin's version moves from 1.0.0 to 0.1.0 to match the root version.

### Removed

- M6-1: pipelines leave MetaTrooper. The runner, schedules, run layouts, the Runs and Pipelines tabs, gate cards,
  variants, the inspiration board and ten pipeline-only plugins move to `../suite-of-products/shared/`; the tag
  `pipelines-final` keeps every removed path. `run.*`, `gate.resolve`, `schedule.set`, `pipeline.validate`,
  `template.list`, `variant.*` and `board.*` answer -32601 "moved to the pipeline products", and `troop run` exits 2.
  Pipeline tables and their rows stay in the database (D58).
- The paid add-on and its licence check are cut (D64).

## [0.1.0]

Not yet tagged. Milestones 1 to 4, as recorded in `status/M1-STATUS.md` to `status/M4-STATUS.md`.

### Added

- M1: the core (SQLite store, pipe, sessions, gates), the `troop` CLI and the Electron workbench.
- M2: pipelines and the plugin runtime, with approval profiles and secrets kept with DPAPI.
- M3: the built-in pipelines and plugins, among them two-engine review, browser QA, docs and release notes.
- M4: shared browser panes, the code map, the secret scan, session glue and clean test suites.

[Unreleased]: https://github.com/Wasif-ZA/metatrooper/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Wasif-ZA/metatrooper/releases/tag/v0.1.0
