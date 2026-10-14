# M6-18: Agent cursor for browser and desktop

Part of the MetaTrooper desk epic, Milestone 6. Priority: Critical. Effort: 4.5 CC days. Depends on: M6-11 (merged), M6-15 (branch `m6-15-computer-use`, unmerged). Start from `main` once `git branch --no-merged main` no longer lists `m6-15-computer-use`; record that `main` SHA as the base in the report.

## Source of truth

- `spec.md`: the Milestone 6 children table row M6-18, "The agent cursor (M6-18, D69)", "Computer use", and every section that names M6-18.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins. This child writes `contracts/agent-cursor.md`; the message shapes in Change 1 go there word for word.

## Context

D69: every agent action in a browser pane and on the desktop shows that agent's own cursor gliding to the target, then the input. The real pointer never moves, and the cursor adds at most 250 ms per action. Today the browser has one blue dot driven by a fixed sleep, and the desktop has no cursor at all: `cursor.glide` answers at once. This child builds the cursor once (`overlay.js`) and hosts it twice: the overlay view above each browser pane, and one click-through window per display for the desktop.

## Current state (verified 2026-10-14 on `main` 4fb7ef9 and `m6-15-computer-use` 7b6cf43; find code by the quoted text, line numbers move)

| # | Fact | Where |
|---|---|---|
| 1 | The cursor is one hardcoded blue dot (`rgb(47 111 228 / 0.85)`) moved by a CSS `transition`. It never reports back. | `workbench/renderer/overlay.css`, `overlay.js` `window.overlayBridge.onCursor` |
| 2 | `pointAt` sends `{x, y, ease: EASE_MS}` (`EASE_MS = 150`), then `await sleep(EASE_MS + 30)`, then reads the dot back with `executeJavaScript('window.cursorAt ? ...')` and logs a `kind: 'cursor'` probe. Every browser click, type and select pays 180 ms plus the read-back, whatever the distance. | `workbench/src/browser/panes.ts` `pointAt`, `clickAt` |
| 3 | The pane overlay view is added on each `pointAt` and removed 1,600 ms later if no newer action came. | `panes.ts` `overlayShownUntil` |
| 4 | The preload exposes one channel, `cursor`, main to overlay only. | `workbench/src/browser/overlay-preload.cjs` |
| 5 | `cursor.glide` on the workbench pipe checks the connection is bound to that session, then replies `{arrived: true}` at once. | `m6-15-computer-use`: `workbench/src/browser/server.ts`, the `ponytail:` line naming M6-18 |
| 6 | `metatrooper-desktop` already calls `cursor.glide {session, target_rect_px, caption}` after `approval.check` allows and before `desktop.act`, and fails the tool if the glide errors. `caption()` already says "type N characters", never the text. | `m6-15-computer-use`: `core/src/hook/desktop-mcp.ts` `input` |
| 7 | `desktop.describe` returns `rect` in physical pixels: the element's `BoundingRectangle`, or the window rectangle when there is no ref. | `m6-15-computer-use`: `core/src/desktop/uia-helper.ps1` `RectOfElement`, `RectOf` |
| 8 | Tiles have no identity colour. The header tint (`hdr`) shows state. The only per-session colour is `sessionColour(id)` (hue from a string hash) used by the grant frames. | `workbench/renderer/app.js` `Tile state colour`; `m6-15-computer-use`: `workbench/src/desktop-frames.ts` |
| 9 | Physical to DIP conversion already exists for the grant frames: `screen.screenToDipRect(null, r)` on Windows. | `desktop-frames.ts` `syncFrames` |
| 10 | Agent screenshots cannot contain an overlay: browser captures are `Page.captureScreenshot` of the pane's own webContents, and desktop `screenshot` is `PrintWindow` of the target window with `PW_RENDERFULLCONTENT`. Content protection only matters to whole-screen captures (recordings, other tools). | `panes.ts`; `uia-helper.ps1` |
| 11 | `settings.ts` has no `agent_cursor` group. | `core/src/settings.ts` |
| 12 | Two existing tests pin cursor behaviour: M1-23 (a `cursor` probe precedes the `click` probe and sits within 5 px of the target) and the "rename during the cursor glide asks" step (the recheck runs after the glide, before the mouse events). | `workbench/test/browser-pane.test.ts`; `workbench/test/m6-02-approvals-e2e.test.ts` |

## Change

