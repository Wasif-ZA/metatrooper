# Result panes (live stub)

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Child result-panes. The layout-A design text is archived at [issues/archive/result-panes.md](archive/result-panes.md); its epic is
[issues/archive/ui-revision-epic.md](archive/ui-revision-epic.md). Built and checked 2026-10-02 to 2026-10-03;
evidence per criterion is in UI-STATUS.md (UI-09).

This issue still owns the code underneath the new wall: the four panes (Item review set, Document, Row table, Findings list), `run.item-set`, the Diff toggle (Last turn, Uncommitted, Whole branch) and their fixtures. In the port a step's `view` pane renders inside the active layout's output slot instead of a side-split tab.

The screen around it is now [issues/ui-port-epic.md](ui-port-epic.md). A change to the code above is made here; a
change to where it shows on screen is made in the port epic.
