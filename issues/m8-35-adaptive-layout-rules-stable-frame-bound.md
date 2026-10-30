# M8-35: Adaptive layout rules: stable frame, boundary-only changes, confidence floor

Part of Ouros, Milestone 8. Priority: Medium. Effort: not sized (sized after M8-0). Depends on: M8-7, M8-11.
Status in scratch: stashed ("not bad, just stash them").
**Start on or after 2026-11-09.**

## Source of truth

- `spec.md` Milestone 8 row M8-35; `ouros-spec.md`.
- Scratch (`~/.cache/claude-scratch/ouros-ide-fiveshot-2026-10-30` unless a path says otherwise): ~/.cache/claude-scratch/ouros-fiveshot-2026-10-30/STASH.md, research-r3/ADAPTIVE.md, round-3/ (idle-to-review.gif).

## What was designed

- Per-workflow zone screens were stashed; their rules were not. Evidence: Findlater 2009 (48 users), predicted items can appear but spatial layout must never move.
- Four rules: a stable frame, change only at a task boundary, a confidence floor, Undo.
- A status-bar layout line shows how many changes fired and Ctrl+Z.

## Blocked on

- MORPH.html verdict.

## Acceptance criteria

- [ ] M8-35a. The status bar shows the layout-change count and Ctrl+Z reverts the last one.
- [ ] M8-35b. A layout change happens only at a task boundary, never mid-run.
- [ ] M8-35c. Below the confidence floor nothing changes.
- [ ] M8-35d. Title bar, sidebar and status bar never move.

## Rules that bind every child

- **Start on or after 2026-11-09.** Own projects are frozen until 2026-11-08; this file is a spec, not a go.
- Never commit, push or open PRs from an agent; hand back the command.
- New repo dependencies pass the gate: MIT, 25k+ stars, maintained.
- Codex writes the tests for any step Claude builds, and the other way round.
- No em dashes; comments say what the code does, not why.
