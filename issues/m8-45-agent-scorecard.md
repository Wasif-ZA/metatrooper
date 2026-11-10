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
- [ ] M8-45d. Below a run count fixed at build and written here, the Settings table (Settings > Activity > Agent scorecard) says "not enough runs" and ranks nothing.
- [ ] M8-45e. Each row shows its run count, so tasks that differ are not read as a fair test.
- [ ] M8-45f. The Settings table makes no network call.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.

## Read of the named tools (M8-45a, 2026-11-08)

Read from GitHub metadata, READMEs and home pages only. No tool was installed or run.

| Tool | Where | Measures | Data from | Licence | Stars | Last push |
|---|---|---|---|---|---|---|
| RepoBench | github.com/felipcsousa/repobench | Which agent CLI fixes your repo's tasks, scored by hidden verifiers | Local runs on tasks built from your merged PRs | Apache-2.0 | 3 | 2026-09-11 |
| RepoGauge | github.com/s1liconcow/repogauge | Agent accuracy on your repo, SWE-bench style | Local runs on tasks from repo history | Other | 3 | 2026-04-26 |
| CodeJoust | github.com/he-yufeng/CodeJoust | Agents on the same bug: tests, diff, cost, time | Local runs on a bug you give it | MIT | 8 | 2026-08-27 |
| agent-bench | Not found. The closest hit is THUDM/AgentBench, a general LLM-as-agent benchmark, which is probably not the tool meant | General agent ability | Its own tasks | not checked | 3817 | 2026-02-08 |
| cc-canary | Not found (only test fixtures came up) | | | | | |
| trackbaseline.com | Site only, no repo | Drift in coding agents across 14 probes against a baseline | Local SQLite; cloud sync on paid plans | Not stated | | |
| nerfed.watch | Site only, no repo | Quality regressions in Claude Code and Codex | Its own fixed task packs; no scores published yet | Not stated | | |

None passes the dependency gate (MIT, 25k+ stars). None was found to read another tool's run records. Each one runs its own tasks.

## Built values (M8-45d)

- `MIN_RUNS = 5`: an engine with fewer runs on a repo is not ranked, and a repo where no engine has 5 runs says "not enough runs".
- Got-worse flag: the last 5 runs compared with the earlier ones (at least 5), raised on a pass-rate drop of 0.2 or more.
- Code: `core/src/scorecard.ts` (pure, no imports). It takes records shaped `{engine, repo, at, checksPassed, repairTries, undone, usd}`. No such records exist yet: M8-F1, M8-F2 and M8-F3 have not been built, so nothing writes them.
