# M8-F21: Readable audit trail

Part of Ouros, Milestone 8, feature 21. Rides on: M8-21. Screen: `proto/kit/workspaces/n12-team.json`, shot `proto/shots/n12-team.png`, the "Who did what" block only.
Effort: not sized until M8-0.

## Source of truth

- `spec.md` Milestone 8, "Direction, 2026-11-05"; M6-12 audit rows; M8-21 log lines.
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `board.py` row "Readable audit trail".

## What it does

One readable record of who did what, when and why, per project.
Gate answers come from Ouros itself.
A reason written by an agent is marked as the agent's own words.
The team chart on the same screen is not built here: see M8-48.

## Evidence

- Board reference: Paperclip only. Not re-checked in RIVALS.md, so this is thin.
- PAINS.md A2: agents claim completion against instructions. So an agent's own reason cannot be shown as fact.

## Blocked on

- Nothing of his.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Read view over what is already logged | `event` table, M6-12 audit, M8-21 log lines |
| 2 | Source mark on each row: system or agent | M8-5 source tagging |

## Acceptance criteria

- [ ] M8-F21a. Each row names the agent, the action and the time.
- [ ] M8-F21b. A gate decision shows as from the system. An agent's reason shows as from the agent.
- [ ] M8-F21c. No agent tool can edit or delete a row.
- [ ] M8-F21d. A fixture secret never appears in a row.
- [ ] M8-F21e. Rows survive a core restart.
- [ ] M8-F21f. The shipped block matches `n12-team.json`, and that workspace loads through `ouros_workspace` with no refusal. (was: passes validate.mjs)
  Status: NOT STARTED. There is no workspace validator in the repo yet; `check.js` checks screens, not workspace layouts. Lands with M8-11.
  Verify: to write, `core/test/m8-11-workspace.test.ts` test "n12-team: the workspace loads through ouros_workspace with no refusal".

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
