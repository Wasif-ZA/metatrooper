# M9-01: File save, search in files, and the close guard (main process)

Part of Ouros, Milestone 9 (daily driver by 2026-11-16). Priority: Blocker. Effort: 1 d. Depends on: none.
**Build 2026-11-10 (running). Tests 2026-11-11.**

## Source of truth

- Scratch `~/.cache/claude-scratch/ouros-build-2026-11-10/build-brief-ide.md`, "Part B" and the contract table at the top. That brief is the spec; this file does not repeat it.
- `build-brief-backend.md` item 1 (adds `fsCreate`, `fsRename`).
- `research/vscode-gap.md` rows 4 and 5.
- `RESUME.md`, "Review findings left open": the check-then-read gap in `workbench/src/files.ts`.

## Goal

He edits a file in Ouros and it saves to disk safely. He searches the text of every file in the project.
Without these two calls the IDE stays a viewer and VS Code stays open.

## Scope

| # | Change | Where |
|---|---|---|
| 1 | `fsWrite` with the six refusals and the conflict answer | `workbench/src/files.ts`, `main.ts`, `preload.cjs` |
| 2 | `fsRead` returns `{ text, mtimeMs }` and reads through one open descriptor (closes the old gap) | `files.ts` |
| 3 | `fsSearch` (fixed string, 200 hits, `more`) | `files.ts`, `main.ts`, `preload.cjs` |
| 4 | `fsCreate`, `fsRename`, same guards as `fsWrite` | same |
| 5 | Close question when a file is unsaved (`will-prevent-unload`) | `main.ts` |

## Out of scope

- Delete from the IDE. It waits for a trash-based design.
- Regex search, replace in files, search options.
- Files over 512 KiB. They open in VS Code (M9-05).

## Contract

As exposed in `workbench/src/preload.cjs` today (working tree, not yet committed):

- `fsRead(projectId, rel)` returns `{ text, mtimeMs }` or `{ error }`.
- `fsWrite(projectId, rel, text, baseMtimeMs)` returns `{ ok: true, mtimeMs }`, `{ error }`, or `{ error, conflict: true }`.
- `fsSearch(projectId, query)` returns `{ hits: [{ path, line, text }], more }`.
- `fsCreate(projectId, rel, kind)` and `fsRename(projectId, from, to)`.
- The project root always comes from the main process. The renderer never sends a root or an absolute path.
- Every refusal is `{ error }`. Nothing throws across IPC. Each write is logged.

## Acceptance checks

- [ ] M9-01a. On screen: change a line in a tracked file, press Ctrl+S, run `git diff` in a shell pane. The diff shows that one line and nothing else.
- [ ] M9-01b. A CRLF file saves as CRLF and an LF file as LF, byte for byte outside the edit.
- [ ] M9-01c. Edit the same file in another program, then save in Ouros: the conflict question appears and nothing is overwritten until he chooses.
- [ ] M9-01d. Each refusal has a test: not a string, NUL, over 512 KiB, a `.git` segment, `..`, an absolute path, a junction that points outside the root, a link swapped in between check and write.
- [ ] M9-01e. `fsSearch` with a query that starts with `-` is treated as text, not as a git option.
- [ ] M9-01f. Closing the window with an unsaved file asks first. Cancel keeps the window and the edit.
- [ ] M9-01g. Codex's tests pass, and a mutation run catches every mutant in `files.ts` (list kept in scratch).

## Engines

- Build: Opus worker (security-sensitive). Tests: Codex. If Codex is at its limit: Gemini writes the tests from the same brief.

## Rules that bind every child

- Commit locally on `ouros/build-1110`. No push, no trailers, no amend or rebase.
- The builder never writes its own tests. Every test batch gets a mutation check.
- No new dependency. No em dashes. Comments are one line and say what the code does.
