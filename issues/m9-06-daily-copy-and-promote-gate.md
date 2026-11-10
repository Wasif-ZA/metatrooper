# M9-06: The daily copy: a second worktree that only moves on a green suite

Part of Ouros, Milestone 9 (daily driver by 2026-11-16). Priority: Blocker. Effort: 1 d. Depends on: M9-08 part 1 (suite green).
**Lands 2026-11-11.**

## Source of truth

- Scratch `~/.cache/claude-scratch/ouros-build-2026-11-10/RESUME.md`: "Demo instance" (the isolation that already works), the junction warning, and the 16:25 goal change ("Daily copy").
- `meta/scripts/demo-env.sh` in the vault (how the demo sets its home and pipe prefix).
- `research/vscode-gap.md` row 2 (switching folders). Read in code 2026-11-10, not yet seen live: the folder picker exists (`workbench/src/main.ts`, `dialog.showOpenDialog` then `project.open`) and the project menu lists every opened project (`app.js`, `project-go`, `project-hide`). So row 2 needs no build; check M9-06c proves it in the daily copy.

## Goal

He works in a copy of Ouros that never breaks under him. The build tree keeps changing; the daily copy moves only to a commit that passed every test. It never touches his real MetaTrooper.

## Scope

One folder, `~/.cache/claude-scratch/ouros-daily/`, and one script in it, `daily.sh`.

| Part | Decision |
|---|---|
| Code | `ouros-daily/app`: a git worktree of the metatrooper repo, on a **detached HEAD** at the last green commit. No branch, so nothing is ever reset or rebased |
| State | `METATROOPER_HOME=ouros-daily/home`. Its own settings, database, logs and kept browser profile |
| Pipe | `METATROOPER_PIPE_PREFIX=ourosdaily`. Not the demo's `ourosdemo`, not his real one |
| Modules | Junctions to the same `node_modules` the build tree uses. Known ceiling: a change there reaches the daily copy. Move to a real install the first time that bites |
| Flags | No `--demo` (that mode hides text for screenshots). No debugging port |

`daily.sh` verbs:

| Verb | What it does |
|---|---|
| `promote` | 1. Refuses if the build tree has uncommitted tracked changes. 2. Rebuilds `ui.bundle.js` and refuses if the committed bundle differs. 3. Runs the whole core suite, then the whole workbench suite, serial. 4. Any failure: prints the failing tests, changes nothing. 5. All green: stops the daily copy, checks out the new commit detached, starts it, appends time, commit and test counts to `promoted.log` |
| `start` | Starts the daily copy detached from the calling terminal |
| `stop` | Closes it with `taskkill /PID` (no `/F`), which also stops its core |
| `status` | Prints the commit it runs, when that was promoted, the test counts, and whether it is running |
| `rollback` | Checks out the previous commit in `promoted.log`, detached, and restarts |

A desktop shortcut runs `daily.sh start`.

## Out of scope

- An installer (M8-44). Auto-update. A tray icon.
- Moving his real `~/.metatrooper` data into the daily copy. He opens his folders once (go-live checklist).
- Any push. The daily copy is local.

## Contract

- `promote` is the only way the daily copy changes commit. No agent edits files in `ouros-daily/app`.
- A red suite never promotes. There is no skip flag.
- Before removing `ouros-daily/app`, remove its junctions first (`cmd //c rmdir <path>`), or the delete follows them into the main checkout.
- The script never reads or writes `~/.metatrooper`. In `projects/metatrooper` it never changes a working file or a branch; it only adds the worktree and reads `node_modules` through the junctions.
- `promote` runs only after the workers have committed. A dirty build tree is refused, so it is run at a handoff point, not mid-build.

## Acceptance checks

- [ ] M9-06a. On screen: with his real MetaTrooper running, double-click the shortcut. Ouros opens. His real one still lists its own sessions, unchanged.
- [ ] M9-06b. `daily.sh status` prints a commit, a promote time with `+11:00`, and "0 fail".
- [ ] M9-06c. Open a folder with the picker (`project.open`). Close and reopen the daily copy: the folder is still listed.
- [ ] M9-06d. Break one test on purpose in the build tree, commit, run `promote`: it prints the failure and `status` still shows the old commit. Revert the commit with a new commit.
- [ ] M9-06e. `rollback` returns to the previous commit and the app starts.
- [ ] M9-06f. Closing the calling terminal does not close the daily copy.
- [ ] M9-06g. `stop` leaves no Electron, core or fixture process from the daily copy.

## Engines

- Build: Opus worker (it handles worktrees and his real instance's isolation). Check: Codex reviews the script and runs M9-06d; a Sonnet helper does the live checks a, c, f, g.

## Rules that bind every child

- Never touch `projects/metatrooper` (unclaimed uncommitted edits there) or his real home.
- No push, no reset, no rebase, no force.
- No em dashes. One-line comments.
