# Agent-native `harness` CLI and skill

Child #31 of the Agent Harness epic. Milestone 1. Effort: about 1.5 Claude Code days.

Depends on: child #1, child #4.

## What

Agent-native `harness` CLI and skill

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: pipe-protocol.md.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M1-31. `harness run start two-engine-review --json` from inside an agent session starts a run, and `harness run wait` returns at its first gate.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