1. **Contract.** `contracts/agent-cursor.md` defines, and the code uses, exactly these shapes:
   - Main to overlay, channel `cursor.glide`: `{id, session, colour, label, from, to, targetRect, ms, caption, mode, reducedMotion}`. `from`, `to` are `{x, y}` and `targetRect` is `{x, y, width, height}`, all in the host's own CSS pixels. `label` is the engine name, a space, a middle dot, a space, and the task cut to 28 characters. `caption` never holds typed text.
   - Overlay to main, channel `cursor.arrived`: `{id, at}` with `at` from `performance.timeOrigin + performance.now()`.
   - Workbench pipe, `cursor.glide {session, target_rect_px: [x, y, w, h], caption}` (physical pixels) replies `{arrived: true, ms, shown, late}`. `shown` is false when the mode is `off` or the target is minimised, closed or empty. `late` is true when the input went at `ms + 16` without an `arrived`.
   - Glide time `clamp(70 + 55 * log2(D / W + 1), 90, 220)` ms, D the distance and W the target width in the host's pixels, as worked in `spec.md`.
2. **One renderer.** `overlay.js` keeps a map of cursors by session. Each cursor is an arrow in the session's colour with a chip holding `label`. On `cursor.glide` it plans the path once as timed samples (eased, one gentle bend), plays it with `requestAnimationFrame` by the clock, not by frame count, and sends `cursor.arrived` when the last sample is drawn. The ripple and the caption play after `arrived`, off the critical path. The latest mover draws on top. A cursor idle for `idle_fade_ms` fades over 300 ms and is removed. Reduced motion (`prefers-reduced-motion` or `systemPreferences.getAnimationSettings().prefersReducedMotion`, sent as `reducedMotion`): `ms` is 0, the cursor snaps, and a 120 ms colour flash replaces the ripple. `overlay.css` drops the hardcoded blue; colour comes from the message.
3. **Glide rules** (computed in main, one function used by both hosts):
   - Target point: the centre of `targetRect` for click, type and select. For key and scroll, the cursor's current position when it is inside `targetRect`, else the centre.
   - First action of a session, or the first after its cursor faded: `ms` 0, the cursor appears at the target with a 120 ms fade-in.
   - Target point within 4 px of the current position: `ms` 0, ripple only.
   - Distance over 25% of the display's (or pane's) diagonal: `ms` 0, snap.
   - Mode `instant`: always `ms` 0. Mode `human`: `ms` is the formula times 2.5 with overshoot; it breaks the 250 ms budget on purpose (D69). Mode `off`: nothing is sent to an overlay; `cursor.glide` replies `{arrived: true, ms: 0, shown: false, late: false}` at once and browser input goes straight on.
4. **Browser host.** `pointAt` sends `cursor.glide` to the pane's overlay and waits for `cursor.arrived` with that `id` or `ms + 16`, whichever is first. The fixed `sleep(EASE_MS + 30)`, `EASE_MS`, the `executeJavaScript` read-back and `window.cursorAt` go. The `cursor` probe stays, now `{kind: 'cursor', pane, session, target, at, ms, late, requested_at, arrived_at}`, with `at` the drawn position the overlay reports in `cursor.arrived` (add `x, y` to that message for the probe only). The overlay view stays attached while any of its cursors is visible and is removed when the last one fades. `recheck` still runs after the glide and before the mouse events. A destroyed or crashed overlay never blocks input: the wait ends at `ms + 16`.
5. **Desktop host.** New `workbench/src/desktop-overlay.ts`:
   - One window per display, made on first use: `transparent`, `frame: false`, `focusable: false`, `skipTaskbar`, `hasShadow: false`, `show: false`, sandboxed, loading `overlay.html` with the same preload; `setIgnoreMouseEvents(true)`; `setContentProtection(!show_in_recordings)`. Shown with `showInactive()` only.
   - `cursor.glide` from the pipe converts `target_rect_px` with `screen.screenToDipRect(null, r)`, picks the display with `screen.getDisplayMatching`, sizes that display's window to the display's `bounds`, and sends the glide in that window's coordinates. A cursor moving between displays fades on the old one and appears (rule 3, first action) on the new one.
   - While a cursor shows: `setAlwaysOnTop(true, 'floating')` and `moveTop()`, re-asserted every 100 ms; the target rect refit from `grant.live` every 250 ms and on `display-metrics-changed`, `display-added` and `display-removed`. 1,500 ms after the last action: `setAlwaysOnTop(false)` and `hide()`.
   - A minimised, closed or zero-size target: no glide, `shown: false`, the cursor hides.
   - Covered target: `desktop.describe` adds `covered_by` (the title of the top-level window at the target point from `WindowFromPoint`, when it is not the granted window or one it owns). The cursor still draws on top and the caption adds "behind <title>" (title cut to 40 characters).
   - `server.ts` `cursor.glide` replaces the stub: keeps the bound-session check, calls the desktop host, replies on `arrived` or `ms + 16`.
