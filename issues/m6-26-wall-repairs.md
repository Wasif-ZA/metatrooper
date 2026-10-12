# M6-26: Wall repairs before the freeze

Part of the MetaTrooper desk epic, Milestone 6. Priority: High (first on the slip list, D81). Effort: 2.6 CC days. Depends on: M6-27, and every open M6 branch that edits `workbench/renderer/app.js` or `workbench/src/main.ts` being merged first (today: m6-13, m6-21, m6-24, m6-3, m6-6, m6-merged-fixes, plus the uncommitted work of the "worktree list stale cleanup" session). Start from `main` once `git branch --no-merged main` lists none of those; record that `main` SHA as the base in the report.

## Context

First users meet the wall on 2027-01-19. Today it has defects that make it say something false, lose an agent, or hide what a control does. Each one is a repair to UI that already exists. Nothing here adds a panel, so it fits before the 2026-12-30 freeze under D73. Source: `~/.cache/claude-scratch/metatrooper-ui-research-2026-10-12/report.html` section 1. Decided with Wasif on 2026-10-12 (D81).

## Current state (verified 2026-10-12 on the working tree; find code by the quoted text, line numbers move)

| # | Defect | Where |
|---|---|---|
| 2 | Hide and "Clear" happen at once with no undo, and the core has no unhide | `app.js` `case 'hide'`, `case 'clear-all'` |
| 3 | "Stop core (stops every agent)" and "Restart core (... open agents stop)" run on one Enter | `app.js` palette items in the `Core` group |
| 4 | The Windows window keeps Electron's default menu bar. A bare Alt press focuses it, fighting the M6-9 Alt keys, and its accelerators (Ctrl+R Reload, Ctrl+Shift+I) sit above every tile | `workbench/src/main.ts` `new BrowserWindow` (framed); no `Menu.setApplicationMenu` call |
| 5 | Clicking the usage chip opens the agent list; usage shows on hover only. CSS already supports `.usage.open .pop` | `app.js` `class="chip uchip..." data-action="list"`; `wall.css` `.usage.open .pop` |
| 6 | With no approvals waiting, the sheet says "Nothing needs you" while the title chip can say "3 need you" | `app.js` `renderSheet` |
| 7 | Keys with no visible hint: Alt+J, Ctrl+G, Ctrl+B, Ctrl+K, Shift+Enter, Ctrl+click on a link or path, right-click paste, the browser pane keys | `app.js` key handlers, `terminal.js` |
| 8 | Cut-off text with no way to read it: tile task, tile last line, list row task (its `title` is fixed help text), pane titles cut at 40 characters | `wall.css` ellipsis rules; `terminal.js` `.tile-task`; `app.js` `.srow` |
| 9 | Two empty states name an action with no button: "No browser pane. Open one." and "Pick a project first." | `app.js` |
| 10 | The tile hide button is an icon with no `aria-label`; list and panel close buttons are a literal "x"; the Inbox and sinks popovers have no `role`; Esc does not close them while focus is in one of their inputs | `terminal.js`, `app.js`, `index.html` |

## Change

2. **Undo for hide and Clear, in the renderer only.** On click the tile or rows leave the wall at once and a toast reads "Agent hidden · Undo" (Clear: "N finished agents cleared · Undo") for 7,000 ms. `toast()` gains an optional `{label, run}` action; there is no other toast change.
   - Each click is its own operation with its own timer and its own toast; toasts stack, none replaces another. Undo cancels only its own operation.
   - Clear takes a snapshot of the session ids it hides at click time and, on expiry, sends one `session.hide` per id in that snapshot. It does not send `project.clear`, so sessions that finish during the 7 s are not swept up.
   - On expiry, each id is checked against the latest snapshot first: a session now in `starting`, `working` or `waiting_for_you` is not hidden and reappears.
   - A pending id stays out of the rendered wall and list until its operation ends. Switching projects does not cancel timers.
   - Closing the window inside the 7 s sends nothing; those sessions stay visible next time.
