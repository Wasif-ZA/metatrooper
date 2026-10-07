# Two-engine review pipeline and view

Part of the MetaTrooper epic. Milestone 1. Effort: about 1 Claude Code days.

Depends on: child #15, child #16.

## What

Two-engine review pipeline and view

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: spec.md § Two-engine review.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with dot-bar progress. Done with nothing for the user, it settles as
a calm `review done` bar.

- Layouts: pr-inline, duel, buckets, coverage-map, triage. Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when the Disagree bucket is not empty, or a finding is critical.
- Pick, first match: Disagree to duel; a critical finding to triage; findings in 3 or more files to buckets; one or
  two files to pr-inline. coverage-map is by hand only. No layout shows a winner.
- Steps: as in `pipelines/two-engine-review.json`.

## Acceptance criteria

- [ ] M1-26. `two-engine-review` on a diff with one planted bug returns both verdicts and the four buckets within 5 minutes.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
