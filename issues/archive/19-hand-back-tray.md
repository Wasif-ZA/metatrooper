# Hand-back tray

Part of the MetaTrooper epic. Milestone 1. Effort: about 0.5 Claude Code days.

Depends on: child #12, child #16.

## What

Hand-back tray

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: spec.md § Hand-back tray.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M1-27. The hand-back tray has no commit path (grep plus a test that stubs `git`).

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
