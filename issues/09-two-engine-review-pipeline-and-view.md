# Two-engine review pipeline and view

Child #9 of the Agent Harness epic. Milestone 1. Effort: about 1 Claude Code days.

Depends on: child #4, child #5.

## What

Two-engine review pipeline and view

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: spec.md § Two-engine review.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M1-26. `two-engine-review` on a diff with one planted bug returns both verdicts and the four buckets within 5 minutes.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
