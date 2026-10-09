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

## Repo scan 2026-10-09

Relevant repos, top ideas and hardening for `data-to-dashboard`: `ide-layer-research/m5-repo-scan-preview.md`, the section with the same name. Idea bank only; nothing there is built before launch (M5-D11).

Tag: M5 (after 12-01, per M5-D11). Nothing here is built before launch.

### Ideas

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| DD-I1 | Define each KPI once and build only from that, from Canner/WrenAI, dbt-labs/dbt-charts | new action step `kpis` after `plan`, `build` | Partly true: `plan` writes each KPI's SQL once in `DASHBOARD.md`, and `plugin:data/render` already runs every sql block (`plugins/data/bin/data.js:84-108`), but the pipeline never calls it. Add `kpis` (`uses: plugin:data/render`, spec `DASHBOARD.md`, db `data.sqlite`). The `build` prompt takes every headline value from `kpis.json` and writes no SQL of its own | On the fixture, `kpis.json` holds 5 entries and every headline on the page equals its `kpis.json` value | 0.4 |
| DD-I2 | Recompute the numbers in code, not with the model's own sums, from ellie886/Datalume, melihbirim/csvql | new code step `recount` before `qa` | `pipelines/data-to-dashboard/recount.mjs` runs `COUNT(*)`, and `SUM` for every column where 90% of non-empty values parse as numbers, on `raw` and the clean table. It writes `recount.json` and outputs `passed`: false when any total is more than 0.5% off (the threshold lives only in the `qa` prompt today). The row-count gap is shown, not judged. `qa` explains the result; the `signoff` summary reads `steps.recount.outputs.passed` | A fixture where `clean` drops 10% of the rows of a number column: `recount.json` shows the gap and `passed` is false | 0.5 |
| DD-I3 | Clean in code first; the model sees only what is left, from Varn1t/EDAgent, rhiever/datacleaner | new code step `preclean` before `clean` | `pipelines/data-to-dashboard/preclean.mjs` builds table `pre` from `raw`: cells trimmed, empty to NULL, currency and thousands commas to REAL when every non-empty value in the column parses, dates to YYYY-MM-DD only when one day value above 12 settles the order for the whole column, exact duplicate rows removed. It lists each change in `PRECLEAN.md`. `clean` starts from `pre` and fixes only what is left | A fixture column of values like `$1,200.50` becomes REAL `1200.5` in `pre`, and `PRECLEAN.md` names the column | 0.75 |
| DD-I4 | Profile the CSV before anything reads it, from Data-Centric-AI-Community/fg-data-profiling, BdR76/CSVLint | `load` | Partly true: `load` already reports rows, columns and ragged lines (`data.js:44-61`). It also writes `profile.json` beside the database: per column the non-empty count, distinct count, share that parses as a number and as a date, and 3 sample values. The `clean` and `qa` prompts read it | A fixture column that is 40% blank shows a non-empty count of 60% of the rows in `profile.json` | 0.3 |
| DD-I5 | Check each chart spec against the data before render, from hustcc/mcp-echarts, antvis/mcp-server-chart | `build`, new code step `chart-check` after `build` | `build` also writes `charts.json` (per chart: KPI name, type, x and y columns). `chart-check.mjs` checks each column exists in that KPI's `kpis.json` result (needs DD-I1), that a line chart has a date or number x, and that a pie has at most 8 rows and no negative value. Failures are written to `READBACK.md`, which the `build` and `readback` loop already reads | A fixture pie over 20 categories fails `chart-check` with "pie over 8 slices" | 0.5 |

Worked: 0.4 + 0.5 + 0.75 + 0.3 + 0.5 = 2.45 CC days.

### Hardening

| Id | Idea, from (repo) | Step | Change | Acceptance (observable on a fixture) | CC days |
|---|---|---|---|---|---|
| DD-H1 | No destructive query, from Canner/WrenAI, datagallery-ai/dataagent | `load`, `recount` | Partly true: `query` and `render` open the database read-only (`data.js:68`). The agent steps can still write to `data.sqlite`, `raw` included. `load` outputs `raw_hash`, a sha256 over the `raw` rows in rowid order; `recount` (DD-I2) recomputes it and fails with "raw changed" when it differs | A test that edits `raw` between `load` and `recount` makes `recount` fail with "raw changed" | 0.3 |
| DD-H2 | Summaries, not rows, when the table is big, from Varn1t/EDAgent, zhongyu09/openchatbi | `clean`, `qa` | Partly true: `query` caps returned rows at 1000 (`data.js:67-72`). The `clean` prompt drops the `{{inputs.csv}}` path, reads `profile.json` (DD-I4), and reads rows only through `plugin:data/query` with a limit of 50 | A test asserts the `clean` prompt in `pipelines/data-to-dashboard.json` has no `inputs.csv` reference | 0.2 |
| DD-H3 | Model-written chart code must not reach outside the page, from togethercomputer/open-data-scientist, ellie886/Datalume | `chart-check` | Partly true: the page is static, served by `http-server` from the run folder, and the prompt asks for one self-contained page. `chart-check` (DD-I5) also fails an `index.html` that loads any script, stylesheet or image from outside `dashboard/` | A fixture `index.html` with a CDN script tag fails with "external script" | 0.2 |
| DD-H4 | Validate headers and types against a declared schema, from Quantco/dataframely, posit-dev/pointblank | `load` | New optional pipeline input `schema` (a JSON map of column name to text, number or date), passed to `plugin:data/load`. Headers must match by name, and 95% of non-empty values in each typed column must parse; otherwise `load` fails listing the missing, extra and mistyped columns. No schema: no change | A schema expecting `price: number` and a CSV where half the prices are `n/a` fails `load` naming `price` | 0.4 |
| DD-H5 | Compare the printed numbers, not only the screenshot, from HKUSTDial/DataMagic, canimus/cuallee | `build`, new code step `numbers-check` after `build` | Partly true: `readback` reads headlines off the page against `DASHBOARD.md`. The `build` prompt puts `data-kpi="<name>"` on each headline. `numbers-check.mjs` parses `index.html`, normalises each headline (currency, commas, %, k and M suffixes) and compares it with the `kpis.json` value (needs DD-I1) within 0.5%, plus the unit symbol. Mismatches go to `READBACK.md` before the visual readback | A fixture page showing `$1.2M` for a value of 1150000 fails (4.3% off) | 0.5 |

Worked: 0.3 + 0.2 + 0.2 + 0.4 + 0.5 = 1.6 CC days.

Issue total: 2.45 + 1.6 = 4.05 CC days.
