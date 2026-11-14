# M9-07: Report issue, proven live, and the daily triage loop

Part of Ouros, Milestone 9 (daily driver by 2026-11-16). Priority: Blocker. Effort: 0.5 d. Depends on: M9-06.
**Lands 2026-11-11. The loop runs every day from 2026-11-16.**

## Source of truth

- Commit `aaba260`: the sidebar row and palette entry open a prefilled issue on `Wasif-ZA/metatrooper-private`. Built, never clicked live.
- `workbench/src/main.ts`, `reportIssue` handler: `cleanReport`, `issueUrl`, `ISSUE_PREFIX`. The body carries version, commit, OS and time.
- His words, 2026-11-10: "if i do find issues it create github issue eairly".

## Goal

When something gets in his way he presses one thing, writes one line, and it is on GitHub with the facts needed to fix it. Every day those issues are sorted and the blockers are fixed by the next morning.

## Scope

| # | Change |
|---|---|
| 1 | Click Report issue once in the daily copy and fix whatever the click shows is wrong |
| 2 | The body names the screen he was on and the daily copy's commit (the handler already reads the commit from the app's own folder) |
| 3 | Tests for `cleanReport` and `issueUrl` |
| 4 | `ouros-daily/triage.sh`: lists open issues with `gh issue list --repo Wasif-ZA/metatrooper-private --state open --json number,title,body,createdAt` and prints them grouped for the triage session |

The loop, each day at 17:00 Sydney time:

1. A session runs `triage.sh` and sorts each new issue into one of three kinds.
   - **Blocker:** he had to open VS Code for something in his daily loop. Fixed first, promoted before 09:00 the next day.
   - **Annoyance:** it slowed him but he stayed. Batched into one round on Friday.
   - **Idea:** a new feature. Written as a parked row. Not built without his yes.
2. All of a day's fixes go on one fix branch. The engine that owns the area builds; the other engine tests; each test batch gets a mutation check.
3. `daily.sh promote` moves the daily copy only if the whole suite is green.
4. He gets one phone page: what was fixed and in which commit, what is batched, what is parked. He closes an issue after he has seen the fix on screen.

## Out of scope

- Agents filing, commenting on or closing issues. Filing is his click on GitHub's own Submit button; closing is his.
- Automatic screenshots or logs in the body.
- Labels and milestones on GitHub.

## Contract

- The handler opens a URL only if it starts with `ISSUE_PREFIX`. That check stays.
- The body never holds file text, terminal output, a prompt or a secret. It holds: version, commit, OS, time, the screen name, and what he types. He reads it on GitHub before he submits.
- Triage reads issues with `gh`. It writes nothing to GitHub.

## Acceptance checks

- [ ] M9-07a. On screen: press Report issue in the daily copy. His browser opens a new-issue page on `Wasif-ZA/metatrooper-private` with the body filled in.
- [ ] M9-07b. The commit in the body equals the commit `daily.sh status` prints.
- [ ] M9-07c. He submits one test issue. `triage.sh` lists it.
- [ ] M9-07d. A report whose fields hold a URL, a newline, or 10,000 characters still produces a URL that starts with `ISSUE_PREFIX` and stays under GitHub's length limit.
- [ ] M9-07e. Tests show no field outside the allowed list reaches the URL; a mutation run catches the removal of the prefix check.

## Engines

- Built by an Opus worker (`aaba260`). Tests: Codex. The live click and the submit: him.

## Rules that bind every child

- No issue is filed, edited or closed by an agent.
- Commit locally. No push, no trailers, no amend or rebase.
- No em dashes. One-line comments.
