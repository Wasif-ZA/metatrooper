# `cite-check` plugin and `deep-research-cited`

Part of the MetaTrooper epic. Milestone 3. Effort: about 1 Claude Code days.

Depends on: child #15, child #17, child #23.

## What

`cite-check` plugin and `deep-research-cited`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with no live extra.

- Layouts: artifact-columns, run-log, coverage-map, pr-inline (citations), preview-stage (the report). Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `approve-plan` waits, `cite-check` still fails at loop max, or any step fails. Never on done.
- Pick, first match: a failure to run-log; loop max to pr-inline on the first unbound claim; `approve-plan` to
  artifact-columns. Opened by hand: preview-stage when done, coverage-map during `sweep`, `depth` or `critic`,
  run-log otherwise.
- Steps (two-engine decision, 2026-10-04): `decompose`, `approve-plan` (gate, approve), `sweep`, `depth` (fanout 4),
  `critic`, `draft`, `critics` (fanout 3), `patch`, `cite-check` (loop with `patch`, max 2). No deliver step: the
  report stays in the run folder.

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.
- [x] M3-02. `cite-check` fails a report with one planted quote absent from its source and passes the same report with curly quotes and extra whitespace in a real quote.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
