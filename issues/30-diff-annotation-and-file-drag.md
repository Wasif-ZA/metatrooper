# Diff annotation and file drag

Child #30 of the Metatrooper epic. Milestone 2. Effort: about 1 Claude Code days.

Depends on: child #10.

## What

Diff annotation and file drag

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: schema.sql (comment).
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M2-06. A diff-line comment and a dropped file reach the target session by its delivery route.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
