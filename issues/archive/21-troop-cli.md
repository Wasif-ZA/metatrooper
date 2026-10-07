# Agent-native `troop` CLI and skill

Part of the MetaTrooper epic. Milestone 1. Effort: about 1.5 Claude Code days.

Depends on: child #12, child #15.

## What

Agent-native `troop` CLI and skill

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: pipe-protocol.md.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M1-31. `troop run start two-engine-review --json` from inside an agent session starts a run, and `troop run wait` returns at its first gate.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
