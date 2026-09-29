# `github` and `deploy` plugins; `spec-to-pr`, `e2e-browser-qa`, `website-build`, `design-variants`

Child #14 of the Agent Harness epic. Milestone 2. Effort: about 2.5 Claude Code days.

Depends on: child #4, child #5, child #6, child #7, child #8.

## What

`github` and `deploy` plugins; `spec-to-pr`, `e2e-browser-qa`, `website-build`, `design-variants`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M2-01. Each milestone-2 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
