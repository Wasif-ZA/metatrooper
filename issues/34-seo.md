# `seo` plugin and `seo-audit-fix`

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

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

## Helper tools (M4-8)

| Helper | Repo | Licence | Risk | Egress | Step it helps |
|---|---|---|---|---|---|
| unlighthouse | harlan-zw/unlighthouse | MIT | OK | requests only to the site under audit; otherwise not checked | crawl and speed |
| siteone-crawler | janreges/siteone-crawler | MIT | OK | requests only to the site under audit; otherwise not checked | audit |
| Lighthouse | GoogleChrome/lighthouse | Apache-2.0 | OK | requests only to the page under audit; otherwise not checked | speed |
| lychee | lycheeverse/lychee | Apache-2.0 | OK | requests to every host whose link it checks | audit |

Helpers are optional. Each pipeline runs without them. They are listed in `pipelines/assists/registry.json` once the pipeline is built (registry format in `issues/m4-09-helper-tools.md`).

## Ideas (M4-8)

### Requirements

- Median of 5, never concurrent: `speed` scores each key page as the median of 5 sequential Lighthouse runs; the `audit` fan-out never runs Lighthouse in parallel (GoogleChrome/lighthouse).
- Same crawl before and after, diffed: crawl the preview build on its leased port before `approve` and diff findings against the first crawl; `pr-first` lists fixed, still open and new (janreges/siteone-crawler).

### Notes

- Show the spread: each key page shows median and min to max; a change smaller than the spread is labelled noise (GoogleChrome/lighthouse). Medium, S.
- Sample by route on big sites: group URLs by route pattern and audit a sample per group (harlan-zw/unlighthouse). Medium, S.
- Link check the build, not production: `--remap` the production host onto the preview port and `--cache` between loop rounds (lycheeverse/lychee). Medium, S.
- Regenerate the sitemap from the crawl in `fix` (janreges/siteone-crawler). Low, S.

## Repo scan 2026-10-09

Relevant repos, top ideas and hardening for `seo-audit-fix`: `ide-layer-research/m5-repo-scan-preview.md`, the section with the same name. Idea bank only; nothing there is built before launch (M5-D11).
