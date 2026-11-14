# M8-F22: Scheduled agents with a check-first script

Part of Ouros, Milestone 8, feature 22. Rides on: M8-26. Screen: `proto/kit/workspaces/n13-automations.json`, shot `proto/shots/n13-automations.png`.
Effort: not sized until M8-0.

## Source of truth

- `spec.md` Milestone 8, "Direction, 2026-11-05"; M8-26d (a scheduled run is a dimmed tile and posts to the inbox).
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `board.py` row "Scheduled and triggered agents".

## What it does

Jobs that start on a schedule, each with an off switch.
A small check script runs first.
Exit 0 means nothing changed: no agent starts and nothing is spent.
Exit 1 wakes the agent.
M8-26 owns the scheduled tile. This adds the screen and the check.

## Evidence

- Board references: bb, OpenHands, Orca, Paperclip. Not re-checked in RIVALS.md.
- PAINS.md A3: bills you cannot predict are the most argued topic. A skip that costs nothing speaks to that.

## Blocked on

- Whether check scripts are bash, PowerShell or both. The screen draws `check-first.sh`, and computer use is Windows only today. His call.
- What runs a schedule when the laptop is off. Board marks this "Later". His call.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Schedule list with last runs | Parts `rows`, `tracker`; M8-26d |
| 2 | Check runner: run the script, read the exit code The detached core from `troop start` |
| 3 | Unattended agent stops at gates and waits in the inbox | M8-21, M8-22 |

## Acceptance criteria

- [ ] M8-F22a. Exit 0 starts no agent process and spends no tokens, shown as a skip in "Last 8 runs".
- [ ] M8-F22b. Exit 1 starts the agent once.
- [ ] M8-F22c. A check that errors or times out shows as failed and starts nothing.
- [ ] M8-F22d. A run missed while the core was off shows as missed, and does not start late on its own.
- [ ] M8-F22e. A scheduled agent cannot pass a gate alone. It waits in the inbox.
- [ ] M8-F22f. An agent cannot change a check script without a gate.
- [ ] M8-F22g. The shipped screen matches `n13-automations.json` and passes validate.mjs.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
