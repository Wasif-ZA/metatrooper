# M8-F11: Remembered, scoped tool access

Part of Ouros, Milestone 8, feature 11 of 12. Rides on: M8-14. Screen: none (decided 2026-11-10, D83). Settings > Safety > Tool access.

## Source of truth

- `ouros-spec.md` section 6e (6e plugins), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A11; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-toolaccess.png`.

## What it does

Allow, ask or deny per tool, per project, with a separate column for subagents; the stop list still asks every time

## Evidence

subagent-only MCP 377 reactions; per-tool filtering 225; excessive approval prompts 39

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 11.

## Acceptance criteria

- [ ] M8-F11a. Allow, ask or deny per tool, per project, with a separate column for subagents.
- [ ] M8-F11b. the stop list still asks every time.
- [ ] M8-F11c. The Settings entries exist and default as listed in ouros-spec.md, Settings tree.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
