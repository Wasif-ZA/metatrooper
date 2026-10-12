# M6-19 Search all terminals: report

Branch `m6-19-search`. The work is commit 1bdd51a (9 files). Diff it with `git diff main...HEAD`. The two-dot form also shows the 116 commits main has gained since the fork, so it looks much larger than the real change.

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| M6-19a. A unique marker printed in one of 4 tiles is found by Ctrl+K within 1 s and opens that tile at the line. | Met | Electron E2E `workbench/test/wall.test.ts` "M6-19a ...". It launches 4 sessions and prints the marker in one of them, between 300 filler lines before and 300 after. It then presses Ctrl+K, types the marker in lower case, and asserts a `Scrollback` hit appears in under 1000 ms (timed in the renderer from the input event). It asserts the palette holds exactly `[['Scrollback', marker]]`. Pressing Enter must make that tile big, and its visible rows must show the marker but not the last line, `filler-b-299` (so the tile scrolled to the marker line). Core test `core/test/m6-19-search.test.ts` covers 4 terminals with a case-insensitive hit in under 1 s, the 50-hit cap with newest first, and that `session.search` is never queued. |

Spec section 403 details are all covered:
- plain text, case insensitive
- at most 50 hits, newest first
- every live session's headless scrollback
- a hit opens the tile at the line
- hits stay in their own group (spec line 1122)

## What is implemented

- Core `term.search()` in `core/src/terminal/index.ts`. It reads every live terminal's headless buffer, joins wrapped rows, and puts the most recently active terminal first. Each hit's text is capped at 300 characters.
- RPC `session.search` (`needsUi`, not queued, never written to the DB). It is documented in `contracts/pipe-protocol.md` and allow-listed in `workbench/src/main.ts`.
- Palette: a `Scrollback` group goes after the other items, with a 100 ms debounced query. Picking a hit selects the tile and calls `termView.reveal()`, which scrolls to the matching line nearest the core's row.

## Tests

- `cd core && node --test test/m6-19-search.test.ts`: 3 pass, 0 fail.
- `cd core && npm test`: exit 0, 270 tests, 266 pass, 0 fail, 4 skipped.
- `cd workbench && METATROOPER_UI_REVISION_E2E=1 node --test --test-concurrency=1 test/wall.test.ts`: exit 0, 6 pass, 0 fail (M6-19a took 8.5 s end to end, most of it launching sessions). Without that env var, the Electron tests skip.
- `Error: AttachConsole failed` lines in the core output come from node-pty/conpty stderr on Windows when a pty is killed. They are not test failures.
- Final diff checked for em dashes: none.

This session added no code. The existing commit already met the criterion, and both test layers pass.

## Left for Wasif

1. **Main has moved on and conflicts.** `git merge-tree HEAD main` shows one conflict, in `core/src/terminal/index.ts`. On main, the `Term` interface and `open()` gained an `attaching` field and an `exitCodes` map. This branch adds an `at` field in the same places. Resolving it means keeping both. Everything else auto-merges (`app.js`, `terminal.js`, `main.ts`, `methods.ts`, `commands.ts`, `pipe-protocol.md`). I tried `git merge main` into this branch, but the session's permission guard blocked it, so the tests above ran on the old base. After merging, rerun the three commands above.
2. Commit 1bdd51a carries `Co-Authored-By` / `Claude-Session` trailers, which the task asked to avoid. Amending is not allowed, so it stays as is.
3. The issue file says "never commit from an agent", but the task said to commit. Only this report is new, and it is committed with a plain message.
4. The M6-19a checkbox is left unticked in `issues/m6-19-search-all-terminals.md` and `spec.md`. In this repo, only archived issues show ticks.
5. D65 does not list M6-19 for Codex tests, so the tests here were written in-branch and no mutation run was required.
