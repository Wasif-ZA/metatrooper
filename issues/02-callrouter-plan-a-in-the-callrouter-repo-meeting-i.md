# Callrouter Plan A, in the callrouter repo, meeting its own criteria 1 to 8; then its `troop-plugin.json`

Child #2 of the Metatrooper epic. Milestone 1. Effort: about 2.5 Claude Code days.

Depends on: child #3 (for the plugin part only).

## What

Callrouter Plan A, in the callrouter repo, meeting its own criteria 1 to 8; then its `troop-plugin.json`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: projects/callrouter/docs/spec.md (Plan A).
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M1-29. Callrouter Plan A passes its own criteria 1 to 8 (`projects/callrouter/docs/spec.md:111-128`).

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
