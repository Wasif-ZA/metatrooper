# M8-44: One-step Windows installer for Ouros

Part of Ouros, Milestone 8. Core service. Priority: High. Effort: not sized until M8-0. Depends on: M8-0, M8-37, M5-1.
**Start on or after 2026-11-09.**

## Source of truth

- `issues/m5-01-installer.md`: the build. Its worked estimate was 3.75 CC days on 2026-10-09, for the MetaTrooper name. This file does not re-spec it.
- `spec.md` D50, D67, D72.
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/core/CORE.html` row "One-step install" (also `ouros/direction` in the wip repo).

## What it does

M5-1 moves into Ouros's core list. It takes the Ouros name and whatever host M8-0 picks.
Everything else about the build stays in M5-1: per-user NSIS, no admin prompt, no user Node, no auto-update.

## Evidence

- README: "There is no installer yet". RIVALS.md table stakes: T3 ships winget and scoop, Herdr an install script.
- CORE.html: without one, few people will try it.
- His direction today: "spend more time on core services".

## Blocked on

- The conflict with D72 and D50. His call. D72 holds the installer until he sees real users. D50 says no unsigned installer is published. No money goes on a certificate for now. CORE.html calls the installer core.
- Options, each with its cost: unsigned for testers only, which keeps D50 for public release; pay for signing; or stay on source install until posts show demand.
- M8-0's host: a VSCodium fork packages differently from the Electron app in M5-1.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Re-point M5-1 at the host M8-0 picks | M5-1 rows 1 to 5; WIP on branch `agent/m5-1` |
| 2 | Rename paths and shims | M8-37; M7-18 troop on PATH |

## Acceptance criteria

- [ ] M8-44a. M5-01a to M5-01d pass under the Ouros name, on the host M8-0 picked.
- [ ] M8-44b. His D72 and D50 call is recorded in the `spec.md` D-list with its drawback.
- [ ] M8-44c. The clean-machine test in D67 is run on a second real Windows PC and recorded here.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained. electron-builder has the M5-D12 exception.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
