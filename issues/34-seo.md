# `seo` plugin and `seo-audit-fix`

Part of the MetaTrooper epic. Milestone 3. Effort: about 2 Claude Code days.

Depends on: child #17, child #25.

## What

`seo` plugin and `seo-audit-fix`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with a small gauge for the worst key page.

- Layouts: triage, coverage-map, before-after, pr-first, run-log. Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `approve` waits, `speed` ends round 3 with a key page under 90, or `crawl` or `deploy` fails.
- Pick, first match: a failure to run-log; `speed` gave up to before-after; `approve` to pr-first. Opened by hand:
  coverage-map during `crawl` or `audit`, triage during `prioritise` or `fix`, before-after during `speed`, run-log
  otherwise.
- Steps (two-engine decision, 2026-10-04): `crawl`, `audit` (fanout 5), `prioritise`, `fix` (worktree), `speed`
  (verify, loop, max 3), `approve` (gate, approve), `deploy` (action, publish, external, `plugin:deploy/production`).
  Sitemap submission is a hand-back line. `requires`: seo, repo, deploy.

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.
