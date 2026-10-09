# M5-6 Pro: PR review and fix loop with a proof gate

Child of Milestone 5 in `spec.md`. Tag: BLOCKER (ships 2026-12-01). Effort 3.5 CC days (worked below). Codex writes the tests.

This is the one thing Pro sells at launch (money plan 2026-10-08): a PR reviewed by Codex and Gemini, fixed by
Claude, and a finding counts as fixed only with proof. The demand scan (`ide-layer-research/m5-demand.md`) adds that
`openai/codex-plugin-cc` (33,994 stars) already gives Claude Code users a free Codex review, so the paid part is the
fix loop, the proof and the third engine, never "Codex reviews Claude".

## Current state, verified 2026-10-09

- `pipelines/spec-build-review-handback.json` starts from a spec (`spec`, `approve-spec`, `build`), then `verify`,
  `review` (sub-pipeline `two-engine-review`), `fix` (fixes only the `both` bucket, prompt at `:69` ends "Then run
  the tests"), `reverify`, `rereview`, `handback` (`handback.mjs`).
- `handback.mjs:29-30` lists findings still found and failing tests, but nothing refuses to count a fix without
  proof, and nothing records which finding a change was for.
- No entry point reviews an existing branch or PR. Only two-engine-review has had a real-engine run (M1-26).

## What to build

New built-in `pipelines/pr-review-fix.json` (layouts `duel`, `pr-inline`, `before-after`, `hand-back`, `run-log`):

| Step | Kind | Does |
|---|---|---|
| `checkout` | code | Input `range` (`base..head`) or `branch`; creates a worktree at head; writes `range.json` |
| `scan` | code | M4-20 secret scan of the diff before any external send (M5-8) |
| `send-check` | gate, `when` scan found something | as M4-4 |
| `review` | pipeline | `two-engine-review` on the range |
| `fix` | agent (claude, worker) | Fixes the `both` and `codex_only` and `gemini_only` findings the user ticks at `pick`; for each finding id writes an entry in `fixes.json` |
| `pick` | gate | the user ticks which findings to fix (default: all `both`) |
| `proof` | code | checks every `fixes.json` entry (rules below) |
| `rereview` | pipeline | `two-engine-review` on `base..worktree` |
| `handback` | code | per finding: fixed with proof, claimed without proof, still found, not picked |

`fixes.json` shape, written by the fix agent:

```json
{"fixes": [{"finding": "<finding id from review-buckets.json>", "status": "fixed",
  "proof": {"kind": "test", "test": "<test file>::<test name>", "command": "<one test command>"}},
 {"finding": "<id>", "status": "fixed", "proof": {"kind": "diff"}},
 {"finding": "<id>", "status": "not-fixed", "reason": "<one line>"}]}
```

Proof rules, all in code, no model:

- `test` proof passes when the named test passes in the fixed worktree AND fails when the fix's non-test hunks are
  reverted (`git stash push -- <changed non-test files>`, run, `git stash pop`). A test that passes either way is not
  proof.
- `diff` proof passes when the fix diff changes at least one line inside the finding's `line_start..line_end`
  widened by 3 (the `WIDEN` rule in `bucket.mjs`).
- A finding is **fixed** only when its proof passes AND `rereview` no longer reports a finding overlapping it.
  Otherwise the hand-back lists it as "claimed, no proof" or "still found". The hand-back never says "fixed" for
  anything else.

The proof code lives with the Pro code (M5-7 decides where); the pipeline file names it as a code step.

## Acceptance criteria

- M5-06a. On `tests/fixtures/pr-review-fix/` (a repo with three planted bugs and a test suite), a fake-engine run
  whose fix agent claims all three with one real test proof, one test that passes before and after, and one diff
  proof outside the finding's lines gives: 1 fixed, 2 claimed without proof.
- M5-06b. A finding the rereview still reports is "still found" even with a passing proof.
- M5-06c. No step runs an engine before `send-check` when the scan has findings.
- M5-06d. One real run with Claude, Codex and agy on the fixture, Wasif on screen (L28), recorded in UI-STATUS.

## Effort, worked

Pipeline file and checkout 0.5 + proof step 1.25 + handback and layouts wiring 0.5 + fixture with planted bugs 0.5 +
real run 0.5 + slack for the `pick` gate 0.25 = 3.5 CC days.
