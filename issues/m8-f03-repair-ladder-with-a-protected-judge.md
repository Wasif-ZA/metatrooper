# M8-F3: Repair ladder with a protected judge

Part of Ouros, Milestone 8, feature 3 of 12. Rides on: M8-13. Screen: none (decided 2026-11-10, D83). Settings > Reliability > Repair.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 6e (6e loop 1), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A3; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-ladder.png`.

## What it does

Tries 1 to 3, each after a rewind and a fresh start, the last on a stronger model; tests, check configs and logging are protected; a wanted test change goes to its own review

## Evidence

71% of one model's failures were the same wrong reading (P2); a self-improving agent "passed" by removing logging

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 3.

## Acceptance criteria

- [ ] M8-F3a. Tries 1 to 3, each after a rewind and a fresh start, the last on a stronger model.
- [ ] M8-F3b. tests, check configs and logging are protected.
- [ ] M8-F3c. a wanted test change goes to its own review.
- [ ] M8-F3d. The Settings entries exist and default as listed in ouros-spec.md, Settings tree.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
