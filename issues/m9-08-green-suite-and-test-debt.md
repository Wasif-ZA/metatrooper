# M9-08: A green whole suite, then the test debt

Part of Ouros, Milestone 9 (daily driver by 2026-11-16). Priority: Blocker (part 1), Medium (part 2). Effort: 1 d. Depends on: none.
**Part 1 lands 2026-11-11. Part 2 lands 2026-11-13.**

## Source of truth

- Scratch `~/.cache/claude-scratch/ouros-build-2026-11-10/research/test-retire-plan.md`: the six GAP tests (G1 to G6) and what makes deleting the old files safe.
- `RESUME.md`: "Owed: one clean whole-suite run on a quiet machine"; commit `9ad405c` left two old Ctrl+B tests red; `tests-brief-8.md` moves them.
- Working tree today: `workbench/test/m9-frame.test.ts` (new, untracked), edits in `wall.test.ts` and `m6-26-wall-repairs.test.ts`.

## Goal

The daily copy only moves on a green suite (M9-06). So the suite has to be green, and it has to mean something.

## Scope

**Part 1, blocks Monday:**

| # | Change |
|---|---|
| 1 | The two red Ctrl+B tests moved to the sidebar frame (in progress, Gemini, `tests-brief-8.md`), with their mutation run |
| 2 | G2 written first: the check-command field after a project switch. The plan names a likely real bug (`settings.jsx` seeds its state once). If the test fails, the fix is part of this issue |
| 3 | One whole-suite run, core then workbench, serial, with no demo, no daily copy and no engine running. The counts go in `RESUME.md` |

**Part 2, does not block Monday:**

| # | Change |
|---|---|
| 4 | G1, G3, G4, G5, G6 added to `m8-ax-screens.test.ts` |
| 5 | The COVERED and DROP cases removed from the five old test files; `inbox.js` and `settings.js` dropped from the four boot lists |
| 6 | `renderer/settings.js`, `inbox.js`, `addons.js` deleted. `renderer/ide.js` and `ide.css` go with M9-02 |

## Out of scope

- The 34 skipped real-Electron tests (SPEC S1). They stay skipped this week.
- Running the suite in parallel.

## Contract

- A test that spawns a nested `node --test` must fail when the child fails (the trap in `RESUME.md`). Every batch is mutation-checked for this reason.
- An OUT OF SCOPE case in the plan (main process IPC, preload, `home.js` blur) is never deleted.
- G6 runs the real `app.js` `isInfo` and `needsCount`, not the stub.

## Acceptance checks

- [ ] M9-08a. Core: 0 fail. Workbench: 0 fail. Both serial, machine quiet, counts written down with the commit.
- [ ] M9-08b. G2 passes: switch project and the field shows that project's command; no project disables it.
- [ ] M9-08c. Each of G1 to G6 fails when the behaviour it names is broken on purpose.
- [ ] M9-08d. After the deletes, no file in the repo names `settings.js`, `inbox.js` or `addons.js` in the renderer folder, apart from the test that asserts they are not loaded.
- [ ] M9-08e. `daily.sh promote` (M9-06) goes green on this commit.

## Engines

- Ctrl+B tests: Gemini (already running). G1 to G6 and the removals: Codex. If Codex is at its limit: Gemini, with Codex running the mutation check when it is back.

## Rules that bind every child

- Commit locally on `ouros/build-1110`. No push, no trailers, no amend or rebase.
- A test writer changes tests only, unless a test proves a bug; then the fix is named in the commit.
- No em dashes.
