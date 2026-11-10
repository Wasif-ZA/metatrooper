# M8-F6: Your rules as checks

Part of Ouros, Milestone 8, feature 6 of 12. Rides on: M8-13. Screen: none (decided 2026-11-10, D83). Settings > Reliability > Your rules.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 6e (6e loop 1), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A6; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-rules.png`.

## What it does

Each rule shows what enforces it (hook, lint, lockfile diff) or that it is only read; caught counts

## Evidence

constraint violation 38.33% of validated pushback episodes, 73.68% of those instruction-following failures

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 6.

## Acceptance criteria

- [ ] M8-F6a. Each rule shows what enforces it (hook, lint, lockfile diff) or that it is only read.
- [ ] M8-F6b. caught counts.
- [ ] M8-F6c. The Settings entries exist and default as listed in ouros-spec.md, Settings tree.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
