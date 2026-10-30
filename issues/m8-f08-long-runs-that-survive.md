# M8-F8: Long runs that survive

Part of Ouros, Milestone 8, feature 8 of 12. Rides on: M8-13. Screen: `kit/specs/f-runs.json`.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 6e (6e row 7), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A8; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-runs.png`.

## What it does

Runs keep going when Ouros closes; reattach, stop queued, notify; output kept

## Evidence

persistent kernels 408 (top vscode-jupyter issue); reconnect 250 and 121; keep running 105; interrupt queued 107

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 8.

## Acceptance criteria

- [ ] M8-F8a. Runs keep going when Ouros closes.
- [ ] M8-F8b. reattach, stop queued, notify.
- [ ] M8-F8c. output kept.
- [ ] M8-F8d. The shipped screen matches `f-runs.json` and passes validate.mjs.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
