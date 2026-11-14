# M8-47: CLI agents can drive

Part of Ouros, Milestone 8. Priority: Medium. Effort: not sized until M8-0. Depends on: M8-37, M6-17.

## Source of truth

- `core/cli.ts` USAGE; `contracts/pipe-protocol.md`; M6-17 public API.
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/board.py` row "CLI that agents can drive" (also `ouros/direction` in the wip repo).

## What it does

An agent can start another agent, wait for it, and read the result, from the command line.
Most of this exists. This issue covers the gaps only.

Today `troop` has `launch` (with `--jobs`), `sessions`, `owners`, `focus`, `seen`, `hide`, `engines`, each with `--json`.
The pipe has `session.wait` and `session.search`. The CLI has no verb for either, and none to send text or read output.

## Evidence

- Board references: Orca, bb, Herdr. Not re-checked in RIVALS.md.
- Herdr offers an open protocol, OSC 7501, for state (RIVALS.md row 6).

## Blocked on

- The CLI's final name, from the M8-37 rename call. His call.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Verbs for wait, send and read, named after popular tools with the same job | `session.wait`, `session.search`, M6-17 |
| 2 | A skill telling agents how to use it | `skills/`, `troop skills install` |

## Acceptance criteria

- [ ] M8-47a. From inside one session, a script launches a second, waits for it to finish and reads its last output, all with `--json`.
- [ ] M8-47b. A wait returns when the session waits on a person, and says so.
- [ ] M8-47c. No CLI verb can answer a gate. An agent cannot approve itself or another agent.
- [ ] M8-47d. A secret never appears in read output.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
