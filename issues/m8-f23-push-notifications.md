# M8-F23: Push notifications when someone is needed

Part of Ouros, Milestone 8, feature 23. Rides on: M6-10, M7-6, M5-15. Screen: `proto/kit/workspaces/n14-machines.json`, shot `proto/shots/n14-machines.png`, the "Tell me on my phone" block.
Effort: not sized until M8-0.

## Source of truth

- `spec.md` M6-10, M5-15 notification sink, M7-6 "Quiet phone alerts" (ntfy and Slack sinks).
- `issues/m8-27-phone-app-after-desktop-ouros.md`: the phone app comes later and is separate.
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `board.py` row "Push notification".

## What it does

A phone alert only when a person is needed: approvals and questions.
Optional switches for finished jobs and quiet hours.
It works before any phone app exists, through the sinks already built.

## Evidence

- Reliable needs-you alerts: claude-code #29438 at 69 (`ide-layer-research/m5-demand.md` row 18). Older count.
- Rivals have it: Orca, Nimbalyst, Devin Desktop (RIVALS.md row 6).

## Blocked on

- PHONE.html call: needs-you only, or finished runs too. His call. The screen draws needs-you on and finished jobs as a switch.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | The settings block | M5-15 settings UI; part `toggle` |
| 2 | Filter to needs-you by default, with quiet hours | M6-10; M7-6 `ui.idle` hold |

## Acceptance criteria

- [ ] M8-F23a. By default a finished job sends nothing and a waiting gate sends one alert.
- [ ] M8-F23b. Nothing is sent during quiet hours, and the waiting gate still shows on the PC.
- [ ] M8-F23c. An alert names the agent and project and carries no diff, command or fixture secret.
- [ ] M8-F23d. The settings say that the chosen sink sends the alert through a third party.
- [ ] M8-F23e. The shipped block matches `n14-machines.json` and passes validate.mjs.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