3. **Two-step confirm for Stop core and Restart core.** The first Enter arms the item: its label becomes "Press Enter again to stop every agent" (Restart: "Press Enter again to restart; open agents stop") and the palette stays open. An Enter while armed and within 3,000 ms of arming runs it. Disarm (label back) on 3,000 ms passing, any other key, a selection change, or Esc. An Enter on a disarmed item arms it again; it never runs it.
4. **No application menu.** Call `Menu.setApplicationMenu(null)` before the first window. The renderer already owns zoom, reload and devtools for browser panes (`browserKeys`). Copy and paste in inputs keep working on Windows without a menu.
5. **The usage chip toggles its popover.** `data-action="usage"` toggles `.open` on `.usage`. A click outside or Esc closes it. Hover still shows it. Only the click changes: the chip's text, the cost chip and the context chip keep their exact wording, which `workbench/test/m6-20-cost-chip.test.ts` and `m6-25-context-fill.test.ts` pin. Demo mode hides `#usage` (`style.css` demo rule) and the cost chip (`if (!DEMO)` in `app.js`); leave both as they are.
6. **Sheet empty text** becomes "No agent actions waiting", in both `sheetT` and the empty gate row.
7. **Keyboard shortcuts.** A palette item "Keyboard shortcuts" replaces the palette results with a read-only "Keys" group, one row per entry of a `KEYS` array in `app.js` (`{keys, does, where}`). Esc or a second Ctrl+K closes it like any palette view. No bare `?` key, because a focused tile must receive it. Windows only; no Mac variants. `KEYS` holds exactly this inventory, checked against the handlers on 2026-10-12 (add any M6-9 keys present on the base revision):

   | Keys | Does | Where |
   |---|---|---|
   | Ctrl+K | Open or close the palette and search | anywhere |
   | Ctrl+G | Grid on or off | anywhere |
   | Ctrl+B | Agent list on or off | anywhere |
   | Alt+J | Jump to the agent that has waited longest | anywhere |
   | Esc | Close the open panel or popover | anywhere |
   | Shift+Enter | New line without sending | agent tile |
   | Ctrl+C with a selection | Copy | tile |
   | Ctrl+V, right-click | Paste (an image if the clipboard has no text) | tile |
   | Ctrl+click | Open a link or file path | tile |
   | Ctrl+T | New browser pane | browser |
   | Ctrl+L | Address bar | browser |
   | Ctrl+F | Find in page | browser |
   | Ctrl+R, F5 | Reload | browser |
   | Alt+Left, Alt+Right | Back, forward | browser |
   | Ctrl+=, Ctrl+-, Ctrl+0 | Zoom in, out, reset | browser |
   | F12 | Page devtools | browser |
   | C | Comment on an element | browser |
   | Up, Down | Walk the element stack while picking | browser pick |

   Tooltips of controls with a key show it: "Agent list (Ctrl+B)", "Grid (Ctrl+G)", and the "N need you" chip says "Jump to the longest wait: Alt+J".
8. **Full text on hover.** `title` carries the full text on the tile task, the tile last line, list row tasks (help text moves after the task, on a second line) and pane tabs.
9. **Empty-state buttons.** "No browser pane." gets an "Open a browser pane" button using the existing palette action; "Pick a project first." gets a "Choose a project" button that opens the project picker.
10. **Labels.** `aria-label` on every button whose visible text is empty, "x", or a symbol; `role="dialog"` and `aria-label` on the Inbox and sinks popovers; Esc closes either popover from anywhere inside it, inputs included.

## Acceptance criteria

