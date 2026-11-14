# M8-F1: Done means proven

Part of Ouros, Milestone 8, feature 1 of 12. Rides on: M8-13. Screen: none (decided 2026-11-10, D83). The toggle, wording and acceptance command are in Settings > Reliability > Finishing.

## Source of truth

- `ouros-spec.md` section 6e (6e loop 1), "Features that make the loops visible".
- Scratch: `ouros-startpoint-2026-10-30/features/FEATURE-LIST.md` row A1; board `ouros-ide-fiveshot-2026-10-30/NEWFEATURES.html`; shot `kit/shots/features/f-done.png`.

## What it does

A run ends as Done, Checks passed or Needs your review. Done is bound to the revision, command, environment and the task's acceptance check, and is cleared by any later edit. A claim with no matching run is marked unverified

## Evidence

inaccurate self-reporting is 22.58% of 16,118 validated pushback episodes; no checked tool shows evidence beside a done claim

Corrected 2026-11-05: that last claim is too strong. Claude Code `/goal` and Stop hooks, Codex goals, Cursor `stop` hooks, Kiro, Aider `--auto-test` and tamperproof all do parts of this (RIVALS.md row 2). What survives is narrow: "needs your review" as the default end state when no check exists. It is cheap to copy.

## Blocked on

- Wasif's keep / change / drop on NEWFEATURES.html feature 1.
- The result's wording. CORE.html proposes "Agreed checks passed" plus a list of what was not checked, in place of "Done means proven". His call.

## Acceptance criteria

- [ ] M8-F1a. A run ends as Done, Checks passed or Needs your review.
- [ ] M8-F1b. Done is bound to the revision, command, environment and the task's acceptance check, and is cleared by any later edit.
- [ ] M8-F1c. A claim with no matching run is marked unverified.
- [ ] M8-F1d. The Settings entries exist and default as listed in ouros-spec.md, Settings tree.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
