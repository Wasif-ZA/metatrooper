# Token meter and prices (reads `usage` from #12 and callrouter "saved")

Part of the MetaTrooper epic. Milestone 1. Effort: about 1.5 Claude Code days.

Depends on: child #12, child #14.

## What

Token meter and prices (reads `usage` from #12 and callrouter "saved")

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: schema.sql (usage), spec.md § Usage limits and meter.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M1-28. The meter's per-session tokens for a Claude session equal the sum over unique `message.id` values in its transcript.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
