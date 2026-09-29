# `social-scheduler` plugin and `clips-to-scheduled-posts`

Child #16 of the Agent Harness epic. Milestone 3. Effort: about 1.5 Claude Code days.

Depends on: child #15.

## What

`social-scheduler` plugin and `clips-to-scheduled-posts`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
