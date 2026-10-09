# M5-17 Hardening the built-ins from the repo scan

Child of Milestone 5 in `spec.md`. Tag: BLOCKER for the set below (5.1 CC days, 4.6 before T2 joined); the rest M5, after 12-01. Decided M5-D11.
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
| S8 | spec-to-pr | a crashed suite reads as "0 new failures" | `plugins/repo/bin/repo.js` (`failingTests`, read by `pipelines/spec-to-pr/compare-tests.mjs`) | 0.25 |
| E1 | e2e-browser-qa | a missing or malformed `findings.json` reads as "None found" | `pipelines/e2e-browser-qa/report.mjs:70-81` | 0.5 |
| E2 | e2e-browser-qa | the dev server counts as ready on any HTTP answer, a 500 included, and a foreign process on the port passes | `core/src/pipelines/devserver.ts:25` | 0.5 |
| S3 | all agent steps | the one agent retry inherits the first attempt's start time, so it gets almost no time | `core/src/pipelines/runner.ts:807` | 0.5 |
| T2 | two-engine-review | a split verdict sends a finding both engines placed into `disagree`, so the fix loop never fixes it (M5-D16) | `bucket.mjs`, workbench `review.js` and `rules.js` | 0.5 |

Worked: 0.4 + 0.4 + 0.3 + 0.2 + 0.3 + 0.75 + 0.5 + 0.25 + 0.5 + 0.5 + 0.5 + 0.5 = 5.1 CC days. The first eleven are
built on `m5-harden`; T2 joined the set on 2026-10-09 (M5-D16).

## Acceptance criteria

Each item's "smallest failing test" in the research file is its criterion: it fails on main at `ace0783` and passes
after the fix. M5-17 is done when all 12 do, and `tests/release.ps1` (M5-9) still passes.

## M5, after 12-01

Tag: M5 (after 12-01).

Each item's failure scenario, fix and smallest failing test are in `ide-layer-research/m5-hardening-coding.md` under
the same id; that test is its acceptance criterion (fails on main before the fix, passes after).