- [ ] M6-26b. Clicking hide on a done tile removes it from the wall within one render, and 0 `session.hide` calls are made before 7,000 ms (fake clock) and exactly 1 after. Clicking Undo at 6,999 ms makes 0 calls and the tile is back. Hiding tiles A then B and undoing A sends exactly 1 call, for B. If A's snapshot state turns `working` at 3,000 ms, 0 calls are made for A and its tile is back at expiry. Closing the window at 3,000 ms leaves 0 calls.
- [ ] M6-26c. "Clear" with 3 done and 1 working sessions removes 3 rows at once, shows "3 finished agents cleared · Undo", and after 7,000 ms sends exactly 3 `session.hide` calls, for those 3 ids, and 0 `project.clear` calls; the working session finishing at 3,000 ms is not among them. Undo before then makes 0 calls.
- [ ] M6-26d. In the palette, one Enter on "Stop core" makes 0 `stopCore` calls and the label reads "Press Enter again to stop every agent"; a second Enter at 2,999 ms makes 1. With no second Enter, the label is back at 3,000 ms; an Enter at 3,001 ms makes 0 calls and arms it again. ArrowDown while armed disarms it. Same for Restart core with `restartCore`.
- [ ] M6-26e. After start, `Menu.getApplicationMenu()` is null. In an Electron test, pressing and releasing Alt leaves focus in the selected tile, and Ctrl+R in a shell tile leaves the renderer's load count at 1 and reaches the pty.
- [ ] M6-26f. Outside demo mode, a click on the usage chip opens the usage popover and the agent list stays as it was; a second click, an outside click or Esc closes it. `m6-20-cost-chip.test.ts` and `m6-25-context-fill.test.ts` pass unchanged.
- [ ] M6-26g. With 0 approvals and 2 waiting sessions, the sheet reads "No agent actions waiting" and the title chip reads 2.
- [ ] M6-26h. `KEYS` holds every row of the table in Change 7, and the "Keyboard shortcuts" view shows one row per entry; Esc closes it. A test fires each entry's keys in its context and sees its action happen (for terminal keys, the expected bytes or clipboard change), so a removed handler fails. A static test scans `app.js` and `terminal.js` for `ctrlKey`/`altKey` key checks and fails on a key that has no `KEYS` row.
- [ ] M6-26i. A task of 200 characters shows in full in the `title` of its tile task and list row; a last line of 300 characters shows in full in the tile last line's `title`; a pane tab whose page title is 80 characters carries all 80 in `title`. The list, grid and need-you controls show their key in `title` as written in Change 7.
- [ ] M6-26j. "Open a browser pane" in the empty browser panel opens one pane; "Choose a project" opens the project picker.
- [ ] M6-26k. Every `button` in the rendered wall whose trimmed text is empty, "x" or one non-letter character has a non-empty `aria-label`; the Inbox and sinks popovers have `role="dialog"`; Esc with focus in a sinks form input closes it, and Esc with focus in the Inbox closes it.
- [ ] M6-26l. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M6-26m. The existing workbench and core suites still pass.

## Testing plan

| Layer | What | Count |
|---|---|---|
| Renderer unit (existing `renderer-guards` style) | b, c, d, f, g, i, j, k | +8 |
| Static | h (every key check has a `KEYS` row) | +1 |
| Electron | e (menu, Alt, Ctrl+R), h (keys fire) | +2 |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: never "make the tests pass".
2. Real code and real tests land in the same change.
3. Any change to an existing test, timeout or threshold is reported on its own line first, with its reason.
4. A reported command names the command and its observed result; stderr is never silenced in a cited command.
5. Your report is a claim until the parent re-runs it.
6. Never commit, push or open PRs; hand back the command. No em dashes; comments say what the code does.
7. Edit only your own lines in files other sessions have uncommitted changes in; stage by hand.

## Rollback

Revert the merge. No data, schema or protocol changes.

## Effort

0.5 undo (toast action, pending sets, per-id timers, recheck), 0.2 two-step confirm, 0.2 menu and its Electron test, 0.2 usage chip, 0.05 sheet text, 0.4 shortcuts list and tooltips, 0.15 titles, 0.15 empty-state buttons, 0.25 labels and Esc, 0.5 tests = 2.6 CC days.

## Files

| File | Change |
|---|---|
| `workbench/renderer/terminal.js` | hide button `aria-label`, task and last-line `title` |
| `workbench/renderer/app.js` | `toast` action, pending hide and clear, palette two-step, usage toggle, sheet text, `KEYS` and its palette item, tooltips, list row titles, empty-state buttons, labels, Esc |
| `workbench/renderer/index.html` | popover roles and labels |
| `workbench/src/main.ts` | `Menu.setApplicationMenu(null)` |
| `workbench/test/` | new tests above |

## Out of scope

- A History panel and a Settings panel (M7, D1 of 2026-10-12).
- `session.unhide` in the core (D2: renderer delay instead).
- Stopping an agent from its tile (needs the M7-06b close ladder).
- A frameless window with its own title bar.
- Focus traps in popovers.
- Workbench devtools from a key once the menu is gone (start with `--inspect` or add a palette item later if missed).
