# Open-core seams

Child #26 of the MetaTrooper epic. Milestone 3. Effort: about 1 Claude Code days.

Depends on: child #1, child #4.

## What

Open-core seams: `provider: gateway` and `run_in: cloud` refusals, account state

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## Acceptance criteria

- [ ] M3-06. `provider: gateway` and `run_in: cloud` are refused with -32040 and nothing else changes; signed out, a full `spec-to-pr` run makes zero outbound connections from the core, workbench or tray.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
