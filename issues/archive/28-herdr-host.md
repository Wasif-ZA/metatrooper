# herdr host plugin

Part of the MetaTrooper epic. Milestone 2. Effort: about 2 Claude Code days.

Depends on: child #13, child #15, child #16.

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
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
