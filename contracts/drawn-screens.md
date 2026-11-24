# Drawn screens in cc (M8-0, D84)

How an agent-drawn screen reaches a tab in cc, how a click on it gets back to the agent, and how the IDE | WALL
switch is drawn. The host is cc's own Electron window (D84). Method shapes are in `contracts/pipe-protocol.md`.

## How a tab opens

1. The agent calls the `ouros_ui` MCP tool (server `ouros-ui`), which calls core `ui.show` with the session id,
   a surface id and the spec. Core checks each part against the catalogue and stores the surface in `ui_surface`
   with its owning session. A part that fails the check is drawn as plain text and listed in `fellBack`.
2. The snapshot lists the surface with its `seq`.
3. In the IDE view, `syncDrawn` (`workbench/ui/src/kit/DrawnTabs.jsx`, called from `ideView.draw` in
   `workbench/ui/src/main.jsx`) sees a new surface or a changed `seq`. It calls `ui.get`, then opens or refreshes
   one tab for the surface in the tab layer over the editor area. A tab the person closed stays closed until the
   agent draws that surface again.

## How events reach the core

A click on a drawn part calls `ui.event` with `{surface, seq, event, context}` (`DrawnTabs.jsx`). Core types one
`[ouros-ui] ...` line into the terminal of the session that drew the screen. If `seq` is stale, or that event was
already sent for that seq, the line is dropped. If the session has exited, the line becomes a needs-you item
(`ui.event` row in `contracts/pipe-protocol.md`).

## How the IDE | WALL switch is drawn

The title bar holds one segmented group, `nav.vseg` in `workbench/renderer/index.html`, with Home, IDE, Wall and
Needs you buttons (`data-action="view"`). A press runs `homeView.set(view)` (`workbench/renderer/app.js`, case
`'view'`). The redraw then sets `aria-pressed` on the button that matches `ui.view`, with Wall as the default
(`workbench/ui/src/main.jsx`). Drawn tabs sync only in the IDE view (`syncDrawn` returns early otherwise).
