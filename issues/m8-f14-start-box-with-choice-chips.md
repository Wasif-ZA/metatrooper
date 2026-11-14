# M8-F14: Start box with choice chips

Part of Ouros, Milestone 8, feature 14. Rides on: M8-17, M8-25. Screen: `proto/kit/workspaces/n02-start-dev.json`, shot `proto/shots/n02-start-dev.png`.
Effort: not sized until M8-0.

## Source of truth

- `spec.md` Milestone 8, "Direction, 2026-11-05".
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `board.py` row "Message box with choice chips"; `proto/BRIEF.md`.

## What it does

One message box to start an agent.
Every choice is a chip: model, project, worktree, branch, approval.
Non-developers see only project and approval.

## Evidence

- Board reference: bb's start box. bb could not be re-checked on 2026-11-05 (RIVALS.md, limits).
- Worktree per agent is table stakes among desks (RIVALS.md row 4). So this is expected, not a difference.

## Blocked on

- How a person says they are a non-developer: a setting, or the mode they are in. His call.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Chips that fill the launch request | `troop launch --worktree --approval`; M8-25a; M7-13 branch name at launch |
| 2 | Model chip default | M8-43 defaults, never forced |
| 3 | Developer starter row | Part `starters`; review starter goes through M8-F17 |

## Acceptance criteria

- [ ] M8-F14a. Each chip's value reaches the launched session, checked in `troop sessions --json`.
- [ ] M8-F14b. "New worktree" starts the agent in its own worktree on the chosen base branch.
- [ ] M8-F14c. The non-developer view shows the project and approval chips and no others.
- [ ] M8-F14d. The approval chip offers only what the project's folder approval allows.
- [ ] M8-F14e. The shipped screen matches `n02-start-dev.json` and passes validate.mjs.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
