# Usage limits and account switcher

Child #29 of the MetaTrooper epic. Milestone 2. Effort: about 2 Claude Code days.

Depends on: child #1, child #5.

## What

Usage limits and account switcher

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: schema.sql (limit_reading).
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M2-05. The usage bar shows Claude and Codex usage against their windows with reset times, or "usage unavailable"; it never shows an invented number.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
