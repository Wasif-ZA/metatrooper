# M8-J3: Spreadsheet job screen

**After launch, add-on.** Part of Ouros, Milestone 8. Priority: Low. Effort: not sized until M8-0. Depends on: M8-11, M8-12, M8-14.
**Not before launch.** His words, 2026-11-05: job screens "will come after post launch".

## Source of truth

- Workspace: `~/.cache/claude-scratch/ouros-direction-2026-11-05/proto/kit/workspaces/persona-t-sheets.json`. Shot: `proto/shots/persona-t-sheets.png`. Parts: `proto/kit/parts-job4b.js`.
- Also in the wip repo at `ouros/direction`.
- Notes: `proto/REPORT-job4b.md`; `research-ide/E/LAYOUTS.md` "sheets"; `research-ide/E/MARKET.md`; `board.py` lists `N` and `DEMAND`.

## What it does

Primary product: Google Sheets.
A total that leaves out wages. The agent suggests a fix on the sheet and shows every cell it would change.

**This is a drawing today.** It needs a real engine or plugin behind it. None exists yet.

| Borrowed part | From | Why |
|---|---|---|
| List of changed cells, old to new | Excel Copilot | You see exactly what the agent touches |
| Status pills in cells | Airtable | Paid and Due read at a glance |

Differs: the suggestion card on the grid is our own design. No reference shows one there.

## Evidence

- 450M+ Microsoft 365 seats, second-hand. No source measures spreadsheets alone. This is the softest number of the seven.

## Blocked on

- Which engine or plugin reads and writes the sheet. His call. Seed list: ENGINES.html.

## Acceptance criteria

- [ ] M8-J3a. The workspace loads through `ouros_workspace` as an example with no refusal. (was: passes validate.mjs)
  Status: NOT STARTED. There is no workspace validator in the repo yet; `check.js` checks screens, not workspace layouts. Lands with M8-11.
  Verify: to write, `core/test/m8-11-workspace.test.ts` test "M8-J3a: the workspace loads through ouros_workspace with no refusal".
- [ ] M8-J3b. With no engine installed, the screen says so and shows an install card, never demo cells as real.
- [ ] M8-J3c. With a plugin installed, a real file opens and its formulas evaluate.
- [ ] M8-J3d. No cell changes until the person accepts, and the list names every changed cell.
- [ ] M8-J3e. No product name or logo shows on screen.

## Rules that bind every child

- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Job parts join the catalogue through M8-10, with tests.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
