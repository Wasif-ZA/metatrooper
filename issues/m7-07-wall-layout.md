# M7-7: Wall layout: splitters, fractions, auto layout, drag to pair, fold stack, palette ranking

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: Medium. Effort: 5.0 CC days. Depends on: M7-8, M6-6, M6-7, M6-9, M6-19. Nothing here starts before the public release on 2027-01-19. Start from `main` once those children are merged; record that `main` SHA as the base in the report.

## Context

The wall's shape is fixed by formulas today. You cannot widen the big column, keep a tile small, drag a tile into the pair, or find a done agent once the fold bars run out. Rivals' users ask for exactly these: resizable splits, layouts that adapt to the agent count, drag to rearrange. Each item names its idea in the idea mine (`~/.cache/claude-scratch/metatrooper-idea-mine-2026-10-10/`, lane wall-layout).

Sources and licences:

- Code is ported only from MIT sources: cmdk's `commandScore`, plus the patterns of react-resizable-panels, allotment, zellij and dockview.
- kitty (fractions) and niri (cross-fade) are GPL-3.0, so they give ideas only, no code.

Order inside the child: fractions, then splitters, then fold and cross-fade.

## Current state (verified 2026-10-14 on `main` 4fb7ef9; find code by the quoted text, line numbers move)

| # | Fact | Where |
|---|---|---|
| 1 | Constants: `const TOP = 64, G = 8, BAR = 36, SPN = 15;`. Margins and the 32 in `W - 32` are literals | `wall.js` top |
| 2 | Big column width: `const colW = (W) => (BIG.length > 1 ? (W - 32) * 0.625 : Math.max((W - 32) / 3.3 * 1.3, Math.min(460, W * 0.5)));`. Two formulas: one for a pair, one for a single big tile | `wall.js` `rects()` |
| 3 | A pair splits evenly: `const bw = (C - G * (BIG.length - 1)) / BIG.length;` | `wall.js` `rects()` |
| 4 | Work rows' share of the side column: `(A - G) * 1.2 / 2.2`, about 0.545 | `wall.js` `const wh =` |
| 5 | Fold cap: `Math.floor((H * 0.5) / (BAR + G))` bars. **Tiles past the cap get no rect, and `layout()` sets `el.hidden = !r`, so those sessions have no place on the wall at all today** | `wall.js` `const bars =` |
| 6 | `function layout(animate, dur = 1.1)` glides with GSAP (`gsap.to(el, {...r, duration: dur, ...})`). It skips unchanged tiles through `el._r`, and uses `gsap.set` plus an opacity flash under reduced motion. Window resize calls `layout(false)`. No snapshot or cross-fade exists | `wall.js` |
| 7 | Terminals refit through `new ResizeObserver(...)` with a 150 ms trailing debounce. `resize(t)` skips folded tiles and calls `troop.termResize(t.id, t.cols, t.rows)` only when cols or rows change. `refit(id)` exists. Nothing tells a terminal that a glide has ended | `terminal.js` |
| 8 | xterm loads only `addon-fit`, so it uses the DOM renderer. There is no canvas to copy for a snapshot | `index.html` scripts |
| 9 | The layout is saved per project as `ui.layout[projectId] = {big, order, open, pair_at, shells}` through `saveLayout()` (500 ms debounce) and `writeSetting('ui.layout', ...)`. There are no split sizes and no `ui.wall`, `layoutAuto`, `layoutManual`, `newAgent`, `pinFold`, `bigFrac`, `workFrac` or `pairFrac` anywhere | `app.js` `saveLayout`; `workbench/src/main.ts`; `core/src/settings.ts` `layout: {}` |
| 10 | Modes are `ui.mode` `'single' \| 'grid'`, saved in localStorage `troop.mode`, switched by `setMode`; Ctrl+G toggles. The title crumb (`<span class="crumb">`: project picker, `#branch`, `#core`) shows no mode and has no double-click handler | `app.js`, `index.html` |
| 11 | M6-9's tile keys on main: only Alt+J (`wallKeys`). Pairing is Shift+click (`onTilePick`) and the `pair`/`unpair` actions (`wall.pair`, `wall.unpair`). Promotion is `wall.promote` | `app.js`, `wall.js` |
| 12 | **New sessions land in two different places today.** Workbench launches call `pick(id)`, which sets single mode and promotes the session to the big slot. Sessions launched through the API go to the side (`if (!seed(id)) ORDER.push(id);`) and take the big slot only when it is empty | `app.js` `function pick`; `wall.js` `decide` |
| 13 | No `wheel` listener exists in the renderer | `workbench/renderer/` |
| 14 | `renderPalette()` filters by plain substring (`` `${x.group} ${x.label}`.toLowerCase().includes(q) ``) with no ranking. Scrollback hits (`scrollbackItems`) follow in group `Scrollback`. `paletteItems()` emits no needs-you group. localStorage goes through `load`/`save` with prefix `troop.` | `app.js` |
| 15 | No splitter code and no pointer drag on tile headers (`#split` in `wall.js` is the side panel) | `wall.js`, `terminal.js` |
| 16 | A folded tile keeps its stream today: folding only toggles `.fold`, and `termDetach` runs only when a session leaves the list. M6-7's "folded tiles get no stream" is not in the code | `terminal.js` `drop` |

