# UI revision status ledger

Branch ui-revision, from m2 at b256909 (D20). Started 2026-10-02T20:28+10:00. Epic: issues/ui-revision-epic.md,
children issues/33 to 38. Status values as in M1-STATUS.md, plus NEEDS-WASIF for a render pick. Nothing filed on
GitHub; filing and pushing are Wasif's.

| Criterion | Status | Evidence / notes |
|---|---|---|
| UI-01 workday in the app | TODO | needs #34 to #36 and a real day of use |
| UI-02 first agent in 30 s | TODO | needs installer and a fresh Windows account |
| UI-03 survives the window | TODO | #33 core half, #34 window half |
| UI-04 fewer clicks | TODO | today's counts go in "Click counts" before any #34 code |
| UI-05 no wt or herdr left | TODO | #33 clean cut |
| UI-06 core kill to Resume | TODO | #35 |
| UI-07 prompt typed once | TODO | #33 |
| UI-08 spec-to-pr step list | TODO | #37 |
| UI-09 four result panes | TODO | #38 |
| UI-10 speed | TODO | #33 and #34 |
| UI-11 tests on the terminal module | TODO | #33; Codex writes the #33 tests |

| Child | Status | Notes |
|---|---|---|
| #33 terminal core | IN PROGRESS | Task 0 passed |
| #34 layout | NEEDS-WASIF | render round 1 |
| #35 status | TODO | after 33, 34 |
| #36 tools | TODO | after 33, 34 |
| #37 step list | TODO | after 34 |
| #38 panes | TODO | after 37 |

## Click counts (today, before #34)

Not counted yet.

## Decisions

- 2026-10-02: dependencies for #33 are node-pty 1.1.0, @xterm/headless and @xterm/addon-serialize. All MIT. Under
  the 25k star gate; accepted by D7 (xterm.js 21,240 stars, node-pty 2,040 stars, nothing better passes). The two
  @xterm packages are the xterm.js monorepo. They go in core only, never in the workbench package.
- 2026-10-02: `pwsh` (PowerShell 7) is not installed on this laptop. Shell tabs fall back to `powershell.exe` (5.1)
  when `pwsh` is missing.

## Log

- 2026-10-02T20:35+10:00: Task 0 of #33 PASSED on the first path (prebuilt binary). node-pty 1.1.0 ships
  win32-x64 prebuilds; it loaded under Node 24.18.0 even with npm's allow-scripts blocking its install script.
  Proof script (scratch, not in repo): spawn `powershell.exe` through ConPTY, `echo hello-$(1+1)` echoed
  `hello-2`, resize to 120x40 read back as 120, `exit 7` gave exit code 7, @xterm/headless serialize() held the
  output. 1.4 s end to end.
