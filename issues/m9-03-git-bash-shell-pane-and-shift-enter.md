# M9-03: Git Bash shell pane on the Wall, and Shift+Enter for a newline

Part of Ouros, Milestone 9 (daily driver by 2026-11-16). Priority: Blocker. Effort: 0.5 d. Depends on: none.
**Build 2026-11-10 (running). Tests 2026-11-11.**

## Source of truth

- Scratch `~/.cache/claude-scratch/ouros-build-2026-11-10/build-brief-backend.md`, item 4.
- `research/vscode-gap.md` row 1. This is the thing he does most: `cd` 35, `git` 13, `gh` 5, `claude` 4 of his last 100 commands.
- Existing code: `shell.open` with shell kinds (`workbench/renderer/app.js` `ui.shells`, `ui.shellKinds`, `reopenShell`).

## Goal

He runs Claude Code, git, gh and npm in a plain Git Bash pane beside his agents, exactly as in the VS Code terminal.

## Scope

| # | Change |
|---|---|
| 1 | Git Bash is one of the shell kinds and opens in the project folder |
| 2 | Shift+Enter in any terminal sends ESC then Enter (`\x1b\r`). This is his only custom VS Code key |
| 3 | A shell pane comes back after a restart of the app (existing saved-layout path) |

## Out of scope

- A terminal inside the IDE screen. The IDE's Terminal tab keeps its "Not built yet" badge and its "Open the Wall" button.
- Terminal profiles, split shells, persistent scrollback across restarts.
- Detecting a `localhost` address in output (gap row 7). He pastes the address into a browser pane.

## Contract

- No new RPC if `shell.open` already takes a kind. A new kind is one row in the kinds table.
- Git Bash is found at its installed path. If it is missing the kind is not offered; nothing falls back silently.
- The key is handled in the xterm.js key handler, for agent terminals and shell panes alike.

## Acceptance checks

- [ ] M9-03a. On screen: New, Git Bash. A pane opens in the project folder. `git status` and `gh --version` run.
- [ ] M9-03b. Run `claude` in it. Type a line, press Shift+Enter, type a second line, press Enter. Claude Code receives one message of two lines.
- [ ] M9-03c. Plain Enter still sends. Ctrl+C still interrupts.
- [ ] M9-03d. Close the app and open it again. The shell pane is back in the same place.
- [ ] M9-03e. Tests cover the bytes sent for Shift+Enter and Enter; a mutation run catches every mutant.

## Engines

- Build: Opus worker (same run as M9-01). Tests: Codex. If Codex is at its limit: Gemini.

## Rules that bind every child

- Commit locally on `ouros/build-1110`. No push, no trailers, no amend or rebase.
- The builder never writes its own tests. Every test batch gets a mutation check.
- No new dependency. No em dashes. One-line comments.
