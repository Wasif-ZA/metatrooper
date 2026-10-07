# `gmail` plugin, `prospect-list-to-drafts`, `inbox-triage-drafts`

Part of the MetaTrooper epic. Milestone 3. Effort: about 2 Claude Code days.

Depends on: child #15, child #16, child #23.

## What

`gmail` plugin, `prospect-list-to-drafts`, `inbox-triage-drafts`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic. Nothing is ever sent: both pipelines end in Gmail drafts.

### `prospect-list-to-drafts`

Background: the 36px wall bar, no thumbnail.

- Layouts: coverage-map (lead table), triage (draft queue), preview-stage (inbox preview), pr-first (the batch),
  run-log.
- Opens when `approve-spend` or `approve` waits, or any step fails, including a refused draft. A `check` flag opens
  it only through `approve`.
- Pick, first match: a failure to run-log; `approve-spend` to coverage-map; `approve` with a flag left to triage on
  that draft; `approve` otherwise to pr-first. Opened by hand: pr-first with the hand-back when done, coverage-map
  while a step runs. preview-stage is by hand only.
- Steps (two-engine decision, 2026-10-04): `load`, `approve-spend` (gate, approve, guards `sources`), `sources`
  (external), `hook` (fanout 4), `write`, `check`, `approve` (gate, approve, guards `drafts`), `drafts` (action,
  publish, external).

### `inbox-triage-drafts`

Background: the 36px wall bar, no thumbnail. Spam and injected messages never open it.

- Layouts: triage (reply queue), buckets (piles), preview-stage (thread), pr-first (drafts batch), run-log.
- Opens when `approve` waits, or any step fails, including a refused draft.
- Pick, first match: a failure to run-log; `approve` with a flag left to triage on that reply; `approve` otherwise to
  pr-first. Opened by hand: pr-first with the hand-back when done, buckets while a step runs. preview-stage is by
  hand only.
- Steps (accepted by Wasif 2026-10-05): `rules` (code, ingest), `fetch` (action, ingest, `plugin:gmail/read`),
  `classify` (agent, review, view items), `draft` (agent, worker), `check` (agent, verify), `approve` (gate,
  approve, guards `drafts`), `drafts` (action, publish, external, `plugin:gmail/draft`). The schedule
  `0 8,12,15 * * *` is a schedule row, not a step.

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
