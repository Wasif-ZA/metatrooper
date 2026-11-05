# M8-F24: Other machines and SSH

Part of Ouros, Milestone 8, feature 24. Rides on: M7-11. Screen: `proto/kit/workspaces/n14-machines.json`, shot `proto/shots/n14-machines.png`, the machines and shared-ports blocks.
Effort: not sized until M8-0.
**Start on or after 2026-11-09.** Board marks this "Later".

## Source of truth

- `issues/m7-11-box-offload.md`: SSH box host, snapshot and patch return.
- `issues/m8-17-core-ide-shell-void-layout-ide-wall-swit.md`: Remote and WSL in v1 is an open call.
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `board.py` row "Other machines and SSH"; `research-ide/F/RIVALS.md` table stakes.

## What it does

A list of connected machines with their running agents.
Add a machine with one pasted command and a one-use code.
Shared ports are listed, and each has Revoke.

## Evidence

- RIVALS.md table stakes: remote control or SSH in Antigravity, Orca, Herdr, T3.
- PAINS.md: platform reach is 11.6% of the labelled thumbs-up, though many top asks have closed.

## Blocked on

- How machines link. D24 says no TCP port, and M7-11 uses SSH. The screen draws a join command. His call.
- Whether a piped install command is acceptable. His call. The drawn `curl | sh` runs unchecked code.
- Remote and WSL in v1 (M8-17). His call.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Machines list with agent counts | M7-11 box host and box check |
| 2 | Add-a-machine flow | Blocked on the link choice above |
| 3 | Shared-port list with Revoke | M6-3 `session_port` |

## Acceptance criteria

- [ ] M8-F24a. An agent on a second machine shows in the list with its state.
- [ ] M8-F24b. A join code works once and is refused after its expiry.
- [ ] M8-F24c. Revoke closes a shared port at once.
- [ ] M8-F24d. `work/` and hwbreports paths never reach another machine, as in M7-11.
- [ ] M8-F24e. The shipped blocks match `n14-machines.json` and pass validate.mjs.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
