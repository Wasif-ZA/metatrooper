# Terminal core (live stub)

Child #33. The layout-A design text is archived at [issues/archive/33-terminal-core.md](archive/33-terminal-core.md); its epic is
[issues/archive/ui-revision-epic.md](archive/ui-revision-epic.md). Built and checked 2026-10-02 to 2026-10-03;
evidence per criterion is in UI-STATUS.md (UI-03, UI-05, UI-07, UI-10, UI-11).

This issue still owns the code underneath the new wall: core/src/terminal/ (the only node-pty import, headless scrollback), the terminal pipe `\\.\pipe\metatrooper-term`, launch through the pty, the prompt typed on first idle, the schema v2 migration, and `workbench/renderer/terminal.js`. Every wall tile in the port reuses `terminal.js`.

The screen around it is now [issues/ui-port-epic.md](ui-port-epic.md). A change to the code above is made here; a
change to where it shows on screen is made in the port epic.
