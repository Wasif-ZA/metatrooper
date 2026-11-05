# M8-F15: A job as plain steps, with Show the code

Part of Ouros, Milestone 8, feature 15. Rides on: M8-13, M8-F1. Screen: `proto/kit/workspaces/n06-job-anyone.json`, shot `proto/shots/n06-job-anyone.png`.
Effort: not sized until M8-0.
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8, "Direction, 2026-11-05": "mostly for devloper and people non devs too who needs to code work".
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `core/CORE.html` row "Plain view"; `research-ide/F/RIVALS.md` row 11; `research-ide/F/PAINS.md` B1, B3, B6.

## What it does

The same run as the IDE, written as plain steps with no code on screen.
Each step says done, or says what is waiting.
One click on "Show the code" opens that run in the full editor.
This is the bridge for non-developers doing code work on a real local repo.

## Evidence

- PAINS.md B3: non-developers often cannot check the work, and nothing states in plain words what was and was not checked.
- Anthropic, a vendor's own classifier: code sessions from other jobs reach verified success 29% of the time, software jobs 34%. Job title is not the barrier.
- Not unique. Lovable, v0, Base44 and Replit have a plain view with code one click away, on their own servers (RIVALS.md row 11).
- What survives is narrow: a developer and a non-developer sharing one local repo run across any CLI.

## Blocked on

- Whether Publish is built in or a plugin. His call. Section 6e leaves deploy out, yet PAINS.md B6 says non-developers break there, and the screen draws a Publish step.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Spike first: can steps be drawn honestly from each CLI's hook events? RIVALS.md marks this unproven. Record the result here | M6-5, M6-23 hook state |
| 2 | Step list bound to real events and check results | Part `steplist`; M8-F1 results |
| 3 | Show the code | M8-F13 switch, opens the same session and worktree |

## Acceptance criteria

- [ ] M8-F15a. The spike's result for `claude` and `codex` is recorded in this file.
- [ ] M8-F15b. A step marked done traces to a real event or check result, shown when the step is opened.
- [ ] M8-F15c. A step with no check reads "Not checked", never done.
- [ ] M8-F15d. Show the code opens the same run, in one click, on the same worktree.
- [ ] M8-F15e. A step that leaves the machine waits at a real gate from M8-21.
- [ ] M8-F15f. The shipped screen matches `n06-job-anyone.json` and passes validate.mjs.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
