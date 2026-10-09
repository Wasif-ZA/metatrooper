# M5-17 Hardening the built-ins from the repo scan

Child of Milestone 5 in `spec.md`. Tag: BLOCKER for the set below (4.6 CC days); the rest M5, after 12-01. Decided M5-D11.
Codex writes the tests.

## Where this comes from

On 2026-10-09 every pipeline got a GitHub scan: about 110 repos per pipeline from four searches, the 50 most starred
read by the local model (gemma4:12b, 850 READMEs, no cloud tokens), then a Sonnet pass that dropped the off-topic
ones, kept 40 to 43 relevant repos per pipeline, and checked each idea against the code. The full tables and every
item with its failure scenario, fix, smallest failing test and source repos are in
`ide-layer-research/m5-hardening-coding.md`. Item ids below (T, H, S, E) point there.

## The launch set: every case where a broken run looks like a clean one

A pipeline that fails loudly costs the user a retry. A pipeline that fails silently and reports "no problems" costs
the user trust, and Pro sells trust. So launch hardening is exactly that class, plus the retry clock bug.

| Id | Pipeline | What goes wrong today | Code | CC days |
|---|---|---|---|---|
| T1 | two-engine-review | `./a.js`, `src\a.js`, `line` instead of `line_start`, or string line numbers drop a real finding into `outside_change` or the wrong bucket | `pipelines/two-engine-review/bucket.mjs:14-63` | 0.4 |
| T4 | two-engine-review | unparseable engine output reads as "no findings" | `bucket.mjs:66-89` | 0.4 |
| T5 | two-engine-review | file names with spaces or non-ASCII miss the hunk map | `bucket.mjs:25-27`, `diff.mjs:33` | 0.3 |
| H1 | spec-build-review-handback | a missing or corrupt review result makes the hand-back look clean | `pipelines/spec-build-review-handback/handback.mjs:4-12` | 0.2 |
| H6 | spec-build-review-handback | a retried review leaves two folders and the fix step reads the stale one | `handback.mjs:4-12`, `spec-build-review-handback.json:69` | 0.3 |
| S2 | spec-to-pr | `build` can finish with nothing committed or a dirty tree, and `verify` tests the working tree, not the pushed commit | `pipelines/spec-to-pr.json`, new `check-build` code step | 0.75 |
| S4 + E3 | spec-to-pr, e2e-browser-qa | no test runner found fails the whole run after the build; detection misses `tests/`-only and `setup.cfg` pytest layouts | `plugins/repo/bin/repo.js:92` | 0.5 |
| S8 | spec-to-pr | a crashed suite reads as "0 new failures" | `pipelines/spec-to-pr/compare-tests.mjs` | 0.25 |
| E1 | e2e-browser-qa | a missing or malformed `findings.json` reads as "None found" | `pipelines/e2e-browser-qa/report.mjs:70-81` | 0.5 |
| E2 | e2e-browser-qa | the dev server counts as ready on any HTTP answer, a 500 included, and a foreign process on the port passes | `core/src/pipelines/devserver.ts:25` | 0.5 |
| S3 | all agent steps | the one agent retry inherits the first attempt's start time, so it gets almost no time | `core/src/pipelines/runner.ts:807` | 0.5 |

Worked: 0.4 + 0.4 + 0.3 + 0.2 + 0.3 + 0.75 + 0.5 + 0.25 + 0.5 + 0.5 + 0.5 = 4.6 CC days.

## Acceptance criteria

Each item's "smallest failing test" in the research file is its criterion: it fails on main at `ace0783` and passes
after the fix. M5-17 is done when all 11 do, and `tests/release.ps1` (M5-9) still passes.

## M5, after 12-01

- T2 (a split verdict hides agreed findings from the fix loop) changes what "disagree" means on the review screen,
  so it waits for Wasif's word.
- T3 and H9 (one engine timing out loses the other engine's review; a failed step leaves no hand-back) share a new
  soft-fail step flag; T6 and H3 share `when` on agent steps. Build each pair together.
- H2, H4, H5 are prerequisites M5-6 builds its own versions of; fold them back into this pipeline after M5-6 lands.
- S1, S5, S6, S7, S9, S10, E4 to E10, T7 to T10, H7, H8: in the research file, ranked.

## Preview pipelines

The same scan ran for the 13 preview and unshipped pipelines. Their repo tables and ideas are in
`ide-layer-research/m5-repo-scan-preview.md`, and each open issue file for those lanes links its section. Nothing
there is built before launch (M5-D11).
