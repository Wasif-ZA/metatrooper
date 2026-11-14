# M8-F20: Issue list with a Start button

Part of Ouros, Milestone 8, feature 20. Rides on: M8-25. Screen: `proto/kit/workspaces/n11-issues.json`, shot `proto/shots/n11-issues.png`.
Effort: not sized until M8-0.

Grouped: "Start an agent from a GitHub issue" and "Issue list with a Start button" are one thing.

## Source of truth

- `spec.md` Milestone 8, "Direction, 2026-11-05"; `ouros-spec.md` section 6e, "Not built in".
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `board.py` rows above.

## What it does

GitHub issues for the open project, in a list.
A Start button turns an issue into a running agent on its own worktree.
Each row shows the agent working on it.
The screen also draws a Board tab. That tab is not built here: see M8-48.

## Evidence

- Board references: Orca, OpenHands. Not re-checked in RIVALS.md.
- Stack Overflow 2026 for tickets and plans: 27.8% use AI, 30.5% do not plan to (PAINS.md). Options changed from 2025, so the years do not compare directly.

## Blocked on

- Section 6e kept project and issue management out of the built-ins. Today's screens add this one list. His call on whether it stays built in or becomes a plugin.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Read open issues with the user's own GitHub login | Part `rows` |
| 2 | Start: issue text becomes the prompt, on a new worktree | `session.launch`, M8-25a |
| 3 | Row status from the session | M8-F16 state |

## Acceptance criteria

- [ ] M8-F20a. The list reads open issues for the project and writes nothing to GitHub.
- [ ] M8-F20b. Start launches one agent on one new worktree with the issue as its prompt.
- [ ] M8-F20c. Issue text reaches the agent labelled as outside text, not as instructions from the user.
- [ ] M8-F20d. With no GitHub login, the screen says so and offers no Start.
- [ ] M8-F20e. The shipped list matches `n11-issues.json` and passes validate.mjs.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
