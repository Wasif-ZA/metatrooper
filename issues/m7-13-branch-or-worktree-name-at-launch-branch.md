# M7-13: Branch or worktree name at launch; branch and port on list rows

Part of the MetaTrooper desk epic (becoming Ouros), Milestone 7. Priority: Medium. Effort: not sized. Depends on: M6-3.
Status in scratch: verdict pending (UI research section 2).

## Source of truth

- ~/.cache/claude-scratch/metatrooper-ui-research-2026-10-12/report.html section 2 item 3; contracts/pipe-protocol.md:129 (worktree.create exists, the workbench never calls it)

## What was designed

- An optional branch or worktree name in "+ New" and the start form calls worktree.create. Demand: Superset #7168 (13), #7318 (10), #6398 (7).
- Each agent-list row shows its branch and owned dev port; cmux's poll put this first with 55 votes. Size S to M.
- Overlaps M8-25 in Ouros; build once.

## Blocked on

- Go or drop on UI research section 2.

## Acceptance criteria

- [ ] M7-13a. Name `fix-x` creates worktree and branch `fix-x` and launches the session in it.
- [ ] M7-13b. An empty field behaves exactly as today.
- [ ] M7-13c. A taken name shows an error and starts nothing.
- [ ] M7-13d. A row shows the branch, and the dev port once M6-3 detects one.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for any fix Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