| Id | Pipeline | What goes wrong today | Code | CC days |
|---|---|---|---|---|
| T3 | two-engine-review | one engine failing or timing out fails the run and throws the other engine's review away | `two-engine-review.json:55,69`, `runner.ts:858`, `:560-572`, `validate.ts` | 1.0 |
| T6 | two-engine-review | an empty diff still starts both engine sessions | `diff.mjs:36,51`, `validate.ts:157`, `runner.ts:406` | 0.75 |
| T7 | two-engine-review | lockfiles, binaries and huge diffs go to the engines, or crash the diff step with `ENOBUFS` | `diff.mjs:21,33` | 0.6 |
| T8 | two-engine-review | one engine's duplicate findings become a fake `codex_only`, and matching takes the first overlap, not the closest | `bucket.mjs:53-57` | 0.4 |
| T9 | two-engine-review | a standalone run leaves intent-to-add entries in the user's real index | `diff.mjs:32` | 0.4 |
| T10 | two-engine-review | CRLF flips show as whole-file rewrites; Latin-1 source is rewritten as U+FFFD | `diff.mjs:33,37` | 0.3 |
| H2 | spec-build-review-handback | rereview drops `gemini_only`, calls new bugs "still found", and cannot follow line drift | `handback.mjs:29` | 1.0 |
| H3 | spec-build-review-handback | the fix agent, reverify and rereview run when there is nothing to fix | `spec-build-review-handback.json:61-71`, `validate.ts:157` | 0.5 |
| H4 | spec-build-review-handback | "tests fail after the fix" cannot tell old failures from new ones | `spec-build-review-handback.json:32-42`, `handback.mjs:30` | 0.4 |
| H5 | spec-build-review-handback | rereview reviews the whole build again, not the fix | `spec-build-review-handback.json:81-89` | 0.8 |
| H7 | spec-build-review-handback | the hand-back prints one side of each disagreement and orders by bucket, not severity | `handback.mjs:14-18,28` | 0.4 |
| H8 | spec-build-review-handback | nothing checks the fix stayed inside the findings it was given | `spec-build-review-handback.json:69` | 0.6 |
| H9 | spec-build-review-handback | a failed step after the build leaves no hand-back, and retries are uncapped | `spec-build-review-handback.json:91-96`, `runner.ts:560-572,752` | 1.0 |
| S1 | spec-to-pr | the build branch is cut from HEAD, not `base_branch`, and `repo` is never compared to the remote | `runner.ts:649`, `spec-to-pr.json:92`, `plugins/github/bin/github.js:19,22` | 1.0 |
| S5 | spec-to-pr | gh and push access are first tested at the last step | `validate.ts:170-176`, `store.ts:66-68`, `github.js:19-24` | 0.75 |
| S6 | spec-to-pr | `approve-pr` does not say whether the base moved | `github.js:19-22`, `spec-to-pr.json:80` | 0.5 |
| S7 | spec-to-pr | retrying `open-pr` after a partial success fails with "already exists" | `github.js:22-24` | 0.25 |
| S9 | spec-to-pr | dependencies install only for npm; pnpm, yarn and uv repos test an empty tree | `runner.ts:112-121`, `repo.js:32` | 0.75 |
| S10 | spec-to-pr | spec-lint passes vague specs, and an over-large change reaches the PR gate unflagged | `pipelines/spec-to-pr/spec-lint.mjs:52-58` | 0.5 |
| E4 | e2e-browser-qa | a page behind login produces fake bugs, and fix then edits the auth | `contracts/browser-tools.md:10`, `e2e-browser-qa.json:38` | 0.75 |
| E5 | e2e-browser-qa | "fixed" is the fix agent's word; nothing re-walks the flows | `e2e-browser-qa.json:47,51-57`, `report.mjs:83-84` | 1.5 |
| E6 | e2e-browser-qa | reverify failures cannot be told apart from failures that were there before | `e2e-browser-qa.json:28-40`, `report.mjs:89` | 0.4 |
| E7 | e2e-browser-qa | full-page screenshots go to the agent as uncapped PNGs up to 16,384 px tall | `workbench/src/browser/panes.ts:574-582`, `core/src/hook/browser-mcp.ts:116-119` | 0.4 |
| E8 | e2e-browser-qa | a qa timeout loses every finding, and fix has no scope or size limit | `runner.ts:752,858`, `e2e-browser-qa.json:38` | 0.4 |
| E9 | e2e-browser-qa | every console error and failed request becomes a finding, favicon 404s included | `e2e-browser-qa.json:38` | 0.4 |
| E10 | e2e-browser-qa | `flows.md` is never checked, and flow start pages are not tied to the dev server | `e2e-browser-qa.json:25-26,38` | 0.25 |

Worked, by pipeline: two-engine-review 1.0 + 0.75 + 0.6 + 0.4 + 0.4 + 0.3 = 3.45; handback 1.0 + 0.5 + 0.4 + 0.8 +
0.4 + 0.6 + 1.0 = 4.7; spec-to-pr 1.0 + 0.75 + 0.5 + 0.25 + 0.75 + 0.5 = 3.75; e2e-browser-qa 0.75 + 1.5 + 0.4 + 0.4 +
0.4 + 0.4 + 0.25 = 4.1. Total 3.45 + 4.7 + 3.75 + 4.1 = 16.0 CC days for 26 items. The shared runner changes below are
counted in both items of each pair, so the real cost is a little lower.

- T3 and H9 share a new soft-fail step flag; T6 and H3 share `when` on agent steps. Build each pair together.
- H2, H4, H5 are prerequisites M5-6 builds its own versions of; fold them back into this pipeline after M5-6 lands.
- E8's retry clock is the same `runner.ts:807` line S3 fixes in the launch set.

## Preview pipelines

The same scan ran for the 13 preview and unshipped pipelines. Their repo tables and ideas are in
`ide-layer-research/m5-repo-scan-preview.md`, and each open issue file for those lanes links its section. Nothing
there is built before launch (M5-D11). Each preview pipeline's ideas are now specced in its own issue file, and
website-build and design-variants in `issues/m5-20-built-preview-ideas.md`.
