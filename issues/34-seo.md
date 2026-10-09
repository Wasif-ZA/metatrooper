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

Tag: M5 (after 12-01, per M5-D11). Nothing here is built before launch.

### Ideas

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| SA-I1 | Deterministic checks first, model judgement only where needed (JeffLi1993/seo-audit-skill) | new code step `checks` between `crawl` and `audit` | `crawl` already extracts title, meta description, canonical, H1 count and images without alt (`plugins/seo/bin/seo.js:55-75`). `checks` turns these into rule findings in `<run>/checks.json`, with the same shape as the audit files: missing or duplicate title, missing meta description, H1 count not 1, images without alt, missing canonical, broken links. The `audit` prompt reads `checks.json` and is told not to repeat those rules. `prioritise` reads `checks.json` along with the audit files | On the fixture site with one page missing a title and one broken link, `checks.json` holds exactly those two findings, and no `audit-*.json` repeats either one | 0.5 |
| SA-I2 | Lighthouse with the SEO category as well as performance (GoogleChrome/lighthouse) | `speed` | The prompt runs Lighthouse with `--only-categories=performance,seo` and records both scores per key page in `speed.md` and the `scores` output. The `approve` gate summary shows both. `passed` still reads performance only | On the fixture site, `speed.md` has a performance and an SEO score for each of the three key pages, and the gate summary shows both | 0.2 |
| SA-I3 | Rank by severity and search visibility, labelling partial data as a heuristic (iannuttall/seo, StJudeWasHere/seonaut) | `crawl`, `prioritise` | `crawl` already counts inbound internal links to rank key pages (`seo.js:115-118`) but does not save the count. It writes `inbound` on each page in `site-crawl.json`. `prioritise` ranks by severity times the page's inbound count, and the top of `FIXES.md` says "visibility is estimated from internal links" when no search data is present | On the fixture, two findings of the same severity rank with the page that has more inbound links first, and `FIXES.md` carries the heuristic label | 0.3 |
| SA-I4 | Ground findings in Search Console and GA4 data (nowork-studio/notfair-plugin, saurabhsharma2u/search-console-mcp) | new action `plugin:seo/search-console` after `crawl`; `prioritise` | An optional, read-only action pulls clicks and impressions per page for the last 28 days into `<run>/search-data.json`, using a user-held credential stored with `troop plugin secret seo`. Without the secret the step is skipped and SA-I3's heuristic label stays. `prioritise` uses clicks in place of inbound links when the file exists | With a fake Search Console response, `FIXES.md` ranks the page with more clicks first and drops the heuristic label. With no secret, the step shows skipped and the run carries on | 1.5 |
| SA-I5 | Performance budgets enforced (treosh/lighthouse-ci-action, ModusCreateOrg/gimbal) | `speed` | When the repo has `lighthouse-budget.json` (Lighthouse's budget format), `speed` passes it with `--budget-path` and lists each over-budget item in `speed.md`. `passed` is false while any budget is exceeded. Without the file, nothing changes | A fixture repo with a 1 KB script budget and a 5 KB script gives `passed: false` and names the script in `speed.md` | 0.4 |

Worked: 0.5 + 0.2 + 0.3 + 1.5 + 0.4 = 2.9 CC days.

### Hardening

| Id | Failure, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| SA-H1 | The crawler ignores robots.txt or noindex (lgraubner/sitemap-generator, janreges/siteone-crawler) | `crawl` (`seo.js`) | Partly true: robots.txt `Disallow` for `*` is honoured and skipped URLs are listed (`seo.js:18-38`, `seo.js:121`). `analyse` also reads `<meta name="robots">` and the `X-Robots-Tag` header and saves `noindex` and `nofollow` per page. Links on a `nofollow` page are not queued. `noindex` pages are never chosen as key pages | On the fixture site, a page with `noindex` shows `noindex: true` and is not in `key_pages`, and a link found only on a `nofollow` page is not crawled | 0.3 |
| SA-H2 | The agent is pointed at internal addresses (JeffLi1993/seo-audit-skill) | `crawl` | Already true: every request goes through `safeFetch`, which refuses private, link-local and loopback addresses on each redirect hop unless the start URL itself is loopback (`plugins/seo/bin/safe-fetch.js:37-58`, `seo.js:11-16`) | Covered by the existing safe-fetch tests | 0 |
| SA-H3 | An audit step writes to the site (nowork-studio/notfair-plugin) | `audit`, `prioritise` | Both run with `approval: edits`, and only the prompt says "Do not edit the repository". A new code step `readonly-check` after `prioritise` compares `git status --porcelain` and `HEAD` of the project with a snapshot taken before `audit`. Any difference fails the run and names the changed files | A fixture where an audit lane writes a file into the project fails at `readonly-check`, naming that file. A clean run passes | 0.4 |
| SA-H4 | One noisy Lighthouse run triggers a false regression (treosh/lighthouse-ci-action `numberOfRuns`) | `speed` | The prompt runs Lighthouse 3 times per key page and records the median score. `speed.md` keeps all three numbers. `passed` reads the medians | On the fixture, `speed.md` has three scores and a median per page, and `passed` follows the medians | 0.3 |
| SA-H5 | A fix is deployed without checks (OpenClaudia/openclaudia-skills) | new code step `predeploy` before `approve` | The `approve` gate is already a human check before `deploy`. `predeploy` adds an automatic one: it serves the fix worktree on loopback, re-runs `plugin:seo/crawl` on it, and compares the result with `site-crawl.json`. Any new broken link, or a page that lost its title or meta description, goes into the `approve` gate summary as a blocking line | A fixture fix that deletes a page another page links to puts a "new broken link" line in the gate summary, naming both pages | 0.5 |

Worked: 0.3 + 0 + 0.4 + 0.3 + 0.5 = 1.5 CC days. Both tables: 2.9 + 1.5 = 4.4 CC days.
