# M8-25: Parallel agents: worktree per agent and collision warnings

Part of Ouros, Milestone 8. Priority: High. Effort: not sized (sized after M8-0). Depends on: M8-17.
Status in scratch: decided (FEATURES.md #1, top ranked); collisions partial (PAINS.md #12).
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-25; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): research/next/FEATURES.md #1; PAINS.md #12; two-engine/reconcile.md P3; check overlap with issues/m7-06-sessions.md.

## What was designed

- New-agent dialog offers its own worktree; the tile shows a branch chip such as `ouros/rate-limit`; a tile menu hands work between Local and Worktree.
- A conflict preview shows when two agents touch one repo. Two agents on one repo is the wall's headline use, and collision handling is the third-biggest gap in PAINS.md.
- 2026-11-05: the new-agent dialog is now the start box with chips: M8-F14.

## Blocked on

- M8-0.

## Acceptance criteria

- [ ] M8-25a. A new agent can start in its own worktree.
- [ ] M8-25b. A tile shows its branch.
- [ ] M8-25c. A second agent touching the same file shows a warning before either applies.
- [ ] M8-25d. Local to Worktree handoff keeps uncommitted work.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
