# M8-F19: Browser screen: point at an element, dev-server tab, before and after

Part of Ouros, Milestone 8, feature 19. Rides on: M6-3, M6-11, M6-12, M6-13. Screen: `proto/kit/workspaces/n09-browser.json`, shot `proto/shots/n09-browser.png`.
Effort: not sized until M8-0.

Grouped: four board rows, because they share the browser pane. Browser with Stop and Take over, Point at an element, Dev server tab, Before and after screenshots.

## Source of truth

- `spec.md` "Browser use" and M6-3, M6-11, M6-12, M6-13; Milestone 7 M7-2, M7-3.
- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `board.py` browser rows; `research-ide/F/RIVALS.md` row 13.

## What it does

You always see who holds the tab: "Claude is using this tab", with Stop and Take over.
You can point at an element and say what you want.
The dev server opens as a tab beside the thread.
A run can show the same page before and after its change.

Most of this exists. This issue moves it into the new screen. Only before and after is new.

## Evidence

- The gates on browser use are the one difference that is real today, across vendors (RIVALS.md row 13).
- Orca and Cursor have a browser. Vibe Kanban and Paradev have preview browsers. No agent gate was found in their pages, which does not prove they have none.
- Before and after: board reference bb only. bb could not be re-checked.

## Blocked on

- Nothing of his. M7-2's threads stay in M7-2.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Holder line, Stop, Take over | M6-12 `handoff`; part `browser` |
| 2 | Point at an element, with its selector and size | M6-13 picks; M7-2 for threads |
| 3 | Dev-server tab beside the thread | M6-3 `session_dev_server` |
| 4 | Before and after pair attached to the run | M7-3 reference overlay; M8-26 film strip in Review |

## Acceptance criteria

- [ ] M8-F19a. The tab shows its holder at all times, and Take over hands it over at once.
- [ ] M8-F19b. A picked element reaches the agent as at most 4 KB of sanitised HTML, labelled page content.
- [ ] M8-F19c. A dev server started in a session opens as a tab beside its thread, from a `ready` row only.
- [ ] M8-F19d. A port the session does not own stays blocked for its agent pane (D60).
- [ ] M8-F19e. Before and after images share one viewport size and are attached to one run.
- [ ] M8-F19f. Images and text pass the same redaction as other browser output (M6-12).
- [ ] M8-F19g. The shipped screen matches `n09-browser.json` and passes validate.mjs.

## Rules that bind every child

- The screen is drawn from the catalogue only; the build step it rides on owns the wiring.
- `pendingDemo` and `system` in prototype JSON are prototype only. Real Ouros never reads gates from layout JSON.
- Codex writes the tests for any feature Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
