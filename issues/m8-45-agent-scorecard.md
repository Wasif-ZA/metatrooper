# M8-45: Agent scorecard

Part of Ouros, Milestone 8. Core service, in the "builds on the IDE" group. Priority: Medium. Effort: not sized until M8-0. Depends on: M8-13, M8-F1, M8-24.
**Start on or after 2026-11-09.**

## Source of truth

- Scratch `~/.cache/claude-scratch/ouros-direction-2026-11-05/` (also `ouros/direction` in the wip repo): `core/CORE.html` row "Agent scorecard"; `core/decisions-brief.md` line 31; `research-ide/F/PAINS.md` A2 and "What makes people switch or pay".

## What it does

Which agent does best on your repo.
Whether one got worse.
It reads Ouros's own run records and sends nothing anywhere.

## Evidence

- Stack Overflow 2026: 3,305 of 8,637 people who switched tools did it for output quality. 3,305 / 8,637 = 38.3%. Cost was 1,268 / 8,637 = 14.7%.
- claude-code #42796, "unusable for complex engineering tasks": 2,072 thumbs-up, 583 comments.
- PAINS.md A2 says no tool tells you your agent got worse this week. That overstates it. Small tools exist: RepoBench, RepoGauge, CodeJoust, agent-bench, cc-canary, trackbaseline.com, nerfed.watch. None was read in detail.
- Nothing is unique here. This is state "Idea".

## Blocked on

- Whether to build this, or plug in one of those tools, after the read in row 1. His call.

## What gets built

Not sized until M8-0.

| # | Change | Reuses |
|---|---|---|
| 1 | Read those tools first. Write down what each measures and its licence, here | `/gh-repo-research` |
| 2 | Table per engine and repo: checks passed, repair tries, undos, cost per task | M8-F1 results, M8-F3, M8-F2, M8-24; M7-23 prices |
| 3 | "Got worse" flag, comparing recent runs to earlier ones on one repo | Same records |

## Acceptance criteria

- [ ] M8-45a. The read of each named tool is recorded in this file.
- [ ] M8-45b. A fixture of run records produces the expected table.
- [ ] M8-45c. A fixture where one engine's pass rate falls raises the flag on that engine only.
- [ ] M8-45d. Below a run count fixed at build and written here, the page says "not enough runs" and ranks nothing.
- [ ] M8-45e. Each row shows its run count, so tasks that differ are not read as a fair test.
- [ ] M8-45f. The page makes no network call.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
