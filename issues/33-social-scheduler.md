# `social-scheduler` plugin and `clips-to-scheduled-posts`

Part of the MetaTrooper epic. Milestone 3. Effort: about 1.5 Claude Code days.

Depends on: child #32.

## What

`social-scheduler` plugin and `clips-to-scheduled-posts`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with a live clip thumbnail and its caption.

- Layouts: variants-grid (clip cards), preview-stage (clip stage), timeline (the week, platforms as tracks),
  pr-first (the batch), run-log. Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `pick` or `approve` waits, or any step fails, including a post the scheduler rejects.
- Pick, first match: a failure to run-log; `pick` to variants-grid; `approve` with a flag left to preview-stage on
  that clip and platform; `approve` otherwise to pr-first. Opened by hand: timeline with the hand-back when done,
  run-log while a step runs.
- Steps (two-engine decision, 2026-10-04): `ingest` (action, ingest), `transcribe` (action, worker), `moments`
  (agent, research, view items), `pick` (gate, handoff), `cut` (action, worker, fanout 4), `style` (action, worker,
  fanout 4), `copy` (agent, worker), `check` (agent, visual-check), `approve` (gate, approve, guards `schedule`),
  `schedule` (action, publish, external).

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
