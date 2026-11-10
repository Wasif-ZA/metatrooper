# M9-09: Lent sign-in: fix findings 1 to 3, only where Codex agrees

Part of Ouros, Milestone 9 (daily driver by 2026-11-16). Priority: Medium. Effort: 1 d. Depends on: Codex being back (after 2026-11-10T18:02+11:00).
**Review 2026-11-10 evening. Fixes 2026-11-12. Does not block Monday.**

## Source of truth

- Scratch `~/.cache/claude-scratch/ouros-build-2026-11-10/reviews/gemini-second-review.md`: findings 1, 2, 3 and the Claude-only finding C1, each with file and line.
- His call, 2026-11-10: fix 1 to 3, after Codex has checked them.
- `SPEC.md` S4b, option A (how lending works).

## Goal

From Monday he signs in to real sites in Ouros panes every day. The three findings are about what an agent can reach through a lent pane. Each is fixed only if a second engine confirms it is real.

## Scope

| Finding | In one line | If Codex confirms |
|---|---|---|
| 1 | A lent page can send fetch, XHR, image and WebSocket requests to sites that were not lent, with his cookies | Hold every request type in a lent pane to the lent sites |
| 2 | A key listener an agent added with evaluate survives a hand-over, so it could read what he types | Reload a scripted page on hand-over, before he gets the pane |
| 3 | Removing a lend closes the pane up to 1 s later | Close the lent pane in the same call that removes the lend |

Steps: Codex reads the full files (not excerpts) and gives a verdict on 1, 2, 3 and C1. Findings both engines hold are fixed. A finding only one holds is reported to him with both readings; nothing is picked quietly.

## Out of scope

- Findings 4 to 8. Low, recorded in the review.
- C1 (`pane.assign` hands an agent his own pane with the whole kept profile). It is a design call, already listed as his open call in `RESUME.md`. Codex gives a verdict; no code changes without his answer.
- Anything that hides Ouros from a site's bot checks (permanently out, SPEC S4).

## Contract

- A lent pane may load, in any request type, only origins he lent for that project.
- After a hand-over, no script an agent injected is still running in the page he types into.
- The fix for finding 1 must not break a lent site's own same-origin requests.

## Acceptance checks

- [ ] M9-09a. Codex's verdicts on 1, 2, 3 and C1 are written beside Gemini's in the review file: both found, only one found, disagree.
- [ ] M9-09b. For each fixed finding, a test fails on the old code and passes on the new.
- [ ] M9-09c. Finding 1, if fixed: a lent fixture page that fetches a second origin gets no response and sends no cookie.
- [ ] M9-09d. Finding 2, if fixed: a listener added before hand-over receives no key typed after it.
- [ ] M9-09e. On screen: a lent site he uses still signs in and loads its own images and scripts.
- [ ] M9-09f. A mutation run catches every mutant in the changed lines.

## Engines

- Review: Codex. Fix: Opus worker (security code). Tests: Codex. Re-read of the diff: Gemini.

## Rules that bind every child

- Presenting a finding is not permission to fix it. Only 1 to 3, and only where both engines agree.
- Commit locally on `ouros/build-1110`. No push, no trailers, no amend or rebase.
- No em dashes. One-line comments.