6. **Colour and chip.** `sessionColour` moves from `desktop-frames.ts` to `workbench/src/colour.ts`; the grant frame, both cursor hosts and the watch thumbnail use it. Main adds `colour` to each session it pushes to the renderer, and the tile header shows a 6 px dot in that colour before the engine name (D69 says "the same colour as its tile"; see the report for this choice).
7. **Watch layout.** Each live thumbnail in `#watch` draws a 10 px dot in the session's colour at the cursor's last position, mapped from the window rect to the thumbnail, while that cursor is visible.
8. **Settings.** `core/src/settings.ts` gains `agent_cursor: {mode: 'snappy', show_caption: true, idle_fade_ms: 5000, show_in_recordings: false}`. `mode` accepts `off`, `instant`, `snappy`, `human`; any other value is read as `snappy` and logged once. `/demo-capture` sets `show_in_recordings: true` for its instance only.

## Acceptance criteria

The first four are copied from `spec.md` and must not be reworded here.

- [ ] M6-18a. In a browser pane and in Notepad, every click and type shows the session's own cursor arriving at the target before the input lands, measured from the overlay's `arrived` message and the input time; the added time per action is under 250 ms at the 95th percentile over 100 actions.
- [ ] M6-18b. Two agents acting at once show two cursors in their own colours. The real pointer's position is unchanged throughout (read before and after).
- [ ] M6-18c. An agent screenshot taken while its cursor is visible does not show the cursor (pixel check at the cursor's position), or the result carries `overlay_may_show: true`.
- [ ] M6-18d. On two displays at 100% and 150%, the cursor lands within 3 px of the target after the target window is dragged from one display to the other.
- [ ] M6-18e. Measuring a and b: with `METATROOPER_WORKBENCH_PROBE` set, each action logs `requested_at`, `arrived_at` and the input probe's time; added time is input time minus `requested_at`. 100 browser clicks and types on a fixture page and 100 Notepad clicks and types (the `m6-15-notepad-e2e` harness) each give a 95th percentile under 250 ms, and in every row `arrived_at` or `late` comes before the input. `screen.getCursorScreenPoint()` read before and after each run is equal.
- [ ] M6-18f. The glide time function returns 90 to 220 for any D and W, rises with D, falls with W, and gives 220 for D 600, W 80 and 93 for D 40, W 120 (rounded).
- [ ] M6-18g. Glide rules: a session's first action has `ms` 0; a second action at a point 3 px away has `ms` 0 and one at 300 px has `ms` above 0; a move longer than 25% of the diagonal has `ms` 0; reduced motion gives `ms` 0 for every action; mode `instant` gives `ms` 0; mode `off` sends no overlay message and `cursor.glide` replies `shown: false` within 20 ms.
- [ ] M6-18h. An overlay that never sends `cursor.arrived` delays the input by `ms + 16` ms (±10 ms) and the probe row says `late: true`. A destroyed overlay view does the same; the action still succeeds.
- [ ] M6-18i. No overlay message, probe row or `cursor.glide` reply contains the text of a `type` call (checked with a 24-character marker string).
- [ ] M6-18j. `cursor.glide` on a connection bound to another session, or not bound, fails with -32030 and draws nothing.
- [ ] M6-18k. Desktop window life: after an action the overlay window is visible, not focusable and ignores the mouse; 1,500 ms after the last action it is hidden and `isAlwaysOnTop()` is false. The focused window before and after a desktop click is the same as without the overlay.
- [ ] M6-18l. A minimised granted window gives `shown: false` and no visible cursor. A granted window covered by another window gives a caption ending "behind <that window's title>".
- [ ] M6-18m. Placement, without real displays: with a faked `screen` of two displays (100% at 0,0 1920x1080; 150% to its right), a physical rect on each converts and lands within 3 px of the expected DIP point on the right display's window.
- [ ] M6-18n. A cursor idle for `idle_fade_ms` is gone 300 ms later, and the pane overlay view is detached once its last cursor is gone.
- [ ] M6-18o. Two sessions get different colours, the tile dot and both cursors of one session use the same colour, and the watch thumbnail dot appears in that colour.
- [ ] M6-18p. Existing tests: M1-23 in `browser-pane.test.ts` still passes with its assertions unchanged (cursor probe before click probe, within 5 px). The "rename during the cursor glide asks" step in `m6-02-approvals-e2e.test.ts` passes unchanged.
- [ ] M6-18q. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M6-18r. The existing workbench and core suites still pass.

## Testing plan

Codex writes every test below through `/tests-brief` (D65), then a mutation run proves they bite: remove the `arrived` wait, swap the colour, drop the bound-session check, leave the window always on top, and put typed text in the caption; each must fail a test.

| Layer | What | Count |
|---|---|---|
| Unit (node:test) | f, g, i (glide function, rules, caption), m (placement with a fake `screen`) | +4 |
| Pipe | j (`cursor.glide` binding), g (mode `off` reply) | +2 |
| Electron | a, e (100 browser actions), h, k, n, o, p | +6 |
| E2E on this laptop | a, b, e (100 Notepad actions, two sessions at once, pointer read), c (desktop and browser screenshot pixel check at the cursor's position), l | +3 |
| Manual, recorded | d on two real displays at 100% and 150%. The automated run skips with "needs 2 displays" when `screen.getAllDisplays().length < 2`; the report records the manual run (date, displays, measured error in px) | 1 run |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: never "make the tests pass".
2. Real code lands with Codex's tests in the same change; you do not write the tests (D65).
3. Any change to an existing test, timeout or threshold is reported on its own line first, with its reason. M1-23 and the m6-02 glide step must pass unchanged.
4. A reported command names the command and its observed result; stderr is never silenced in a cited command.
5. Your report is a claim until the parent re-runs it.
6. Never commit, push or open PRs; hand back the command. No em dashes; comments say what the code does.
7. Edit only your own lines in files other sessions have uncommitted changes in; stage by hand.

## Rollback

Revert the merge. No schema or core protocol change; `cursor.glide` keeps its params and gains reply fields, and `agent_cursor.mode: off` turns the cursor off without a revert.

## Effort

0.2 contract, 0.8 overlay renderer (cursor map, timed path, `arrived`, chip, caption, ripple, fade, reduced motion), 0.3 glide rules and modes, 0.4 browser host (`arrived` wait, overlay life, probe), 1.0 desktop host (per-display windows, placement, refit, z-order, content protection, `covered_by`), 0.2 `cursor.glide` in `server.ts`, 0.2 colour module, tile dot and watch dot, 0.1 settings, 0.8 tests brief and mutation run, 0.5 the 100-action timing runs and the two-display manual run = 4.5 CC days.

## Files

| File | Change |
|---|---|
| `contracts/agent-cursor.md` | new: the shapes and timing in Change 1 |
| `workbench/renderer/overlay.js`, `overlay.css`, `overlay.html` | cursor map, arrow and chip, timed path, `cursor.arrived`, ripple, caption, fade |
| `workbench/src/browser/overlay-preload.cjs` | `cursor.glide` in, `cursor.arrived` out |
| `workbench/src/browser/panes.ts` | `pointAt` waits on `arrived`; `EASE_MS`, the sleep and the read-back go; overlay life; probe fields |
| `workbench/src/desktop-overlay.ts` | new: per-display windows, placement, refit, z-order, content protection |
| `workbench/src/browser/server.ts` | `cursor.glide` calls the desktop host |
| `workbench/src/colour.ts` | new: `sessionColour`, moved from `desktop-frames.ts` |
| `workbench/src/desktop-frames.ts` | imports `sessionColour` |
| `workbench/src/main.ts` | `colour` on pushed sessions; display events; mode from settings |
| `workbench/renderer/terminal.js`, `wall.css` | tile colour dot |
| `workbench/renderer/app.js` | watch thumbnail cursor dot |
| `core/src/settings.ts` | `agent_cursor` group |
| `core/src/desktop/uia-helper.ps1`, `core/src/desktop/driver.ts` | `covered_by` in `describe` |
| `workbench/test/`, `core/test/` | Codex's tests above |

## Out of scope

- cua-driver and its `--no-overlay` flag (D71: not installed).
- A cursor for input an agent sends through its own shell; the input watcher (M6-22) covers that.
- Streaming cursors to another screen or recording them (M7 idea mine, agent-cursor 13).
- `reveal {ref}` flashing a cursor on an element (M7-2).
- Showing typed text anywhere.
