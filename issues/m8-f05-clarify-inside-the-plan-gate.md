# M8-F5: Clarify inside the plan gate

Part of Ouros, Milestone 8, feature 5 of 12. Rides on: M8-5. Screen: none (decided 2026-11-10, D83). Settings > Reliability > Asking. The decision card in Needs you stays.

## Source of truth

- `ouros-spec.md` section 6e (6e loop 2, plan gate), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A5; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-intent.png`.

## What it does

Only when the ambiguity changes what gets done: the plan offers two readings and lists the files it plans to touch; edits outside are flagged

## Evidence

misread intent 26.95% of validated pushback episodes; agents ask in about 3% of SWE-chat turns

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 5.

## Acceptance criteria

- [ ] M8-F5a. Only when the ambiguity changes what gets done: the plan offers two readings and lists the files it plans to touch.
- [ ] M8-F5b. edits outside are flagged.
- [ ] M8-F5c. The Settings entries exist and default as listed in ouros-spec.md, Settings tree.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
