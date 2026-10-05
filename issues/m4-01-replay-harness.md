# M4-1 Replay harness, baselines, before-runs

Child of Milestone 4 in `spec.md` (Milestones and child issues). Decisions M4-D1 to M4-D12 and the
verified current state are there; this file is what to build.

## What to build
- Fixture: `tests/fixtures/token-replay/repo/` is a copy of `tests/fixtures/spec-to-pr`, committed as one
  commit. Three patches apply to it: `small.patch` (1 file, under 30 changed lines), `medium.patch` (3 to 5
  files), `large.patch` (10 or more files, 300 or more changed lines). All three are written for M4-1 and
  committed.
- `tests/replay/token-replay.mjs --diff <small|medium|large> --mode <before|after>`:
  1. Copies the fixture repo to a temp folder, applies the patch without committing, runs `diff.mjs` logic
     (`git diff HEAD`) to produce `review.diff`.
  2. Renders the `codex-review` prompt from `pipelines/two-engine-review.json` with `{{steps.diff.outputs.diff_file}}`
     set to the literal `RUN/review.diff`, `{{inputs.range}}` to `HEAD`, and (after M4-3)
     `{{steps.map.outputs.hint}}` to the value M4-3 defines for `mode`.
  3. `before`: offered context = rendered prompt + `review.diff` + the full working-tree text of every file
     named in a `diff --git` header of `review.diff`.
     `after`: offered context = rendered prompt + `review.diff` + the text result of calling
     `get_review_context_tool` once with `{"files": [<those file paths>]}` (arguments checked against the
     tool's `inputSchema` from `tools/list` when M4-3 is built) on `code-review-graph serve --repo <temp>`
     after `code-review-graph build` in the temp folder. The harness speaks MCP JSON-RPC over stdio itself
     (`initialize`, `tools/list`, `tools/call`; about 60 lines), no SDK dependency.
  4. Prints `{"diff", "mode", "bytes", "tokens"}` with `tokens = ceil(bytes / 4)`, UTF-8 bytes. This is a
     proxy for what the agent is offered, not a tokenizer count; the same rule on both sides keeps the
     ratio meaningful.
- `tests/fixtures/token-replay/baseline.json`: `{"<diff>": {"before": {"bytes", "tokens"}}}` for all three
  diffs, committed in a commit before any M4-3 change.
- Before-runs, real engines, done once by Wasif with the steps in `tests/replay/REAL-RUNS.md`:
  `troop run start two-engine-review --project tests/fixtures/token-replay/repo` with `large.patch` applied,
  and `troop run start spec-to-pr --input idea="add a /health route that returns ok" --input repo=<a scratch
  GitHub repo> ` stopped by Reject at `approve-pr` (nothing is pushed). Their meter totals per step (Claude
  plus Codex tokens, from `usage`) are written into `tests/fixtures/token-replay/real-before.json` with the
  run ids and the commit hash.

## Acceptance criteria

- M4-01. `baseline.json` and `real-before.json` are committed in a commit that precedes every M4-3 commit.
- M4-03. Replay: for each of `small`, `medium`, `large`, compute `after.tokens / before.tokens` for
  `codex-review`. The median of the three ratios is at most 0.70.
- M4-04. After M4-3, M4-9 and M4-10 land, the same two real runs as `real-before.json` are repeated on the
  same fixture and inputs: for each pipeline, the total Claude plus Codex tokens of its agent steps is lower
  than before. Recorded in `tests/fixtures/token-replay/real-after.json`. No threshold.

## Tests

| Criterion | Test | Kind |
|---|---|---|
| M4-01, M4-03 | `tests/replay/token-replay.test.mjs` runs the harness on the three diffs and checks the median | integration, needs code-review-graph installed; skipped with a printed reason otherwise |
| M4-04, M4-12 | `tests/replay/REAL-RUNS.md` steps, done by Wasif | manual |

Tests by Codex. A test that needs a real external tool skips with a printed reason when it is absent.
