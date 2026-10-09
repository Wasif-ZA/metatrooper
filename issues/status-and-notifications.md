# Status and notifications (live stub)

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Child status-and-notifications. The layout-A design text is archived at [issues/archive/status-and-notifications.md](archive/status-and-notifications.md); its epic is
[issues/archive/ui-revision-epic.md](archive/ui-revision-epic.md). Built and checked 2026-10-02 to 2026-10-03;
evidence per criterion is in UI-STATUS.md (UI-06).

This issue still owns the code underneath the new wall: done-unseen, the `term.bell` and `term.title` signal, toasts that jump to the session, the notification inbox with mark-read and mark-unread, Clear status, and Resume or Start new here for dead sessions. The wall shows this state on its tiles, the NEEDS YOU stamp and the "need you" chip.

The screen around it is now [issues/ui-port-epic.md](ui-port-epic.md). A change to the code above is made here; a
change to where it shows on screen is made in the port epic.
