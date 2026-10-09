# `cite-check` plugin and `deep-research-cited`

Moved to M5 (launch) on 2026-10-09: every undone item here is M5 work now; its tag (BLOCKER or M5) is in `issues/m5-00-rebaseline.md`.

Part of the MetaTrooper epic. Milestone 3. Effort: about 1 Claude Code days.

Depends on: child #15, child #17, child #23.

## What

`cite-check` plugin and `deep-research-cited`

## Source of truth

- `spec.md`, section "Milestones and child issues" and the sections it names.
- Contracts: see spec.md for the plugin and pipeline this child adds.
- If this issue and the contracts disagree, the contracts win.

## UI

Background. The run folds to the 36px wall bar with no live extra.

- Layouts: artifact-columns, run-log, coverage-map, pr-inline (citations), preview-stage (the report). Keys 1 to 5 pick the layouts in the order above; 0 goes back to automatic.
- Opens when `approve-plan` waits, `cite-check` still fails at loop max, or any step fails. Never on done.
- Pick, first match: a failure to run-log; loop max to pr-inline on the first unbound claim; `approve-plan` to
  artifact-columns. Opened by hand: preview-stage when done, coverage-map during `sweep`, `depth` or `critic`,
  run-log otherwise.
- Steps (two-engine decision, 2026-10-04): `decompose`, `approve-plan` (gate, approve), `sweep`, `depth` (fanout 4),
  `critic`, `draft`, `critics` (fanout 3), `patch`, `cite-check` (loop with `patch`, max 2). No deliver step: the
  report stays in the run folder.

## Acceptance criteria

- [ ] M3-01. Each milestone-3 built-in runs end to end on its fixture and stops at every gate before a publish step.
- [x] M3-02. `cite-check` fails a report with one planted quote absent from its source and passes the same report with curly quotes and extra whitespace in a real quote.

## Rules that bind every child

- Never commit, push or open PRs from an agent; hand back the command.
- Codex writes the tests for children #12, #15 and #17.
- No em dashes; comments say what the code does, not why.

## Helper tools (M4-8)

| Helper | Repo | Licence | Risk | Egress | Step it helps |
|---|---|---|---|---|---|
| crawl4ai | unclecode/crawl4ai | Apache-2.0 | OK | not checked (fetches the pages you point it at) | depth |
| trafilatura | adbar/trafilatura | Apache-2.0 | OK | not checked | cite-check |
| gpt-researcher | assafelovic/gpt-researcher | Apache-2.0 | OK | uses a remote filter when `TYPESAFE_API_KEY` is set; otherwise not checked | sweep |
| local-deep-research | LearningCircuit/local-deep-research | MIT | OK | not checked (runs on Ollama; its "Private only" scope limits it to local sources) | sweep |

Helpers are optional. Each pipeline runs without them. They are listed in `pipelines/assists/registry.json` once the pipeline is built (registry format in `issues/m4-09-helper-tools.md`).

## Ideas (M4-8)

### Requirements

- Plan from a first search: `decompose` runs one quick search first and writes sub-questions that name what the results showed; the approve-plan card shows that evidence (assafelovic/gpt-researcher).
- Keyword filter before the model reads: a code step keeps only BM25-ranked passages per sub-question before the agent reads sources (assafelovic/gpt-researcher).
- Keep raw text for quotes, filtered text for reading: save both; agents read the fit text and `cite-check` matches quotes against the raw text (unclecode/crawl4ai).

### Notes

- Every learning carries its URL: `depth` writes `{insight, sourceUrl}` so `draft` cites only sourced learnings (assafelovic/gpt-researcher). Medium, S.
- Source cards with date and author, so `critic` can flag claims resting on old or authorless pages (adbar/trafilatura). Medium, S.
- Dead links before cite-check: a code pass over every cited URL, using `--format json` and `--cache` (lycheeverse/lychee). Medium, S.
- Journal quality on academic sources: check against open lists (OpenAlex, DOAJ, Stop Predatory Journals) in `critic` (LearningCircuit/local-deep-research). Low, M.
- Private-topic mode: a run input `private: true` limits `sweep` to local files and refuses remote engines (LearningCircuit/local-deep-research). Medium, M.
