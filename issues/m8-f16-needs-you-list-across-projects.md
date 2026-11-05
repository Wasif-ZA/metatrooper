# M8-F16: Needs-you list across projects

Part of Ouros, Milestone 8, feature 16. Rides on: M8-22. Screen: `proto/kit/workspaces/n03-needs-wall.json`, shot `proto/shots/n03-needs-wall.png`.
Effort: not sized until M8-0.
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8, "Direction, 2026-11-05".
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `board.py` rows "Who is working, done or waiting", "Needs-you list across all projects", "Wall"; `research-ide/F/RIVALS.md` row 6.

## What it does

One list of every agent, grouped by project.
One orange tag says where to look.
Picking a row jumps to that agent's tile.
M8-22 owns the inbox and the shared gate. This adds the list that spans projects.

## Evidence

- Table stakes, not a difference. Cursor, Devin Desktop, the Codex app, Orca, Herdr, Paradev and Nimbalyst all have a version (RIVALS.md row 6).
- The left-over detail is moving the waiting tile to the big slot without stealing keys. That is built in the wall today.

## Blocked on

- Nothing of his. Build after M8-22.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | List grouped by project | Part `agentlist`; `session.list`; M6-5 and M6-23 state |
| 2 | Jump to tile | M6-9 wall keys, Alt+J |
| 3 | No lost rows | FIX-W6: sessions older than the newest 50 vanish from the wall. Fix first |

## Acceptance criteria

- [ ] M8-F16a. Agents in 3 registered projects show in one list, grouped by project.
- [ ] M8-F16b. Only rows waiting on a person are orange.
- [ ] M8-F16c. Picking a row in another project opens that agent's tile and takes no key input.
- [ ] M8-F16d. The list's waiting count equals the inbox count in M8-17c.
- [ ] M8-F16e. A running session older than the newest 50 still shows.
- [ ] M8-F16f. The shipped screen matches `n03-needs-wall.json` and passes validate.mjs.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