## Change

1. **Fractions** (wall-layout 5).
   - `ui.layout[projectId]` gains `fracs: {big?, work?, pair?}`, each clamped to 0.2..0.8 and saved with the rest of the layout by `saveLayout()`. That is one save path, not a second `ui.wall` key.
   - `rects()` reads them:
     - `big` makes `colW = (W - 32) * big` for a single and a pair alike;
     - `work` replaces `1.2 / 2.2`;
     - `pair` gives the first pair tile `(C - G) * pair`.
   - An unset fraction keeps today's formula from facts 2 to 4, so nothing changes until a splitter moves.
2. **Splitters** (wall-layout 4, react-resizable-panels' preview mode).
   - New `workbench/renderer/splitter.js` provides three handles: big column against the rest, work rows against done rows, and (in a pair) the two pair tiles. Each is a focusable `role="separator"` with `aria-valuenow`.
   - A drag moves a preview line only. Release writes the fraction and runs `layout(true, 0.3)`.
   - A focused splitter moves 2% per arrow key. Home deletes its fraction, back to the formula.
   - Hidden in grid mode.
3. **Cross-fade on reflow** (wall-layout 7, idea from niri).
   - In `layout()`, for each tile whose rect changes by more than 8 px in width or height: clone the tile's `.xterm-screen` node into an absolutely placed copy (the DOM renderer has no canvas, fact 8), hide the live body, glide, then call `refit(id)` once from the GSAP `onComplete`, and fade the copy over 120 ms.
   - While a glide runs, a wall-level `gliding` flag makes the ResizeObserver handler in `terminal.js` do nothing.
   - Off under reduced motion, where tiles snap as today and refit once.
   - M7-8's leading-edge resize applies to window and splitter resizes only.
4. **Drag to fold** (wall-layout 8, allotment's snap).
   - Each work tile gets a 6 px handle on its bottom edge. Dragging it below 120 px sets `pinFold` on that session, so `folded()` returns true and the tile becomes the 36 px bar with its state and sparkline. It keeps whatever stream rule folded tiles have (fact 16); M7-7 adds none.
   - Dragging the bar's handle back above 120 px clears `pinFold`. So does a click on the bar or the session entering `waiting_for_you`.
   - `pinFold` is saved per session id in `ui.layout[projectId].pinned`.
5. **Layout by count** (wall-layout 9, zellij's swap layouts).
   - `ui.layoutAuto`: a `settings.set` key, default false. While it is false, `single` and `grid` behave exactly as today.
   - When it is on and the project's `ui.layout[projectId].manual` is not set:
     - 1 live pane: full;
     - 2: pair;
     - 3 to 5: big plus one column (today's single);
     - 6 to 8: big plus two columns, a new `rects()` branch splitting the side area into two equal columns;
     - 9 or more: grid.
   - A splitter release, a header drop or Ctrl+G sets `manual: true`. After that, a session count change never changes the layout.
   - The crumb gains `#layout-mode` reading "auto" or "manual", shown only when `ui.layoutAuto` is on. Double-clicking it clears `manual`.
6. **Drag a header** (wall-layout 12, dockview's drop quadrants).
   - A pointer drag on a tile header that moves more than 6 px shows a drop overlay:
     - over the big tile's left or right 25%, it pairs there (`wall.pair`);
     - over any tile's centre, it swaps the two (`setBig` for the big slot, an `ORDER` splice for side tiles).
   - Drop runs `layout(true, 0.6)`. Esc or a drop outside a tile cancels with no change.
   - Keyboard pairing stays M6-9's.
7. **Fold stack** (wall-layout 13, zellij stacks).
   - When folded bars exceed the cap (fact 5), the wall shows cap minus 1 bars plus one "+N more" bar. N counts the folded sessions not shown.
   - The "+N more" bar opens an inline scrollable list of one-line rows (label, state). Clicking a row opens that session as `toggleOpen` does.
   - At most one row's tile is open at a time. When N falls to 1, the stack becomes a normal bar.
   - This fixes fact 5: no session is ever without a place.
8. **Where new agents land** (wall-layout 15).
   - `ui.newAgent`: `big`, `side` or `big-if-idle`, a `settings.set` key that is unset by default.
   - Unset keeps fact 12 exactly: workbench launches take the big slot, API launches go to the side.
   - Once set, it applies to both kinds of launch. `big-if-idle` takes the big slot only when no session is `waiting_for_you`.
   - `pick()` stops promoting a new launch when the setting says `side`.
9. **Wheel on other tiles** (wall-layout 16, sshx).
   - A capture-phase `wheel` listener on the wall swallows the wheel over a tile that is not selected, unless Ctrl is held.
   - It shows a "click to scroll" hint on that tile for 1,200 ms.
10. **Palette ranking** (wall-layout 6).
    - `renderPalette` scores each item with a port of cmdk's `commandScore` (MIT, about 60 lines, in `workbench/renderer/score.js` with its licence line) against `` `${group} ${label}` ``. Items scoring 0 drop out.
    - Inside each group, items sort by score times zoxide's recency weight from localStorage `troop.paletteUse` (`{id: {n, at}}`). Weights: x4 within an hour, x2 within a day, x0.5 within a week, else x0.25.
    - Groups keep their order, and the `Scrollback` group stays last as M6-19 built it. If a needs-you group exists by then, it stays first.
    - `troop.paletteUse` keeps the 200 most recently used items.

## Acceptance criteria

- [ ] M7-07a. Dragging a splitter 200 px causes 0 `termResize` calls before release and at most 1 per changed tile after. An arrow key on a focused splitter moves it 2% (plus or minus 0.1%).
- [ ] M7-07b. With `big` 0.5, adding 3 sessions and removing 2 leaves the big column at 0.5 x (W - 32) px, plus or minus 1 px, before and after a restart. With no fractions saved, `rects()` returns the same rects as on the base revision for 1, 2, 5 and 9 sessions.
- [ ] M7-07c. Layout by count:
  - With `ui.layoutAuto` on, going from 1 to 2 to 6 to 9 live sessions with no manual change switches the layout 3 times (pair, big plus two columns, grid).
  - After one Ctrl+G, adding a session switches it 0 times and the crumb reads "manual".
  - A double-click on the crumb makes it read "auto", and the next session count change switches the layout again.
  - With `ui.layoutAuto` off, the crumb has no `#layout-mode`.
- [ ] M7-07d. Dropping a header on the big tile's right 25% pairs it. A centre drop on a side tile swaps the two. Esc during a drag leaves `wall.state()` unchanged.
- [ ] M7-07e. 20 done sessions on a 900 px tall window: every one has a bar or a row in "+N more", N equals the count not shown as bars, and no tile element is `hidden` while its session is listed.
- [ ] M7-07f. 10 wheel notches over an unselected tile move its scroll by 0 rows and send 0 bytes to its pty. With Ctrl held, it scrolls.
- [ ] M7-07g. Palette ranking:
  - "cdx" ranks "codex ..." first.
  - After one agent is picked 3 times, it ranks above an equal-scoring agent picked 0 times.
  - With a fake clock, an item last used 30 minutes ago scores 4 times its use count, 3 hours ago 2 times, 3 days ago 0.5 times and 30 days ago 0.25 times.
- [ ] M7-07h. With 6 tiles, during a Ctrl+G glide every tile whose size changes by more than 8 px has its live terminal hidden and its copy shown. `termResize` fires exactly once per changed tile, after the glide ends. Under reduced motion no copy is made.
- [ ] M7-07i. Home on a focused splitter puts it back at today's formula. Dragging a working tile's handle to 100 px makes a 36 px bar. The session entering `waiting_for_you` reopens it within one layout pass. `pinFold` survives a restart.
- [ ] M7-07j. Where new agents land:
  - With `ui.newAgent` unset, a workbench launch takes the big slot and an API launch goes to the side, as on the base revision.
  - With `side`, both leave the big slot unchanged.
  - With `big`, both take it.
  - With `big-if-idle`, either takes it only when no tile is waiting.
- [ ] M7-07k. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M7-07l. The existing workbench suites pass, including M6-9's and M6-19's.

## Testing plan

M7-7 is not in D65; the implementing agent writes these tests.

| Layer | What | Count |
|---|---|---|
| Renderer unit (`rects()`, `commandScore`, recency, stack math as pure functions) | b, e, g, and the unchanged-rects part of b | +4 |
| Renderer DOM (existing `renderer-guards` style, fake GSAP clock) | a, c, d, f, h, i, j | +7 |
| Electron E2E, `METATROOPER_UI_REVISION_E2E=1` | one splitter drag and one header drop on a live wall | +1 |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: never "make the tests pass".
2. Real code and real tests land in the same change.
3. Any change to an existing test, timeout or threshold is reported on its own line first, with its reason.
4. A reported command names the command and its observed result; stderr is never silenced in a cited command.
5. Your report is a claim until the parent re-runs it.
6. Never commit, push or open PRs; hand back the command. No em dashes; comments say what the code does.
7. No code from kitty or niri (GPL-3.0). cmdk's port keeps its MIT notice in `score.js`.
8. Show Wasif the running wall after the splitters and again at the end. Tests are not the check for a layout.

## Rollback

Revert the merge. The saved `fracs`, `pinned` and `manual` fields stay in `ui.layout`, where older code ignores them. `ui.layoutAuto` and `ui.newAgent` stay in `settings.json`, unused.

## Effort

Idea sizes as `spec.md` uses them:

- M, 0.75 each: splitters (4), cross-fade (7), drag to fold (8), layout by count (9), header drag (12). 5 x 0.75 = 3.75.
- S, 0.25 each: fractions (5), palette (6), fold stack (13), new agents (15), wheel (16). 5 x 0.25 = 1.25.

Total: 3.75 + 1.25 = 5.0 CC days, as in `spec.md`. Two findings sit inside those sizes:

- the new "big plus two columns" branch, inside item 9;
- the DOM-node copy instead of a canvas copy, inside item 7.

## Files

| File | Change |
|---|---|
| `workbench/renderer/wall.js` | `fracs` in `rects()`; two-column branch; fold stack; `pinFold`; gliding flag and `onComplete` refit; header drop targets |
| `workbench/renderer/splitter.js` | new: the three splitters |
| `workbench/renderer/score.js` | new: `commandScore` port (MIT) |
| `workbench/renderer/app.js` | `saveLayout` fields; layout by count; crumb mode; `ui.newAgent` in `pick`; wheel guard; palette ranking and `troop.paletteUse` |
| `workbench/renderer/terminal.js` | ResizeObserver skip while gliding; fold handle; `.xterm-screen` copy |
| `workbench/renderer/wall.css`, `index.html` | splitter, drop overlay, stack, hint, crumb styles; script tags |
| `core/src/settings.ts` | `ui.layoutAuto`, `ui.newAgent` defaults and validation |
| `workbench/test/m7-07-*.test.ts` | new |

## Risks

- **Six interacting layout features in one file.** `rects()` grows several branches. The unchanged-rects check in M7-07b is the guard that the default wall stays as it is.
- **Copying `.xterm-screen` for 6 tiles at once.** It costs one DOM clone each. If a long-task observer shows a frame over 50 ms on the laptop, fall back to hiding the body with no copy, and report it.
- **`ui.newAgent` changes API launches once set.** Pipeline apps (D54) that launch many sessions could take the big slot every time under `big`. `big-if-idle` is the safer suggestion for them.
- **Fact 5 is a live defect before the release.** Tiles past the fold cap disappear today. It waits here because D73 moved the stack to M7. See the report.

## Out of scope

- Free-form tiling (any split anywhere). The wall keeps its big-plus-columns shape.
- Saving layouts as named presets.
- Touch gestures.
- A focus mode that hides the side column (M6-9's keys cover it).
