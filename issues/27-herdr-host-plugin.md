# herdr host plugin

Child #27 of the Metatrooper epic. Milestone 2. Effort: about 2 Claude Code days.

Depends on: child #3, child #4, child #5.

## What

herdr host plugin

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: spec.md § herdr host plugin.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M2-04. With the herdr plugin, a `continue` step reaches the earlier herdr pane via `agent.prompt` and the run advances on herdr `done`; without it, the same pipeline runs in Windows Terminal and the log shows `memory not kept`.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
