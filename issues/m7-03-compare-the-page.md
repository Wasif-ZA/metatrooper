# M7-3: Compare the page: device, rendering, reference overlay, follow session

Part of the MetaTrooper desk epic, Milestone 7 (after the release). Priority: Medium. Effort: 2.0 CC days. Depends on: M6-11 (merged), and M7-1 for its re-attach after a DevTools detach (`dbg.on('detach')`, spec.md M7-1). Start from `main` after M7-1 is merged; record that `main` SHA as the base in the report.

## Source of truth

- `spec.md`: the Milestone 7 children table row M7-3, and the "Specced, built after the release" section ("Compare the page"). D73 and D77 say why it is in this milestone.
- `ide-layer-research/idea-coverage.md` names the mined ideas this child builds.
- The contracts listed at the top of `spec.md`. If this file and a contract disagree, the contract wins. `contracts/browser-tools.md` gains `emulate`.

## Context

A developer checking a page wants to see it as a phone, in dark mode, or against a saved design, and wants the agent to see the same thing. Today the pane can only take before and after captures. This child adds a device and rendering record per pane that both the user and the agent set, a reference image drawn over the live page, and an opt-in reload when the session's turn ends.

## Current state (verified 2026-10-14 on `main` 4fb7ef9 and every unmerged branch; find code by the quoted text, line numbers move)

| # | Fact | Where |
|---|---|---|
| 1 | The only emulation is the parked viewport: `applyViewport` sets `Emulation.setDeviceMetricsOverride {1280x800, dsf 1, mobile false}` on a parked pane and `clearDeviceMetricsOverride` on unpark. Every layout change parks or unparks, so any other override would be overwritten or cleared. | `workbench/src/browser/panes.ts` `applyViewport`, `layout` |
| 2 | `capture()` sets 390 and 1280 px widths for its two shots and, in a `finally`, restores "parked or clear" (M6-13), which would drop a device setting. Shots are saved to `~/.metatrooper/snapshots/<pane_id>/<stamp>-<label>-<width>.png` with a `snapshot` row; the `label` CHECK already allows `'reference'`, which nothing writes. | `panes.ts` `capture`; `core/src/methods.ts` `pane.capture`; `contracts/schema.sql` `snapshot` |
| 3 | No `setEmulatedMedia`, vision deficiency, CPU throttling or offline emulation anywhere; no `emulate` tool. | repo-wide, every branch |
| 4 | DevTools for a page opens with `wc.openDevTools({mode: 'detach'})` (F12, Ctrl+Shift+I). There is no `detach` handler on `pane.dbg`; M7-1 specs one. | `panes.ts` `act('devtools')` |
| 5 | The pane menu holds Take Before, Take After, Compare/Live, Find in page, Driven by, Close pane. | `workbench/renderer/browser-chrome.js` `menuItems` |
| 6 | The overlay view above a pane is a `WebContentsView` holding only the cursor. Electron views have no click-through, so while it is attached it takes every mouse event over the pane; today it is attached only around an agent action. | `workbench/renderer/overlay.*`; `panes.ts` `pointAt` |
| 7 | Nothing reloads a pane on a session state change. The workbench learns states from `push()` rebuilding `lastGood` from the database. | `workbench/src/main.ts` `push`, `read` |

## Change

