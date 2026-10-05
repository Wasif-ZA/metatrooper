# `data` plugin and `data-to-dashboard`

Child #20 of the MetaTrooper epic. Milestone 3. Effort: about 1 Claude Code days.

Depends on: child #4, child #5.

## What

`data` plugin and `data-to-dashboard`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with a small dashboard thumbnail once `build` lands.

- Layouts: preview-stage, artifact-columns, coverage-map, before-after, run-log. Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `signoff` waits, `readback` hits loop max with a headline still wrong, or `load` or `qa` fails.
- Pick, first match: a failure to run-log; `readback` gave up to preview-stage on that headline; `signoff` to
  preview-stage. Opened by hand: before-after during `load` or `clean`, coverage-map during `qa`, artifact-columns
  during `plan`, `build`, `readback` or `narrate`, run-log once signed off.
- Steps (accepted by Wasif 2026-10-05): `load` (action, ingest, `plugin:data/load`), `clean` (agent, worker), `qa`
  (agent, verify), `plan` (agent, plan), `build` (agent, worker, `plugin:data/render`), `readback` (agent,
  visual-check, loop with `build`, max 2), `narrate` (agent, worker), `signoff` (gate, handoff). Sending the summary
  is a hand-back line, not a step.

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #1, #4 and #6.
- No em dashes; comments say what the code does, not why.
