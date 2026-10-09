# Open-core seams

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Part of the MetaTrooper epic. Milestone 3. Effort: about 1 Claude Code days.

Depends on: child #12, child #15.

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
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
