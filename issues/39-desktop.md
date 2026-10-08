# `desktop` plugin, handoff gate UI, `form-fill-batch`

Part of the MetaTrooper epic. Milestone 3. Effort: about 3 Claude Code days.

Depends on: child #15, child #16, child #17.

## What

`desktop` plugin, handoff gate UI, `form-fill-batch`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Foreground. The loop stops for a captcha about every 35 s, too often to stay folded. Done or cancelled, it settles
as a calm 36px wall bar.

- Layouts: coverage-map (row grid), triage (task queue), preview-stage (take control), pr-first (submit), run-log.
  Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens at run start. Folded by hand, it opens again when `captcha` or `approve` waits, or any step fails.
- Pick, first match: a failure to run-log; a shown captcha to preview-stage on that row's window; a row with no
  captcha keeps the current layout; `approve` to pr-first; otherwise coverage-map. triage is by hand only.
- Steps (approve-once decided by Wasif 2026-10-05): `map` (agent, plan), `fill` (agent, worker), `captcha` (gate,
  handoff), `shot` (action, visual-check, loop over `fill`, `captcha`, `shot` until no rows are left, max 20),
  `approve` (gate, approve, guards `submit`), `submit` (action, publish, external, one action for every row),
  `confirm` (action, verify). 6 rows means 6 captcha stops and 1 approve.

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.
- [x] M3-03. `form-fill-batch` pauses at a handoff gate when the fixture form shows its captcha stand-in and resumes on Continue.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
