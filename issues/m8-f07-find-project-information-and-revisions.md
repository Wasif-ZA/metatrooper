# M8-F7: Find project information and revisions

Part of Ouros, Milestone 8, feature 7 of 12. Rides on: M8-16. Screen: `kit/specs/f-find.json`.

## Source of truth

- `ouros-spec.md` section 6e (6e row 2), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A7; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-find.png`.

## What it does

One search over files, specs, datasheets and design revisions, current revision marked

## Evidence

CAD users lose 1.3 h a week locating design data (1,466, 2023); broader: 55.75% of design engineers' time on acquiring or providing information (78, 2010); Overleaf multi-file search 157

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 7.

## Acceptance criteria

- [ ] M8-F7a. One search over files, specs, datasheets and design revisions, current revision marked.
- [ ] M8-F7b. The shipped screen matches `f-find.json` and passes validate.mjs.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
