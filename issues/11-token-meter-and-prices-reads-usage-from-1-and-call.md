# Token meter and prices (reads `usage` from #1 and callrouter "saved")

Child #11 of the Agent Harness epic. Milestone 1. Effort: about 1.5 Claude Code days.

Depends on: child #1, child #2.

## What

Token meter and prices (reads `usage` from #1 and callrouter "saved")

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: schema.sql (usage), spec.md § Usage limits and meter.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M1-28. The meter's per-session tokens for a Claude session equal the sum over unique `message.id` values in its transcript.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
