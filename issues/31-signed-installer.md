# Signed installer through SignPath Foundation

Part of the MetaTrooper epic. Milestone 2. Effort: about 1.5 Claude Code days.

Depends on: child #16.

## What

Signed packaging through SignPath Foundation (Electron now; Tauri in milestone 3)

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M2-07. Once SignPath approves, the signed Electron installer installs and launches on laptop-ops with Smart App Control on.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
