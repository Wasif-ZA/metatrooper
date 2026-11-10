# M9-05: New file, open a PDF or image outside, Open in VS Code

Part of Ouros, Milestone 9 (daily driver by 2026-11-16). Priority: High. Effort: 1 d. Depends on: M9-01, M9-02.
**Lands 2026-11-13.**

## Source of truth

- Scratch `~/.cache/claude-scratch/ouros-build-2026-11-10/build-brief-backend.md`, items 1 (`fsCreate`) and 5 (`openInVsCode`).
- `research/vscode-gap.md` rows 8, 9, 11 and 12.
- Fact checked 2026-11-10: a pane lets through http, https, ws, wss, `data:`, `blob:` and `about:blank`, and cancels the rest, `file://` included (`workbench/src/browser/panes.ts`, `guardPartition`). So a pane cannot show a `file://` PDF today. The gap table's row 8 suggestion does not hold.

## Goal

Three small exits so he never gets stuck in the IDE: make a new file, look at a PDF or image, and jump to VS Code for the work that stays there.

## Scope

| # | Change | Where |
|---|---|---|
| 1 | Palette command "New file": asks for a path inside the project, creates it with `fsCreate`, opens it in a tab | `ui/src/ide.jsx` |
| 2 | New IPC `fsOpenOutside(projectId, rel)`: opens the file in the Windows default app | `workbench/src/files.ts`, `main.ts`, `preload.cjs` |
| 3 | A file the editor cannot show (binary, over 512 KiB) gets two buttons in its empty state: "Open outside" and "Open in VS Code" | `ui/src/ide.jsx` |
| 4 | "Open in VS Code" in the breadcrumb row and the IDE palette, for the active file or the project | `ui/src/ide.jsx` |
| 5 | Each use of "Open in VS Code" writes one log line: time, project id, file extension | `main.ts` |

Row 5 is the measure for the week after: the extensions he still leaves for show what to build next.

## Out of scope

- A PDF or image viewer inside Ouros. Drawback: a PDF opens in another window.
- Rename and delete in the tree. He uses `git mv` and `rm` in the shell pane.
- LaTeX, Java, PlatformIO, the Python debugger. They stay in VS Code.

## Contract

- `fsOpenOutside` uses the same `inside(root, rel)` guard as `fsRead`, then `shell.openPath`.
- It opens only these extensions: pdf, png, jpg, jpeg, gif, webp, svg, html, htm. Anything else returns `{ error }`. Without this list it would run an `.exe`, `.bat` or `.lnk` from a project folder.
- `openInVsCode(projectId, rel)` spawns `code` with an argument array, no shell. If `code` is not on PATH it returns `{ error }` and the screen shows it in a toast.
- "New file" refuses a path that exists, that leaves the project, or that has a `.git` segment (the `fsCreate` guards).

## Acceptance checks

- [ ] M9-05a. On screen: Ctrl+Shift+P, "New file", type `notes/todo.md`, Enter. The file exists on disk and is open in a tab.
- [ ] M9-05b. Click a PDF in the tree, press "Open outside". It opens in his PDF app.
- [ ] M9-05c. Click a `.tex` file, press "Open in VS Code". VS Code opens that project with that file.
- [ ] M9-05d. `fsOpenOutside` on a `.bat`, a `.lnk`, a path with `..` and a junction that leaves the project: all refused, each with a test.
- [ ] M9-05e. The log holds one line per "Open in VS Code" use, with the extension and no file text.
- [ ] M9-05f. A mutation run catches the removal of the extension list and of the path guard.

## Engines

- IPC (rows 2 and 5): Opus builds, Codex tests.
- Screen (rows 1, 3, 4): Codex builds, Gemini tests. If Codex is at its limit: Opus builds, Gemini tests.

## Rules that bind every child

- Commit locally on `ouros/build-1110`. No push, no trailers, no amend or rebase.
- The builder never writes its own tests. Every test batch gets a mutation check.
- No new dependency. No em dashes. One-line comments.
