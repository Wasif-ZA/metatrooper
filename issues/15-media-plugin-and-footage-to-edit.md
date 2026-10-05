# `media` plugin and `footage-to-edit`

Child #15 of the MetaTrooper epic. Milestone 3. Effort: about 2.5 Claude Code days.

Depends on: child #4, child #5.

## What

`media` plugin and `footage-to-edit`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with a small programme strip showing cut ticks.

- Layouts: timeline (text view and strip mode are toggles), preview-stage (screening room), before-after (cut
  pair), pipe (take cards), run-log. Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `approve-plan` or `approve-final` waits, the last `edit` pass leaves a flag `left for you`, or any step
  fails.
- Pick, first match: a failure to run-log; `approve-plan` to timeline in text view; `approve-final` to
  preview-stage; a flag left before `approve-final` to before-after on that cut. Opened by hand: preview-stage with
  the hand-back once approved, pipe while a step runs.
- Steps (two-engine decision, 2026-10-04): `inventory`, `transcribe`, `plan`, `approve-plan` (gate, approve),
  `edit`, `visual-check` (loop with `edit`, max 2), `approve-final` (gate, approve). No external or publish step.

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
