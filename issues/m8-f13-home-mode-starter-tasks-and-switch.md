# M8-F13: Home mode, starter tasks, and the Home, IDE, Wall switch

Part of Ouros, Milestone 8, feature 13. Rides on: M8-17. Screen: `proto/kit/workspaces/n01-home-anyone.json`, shot `proto/shots/n01-home-anyone.png`.
Effort: not sized until M8-0.
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8, "Direction, 2026-11-05"; `ouros-spec.md` "Answer first".
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `board.py` feature rows "Home screen", "Starter tasks", "Home, IDE and Wall switch"; `research-ide/F/RIVALS.md` row 11.

## What it does

One question and one box, with no menus and no file tree.
A row of starter tasks sits under the box.
The title-bar switch gains a third place: Home, IDE, Wall.
This is the door for non-developers doing code work, the second group in today's direction.
It is not the Today screen. Today stays in M8-17 (`n21-today.json`, shot `r-home.png`).

## Evidence

- Non-developers hit a setup wall in tools that act on their own machine. The evidence is thin: PAINS.md B7.
- This is not unique. Lovable, v0, Base44 and Replit all start from plain words (RIVALS.md row 11).

## Blocked on

- Which screen opens first on a fresh install: Home or IDE. His call.
- Which starters ship at launch. His call. The drawn six include website, video and spreadsheet, and those need add-ons.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Home as a third mode in the shell | M8-17 switch and Ctrl+Alt+W |
| 2 | The question box, sending to a new session | M8-F14 start box, project and approval chips only |
| 3 | Starter list | Parts `hero`, `starters` and `composer` from `parts-next.js`, moved by M8-46 |
| 4 | Pinned list says Home, IDE, Wall, not IDE, Wall | M8-11 pinned list, M8-17b |

## Acceptance criteria

- [ ] M8-F13a. The switch moves between Home, IDE and Wall, and each keeps its state, as M8-17a does for two.
- [ ] M8-F13b. No workspace change can remove the switch.
- [ ] M8-F13c. Text sent from Home starts a session in the chosen project with approval on "Ask me first".
- [ ] M8-F13d. A starter whose engine or add-on is missing shows its install card and never a demo result.
- [ ] M8-F13e. The waiting row on Home matches the inbox count in M8-17c.
- [ ] M8-F13f. The shipped screen matches `n01-home-anyone.json` and passes validate.mjs.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
