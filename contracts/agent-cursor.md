# The agent cursor

Version 1 (M6-18, D69; open calls D48-D57 decided 2026-10-18). Each agent session has its own cursor, drawn by one
renderer (`workbench/renderer/overlay.js`) in two hosts: the overlay view above each browser pane, and one
click-through window per display for the desktop. The real pointer never moves. Code: `workbench/src/cursor-glide.ts`
(timing, rules, placement), `workbench/src/browser/panes.ts` `pointAt` (browser host),
`workbench/src/desktop-overlay.ts` (desktop host).

## Messages

- Main to overlay, channel `cursor.glide`: `{id, session, colour, label, from, to, targetRect, ms, caption, mode, reducedMotion}`.
  `from`, `to` are `{x, y}` and `targetRect` is `{x, y, width, height}`, all in the host's own CSS pixels. `label` is the
  engine name, a space, a middle dot, a space, and the task, the whole label cut to 28 characters (D50; a cut label ends
  in "…"). `caption` never holds typed text; it is empty when `agent_cursor.show_caption` is false. `id` matches the
  `cursor.arrived` reply to its glide and `mode` picks the path shape (D51).
- Main to overlay, channel `cursor.hide`: `{session}`. The session's cursor fades over 300 ms and is removed. Main sends
  it when the cursor has been idle for `agent_cursor.idle_fade_ms`, when the target is minimised, closed or empty, and
  on the old display when a cursor moves to another.
- Overlay to main, channel `cursor.arrived`: `{id, at}` with `at` from `performance.timeOrigin + performance.now()`.
  The overlay adds `x, y` (the drawn position) for the browser probe row only.
- Workbench pipe, `cursor.glide {session, target_rect_px: [x, y, w, h], caption}` (physical pixels) replies
  `{arrived: true, ms, shown, late}`. `shown` is false when the mode is `off` or the target is minimised, closed or empty
  (`target_rect_px` null or of zero size). `late` is true when the reply went at `ms + 16` without an `arrived`. A
  caption starting "press" or "scroll" is a key or scroll: the cursor stays where it is when it is inside the target.
  `session` must be the connection's bound session, else -32030 and nothing is drawn.

No message, reply or probe row carries the text of a `type` call: captions say "type N characters".

## Timing

Glide time is `clamp(70 + 55 * log2(D / W + 1), 90, 220)` ms, rounded, D the distance and W the target width in the
host's pixels. A 600 px move to an 80 px button: 600 / 80 + 1 = 8.5; log2(8.5) = 3.09; 70 + 55 x 3.09 = 240, capped to
220 ms. A 40 px hop to a 120 px button: 40 / 120 + 1 = 1.33; log2(1.33) = 0.41; 70 + 22.6 = 93 ms.

The input goes on `arrived`, or at `ms + 16` when no `arrived` came; a late, destroyed or crashed overlay never blocks
input (D57). The overlay sends `arrived` when the last sample is drawn; a glide of `ms` 0 replies as soon as the cursor is
placed. Ripple and caption play after `arrived`, off the critical path.

## Rules (one function, both hosts: `planGlide`)

1. Target point: the centre of `targetRect` for click, type and select. For key and scroll, the cursor's current
   position when it is inside `targetRect`, else the centre; no focus query is made (D56).
2. First action of a session, or the first after its cursor faded: `ms` 0; the cursor appears at the target with a
   120 ms fade-in, no glide (D55).
3. Target point within 4 px of the current position: `ms` 0, ripple only.
4. Distance over 50% of the host's diagonal (the pane, or the display): `ms` 0, snap. On a 1920x1080 host that is
   0.5 x 2203 = 1,101 px, so ordinary moves across a pane glide and still cost at most 220 ms (D54).
5. Reduced motion (`systemPreferences.getAnimationSettings().prefersReducedMotion` in main, sent as `reducedMotion`;
   the overlay also honours `prefers-reduced-motion`): `ms` 0, the cursor snaps and a 120 ms colour flash replaces the
   ripple.
6. Mode `instant`: always `ms` 0. Mode `human`: the formula times 2.5 with overshoot; it breaks the 250 ms budget on
   purpose (D69). Mode `off`: nothing is sent to an overlay; `cursor.glide` replies
   `{arrived: true, ms: 0, shown: false, late: false}` at once and browser input goes straight on.

## Hosts

- **Browser.** The pane's overlay view is attached on a glide and stays while any of its cursors is visible; it is
  removed once the last one has faded. Probe row (with `METATROOPER_WORKBENCH_PROBE`):
  `{kind: 'cursor', pane, session, target, at, ms, late, requested_at, arrived_at}`, `at` the drawn position from
  `cursor.arrived` (null when late), `requested_at` the main-process time the glide was sent. It precedes the `click`
  probe; `recheck` runs after the glide and before the mouse events.
- **Desktop.** One window per display, made on first use: `transparent`, `frame: false`, `focusable: false`,
  `skipTaskbar`, `hasShadow: false`, `show: false`, sandboxed, loading `overlay.html` with the same preload;
  `setIgnoreMouseEvents(true)`; `setContentProtection(!agent_cursor.show_in_recordings)`; shown with `showInactive()`
  only. `target_rect_px` is converted with `screen.screenToDipRect(null, r)` and the display picked with
  `screen.getDisplayMatching`; the window is sized to that display's `bounds`. While a cursor shows:
  `setAlwaysOnTop(true, 'floating')` and `moveTop()` every 100 ms, and the target refit from `grant.live` every 250 ms and
  on `display-metrics-changed`, `display-added` and `display-removed`. 1,500 ms after the last action:
  `setAlwaysOnTop(false)` and `hide()`.
- **Covered target.** `desktop.describe` returns `covered_by`, the title of the top-level window at the target's centre
  (`WindowFromPoint`) when it is not the target's own window, one it owns, a window of the granted window's process, or
  a workbench window (the overlay and frames are click-through, and are filtered by pid as well); `metatrooper-desktop`
  appends " behind <title>" (title cut to 40 characters) to the caption. `minimized` true makes it send a null
  `target_rect_px`.
- **Screenshots** (D52). Agent captures cannot contain an overlay (`Page.captureScreenshot` of the pane's own
  webContents; `PrintWindow` of the target window), so there is no screenshot wait and no `overlay_may_show` flag.
  Content protection keeps the desktop overlay out of whole-screen captures.

## Settings

`agent_cursor: {mode: 'snappy', show_caption: true, idle_fade_ms: 5000, show_in_recordings: false}`. `mode` accepts
`off`, `instant`, `snappy`, `human`; any other value is read as `snappy` and logged once.

## Colour

`sessionColour(id)` (`workbench/src/colour.ts`): a hue from a hash of the session id, so colours are stable across
restarts and usually differ (D49). The grant frame, both cursors, the tile's colour dot (beside the state dot, D48) and
the watch thumbnail dot use it.
