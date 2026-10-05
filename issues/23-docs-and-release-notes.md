# `docs-and-release-notes`

Child #23 of the MetaTrooper epic. Milestone 2. Effort: about 1 Claude Code days.

Depends on: child #14.

## What

`docs-and-release-notes`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with chips for the planned bump and the docs touched; no live
extra.

- Layouts: pr-first (release draft), run-log, before-after (change request), preview-stage (agent checklist),
  artifact-columns (changelog feed). Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `approve` waits, a sample still fails after the fix pass, `release` fails, or a breaking PR has no doc
  under `docs/how-to/upgrade-*`.
- Pick, first match: a sample or `release` failure to run-log; a breaking PR with no migration note to pr-first with
  that line on top; `approve` to pr-first; `release` done to artifact-columns. Opened by hand: preview-stage while
  a step runs. before-after is by hand only.
- Steps (two-engine decision, 2026-10-04): `diff`, `map`, `update` (fanout 3, no worktree), `changelog`, `samples`,
  `approve` (gate, approve), `release` (publish, external). The staged docs end in the hand-back tray, not a step.

## Acceptance criteria

- [ ] M2-01. Each milestone-2 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
