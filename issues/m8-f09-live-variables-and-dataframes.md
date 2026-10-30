# M8-F9: Live variables and DataFrames

Part of Ouros, Milestone 8, feature 9 of 12. Rides on: M8-16. Screen: `kit/specs/f-data.json`.
**Start on or after 2026-11-09.**

## Source of truth

- `ouros-spec.md` section 6e (6e row 7), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A9; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-data.png`.

## What it does

A side view of live variables and tables while a script runs; summaries (types, empties) are a hypothesis

## Evidence

DataFrame debugger 360 (later shipped in VS Code); variable explorer 185; inspector 118

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 9.

## Acceptance criteria

- [ ] M8-F9a. A side view of live variables and tables while a script runs.
- [ ] M8-F9b. summaries (types, empties) are a hypothesis.
- [ ] M8-F9c. The shipped screen matches `f-data.json` and passes validate.mjs.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
