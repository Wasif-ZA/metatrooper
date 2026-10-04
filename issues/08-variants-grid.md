# Variants grid

Child #8 of the MetaTrooper epic. Milestone 2. Effort: about 2 Claude Code days.

Depends on: child #4, child #6.

## What

Variants grid: tiles, pick, combine, discard

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M2-03. Variants: Pick shows that worktree's diff in the tray; Combine starts a new worktree with the note and crops; Discard removes the worktree.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
