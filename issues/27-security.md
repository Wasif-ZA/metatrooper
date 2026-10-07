# `security` plugin and `security-review-and-upgrade`

Part of the MetaTrooper epic. Milestone 2. Effort: about 1.5 Claude Code days.

Depends on: child #18, child #25.

## What

`security` plugin and `security-review-and-upgrade`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with no live extra. The round 1 red test and its fix are ink, not
orange.

- Layouts: pr-first (upgrade PR), triage (ledger), triage (findings), before-after (posture), run-log (fix loop).
  Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `approve-upgrade` waits, a high reachable finding is not closed by the plan, the check and fix loop
  pauses at max, or a licence conflicts.
- Pick, first match: a failure or the loop at max to run-log; a licence conflict to triage (ledger); a high
  reachable finding to triage (findings); `approve-upgrade` to pr-first. Opened by hand: before-after once handed
  back, run-log while a step runs.
- Steps (two-engine decision, 2026-10-04): `inventory`, `notes`, `plan`, `bump`, `check` and `fix` loop (max 2),
  `licences`, `approve-upgrade` (gate, approve). The hand-back list is the end-of-run tray, not a step.

## Acceptance criteria

- [ ] M2-01. Each milestone-2 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
