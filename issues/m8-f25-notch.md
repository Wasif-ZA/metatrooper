# M8-F25: Notch: agent status at the top of the screen

Part of Ouros, Milestone 8, feature 25. Rides on: M6-5, M8-21. Screen: scratch `~/.cache/claude-scratch/ouros-notch-2026-10-31/` (`BOARD.html`, `notch.html`, `shots/`).
Effort: not sized until M8-0.
**Start on or after 2026-11-09.**

## Source of truth

- Scratch `ouros-notch-2026-10-31/`: `BOARD.html`, `BLOB-R2.html`, `NOTCH-WORK.html`, `NOTCH-RESEARCH.html`, `RESUME.md`.
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `board.py` row "Notch".

## What it does

A small blob in a notch at the top centre of the screen, outside the Ouros window.
It has eyes at rest and a grey label for the kind of work.
Eyes change only for a question, a gate or all done.
A gate shows an orange drop. Only that is orange.
With several agents it shows the most urgent one.
It also ships as its own small app that works without Ouros open.

No mascot character. He rejected the mascot rounds on 2026-10-31 and chose eyes plus drip.

## Evidence

- Needs-you alerts are a known ask, and vibe-notch has 2.5k stars (`ide-layer-research/m5-demand.md` row 18). Older count.
- He approved Louis-CFM/coucou as a base on 2026-11-01: 6,822 stars, MIT code, below the 25k gate, as an exception like GSAP.
- Its name, mascot, icons and sounds are reserved. Reuse none.

## Blocked on

- NOTCH-WORK.html verdict: 6 agreed calls and 6 split calls. His call.
- Which NOTCH-RESEARCH.html review points to apply. His call.
- Whether Allow and Deny work from the notch. His call.
- Hook wait length needs a live test, per RESUME.md.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Top-level notch window, CSS-built, IDE palette only | Coucou as a base; `ouros-notch-2026-10-31/proto/notch-prototype.html` |
| 2 | State from agent sessions, with Ouros or alone | M6-5 hook state |
| 3 | Most-urgent rule and fixed-width labels | NOTCH-WORK.html |

## Acceptance criteria

- [ ] M8-F25a. The notch sits at the top centre on the main display and takes no focus or key input.
- [ ] M8-F25b. Orange shows only when a gate waits.
- [ ] M8-F25c. With 3 agents, one on a gate, it shows the gate.
- [ ] M8-F25d. With Ouros closed, the standalone app still shows a live agent's state.
- [ ] M8-F25e. Nothing from Coucou's name, mascot, icons or sounds ships.
- [ ] M8-F25f. Only blinks loop, per NOTCH-WORK.html.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- The build step it rides on owns the wiring.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
