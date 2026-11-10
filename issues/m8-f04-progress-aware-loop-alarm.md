# M8-F4: Progress-aware loop alarm

Part of Ouros, Milestone 8, feature 4 of 12. Rides on: M8-13. Screen: none (decided 2026-11-10, D83). Settings > Reliability > Watching. The nudge card in Needs you stays.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 6e (6e loop 2), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A4; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-loop.png`.

## What it does

Same call 3 times with no new output: nudge (Pause, Rewind, Try another way, Not a loop); stop at 5; declared polling of a long run is exempt; false alarms are counted

## Evidence

loops are 5.21% of 42.8k production trajectories (Meta); a stuck-loop report has 38 reactions; no checked tool shows a repeat counter

Corrected 2026-11-05: loop alarms are table stakes. Cline, Gemini CLI and OpenHands detect loops in code, and opencode has `doom_loop` as a permission (RIVALS.md row 8). The left-over is progress-aware polling and a recovery message over any CLI: real engineering, a small difference. The repeat counter on screen was not checked again.

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 4.

## Acceptance criteria

- [ ] M8-F4a. Same call 3 times with no new output: nudge (Pause, Rewind, Try another way, Not a loop).
- [ ] M8-F4b. stop at 5.
- [ ] M8-F4c. declared polling of a long run is exempt.
- [ ] M8-F4d. false alarms are counted.
- [ ] M8-F4e. The Settings entries exist and default as listed in ouros-spec.md, Settings tree.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
