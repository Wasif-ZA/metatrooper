# M9-04: Source control view: changes, diff, stage, commit

Part of Ouros, Milestone 9 (daily driver by 2026-11-16). Priority: Blocker. Effort: 1.5 d. Depends on: M9-02.
**Back end 2026-11-10 (running). Screen 2026-11-12.**

## Source of truth

- Scratch `~/.cache/claude-scratch/ouros-build-2026-11-10/build-brief-backend.md`, item 3 (the five git calls).
- `build-brief-ide.md` Part A for the classes, tokens and the diff list this view reuses.
- `research/vscode-gap.md` row 6.

## Goal

He sees what changed in the project, reads each diff, stages files and commits, without leaving Ouros.
Today Ouros shows only the diff of one agent's session.

## Scope

The back end is in the brief. The screen has no brief, so it is decided here.

**Placement.** A third view in the IDE explorer: Files | Search | **Changes**. Ctrl+Shift+G shows it. The segment label carries the count of changed files.

**Layout, top to bottom, inside the 240 px explorer:**

| Region | Size | Content |
|---|---|---|
| Message | 3 text rows | Plain square textarea, placeholder "Commit message". Ctrl+Enter commits |
| Commit row | 28 px | `Button` "Commit" (enabled only with a message and at least one staged file), refresh `IconButton` |
| Staged | rows 24 px | Heading "Staged" with count. Row: status letter, file name, folder muted, a minus `IconButton` (unstage) |
| Changes | rows 24 px | Heading "Changes" with count. Row: status letter, file name, folder muted, a plus `IconButton` (stage). A plus on the heading stages all listed paths by name |

- Status letters: M, A, D, R, U (untracked), in `var(--mute)`. No colour per letter.
- Clicking a row opens the file in a tab in Changes mode. The diff comes from `gitDiff(projectId, rel, staged)` and draws with the same diff list as M9-02.
- A deleted file shows the diff only, with no File mode.
- The list reloads when the view is shown, after a save, after stage, unstage and commit, and on the refresh button.
- After a commit the message clears and a toast shows the short hash.
- Not a git repo: muted "This folder is not a git repository."

## Out of scope

- Push, pull, fetch, branch switch, stash. He does these in the shell pane (M9-03).
- Discard changes. It destroys work, so it waits for its own design.
- Blame, history, GitLens-style annotations.
- Amend. Never offered.

## Contract

- `gitStatus(projectId)`, `gitDiff(projectId, rel, staged)`, `gitStage(projectId, rels)`, `gitUnstage(projectId, rels)`, `gitCommit(projectId, message)` as in `workbench/src/preload.cjs`.
- Git runs with an argument array in the project root. The message goes in on stdin.
- Never `--amend`, never push, never `-A`, never `--no-verify`. Stage only named paths.
- Screen files: `workbench/ui/src/ide.jsx`, `ui.css`, `main.jsx` only. astryx components, `ou-ide-` classes, no new dependency.
- A commit is always his click. No agent tool reaches `gitCommit`.

## Acceptance checks

- [ ] M9-04a. On screen: edit and save a file. Changes lists it with M. Click it: the diff shows his edit.
- [ ] M9-04b. Press plus: the row moves to Staged. Press minus: it moves back.
- [ ] M9-04c. Type a message, press Commit. `git log -1` in the shell pane shows that message and only the staged files.
- [ ] M9-04d. A hook that fails the commit shows its error in a toast; the message and the staged list stay.
- [ ] M9-04e. A file name with a space, and one that starts with `-`, stage and commit correctly.
- [ ] M9-04f. Back-end tests assert the exact git arguments and that the four banned flags never appear; a mutation run catches every mutant.
- [ ] M9-04g. Screen tests cover the enabled state of Commit, the reload points and the empty states.

## Engines

- Back end: Opus builds, Codex tests.
- Screen: Codex builds from this file, Gemini tests. If Codex is at its limit: an Opus worker builds the screen and Gemini still tests.

## Rules that bind every child

- Commit locally on `ouros/build-1110`. No push, no trailers, no amend or rebase.
- The builder never writes its own tests. Every test batch gets a mutation check.
- No new dependency. No em dashes. One-line comments.