1. **One record per pane.** `pane.emu = {device, rendering}` in the workbench, in memory, kept for the pane's life. `device`: `null` (responsive, today's behaviour) or `{name, width, height, dsf, mobile, rotated}` from four presets: iPhone 390x844 at 3, Android 412x915 at 2.625, iPad 820x1180 at 2, Laptop 1366x768 at 1; Rotate swaps width and height. `rendering`: `{color_scheme: 'light'|'dark'|null, reduced_motion: bool, vision: 'none'|'blurredVision'|'reducedContrast'|'achromatopsia'|'deuteranopia'|'protanopia'|'tritanopia', cpu: 1|4|6, offline: bool}`.
2. **One apply function.** `applyEmulation(pane)` replaces `applyViewport`'s override logic and `capture()`'s restore. Parked: today's 1280x800. Else with a device: `setDeviceMetricsOverride {width, height, deviceScaleFactor: dsf, mobile, scale}` with `scale = min(1, paneWidth / width, paneHeight / height)`, `setTouchEmulationEnabled` on for mobile presets, and the view and overlay bounds set to the scaled size centred in the pane area. Else clear. Then `setEmulatedMedia {features: [prefers-color-scheme, prefers-reduced-motion]}`, `setEmulatedVisionDeficiency`, `setCPUThrottlingRate`, and `Network.emulateNetworkConditions {offline}`. It runs on unpark and park, on main-frame `Page.frameNavigated`, at the end of `capture()`, and from M7-1's re-attach after a detach.
3. **Pane menu.** Device (Responsive, the four presets, Rotate) and Rendering (Colour scheme: system, light, dark; Reduced motion; Vision: the six types and none; CPU: 1x, 4x, 6x; Offline). Each item shows a check when set. A small text tag in the pane's chrome bar names any non-default setting ("iPhone · dark · 4x CPU").
4. **`emulate` browser tool.** `emulate {pane_id, device?, rotate?, color_scheme?, reduced_motion?, vision?, cpu?, offline?}` sets the same record and returns it. `device` takes a preset name or `{width, height, dsf?, mobile?}` (width and height 200 to 4,000). It is a reading-class tool for D61 (no approval card) but obeys the pane's driver rule like every browser tool. A user change to the record is visible to the agent on its next `snapshot` header line ("emulating: iPhone, dark").
5. **Overlay hold mode.** A shared mode of the overlay view (M7-2's pins use it too). While held, the overlay view stays attached over the pane; wheel events on it are forwarded to the page with `Input.dispatchMouseEvent {type: 'mouseWheel'}`; clicks do not reach the page. The page's scroll position reaches the overlay through a `scroll` listener in MetaTrooper's isolated world calling a `Runtime.addBinding` binding (`executionContextName: 'metatrooper'`), so the page's DOM and main world are unchanged.
6. **Overlay reference.** Pane menu "Overlay reference..." lists the pane's `snapshot` rows and lets the user pick a PNG file; a picked file is copied to the snapshots folder with a `reference` row. While on, the overlay (hold mode) draws the image at the page's scroll offset, clipped at a vertical divider, at an opacity. The divider position (0 to 100%) and the opacity slider (0 to 100%) sit in the pane's chrome bar; Esc or the menu item again turns it off.
7. **Follow session.** Pane menu "Follow session" (off by default, per pane, in memory). When on and the pane is shown and assigned to a session, a change of that session's state from `working` to `done` or `idle` in `lastGood` reloads the pane once (`webContents.reload()`), at most once per turn.

## Acceptance criteria

The first three are copied from `spec.md` and must not be reworded here.

- [ ] M7-03a. Device iPhone preset, then a navigation: the page still reports `innerWidth` 390. `emulate {color_scheme: "dark"}` makes `matchMedia('(prefers-color-scheme: dark)')` true on the next snapshot.
- [ ] M7-03b. With Follow session on, a session moving from `working` to `done` reloads its shown pane once.
- [ ] M7-03c. Overlay reference over a fixture page: the divider and opacity slider change only the overlay, it follows a 500 px scroll within 1 frame, and a DOM mutation observer on the page records 0 changes. After DevTools detaches, the pane's device and rendering record is re-applied. With Follow session on, `working` to `idle` also reloads once.
- [ ] M7-03d. With the iPhone preset set, parking and unparking the pane, and a `pane.capture`, each leave `innerWidth` at 390 afterwards.
- [ ] M7-03e. `emulate` from a session that does not drive the pane fails with the same error as other tools; `emulate {device: {width: 100, height: 800}}` is refused.
- [ ] M7-03f. Each rendering setting has a check: `prefers-reduced-motion: reduce` matches, a vision type changes a red pixel's captured colour, `cpu: 4` makes a fixed busy loop at least 3 times slower, and `offline` makes a `fetch` reject.
- [ ] M7-03g. With Follow session off, a `working` to `done` change reloads nothing; with it on, `done` then `idle` in the same turn reloads once.
- [ ] M7-03h. Each test states its card: `protects=`, `fails_when=`, `no_claim=`.
- [ ] M7-03i. The existing workbench suites still pass, including the M6-13 capture tests.

## Testing plan

D65 does not list M7-3, so the implementing agent writes the tests, with the cards in rule 1.

| Layer | What | Count |
|---|---|---|
| Electron with a fixture page | a, d, e, f (one per setting) | +4 |
| Electron, overlay | c (divider, opacity, scroll follow, mutation count, detach re-apply) | +1 |
| Workbench unit with a fake `lastGood` | b, g | +1 |

## Rules for the implementing agent

1. Acceptance criteria are the `protects / fails_when / no_claim` profile of each test: never "make the tests pass".
2. Real code and real tests land in the same change.
3. Any change to an existing test, timeout or threshold is reported on its own line first, with its reason.
4. A reported command names the command and its observed result; stderr is never silenced in a cited command.
5. Your report is a claim until the parent re-runs it.
6. Never commit, push or open PRs; hand back the command. No em dashes; comments say what the code does.
7. Nothing here starts before the public release on 2027-01-19.

## Rollback

Revert the merge. Nothing is stored except `reference` snapshot rows, which the schema already allows.

## Effort

0.75 the record, `applyEmulation`, the menu and the `emulate` tool, 0.75 overlay hold mode and the reference overlay, 0.25 follow session, 0.25 tests = 2.0 CC days.

## Files

| File | Change |
|---|---|
| `workbench/src/browser/panes.ts` | `pane.emu`, `applyEmulation`, `capture()` restore, `emulate`, hold mode, scroll binding, follow reload |
| `workbench/src/browser/server.ts`, `core/src/hook/browser-mcp.ts` | `emulate` tool |
| `workbench/renderer/browser-chrome.js`, `app.js` | Device, Rendering, Overlay reference and Follow session menu items; the tag, divider and opacity controls |
| `workbench/renderer/overlay.js`, `overlay.css` | reference image layer, wheel forwarding |
| `workbench/src/main.ts` | follow session from `lastGood` changes |
| `contracts/browser-tools.md` | `emulate` |
| `workbench/test/` | the tests above |

## Out of scope

- A user agent string per device preset.
- Keeping the record across a workbench restart.
- Network throttling other than offline.
- Clicking the page while the reference overlay is on (the overlay view takes clicks; see the report).
