# `data` plugin and `data-to-dashboard`

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Part of the MetaTrooper epic. Milestone 3. Effort: about 1 Claude Code days.

Depends on: child #15, child #16.

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
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.

## Helper tools (M4-8)

| Helper | Repo | Licence | Risk | Egress | Step it helps |
|---|---|---|---|---|---|
| DuckDB CLI | duckdb/duckdb | MIT | OK | none (reads local files) | load and qa |
| Evidence | evidence-dev/evidence | MIT | OK | not checked | build |
| Datasette | simonw/datasette | Apache-2.0 | OK | none (local web server) | readback |
| mcp-server-chart | antvis/mcp-server-chart | MIT | OK | sends chart data to `https://antv-studio.alipay.com/api/gpt-vis` by default (`VIS_REQUEST_SERVER`); private only with a self-hosted GPT-Vis-SSR. Show orange on the chip | build |

Helpers are optional. Each pipeline runs without them. They are listed in `pipelines/assists/registry.json` once the pipeline is built (registry format in `issues/m4-09-helper-tools.md`).

## Ideas (M4-8)

### Requirements

- Numbers bound to named queries: `build` writes a manifest of each headline number, its query name and SQL; `readback` re-runs each query through `plugin:data` and compares; a typed literal number fails the step (evidence-dev/evidence).
- Column profile before and after clean: profile at `load` and after `clean` with plain SQL aggregates (node:sqlite, or DuckDB when installed); `before-after` shows per-column deltas (duckdb/duckdb).

### Notes

- Narration cites its query: each sentence with a number links to its query and `signoff` shows the working (evidence-dev/evidence). Medium, S.
- Browse rows behind a headline: with Datasette installed, a headline opens the filtered rows in a browser pane at `signoff` (simonw/datasette). Low, S.

## Added requirement (M4-8)

`node:sqlite` stays the built-in path for the `data` plugin. DuckDB, Evidence and Datasette are optional helpers only.
