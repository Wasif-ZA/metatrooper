# M8-J8: Upgrade the 8 existing job layouts to the new layouts

**After launch, add-on.** Part of Ouros, Milestone 8. Priority: Low. Effort: not sized until M8-0. Depends on: M8-11, M8-12, M8-14.
**Not before launch.** His words, 2026-11-05: job screens "will come after post launch".

Also owns the board row "Starting screens by job", with M8-F13's starters pointing here.

## Source of truth

- `issues/m8-11-ouros-workspace-tool-the-agent-reshapes.md`, M8-11e: the 8 persona layouts load as examples.
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `proto/REPORT-refine.md`; `research-ide/E/LAYOUTS.md`; `research-ide/E/MARKET.md` "How the existing 8 jobs look"; `board.py` list `R`. Earlier versions: `proto/shots/before/`.

## What it does

M8-11's eight examples swap to the layouts he approved today.
Each follows one named product, so a person who knows it recognises the screen.

**These are drawings today.** Each needs a real engine or plugin behind it to do real work. M8-11 owns the layouts as examples only.

| Job | Workspace file, under `proto/kit/workspaces/` | Primary product | Borrowed parts | Report note |
|---|---|---|---|---|
| Website builder | `persona-t-website.json` | Webflow | Margin and padding box, breadcrumb; action bar by the selection (Wix) | Skipped Framer's side-by-side sizes: the page would shrink too far |
| Video editor | `persona-t-editor.json` | Adobe Premiere | Tool tabs (CapCut) | Skipped Descript's script and audio meters |
| Part designer | `persona-t-engineer.json` | Autodesk Fusion | Labelled commands (SolidWorks) | Skipped Onshape tabs and versions graph. The part is a first pass |
| Data notebook | `persona-t-analyst.json` | Hex | Columns and Rows shelves (Tableau) | Kept Hex over LAYOUTS' Tableau, because the story needs the query |
| Writing tool | `persona-t-writer.json` | Google Docs | none | Chapter list is ours. Skipped Notion's page and iA's split |
| Study tool | `persona-t-student.json` | Anki | Mode tabs (Quizlet) | Kept dark ground. Fixed counts: 5 + 3 + 24 = 32 left, 2 done |
| Research library | `persona-t-researcher.json` | Zotero | Quote found column (Elicit); tick boxes (NotebookLM) | 5 Yes + 1 No = 6 cited; 18 of 19 ticked |
| Shop admin | `persona-t-shop.json` | Shopify admin | Action buttons and change pills (Square) | 12 orders in one card. Order dates fixed |

## Evidence

MARKET.md, each with its own limits:
- Website builder: Ramp 27.6%.
- Video editor: CapCut's 736M mobile monthly actives, a16z March 2026.
- Writer: Superhuman at #4 on a16z spend.
- Researcher: Ramp search and research AI 4.1%, down 0.2 points.
- Student: consumer evidence only. Ramp cannot show it.
- Data analyst: Ramp BI 1.9%. Spreadsheets may hide most of this demand.
- Engineer: Ramp construction 1.7%, and no mechanical CAD category.
- Shop admin: not measured by any source opened.

## Blocked on

- MORPH.html and STARTPOINT.html call 1, on M8-11. His call.
- Which engine or plugin backs each job. His call. Seed list: ENGINES.html.

## Acceptance criteria

- [ ] M8-J8a. All 8 workspace files load through `ouros_workspace` with no refusal, replacing the older `persona-*.json`. (was: and pass validate.mjs)
  Status: NOT STARTED. There is no workspace validator in the repo yet; `check.js` checks screens, not workspace layouts. Lands with M8-11.
  Verify: to write, `core/test/m8-11-workspace.test.ts` test "each of the 8 persona layouts: the workspace loads through ouros_workspace with no refusal".
- [ ] M8-J8b. With no engine installed, each screen says so and shows an install card, never demo data as real.
- [ ] M8-J8c. Any send, post or spend waits at a real gate from M8-21.
- [ ] M8-J8d. No product name or logo shows on screen.

## Rules that bind every child

- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Job parts join the catalogue through M8-10, with tests.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
